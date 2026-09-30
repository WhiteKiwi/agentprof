import { diagnostic } from "../privacy/diagnostics.js";
import type { SafeDiagnostic } from "../privacy/diagnostics.js";
import type { IdentityContext, IdentityPart } from "./identity.js";
import { classifyCommand } from "./command.js";
import type { CommandClassification } from "./command.js";
import type { DurationScope, EventKind, ExecutionOutcome, ExecutionStatus, NormalizedEvent, TimingEvidence } from "./types.js";

// Read own data fields from parsed JSON; omit accessor properties on API candidates.
function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
function text(value: unknown): string | null { return typeof value === "string" && value.length > 0 && value.length <= 1_048_576 ? value : null; }
function number(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null; }
function choice<T extends string>(value: unknown, values: readonly T[], fallback: T): T { return values.includes(value as T) ? value as T : fallback; }
const EVIDENCE = ["source_reported", "paired_timestamps", "estimated", "unknown"] as const;
const SCOPES = ["invocation_latency", "process_runtime", "item_lifecycle", "unknown"] as const;
const KINDS = ["model", "shell", "file_read", "file_write", "file_edit", "search", "mcp", "browser", "skill", "subagent", "other"] as const;
const TOOLS = ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "exec_command", "write_stdin", "apply_patch", "mcp", "browser", "other"] as const;

function timestamp(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  try {
    const normalized = new Date(ms).toISOString();
    if (typeof value === "string" && normalized.slice(0, 19) !== value.slice(0, 19)) return null;
    return normalized;
  } catch { return null; }
}

function classifyStatus(raw: unknown, evidence: unknown, exitCode: number | null, command: CommandClassification | null): { status: ExecutionStatus; outcome: ExecutionOutcome } {
  const status = choice(raw, ["completed", "failed", "cancelled", "pending", "unknown"] as const, "unknown");
  if (evidence === "explicit") {
    return { status, outcome: status === "failed" ? "error" : status === "completed" ? "success" : "unknown" };
  }
  if (evidence !== "exit_code" || exitCode === null || command === null || !command.safeSimple) return { status: "unknown", outcome: "unknown" };
  if (command.exitCodePolicy === "rg") {
    if (exitCode === 0) return { status: "completed", outcome: "success" };
    if (exitCode === 1) return { status: "completed", outcome: "no_match" };
    if (exitCode >= 2) return { status: "failed", outcome: "error" };
  }
  if (command.exitCodePolicy === "git_diff") {
    if (exitCode === 0) return { status: "completed", outcome: "success" };
    if (exitCode === 1) return { status: "completed", outcome: "change_detected" };
    if (exitCode >= 2) return { status: "failed", outcome: "error" };
  }
  return { status: "unknown", outcome: "unknown" };
}

export function normalizeEvent(input: unknown, context: IdentityContext): Readonly<{ event: NormalizedEvent | null; diagnostics: readonly SafeDiagnostic[] }> {
  const diagnostics: SafeDiagnostic[] = [];
  const provider = field(input, "provider");
  const eventIdentity = text(field(input, "eventIdentity"));
  const sessionIdentity = text(field(input, "sessionIdentity"));
  const source = field(input, "sourceRef");
  const sourceIdentity = text(field(source, "fileIdentity"));
  const offset = number(field(source, "byteOffset"));
  if ((provider !== "codex" && provider !== "claude") || !eventIdentity || !sessionIdentity || !sourceIdentity || offset === null || !Number.isSafeInteger(offset)) {
    return { event: null, diagnostics: [diagnostic("INVALID_RECORD")] };
  }
  const warn = (code: SafeDiagnostic["code"]) => diagnostics.push(diagnostic(code, null, offset));
  const kind: EventKind = choice(field(input, "kind"), KINDS, "other");
  const project = text(field(input, "projectIdentity"));
  const rawCommand = field(input, "command");
  const command = rawCommand === undefined || rawCommand === null ? null : classifyCommand(rawCommand, context, provider, project);
  if (command && !command.safeSimple) warn("UNSUPPORTED_COMMAND");
  const rawOperationParts = field(input, "operationParts");
  const operationParts = Array.isArray(rawOperationParts) && rawOperationParts.every((part) => typeof part === "string") ? rawOperationParts as string[] : null;
  const operationKey = command ? command.operationKey : operationParts && project ? context.fingerprint("operation", [provider, project, kind, operationParts]) : null;
  if (operationKey === null) warn("INSUFFICIENT_OPERATION_CONTEXT");

  const rawDuration = field(input, "durationMs");
  let durationMs = number(rawDuration);
  let timingEvidence: TimingEvidence = choice(field(input, "timingEvidence"), EVIDENCE, "unknown");
  let durationScope: DurationScope = choice(field(input, "durationScope"), SCOPES, "unknown");
  let startAt = timestamp(field(input, "startAt"));
  let endAt = timestamp(field(input, "endAt"));
  let intervalTimingEvidence: TimingEvidence = choice(field(input, "intervalTimingEvidence"), EVIDENCE, "unknown");
  let intervalScope: DurationScope = choice(field(input, "intervalScope"), SCOPES, "unknown");
  if (rawDuration !== null && rawDuration !== undefined && durationMs === null) warn("INVALID_TIMING");
  if (durationMs === null || timingEvidence === "unknown" || durationScope === "unknown") {
    if (durationMs !== null) warn("TIMING_SCOPE_UNKNOWN");
    durationMs = null; timingEvidence = "unknown"; durationScope = "unknown";
  }
  if ((field(input, "startAt") != null && startAt === null) || (field(input, "endAt") != null && endAt === null)) warn("INVALID_TIMING");
  if (startAt !== null && endAt !== null && Date.parse(endAt) < Date.parse(startAt)) {
    warn("INVALID_TIMING"); startAt = null; endAt = null;
  }
  if (startAt === null || endAt === null || intervalScope === "unknown" || intervalTimingEvidence === "unknown") {
    if (startAt !== null && endAt !== null) warn("TIMING_SCOPE_UNKNOWN");
    intervalScope = "unknown"; intervalTimingEvidence = "unknown";
  }
  if (durationMs !== null && startAt !== null && endAt !== null && durationScope === intervalScope && Math.abs(durationMs - (Date.parse(endAt) - Date.parse(startAt))) > 1) {
    warn("TIMING_CONFLICT");
    const sameEvidence = timingEvidence === intervalTimingEvidence;
    if (timingEvidence === "source_reported" && intervalTimingEvidence !== "source_reported") {
      intervalScope = "unknown"; intervalTimingEvidence = "unknown";
    } else {
      durationMs = null; durationScope = "unknown"; timingEvidence = "unknown";
      if (intervalTimingEvidence !== "source_reported" || sameEvidence) { intervalScope = "unknown"; intervalTimingEvidence = "unknown"; }
    }
  }
  const rawExit = field(input, "exitCode");
  const exitCode = typeof rawExit === "number" && Number.isSafeInteger(rawExit) && rawExit >= -2_147_483_648 && rawExit <= 2_147_483_647 ? rawExit : null;
  const execution = classifyStatus(field(input, "status"), field(input, "statusEvidence"), exitCode, command);
  if (execution.status === "pending") {
    endAt = null; durationMs = null; timingEvidence = "unknown"; durationScope = "unknown"; intervalScope = "unknown"; intervalTimingEvidence = "unknown";
  }

  const filePath = text(field(input, "filePath"));
  const fileFingerprint = filePath && project ? context.fingerprint("file", [provider, project, filePath]) : null;
  const rawRange = field(input, "lookupRange");
  const startLine = number(field(rawRange, "startLine"));
  const endLine = number(field(rawRange, "endLine"));
  const lookupRange = startLine !== null && endLine !== null && Number.isSafeInteger(startLine) && Number.isSafeInteger(endLine) && startLine > 0 && endLine >= startLine
    ? Object.freeze({ startLine, endLine }) : null;
  const query = text(field(input, "searchQuery"));
  const searchRoot = text(field(input, "searchRoot"));
  const rawOptions = field(input, "searchOptions");
  const options = Array.isArray(rawOptions) && rawOptions.every((part) => typeof part === "string") ? rawOptions as string[] : null;
  const lookupParts: IdentityPart[] | null = fileFingerprint && lookupRange ? ["file", fileFingerprint, lookupRange.startLine, lookupRange.endLine]
    : query && searchRoot && options && project ? ["search", provider, project, query, searchRoot, options] : null;
  const lookupKey = lookupParts === null ? null : context.fingerprint("lookup", lookupParts);
  const contentState = choice(field(input, "contentState"), ["complete", "truncated", "unknown"] as const, "unknown");
  const rawContent = field(input, "observedContent");
  const contentFingerprint = contentState === "complete" && typeof rawContent === "string" ? context.fingerprint("content", [rawContent]) : null;
  if ((kind === "file_read" || kind === "search") && (lookupKey === null || contentFingerprint === null)) warn("INSUFFICIENT_LOOKUP_EVIDENCE");

  const errorClass = choice(field(input, "errorClass"), ["process_exit", "tool_error", "timeout", "other"] as const, "other");
  const errorCode = text(field(input, "errorCode"));
  const errorMessage = text(field(input, "errorMessage"));
  const errorFingerprint = execution.status === "failed" && (errorCode !== null || errorMessage !== null) ? context.fingerprint("error", [errorClass, errorCode, errorMessage]) : null;
  if (execution.status === "failed" && errorFingerprint === null) warn("INSUFFICIENT_ERROR_EVIDENCE");
  const turn = text(field(input, "turnIdentity"));
  const parent = text(field(input, "parentEventIdentity"));
  const parentStream = field(input, "parentStreamIdentity");
  const sameParentStream = parentStream === undefined || parentStream === sessionIdentity;
  if (parent !== null && !sameParentStream) warn("UNSUPPORTED_PARENT_RELATION");
  const fixedCategories = { model: "model", shell: "other", file_read: "read", file_write: "write", file_edit: "edit", search: "search", mcp: "mcp", browser: "browser", skill: "skill", subagent: "subagent", other: "other" } as const;
  const event: NormalizedEvent = Object.freeze({
    normalizationVersion: 1, keyVersion: 1, keyId: context.keyId,
    id: context.fingerprint("event", [provider, sessionIdentity, eventIdentity]),
    sessionId: context.fingerprint("session", [provider, sessionIdentity]),
    turnId: turn ? context.fingerprint("turn", [provider, sessionIdentity, turn]) : null,
    parentEventId: parent && sameParentStream ? context.fingerprint("event", [provider, sessionIdentity, parent]) : null,
    provider, kind, category: command?.category ?? fixedCategories[kind],
    toolName: field(input, "toolName") == null ? null : choice(field(input, "toolName"), TOOLS, "other"),
    commandPattern: command?.commandPattern ?? null, operationKey,
    fileFingerprint, lookupKey, lookupRange, contentFingerprint, contentState,
    changeState: choice(field(input, "changeState"), ["unchanged", "changed", "unknown"] as const, "unknown"),
    validationScope: choice(field(input, "validationScope"), ["full", "targeted", "incremental", "unknown"] as const, "unknown"),
    startAt, endAt, intervalTimingEvidence, intervalScope,
    durationMs, timingEvidence, durationScope,
    status: execution.status, executionOutcome: execution.outcome, exitCode,
    errorFingerprint, errorClass: execution.status === "failed" ? errorClass : null,
    sourceRef: Object.freeze({ fileId: context.fingerprint("source", [provider, sourceIdentity]), byteOffset: offset,
      recordType: choice(field(source, "recordType"), ["response_item", "event_msg", "assistant", "user", "system", "unknown"] as const, "unknown") }),
  });
  return Object.freeze({ event, diagnostics: Object.freeze(diagnostics) });
}
