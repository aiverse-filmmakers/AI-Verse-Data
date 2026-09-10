export type DataScopeErrorCode =
  | "ROOT_INVALID"
  | "ROOT_NOT_FOUND"
  | "ROOT_NOT_DIRECTORY"
  | "WORKSPACE_ID_UNSAFE"
  | "PATH_COMPONENT_INVALID"
  | "PATH_ESCAPE"
  | "PATH_SYMLINK_UNSAFE";

export class DataScopeError extends Error {
  readonly code: DataScopeErrorCode;

  constructor(code: DataScopeErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataScopeError";
    this.code = code;
  }
}

export function isDataScopeError(error: unknown): error is DataScopeError {
  return error instanceof DataScopeError;
}
