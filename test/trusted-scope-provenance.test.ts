import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDataClient } from "../src/client/index.js";
import {
  DataScopeError,
  TrustedDataRoot,
  createWorkspaceDataScope,
  openScopedDataDatabase,
  type DataDatabaseScope,
} from "../src/scope/index.js";
import {
  AI_VERSE_DATA_SCOPE_BINDING_VERSION,
  SqliteStorageDriver,
} from "../src/storage/index.js";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function assertUntrusted(error: unknown): boolean {
  assert.ok(error instanceof DataScopeError);
  assert.equal(error.code, "SCOPE_UNTRUSTED");
  return true;
}

function forgedScope(
  trustedRootPath: string,
  workspaceId: string,
  databasePath: string,
): DataDatabaseScope {
  return {
    kind: "workspace",
    workspaceId,
    binding: {
      bindingVersion: AI_VERSE_DATA_SCOPE_BINDING_VERSION,
      kind: "workspace",
      workspaceId,
    },
    root: { canonicalPath: trustedRootPath },
    databasePath: () => databasePath,
  } as DataDatabaseScope;
}

test("scoped open rejects a structurally compatible forged scope before touching its outside path", () => {
  const trustedPath = tempDir("ai-verse-data-trusted-");
  const outsidePath = tempDir("ai-verse-data-outside-");
  try {
    const outsideDatabase = join(outsidePath, "forged.sqlite");
    const forged = forgedScope(trustedPath, "alpha", outsideDatabase);

    assert.throws(
      () => openScopedDataDatabase(new SqliteStorageDriver(), forged),
      assertUntrusted,
    );
    assert.equal(existsSync(outsideDatabase), false);
  } finally {
    rmSync(trustedPath, { recursive: true, force: true });
    rmSync(outsidePath, { recursive: true, force: true });
  }
});

test("createDataClient rejects an unbranded forged scope before creating an outside database", () => {
  const trustedPath = tempDir("ai-verse-data-client-trusted-");
  const outsidePath = tempDir("ai-verse-data-client-outside-");
  try {
    const outsideDatabase = join(outsidePath, "client-forged.sqlite");
    const forged = forgedScope(trustedPath, "alpha", outsideDatabase);

    assert.throws(
      () =>
        createDataClient({
          scope: forged,
          actor: { kind: "human", id: "scope-test" },
          authorization: { mode: "local-operator" },
        }),
      assertUntrusted,
    );
    assert.equal(existsSync(outsideDatabase), false);
  } finally {
    rmSync(trustedPath, { recursive: true, force: true });
    rmSync(outsidePath, { recursive: true, force: true });
  }
});

test("copying all visible fields and the real databasePath method does not copy trusted scope provenance", () => {
  const rootPath = tempDir("ai-verse-data-copy-root-");
  try {
    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    const real = createWorkspaceDataScope(root, "alpha");
    const copied = {
      kind: real.kind,
      workspaceId: real.workspaceId,
      binding: real.binding,
      root: real.root,
      databasePath: real.databasePath.bind(real),
    } as DataDatabaseScope;

    assert.throws(
      () => openScopedDataDatabase(new SqliteStorageDriver(), copied),
      assertUntrusted,
    );
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("trusted scope and root authority cannot be rewritten after construction", () => {
  const rootPath = tempDir("ai-verse-data-immutable-root-");
  const outsidePath = tempDir("ai-verse-data-immutable-outside-");
  try {
    mkdirSync(join(rootPath, "workspaces", "alpha", "data"), {
      recursive: true,
    });
    const root = TrustedDataRoot.fromExistingDirectory(rootPath);
    const scope = createWorkspaceDataScope(root, "alpha");
    const expectedDatabase = scope.databasePath();
    const outsideDatabase = join(outsidePath, "tampered.sqlite");

    assert.equal(Object.isFrozen(root), true);
    assert.equal(Object.isFrozen(scope), true);
    assert.equal(Object.isFrozen(scope.binding), true);

    assert.equal(Reflect.set(root as object, "canonicalPath", outsidePath), false);
    assert.equal(Reflect.set(scope as object, "workspaceId", "beta"), false);
    assert.equal(
      Reflect.set(scope.binding as object, "workspaceId", "beta"),
      false,
    );
    assert.equal(
      Reflect.set(scope as object, "databasePath", () => outsideDatabase),
      false,
    );

    const opened = openScopedDataDatabase(new SqliteStorageDriver(), scope);
    try {
      assert.equal(scope.workspaceId, "alpha");
      assert.equal(scope.binding.workspaceId, "alpha");
      assert.equal(scope.databasePath(), expectedDatabase);
      assert.equal(existsSync(expectedDatabase), true);
      assert.equal(existsSync(outsideDatabase), false);
      assert.deepEqual(opened.database.metadata().binding, {
        bindingVersion: AI_VERSE_DATA_SCOPE_BINDING_VERSION,
        kind: "workspace",
        workspaceId: "alpha",
      });
    } finally {
      opened.database.close();
    }
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
    rmSync(outsidePath, { recursive: true, force: true });
  }
});

test("scope constructors reject a forged TrustedDataRoot object", () => {
  const rootPath = tempDir("ai-verse-data-forged-root-");
  try {
    const forgedRoot = {
      canonicalPath: rootPath,
      resolve: (...segments: readonly string[]) => join(rootPath, ...segments),
    } as unknown as TrustedDataRoot;

    assert.throws(
      () => createWorkspaceDataScope(forgedRoot, "alpha"),
      assertUntrusted,
    );
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});
