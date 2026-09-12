export type AiVerseDoctorCommand = "doctor" | "status";

export interface AiVerseDoctorInput {
  readonly rootPath: string;
  readonly workspaceId?: string;
}

export interface AiVerseDoctorIssue {
  readonly code: string;
  readonly message: string;
}

export interface AiVerseDoctorProblem {
  readonly code: string;
  readonly message: string;
  readonly nextStep: string;
}

export interface AiVerseDoctorNotice {
  readonly code: string;
  readonly message: string;
}

export interface AiVerseDoctorHost {
  readonly status: "compatible" | "no-os" | "incompatible";
  readonly issues: readonly AiVerseDoctorIssue[];
}

export interface AiVerseDoctorRegistration {
  readonly registryExists: boolean;
  readonly registered: boolean;
  readonly installed: boolean;
  readonly enabled: boolean | null;
  readonly version: string | null;
}

export interface AiVerseDoctorInstructions {
  readonly status: "ready" | "disabled" | "not-installed";
}

export interface AiVerseDoctorWorkspace {
  readonly workspaceId: string;
  readonly status: string;
  readonly databasePath: string;
}

export interface AiVerseDoctorMigration {
  readonly state: "current" | "required" | "incomplete";
  readonly pendingMigrationIds: readonly string[];
  readonly incompleteMigrationIds: readonly string[];
}

export interface AiVerseDoctorDatabase {
  readonly state: string;
  readonly detail: string;
  readonly databaseFormatVersion: number | null;
  readonly bindingWorkspaceId: string | null;
  readonly migration: AiVerseDoctorMigration | null;
}

export interface AiVerseDoctorSqlite {
  readonly version: string;
  readonly meetsMinimum: boolean;
  readonly minimum: string;
}

export interface AiVerseDoctorIntegrity {
  readonly checked: boolean;
  readonly ok: boolean | null;
  readonly messages: readonly string[];
}

export interface AiVerseDoctorWal {
  readonly checked: boolean;
  readonly writable: boolean | null;
}

export interface AiVerseDoctorResult {
  readonly command: AiVerseDoctorCommand;
  readonly healthy: boolean;
  readonly mode: "ai-verse-os-v2" | "standalone" | "incompatible";
  readonly rootPath: string;
  readonly workspaceId: string | null;
  readonly host: AiVerseDoctorHost;
  readonly registration: AiVerseDoctorRegistration | null;
  readonly instructions: AiVerseDoctorInstructions | null;
  readonly workspace: AiVerseDoctorWorkspace | null;
  readonly database: AiVerseDoctorDatabase | null;
  readonly sqlite: AiVerseDoctorSqlite | null;
  readonly integrity: AiVerseDoctorIntegrity | null;
  readonly wal: AiVerseDoctorWal | null;
  readonly problems: readonly AiVerseDoctorProblem[];
  readonly notices: readonly AiVerseDoctorNotice[];
  readonly siblingNote: string;
}
