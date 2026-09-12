import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  DataScopeError,
  TrustedDataRoot,
  createStandaloneDataScope,
  createWorkspaceDataScope,
  openScopedDataDatabase,
} from "../src/scope/index.js";
import {
  AI_VERSE_DATA_SCOPE_BINDING_VERSION,
  DataStorageError,
  SqliteStorageDriver,
} from "../src/storage/index.js";

function withTempRoot(run: (rootPath: string) => void): void {
  const rootPath = realpathSync(mkdtempSync(join(tmpdir(), "ai-verse-data-scope-")));
  try {
    run(rootPath);
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
}

function assertScopeError(
  error: unknown,
  expectedCode: DataScopeError["code"],
): boolean {
  assert.ok(error instanceof DataScopeError);
  assert.equal(error.code, expectedCode);
  return true;
}

function assertStorageError(
  error: unknown,
  expectedCode: DataStorageError["code"],
): boolean {
  assert.ok(error instanceof DataStorageError);
  assert.equal(error.code, expectedCode);
  return true;
}

test("trusted roots canonicalize an existing directory", () => {
  withTempRoot((rootPath) => {
    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    assert.equal(root.canonicalPath, realpathSync(resolve(rootPath)));
  });
});

test("trusted roots reject missing paths and non-directories", () => {
  withTempRoot((rootPath) => {
    assert.throws(
      () =>
        TrustedDataRoot.fromExistingDirectory(
          join(rootPath, "does-not-exist"),
        ),
      (error) => assertScopeError(error, "ROOT_NOT_FOUND"),
    );

    const filePath = join(rootPath, "file.txt");
    writeFileSync(filePath, "not a root");
    assert.throws(
      () => TrustedDataRoot.fromExistingDirectory(filePath),
      (error) => assertScopeError(error, "ROOT_NOT_DIRECTORY"),
    );
  });
});

test("workspace scope resolves the canonical native-ready database path", () => {
  withTempRoot((rootPath) => {
    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    const scope = createWorkspaceDataScope(root, "production-01");

    assert.equal(scope.kind, "workspace");
    assert.equal(scope.workspaceId, "production-01");
    assert.equal(
      scope.databasePath(),
      join(
        resolve(rootPath),
        "workspaces",
        "production-01",
        "data",
        "ai-verse-data.sqlite",
      ),
    );
    assert.deepEqual(scope.binding, {
      bindingVersion: AI_VERSE_DATA_SCOPE_BINDING_VERSION,
      kind: "workspace",
      workspaceId: "production-01",
    });
    assert.deepEqual(Object.keys(scope.binding).sort(), [
      "bindingVersion",
      "kind",
      "workspaceId",
    ]);
  });
});

test("standalone scope uses the host-neutral project-local database path", () => {
  withTempRoot((rootPath) => {
    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    const scope = createStandaloneDataScope(root, "local");

    assert.equal(
      scope.databasePath(),
      join(resolve(rootPath), ".ai-verse-data", "data.sqlite"),
    );
    assert.deepEqual(scope.binding, {
      bindingVersion: AI_VERSE_DATA_SCOPE_BINDING_VERSION,
      kind: "standalone",
      workspaceId: "local",
    });
  });
});

test("filesystem-unsafe workspace IDs are rejected before path resolution", () => {
  withTempRoot((rootPath) => {
    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    for (const id of [
      "../other",
      "team/name",
      "team\\name",
      "team:name",
      "CON",
      "trailing.",
    ]) {
      assert.throws(
        () => createWorkspaceDataScope(root, id),
        (error) => assertScopeError(error, "WORKSPACE_ID_UNSAFE"),
      );
    }
  });
});

test("existing symlink components cannot redirect a scoped database outside the root", {
  skip: process.platform === "win32",
}, () => {
  withTempRoot((rootPath) => {
    const outside = mkdtempSync(join(tmpdir(), "ai-verse-data-outside-"));
    try {
      mkdirSync(join(rootPath, "workspaces"), { recursive: true });
      symlinkSync(outside, join(rootPath, "workspaces", "escaped"));

      const root = TrustedDataRoot.fromExistingDirectory(rootPath);
      const scope = createWorkspaceDataScope(root, "escaped");
      assert.throws(
        () => scope.databasePath(),
        (error) => assertScopeError(error, "PATH_SYMLINK_UNSAFE"),
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("scoped open binds a new database and preserves binding across reopen", () => {
  withTempRoot((rootPath) => {
    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    const scope = createWorkspaceDataScope(root, "alpha");
    mkdirSync(join(rootPath, "workspaces", "alpha", "data"), {
      recursive: true,
    });

    const driver = new SqliteStorageDriver();
    const first = openScopedDataDatabase(driver, scope);
    assert.deepEqual(first.database.metadata().binding, scope.binding);
    first.database.close();

    const second = openScopedDataDatabase(driver, scope, {
      mode: "open-existing",
    });
    assert.deepEqual(second.database.metadata().binding, scope.binding);
    second.database.close();
  });
});

test("an existing unbound AI-Verse Data database can be bound exactly once", () => {
  withTempRoot((rootPath) => {
    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    const scope = createStandaloneDataScope(root, "alpha");
    mkdirSync(join(rootPath, ".ai-verse-data"), { recursive: true });

    const driver = new SqliteStorageDriver();
    const raw = driver.open({ location: scope.databasePath() });
    assert.equal(raw.metadata().binding, null);
    raw.close();

    const bound = openScopedDataDatabase(driver, scope, {
      mode: "open-existing",
    });
    assert.deepEqual(bound.database.metadata().binding, scope.binding);
    bound.database.close();
  });
});

test("a bound database fails closed under a conflicting workspace identity", () => {
  withTempRoot((rootPath) => {
    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    const scope = createStandaloneDataScope(root, "alpha");
    mkdirSync(join(rootPath, ".ai-verse-data"), { recursive: true });

    const driver = new SqliteStorageDriver();
    const created = openScopedDataDatabase(driver, scope);
    const databasePath = scope.databasePath();
    created.database.close();

    assert.throws(
      () =>
        driver.open({
          location: databasePath,
          mode: "open-existing",
          expectedBinding: {
            bindingVersion: AI_VERSE_DATA_SCOPE_BINDING_VERSION,
            kind: "standalone",
            workspaceId: "beta",
          },
        }),
      (error) => assertStorageError(error, "DATABASE_SCOPE_CONFLICT"),
    );
  });
});

test("a bound database fails closed if its scope kind changes", () => {
  withTempRoot((rootPath) => {
    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    const scope = createStandaloneDataScope(root, "alpha");
    mkdirSync(join(rootPath, ".ai-verse-data"), { recursive: true });

    const driver = new SqliteStorageDriver();
    const created = openScopedDataDatabase(driver, scope);
    const databasePath = scope.databasePath();
    created.database.close();

    assert.throws(
      () =>
        driver.open({
          location: databasePath,
          mode: "open-existing",
          expectedBinding: {
            bindingVersion: AI_VERSE_DATA_SCOPE_BINDING_VERSION,
            kind: "workspace",
            workspaceId: "alpha",
          },
        }),
      (error) => assertStorageError(error, "DATABASE_SCOPE_CONFLICT"),
    );
  });
});

test("matching workspace IDs under different trusted roots remain physically isolated", () => {
  const rootAPath = mkdtempSync(join(tmpdir(), "ai-verse-data-root-a-"));
  const rootBPath = mkdtempSync(join(tmpdir(), "ai-verse-data-root-b-"));
  try {
    const rootA = TrustedDataRoot.fromExistingDirectory(rootAPath);
    const rootB = TrustedDataRoot.fromExistingDirectory(rootBPath);
    const scopeA = createWorkspaceDataScope(rootA, "shared");
    const scopeB = createWorkspaceDataScope(rootB, "shared");

    assert.notEqual(scopeA.databasePath(), scopeB.databasePath());
    assert.deepEqual(scopeA.binding, scopeB.binding);
  } finally {
    rmSync(rootAPath, { recursive: true, force: true });
    rmSync(rootBPath, { recursive: true, force: true });
  }
});
