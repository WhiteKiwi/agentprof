export const MESSAGES = {
  INVALID_ARGUMENT: "Invalid arguments. Run agentprof --help for usage.",
  NOT_IMPLEMENTED: "This command is not implemented in this development build. Only help and version are available.",
  UNSUPPORTED_RUNTIME: "AgentProf requires Node.js >=24.15.0.",
  UNSUPPORTED_PLATFORM: "AgentProf currently supports macOS and Linux.",
  INTERNAL_ERROR: "The operation could not be completed.",
  UNSAFE_DATA_PATH: "The local data path must not contain symbolic links.",
  DATA_ACCESS_FAILED: "The local data directory could not be accessed.",
  DATA_PERMISSION_FAILED: "The local data permissions could not be protected.",
  UNSAFE_PRIVATE_FILE: "The private file is unsafe or has invalid permissions.",
  INVALID_IDENTITY_KEY: "The local identity key is invalid. Preserve the existing file before recovery.",
  IDENTITY_INPUT_TOO_LARGE: "The identity input exceeds the supported size.",
  INVALID_RECORD: "The record lacks the required safe normalization fields.",
  UNSUPPORTED_RECORD: "The record shape is not supported by this adapter.",
  UNATTRIBUTED_RECORD: "A stable execution stream could not be established.",
  UNSUPPORTED_RELATION: "The execution relationship could not be verified.",
  AMBIGUOUS_ORIGIN: "Copied history or execution origin could not be verified.",
  REORDERED_RECORD: "A result or observation arrived out of source order.",
  INCONSISTENT_REPLAY: "Repeated observations of the same identity disagree.",
  STATUS_CONFLICT: "The validated transport status and result disagree.",
  INVALID_USAGE: "Token counts are invalid or violate verified containment rules.",
  INSUFFICIENT_USAGE: "Required token components are missing.",
  USAGE_CONFLICT: "Repeated response usage values disagree.",
  USAGE_RESET: "A cumulative token snapshot decreased.",
  STATE_LIMIT: "The adapter state limit was reached. Coverage is partial.",
  UNSUPPORTED_COMMAND: "The command cannot be classified safely.",
  INSUFFICIENT_OPERATION_CONTEXT: "The operation context is incomplete.",
  UNSUPPORTED_PARENT_RELATION: "A cross-stream parent relation is unsupported.",
  INVALID_TIMING: "The timing fields are invalid.",
  TIMING_SCOPE_UNKNOWN: "The timing scope or evidence is unverified.",
  TIMING_CONFLICT: "Timing values disagree within the same scope.",
  INSUFFICIENT_LOOKUP_EVIDENCE: "The lookup scope or observed content is incomplete.",
  INSUFFICIENT_ERROR_EVIDENCE: "The error comparison fields are incomplete.",
  INPUT_ROOT_MISSING: "An input root does not exist.",
  INPUT_ACCESS_FAILED: "The input could not be read.",
  INPUT_CHANGED: "The input changed while being read. A new scan is required.",
  AMBIGUOUS_INPUT_PROVIDER: "A source matches multiple provider roots and was skipped.",
  SYMLINK_SKIPPED: "A symbolic link was skipped.",
  UNSUPPORTED_COMPRESSION: "Compressed logs are not supported.",
  DISCOVERY_LIMIT: "The input discovery limit was reached.",
  INVALID_OFFSET: "The requested offset is not a complete line boundary.",
  INVALID_JSON: "A complete line contains invalid JSON.",
  INVALID_UTF8: "A complete line contains invalid UTF-8.",
  RECORD_TOO_LARGE: "A line exceeds the supported byte limit.",
  DATABASE_ACCESS_FAILED: "The local database could not be opened.",
  DATABASE_SCHEMA_TOO_NEW: "The database schema is newer than this AgentProf build.",
  DATABASE_MIGRATION_FAILED: "The local database migration failed.",
  DATABASE_TRANSACTION_FAILED: "The database transaction could not be completed.",
} as const;

export type DiagnosticCode = keyof typeof MESSAGES;
function knownCode(value: unknown): value is DiagnosticCode {
  return typeof value === "string" && Object.hasOwn(MESSAGES, value);
}
export type SafeDiagnostic = Readonly<{
  code: DiagnosticCode;
  severity: "info" | "warning" | "error";
  sourceAlias: string | null;
  byteOffset: number | null;
}>;

export class SafeError extends Error {
  readonly code: DiagnosticCode;
  constructor(code: DiagnosticCode) {
    const safeCode = knownCode(code) ? code : "INTERNAL_ERROR";
    super(MESSAGES[safeCode]);
    this.name = "SafeError";
    this.code = safeCode;
  }
}

export function diagnostic(
  code: DiagnosticCode,
  sourceAlias: string | null = null,
  byteOffset: number | null = null,
): SafeDiagnostic {
  return Object.freeze({
    code: knownCode(code) ? code : "INTERNAL_ERROR",
    severity: code === "INPUT_ROOT_MISSING" ? "info" : "warning",
    sourceAlias: sourceAlias !== null && /^source-[0-9]{1,12}$/.test(sourceAlias) ? sourceAlias : null,
    byteOffset: byteOffset !== null && Number.isSafeInteger(byteOffset) && byteOffset >= 0 ? byteOffset : null,
  });
}

export function safeErrorEnvelope(error: unknown) {
  const code = error instanceof SafeError && knownCode(error.code) ? error.code : "INTERNAL_ERROR";
  return { schema: "agentprof.cli/v1", ok: false, error: { code, message: MESSAGES[code] } } as const;
}
