import {
  existsSync,
  lstatSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import {
  AI_VERSE_DATA_SCOPE_BINDING_VERSION,
  type DataStorageDatabase,
  type DataStorageDriver,
  type StorageDatabaseBinding,
} from "../storage/index.js";
import { DataScopeError } from "./errors.js";
import type {
  DataDatabaseScope,
  ScopedDatabaseHandle,
  ScopedDatabaseOpenOptions,
  TrustedRootView,
} from "./types.js";

const MAX_WORKSPACE_ID_LENGTH = 128;
const SAFE_FILESYSTEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WINDOWS_RESERVED_NAME =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_UNSAFE_CHARACTERS = /[<>:"|?*]/;

const TRUSTED_ROOT_PATHS = new WeakMap<object, string>();

interface TrustedScopeFacts {
  readonly kind: "standalone" | "workspace";
  readonly workspaceId: string;
  readonly root: TrustedDataRoot;
  readonly relativeDatabasePath: readonly string[];
  readonly binding: StorageDatabaseBinding;
}

const TRUSTED_SCOPE_FACTS = new WeakMap<object, TrustedScopeFacts>();

function validateWorkspaceFilesystemId(workspaceId: string): void {
  if (
    workspaceId.length < 1 ||
    workspaceId.length > MAX_WORKSPACE_ID_LENGTH ||
    workspaceId === "." ||
    workspaceId === ".." ||
    !SAFE_FILESYSTEM_ID.test(workspaceId) ||
    WINDOWS_UNSAFE_CHARACTERS.test(workspaceId) ||
    workspaceId.endsWith(".") ||
    workspaceId.endsWith(" ") ||
    WINDOWS_RESERVED_NAME.test(workspaceId)
  ) {
    throw new DataScopeError(
      "WORKSPACE_ID_UNSAFE",
      "Workspace ID is not safe as a cross-platform filesystem segment.",
    );
  }
}

function validatePathSegment(segment: string): void {
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("\u0000") ||
    segment.includes("/") ||
    segment.includes("\\") ||
    isAbsolute(segment)
  ) {
    throw new DataScopeError(
      "PATH_COMPONENT_INVALID",
      "Data path components must be single relative filesystem segments.",
    );
  }
}

function isContained(root: string, target: string): boolean {
  const child = relative(root, target);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function trustedRootPath(root: TrustedDataRoot): string {
  const canonicalPath = TRUSTED_ROOT_PATHS.get(root as object);
  if (canonicalPath === undefined) {
    throw new DataScopeError(
      "SCOPE_UNTRUSTED",
      "Data scope root was not created by TrustedDataRoot.",
    );
  }
  return canonicalPath;
}

function trustedScopeFacts(scope: DataDatabaseScope): TrustedScopeFacts {
  if (typeof scope !== "object" || scope === null) {
    throw new DataScopeError(
      "SCOPE_UNTRUSTED",
      "Data database scope must be created by the trusted scope constructors.",
    );
  }
  const facts = TRUSTED_SCOPE_FACTS.get(scope as object);
  if (facts === undefined) {
    throw new DataScopeError(
      "SCOPE_UNTRUSTED",
      "Data database scope provenance is not trusted. Use createStandaloneDataScope or createWorkspaceDataScope with a TrustedDataRoot.",
    );
  }
  return facts;
}

function authoritativeScopePath(facts: TrustedScopeFacts): string {
  return facts.root.resolve(...facts.relativeDatabasePath);
}

export class TrustedDataRoot implements TrustedRootView {
  private constructor(canonicalPath: string) {
    TRUSTED_ROOT_PATHS.set(this, canonicalPath);
    Object.freeze(this);
  }

  get canonicalPath(): string {
    return trustedRootPath(this);
  }

  static fromExistingDirectory(rootPath: string): TrustedDataRoot {
    if (rootPath.length === 0 || rootPath.includes("\u0000")) {
      throw new DataScopeError(
        "ROOT_INVALID",
        "Trusted Data root must be a non-empty filesystem path without NUL.",
      );
    }

    const absolute = resolve(rootPath);
    if (!existsSync(absolute)) {
      throw new DataScopeError(
        "ROOT_NOT_FOUND",
        "Trusted Data root does not exist.",
      );
    }

    let canonicalPath: string;
    try {
      canonicalPath = realpathSync(absolute);
    } catch (error) {
      throw new DataScopeError(
        "ROOT_INVALID",
        "Trusted Data root could not be resolved.",
        error,
      );
    }

    if (!statSync(canonicalPath).isDirectory()) {
      throw new DataScopeError(
        "ROOT_NOT_DIRECTORY",
        "Trusted Data root must resolve to a directory.",
      );
    }

    return new TrustedDataRoot(canonicalPath);
  }

  resolve(...segments: readonly string[]): string {
    const canonicalPath = trustedRootPath(this);
    this.assertStillTrusted(canonicalPath);
    for (const segment of segments) validatePathSegment(segment);

    const target = resolve(canonicalPath, ...segments);
    if (!isContained(canonicalPath, target)) {
      throw new DataScopeError(
        "PATH_ESCAPE",
        "Resolved Data path escapes the trusted root.",
      );
    }

    let current = canonicalPath;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment === undefined) continue;
      current = join(current, segment);
      if (!existsSync(current)) break;

      const info = lstatSync(current);
      if (info.isSymbolicLink()) {
        throw new DataScopeError(
          "PATH_SYMLINK_UNSAFE",
          "Data path traverses an existing symbolic-link component.",
        );
      }

      const isFinal = index === segments.length - 1;
      if (!isFinal && !info.isDirectory()) {
        throw new DataScopeError(
          "PATH_COMPONENT_INVALID",
          "A Data path parent exists but is not a directory.",
        );
      }
    }

    return target;
  }

  private assertStillTrusted(canonicalPath: string): void {
    if (!existsSync(canonicalPath)) {
      throw new DataScopeError(
        "ROOT_NOT_FOUND",
        "Trusted Data root no longer exists.",
      );
    }

    const info = lstatSync(canonicalPath);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new DataScopeError(
        "ROOT_INVALID",
        "Trusted Data root changed after it was trusted.",
      );
    }

    if (realpathSync(canonicalPath) !== canonicalPath) {
      throw new DataScopeError(
        "ROOT_INVALID",
        "Trusted Data root no longer resolves to its original canonical path.",
      );
    }
  }
}

class ConcreteDataDatabaseScope implements DataDatabaseScope {
  readonly binding: StorageDatabaseBinding;

  constructor(
    readonly kind: "standalone" | "workspace",
    readonly workspaceId: string,
    readonly root: TrustedDataRoot,
    relativeDatabasePath: readonly string[],
  ) {
    validateWorkspaceFilesystemId(workspaceId);
    trustedRootPath(root);

    const binding = Object.freeze({
      bindingVersion: AI_VERSE_DATA_SCOPE_BINDING_VERSION,
      kind,
      workspaceId,
    });
    const frozenPath = Object.freeze([...relativeDatabasePath]);

    this.binding = binding;
    TRUSTED_SCOPE_FACTS.set(this, {
      kind,
      workspaceId,
      root,
      relativeDatabasePath: frozenPath,
      binding,
    });
    Object.freeze(this);
  }

  databasePath(): string {
    return authoritativeScopePath(trustedScopeFacts(this));
  }
}

export function createStandaloneDataScope(
  root: TrustedDataRoot,
  workspaceId: string,
): DataDatabaseScope {
  return new ConcreteDataDatabaseScope(
    "standalone",
    workspaceId,
    root,
    [".ai-verse-data", "data.sqlite"],
  );
}

export function createWorkspaceDataScope(
  root: TrustedDataRoot,
  workspaceId: string,
): DataDatabaseScope {
  return new ConcreteDataDatabaseScope(
    "workspace",
    workspaceId,
    root,
    ["workspaces", workspaceId, "data", "ai-verse-data.sqlite"],
  );
}

export function openScopedDataDatabase(
  driver: DataStorageDriver,
  scope: DataDatabaseScope,
  options: ScopedDatabaseOpenOptions = {},
): ScopedDatabaseHandle {
  const facts = trustedScopeFacts(scope);
  const databasePath = authoritativeScopePath(facts);
  const database: DataStorageDatabase = driver.open({
    location: databasePath,
    mode: options.mode ?? "create-or-open",
    expectedBinding: facts.binding,
  });

  return {
    scope,
    database,
  };
}
