// Release record guard.
//
// Warns when release/component-release.json and the code it points at drift apart,
// and when the partner pins in the five component acceptance workflow are far behind.
// Fails only in strict mode.
//
// Default (warn only): problems print as GitHub warnings and the exit code is 0,
// even if git is missing or the guard itself throws.
// Strict (--strict or RELEASE_GUARD_STRICT=1): exit code 1 when a problem is found.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RECORD_PATH = "release/component-release.json";
export const PINS_WORKFLOW = ".github/workflows/five-component-acceptance.yml";
export const SCHEMA = "ai-verse.component-release/v1";
export const STALE_AFTER_COMMITS = 50;
const SHA = /^[0-9a-f]{40}$/;

// Files that hold the package version at the accepted commit.
export const VERSION_HOLDERS = [
  { path: "package.json", read: (t) => JSON.parse(t).version },
  { path: "src/index.ts", read: (t) => /AI_VERSE_DATA_PACKAGE_VERSION\s*=\s*"([^"]+)"/.exec(t)?.[1] },
  { path: "src/native/extension-types.ts", read: (t) => /AI_VERSE_DATA_EXTENSION_VERSION\s*=\s*"([^"]+)"/.exec(t)?.[1] },
];

export const PARTNERS = {
  OS: "aiverse-filmmakers/AI-Verse-OS",
  BRAIN: "aiverse-filmmakers/AI-Verse-Brain",
  MEMORY: "aiverse-filmmakers/AI-Verse-Memory",
  SKILLS: "aiverse-filmmakers/AI-Verse-Skills",
};

export function git(repo, ...args) {
  try {
    const stdout = execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout };
  } catch (error) {
    const code = typeof error.status === "number" ? error.status : 127;
    return { code, stdout: "", missing: error.code === "ENOENT" };
  }
}

function loadRecord(repo, problems) {
  let data;
  try {
    data = JSON.parse(readFileSync(path.join(repo, RECORD_PATH), "utf8"));
  } catch (error) {
    problems.push(`The release record ${RECORD_PATH} cannot be read as JSON (${error.message}).`);
    return null;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    problems.push("The release record is not a JSON object.");
    return null;
  }
  if (data.schema_version !== SCHEMA) problems.push(`The release record schema_version is not ${SCHEMA}.`);
  for (const key of ["version", "revision", "release_status"]) {
    if (typeof data[key] !== "string" || !data[key]) problems.push(`The release record is missing a text field named ${key}.`);
  }
  if (typeof data.revision === "string" && !SHA.test(data.revision)) {
    problems.push("The release record revision is not a full 40 character commit id.");
  }
  return data;
}

function checkEvidence(data, problems) {
  const evidence = data.evidence;
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) {
    problems.push("The release record has no evidence section.");
    return;
  }
  const seen = new Map();
  for (const group of ["ci", "acceptance"]) {
    const entries = evidence[group];
    if (!Array.isArray(entries)) {
      problems.push(`The release record evidence.${group} is not a list.`);
      continue;
    }
    for (const entry of entries) {
      const runId = entry && typeof entry === "object" ? entry.run_id : undefined;
      if (runId === undefined || runId === null || runId === "") {
        problems.push(`An evidence.${group} entry has no run_id.`);
        continue;
      }
      if (entry.revision !== undefined && entry.revision !== data.revision) {
        problems.push(`An evidence.${group} entry (run ${runId}) names a different revision than the record.`);
      }
      const id = String(runId);
      if (seen.has(id)) {
        problems.push(
          `CI run ${id} is listed twice as separate evidence (evidence.${seen.get(id)} and evidence.${group}). One run is one proof, not two.`,
        );
      } else {
        seen.set(id, group);
      }
    }
  }
}

function checkVersionsAtCommit(repo, revision, version, problems) {
  const short = revision.slice(0, 12);
  for (const holder of VERSION_HOLDERS) {
    const shown = git(repo, "show", `${revision}:${holder.path}`);
    if (shown.code !== 0) {
      problems.push(`${holder.path} does not exist at the accepted commit ${short}.`);
      continue;
    }
    let have;
    try {
      have = holder.read(shown.stdout);
    } catch {
      have = undefined;
    }
    if (have !== version) {
      problems.push(
        `${holder.path} at the accepted commit ${short} says ${have ?? "no version"}, but the record says ${version}.`,
      );
    }
  }
}

export function parsePins(text) {
  const pins = [];
  for (const [key, repoName] of Object.entries(PARTNERS)) {
    const match = new RegExp(`^\\s*${key}_SHA:\\s*([0-9a-f]{40})\\s*$`, "m").exec(text);
    if (match) pins.push({ key, repo: repoName, sha: match[1] });
  }
  return pins;
}

// Asks GitHub how far the default branch is ahead of a pin. Returns a number, or null when unreachable.
export async function fetchBehind(repoName, sha, env = process.env) {
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const get = async (url) => {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
  const repoInfo = await get(`https://api.github.com/repos/${repoName}`);
  const compare = await get(`https://api.github.com/repos/${repoName}/compare/${sha}...${repoInfo.default_branch}`);
  return Number.isInteger(compare.ahead_by) ? compare.ahead_by : null;
}

async function checkPins(repo, warnings, notes, fetcher) {
  let text;
  try {
    text = readFileSync(path.join(repo, PINS_WORKFLOW), "utf8");
  } catch {
    notes.push(`Partner pins not checked: ${PINS_WORKFLOW} was not found.`);
    return;
  }
  const pins = parsePins(text);
  if (!pins.length) notes.push(`Partner pins not checked: no pins found in ${PINS_WORKFLOW}.`);
  for (const pin of pins) {
    let behind = null;
    try {
      behind = await fetcher(pin.repo, pin.sha);
    } catch (error) {
      notes.push(`Partner pin for ${pin.key} not checked: the repository could not be read (${error.message}).`);
      continue;
    }
    if (behind === null) {
      notes.push(`Partner pin for ${pin.key} not checked: no commit count was returned.`);
    } else if (behind > STALE_AFTER_COMMITS) {
      warnings.push(
        `Heads up: the ${pin.key} pin ${pin.sha.slice(0, 12)} in ${PINS_WORKFLOW} is ${behind} commits behind the default branch of ${pin.repo} (limit ${STALE_AFTER_COMMITS}). The five component test may not reflect what members get. This is a warning only.`,
      );
    }
  }
}

export async function check(repo, { fetcher = fetchBehind } = {}) {
  const problems = [];
  const warnings = [];
  const notes = [];
  const data = loadRecord(repo, problems);
  if (data) {
    checkEvidence(data, problems);
    const { revision, version } = data;
    if (typeof revision === "string" && SHA.test(revision) && typeof version === "string") {
      const exists = git(repo, "cat-file", "-e", `${revision}^{commit}`);
      if (exists.missing) {
        notes.push("Accepted commit not checked: git could not be run.");
      } else if (exists.code !== 0) {
        problems.push(
          `The accepted commit ${revision} does not exist in this repository (if this is a CI run, the checkout needs full history).`,
        );
      } else {
        checkVersionsAtCommit(repo, revision, version, problems);
        const count = git(repo, "rev-list", "--count", `${revision}..HEAD`);
        const ahead = Number.parseInt(count.stdout.trim(), 10);
        if (count.code === 0 && Number.isInteger(ahead) && ahead > STALE_AFTER_COMMITS) {
          warnings.push(
            `Heads up: the code is ${ahead} commits ahead of the accepted commit ${revision.slice(0, 12)} (limit ${STALE_AFTER_COMMITS}). The release record is getting stale and should be refreshed. This is a warning only.`,
          );
        }
      }
    }
  }
  await checkPins(repo, warnings, notes, fetcher);
  return { problems, warnings, notes };
}

export function strictRequested(argStrict, env) {
  return Boolean(argStrict) || !["", "0", "false", undefined].includes(env.RELEASE_GUARD_STRICT);
}

export async function run(repo, strict, env = process.env, options = {}) {
  const { problems, warnings, notes } = await check(repo, options);
  for (const w of warnings) console.log(`::warning title=Release record is getting stale::${w}`);
  for (const p of problems) {
    console.log(`${strict ? "::error" : "::warning"} title=Release record mismatch::${p}`);
  }
  const lines = ["## Release record guard", ""];
  if (problems.length) {
    const mode = strict ? "strict (blocks CI)" : "warn only (does not block CI)";
    lines.push(`Mode: ${mode}. ${problems.length} problem(s) found:`);
    lines.push(...problems.map((p) => `- ${p}`));
  } else {
    lines.push("The release record and the code at its accepted commit agree.");
  }
  lines.push(...warnings.map((w) => `- Warning: ${w}`));
  lines.push(...notes.map((n) => `- Note: ${n}`));
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, "utf8");
    } catch {
      // The summary is a convenience; never fail on it.
    }
  }
  console.log(lines.join("\n"));
  return problems.length && strict ? 1 : 0;
}

export async function main(argv = process.argv.slice(2), env = process.env, options = {}) {
  const strict = strictRequested(argv.includes("--strict"), env);
  const repo = argv.find((a) => !a.startsWith("--")) ?? ".";
  try {
    return await run(repo, strict, env, options);
  } catch (error) {
    // The guard must never crash a build in warn mode.
    console.log(`::${strict ? "error" : "warning"} title=Release record guard crashed::The guard could not finish (${error?.message ?? error}).`);
    return strict ? 1 : 0;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
