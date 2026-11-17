import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { PINS_WORKFLOW, RECORD_PATH, SCHEMA, check, main, parsePins } from "./check-release-record.mjs";

const VERSION = "0.1.0-alpha.1.dev0";
const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const git = (repo, ...args) =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    encoding: "utf8",
  }).trim();

function put(repo, rel, text) {
  mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  writeFileSync(path.join(repo, rel), text);
}

function makeRepo(codeVersion = VERSION) {
  const repo = mkdtempSync(path.join(tmpdir(), "rrg-"));
  roots.push(repo);
  git(repo, "init", "-q");
  put(repo, "package.json", JSON.stringify({ name: "x", version: codeVersion }));
  put(repo, "src/index.ts", `export const AI_VERSE_DATA_PACKAGE_VERSION = "${codeVersion}" as const;\n`);
  put(repo, "src/native/extension-types.ts", `export const AI_VERSE_DATA_EXTENSION_VERSION = "${codeVersion}" as const;\n`);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "code");
  return { repo, sha: git(repo, "rev-parse", "HEAD") };
}

function record(sha, { ci = "1", acceptance = "2", version = VERSION } = {}) {
  return {
    schema_version: SCHEMA,
    version,
    revision: sha,
    release_status: "accepted",
    evidence: {
      ci: [{ status: "pass", revision: sha, run_id: ci }],
      acceptance: [{ status: "pass", revision: sha, run_id: acceptance }],
    },
  };
}

const noPins = async () => null;
const quiet = async (fn) => {
  const original = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(" "));
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
};

describe("release record guard", () => {
  it("passes when the record matches the code at the accepted commit", async () => {
    const { repo, sha } = makeRepo();
    put(repo, RECORD_PATH, JSON.stringify(record(sha)));
    const out = await check(repo, { fetcher: noPins });
    assert.deepEqual(out.problems, []);
    assert.deepEqual(out.warnings, []);
  });

  it("flags a version mismatch in every version holder at the accepted commit", async () => {
    const { repo, sha } = makeRepo("0.0.1");
    put(repo, RECORD_PATH, JSON.stringify(record(sha)));
    const { problems } = await check(repo, { fetcher: noPins });
    for (const file of ["package.json", "src/index.ts", "src/native/extension-types.ts"]) {
      assert.ok(problems.some((p) => p.startsWith(file)), file);
    }
  });

  it("flags one run id listed twice", async () => {
    const { repo, sha } = makeRepo();
    put(repo, RECORD_PATH, JSON.stringify(record(sha, { ci: "9", acceptance: "9" })));
    const { problems } = await check(repo, { fetcher: noPins });
    assert.ok(problems.some((p) => p.includes("CI run 9 is listed twice")));
  });

  it("flags a missing accepted commit and a malformed record", async () => {
    const { repo } = makeRepo();
    put(repo, RECORD_PATH, JSON.stringify(record("a".repeat(40))));
    assert.ok((await check(repo, { fetcher: noPins })).problems.some((p) => p.includes("does not exist")));
    put(repo, RECORD_PATH, "{ not json");
    assert.ok((await check(repo, { fetcher: noPins })).problems.some((p) => p.includes("cannot be read")));
    put(repo, RECORD_PATH, JSON.stringify({ schema_version: "x", revision: "short" }));
    assert.ok((await check(repo, { fetcher: noPins })).problems.length >= 3);
  });

  it("warns when HEAD is more than 50 commits ahead", async () => {
    const { repo, sha } = makeRepo();
    put(repo, RECORD_PATH, JSON.stringify(record(sha)));
    for (let i = 0; i < 51; i += 1) git(repo, "commit", "-q", "--allow-empty", "-m", `c${i}`);
    const { warnings } = await check(repo, { fetcher: noPins });
    assert.ok(warnings.some((w) => w.includes("51 commits ahead")));
  });

  it("parses partner pins and warns only for pins over 50 commits behind", async () => {
    const { repo, sha } = makeRepo();
    put(repo, RECORD_PATH, JSON.stringify(record(sha)));
    const pin = (n) => String(n).repeat(40);
    put(
      repo,
      PINS_WORKFLOW,
      ["OS_SHA: " + pin(1), "BRAIN_SHA: " + pin(2), "MEMORY_SHA: " + pin(3), "SKILLS_SHA: " + pin(4)].map((l) => `          ${l}`).join("\n"),
    );
    assert.equal(parsePins(readFileSync(path.join(repo, PINS_WORKFLOW), "utf8")).length, 4);
    const counts = { [pin(1)]: 545, [pin(2)]: 50, [pin(3)]: 51 };
    const fetcher = async (_repo, s) => {
      if (s === pin(4)) throw new Error("offline");
      return counts[s];
    };
    const { warnings, notes } = await check(repo, { fetcher });
    assert.equal(warnings.length, 2);
    assert.ok(warnings[0].includes("OS pin") && warnings[0].includes("545"));
    assert.ok(warnings[1].includes("MEMORY pin"));
    assert.ok(notes.some((n) => n.includes("SKILLS") && n.includes("not checked")));
  });

  it("skips quietly when the partner repositories cannot be read", async () => {
    const { repo, sha } = makeRepo();
    put(repo, RECORD_PATH, JSON.stringify(record(sha)));
    put(repo, PINS_WORKFLOW, "OS_SHA: " + "1".repeat(40));
    const failing = async () => {
      throw new Error("no network");
    };
    const out = await check(repo, { fetcher: failing });
    assert.deepEqual(out.warnings, []);
    assert.equal(out.notes.length, 1);
  });

  it("warn mode exits 0 on problems; strict mode exits 1", async () => {
    const { repo, sha } = makeRepo();
    put(repo, RECORD_PATH, JSON.stringify(record(sha, { ci: "7", acceptance: "7" })));
    const opts = { fetcher: noPins };
    const warn = await quiet(() => main([repo], {}, opts));
    assert.equal(warn.result, 0);
    assert.ok(warn.lines.some((l) => l.startsWith("::warning title=Release record mismatch")));
    const viaFlag = await quiet(() => main([repo, "--strict"], {}, opts));
    assert.equal(viaFlag.result, 1);
    assert.ok(viaFlag.lines.some((l) => l.startsWith("::error title=Release record mismatch")));
    assert.equal((await quiet(() => main([repo], { RELEASE_GUARD_STRICT: "1" }, opts))).result, 1);
    assert.equal((await quiet(() => main([repo], { RELEASE_GUARD_STRICT: "0" }, opts))).result, 0);
  });

  it("strict mode exits 0 when everything agrees", async () => {
    const { repo, sha } = makeRepo();
    put(repo, RECORD_PATH, JSON.stringify(record(sha)));
    assert.equal((await quiet(() => main([repo, "--strict"], {}, { fetcher: noPins }))).result, 0);
  });

  it("exits 0 in warn mode when git is missing", async () => {
    const { repo, sha } = makeRepo();
    put(repo, RECORD_PATH, JSON.stringify(record(sha, { ci: "7", acceptance: "7" })));
    const savedPath = process.env.PATH;
    process.env.PATH = path.join(repo, "no-such-bin");
    try {
      const warn = await quiet(() => main([repo], {}, { fetcher: noPins }));
      assert.equal(warn.result, 0);
      assert.ok(warn.lines.some((l) => l.includes("git could not be run")));
      assert.equal((await quiet(() => main([repo, "--strict"], {}, { fetcher: noPins }))).result, 1);
    } finally {
      process.env.PATH = savedPath;
    }
  });

  it("exits 0 in warn mode on an unexpected exception, 1 in strict mode", async () => {
    const { repo, sha } = makeRepo();
    put(repo, RECORD_PATH, JSON.stringify(record(sha)));
    const boom = (strictValue) =>
      new Proxy({ RELEASE_GUARD_STRICT: strictValue }, {
        get(target, key) {
          if (key === "GITHUB_STEP_SUMMARY") throw new Error("forced");
          return target[key];
        },
      });
    const warn = await quiet(() => main([repo], boom("0"), { fetcher: noPins }));
    assert.equal(warn.result, 0);
    assert.ok(warn.lines.some((l) => l.includes("Release record guard crashed")));
    assert.equal((await quiet(() => main([repo], boom("1"), { fetcher: noPins }))).result, 1);
  });

  it("writes the step summary when asked", async () => {
    const { repo, sha } = makeRepo();
    put(repo, RECORD_PATH, JSON.stringify(record(sha)));
    const summary = path.join(repo, "summary.md");
    await quiet(() => main([repo], { GITHUB_STEP_SUMMARY: summary }, { fetcher: noPins }));
    assert.match(readFileSync(summary, "utf8"), /Release record guard/);
  });
});
