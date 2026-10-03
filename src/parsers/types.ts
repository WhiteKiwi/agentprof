import type { NormalizedEvent, TimingEvidence } from "../normalize/types.js";
import type { SafeDiagnostic } from "../privacy/diagnostics.js";

export type ParserSourceRef = Readonly<{ fileId: string; byteOffset: number }>;
export type TokenCounts = Readonly<{
  input: number | null;
  output: number | null;
  cachedInput: number | null;
  cacheWriteInput: number | null;
  reasoningOutput: number | null;
  total: number | null;
}>;
export type NormalizedTurn = Readonly<{
  id: string;
  sessionId: string;
  provider: "codex";
  startAt: string | null;
  endAt: string | null;
  startTimingEvidence: TimingEvidence;
  endTimingEvidence: TimingEvidence;
  intervalTimingEvidence: TimingEvidence;
  intervalScope: "turn_wall" | "observed_turn" | "unknown";
  durationMs: number | null;
  timingEvidence: TimingEvidence;
  durationScope: "turn_elapsed" | "unknown";
  status: "completed" | "cancelled" | "pending" | "unknown";
  sourceRef: ParserSourceRef;
}>;
export type UsageObservation = Readonly<{
  id: string;
  sessionId: string;
  turnId: string | null;
  responseId: string | null;
  provider: "codex";
  source: "response_usage" | "turn_snapshot" | "thread_snapshot" | "token_count_total" | "token_count_last";
  counts: TokenCounts | null;
  scope: "response_increment" | "turn_cumulative" | "thread_cumulative" | "unverified_snapshot";
  selection: "eligible" | "provisional" | "snapshot_only" | "conflicted" | "invalid";
  finality: "source_terminal" | "trusted_final" | "trusted_partial" | "unknown";
  countStatus: "complete" | "partial" | "invalid";
  mapping: "openai_responses" | "unknown";
  limitations: readonly ("unknown_finality" | "ambiguous_origin" | "partial_counts" | "invalid_counts" | "missing_response_id" | "conflict" | "snapshot_only" | "zero_or_source_default")[];
  toolEventId: null;
  phase: "unknown";
  sourceRef: ParserSourceRef;
}>;
export type SourceObservation = Readonly<{
  /** Present only in timestamp-capture parser versions; record time, not usage finality. */
  usageObservedAt?: string | null;
  id: string;
  eventId: string | null;
  turnId: string | null;
  usageId: string | null;
  representation: "call" | "result" | "structured" | "poll" | "wrapper" | "turn" | "usage" | "metadata" | "provenance" | "unsupported";
  origin: "ordinary" | "ambiguous" | "trusted_copied";
  transportStatus: "completed" | "failed" | "cancelled" | "pending" | "unknown";
  observedUsage: Readonly<{ counts: TokenCounts | null; finality: UsageObservation["finality"]; countStatus: UsageObservation["countStatus"]; mapping: UsageObservation["mapping"] }> | null;
  sourceRef: ParserSourceRef;
}>;
export type WrapperRepresentation = Readonly<{
  id: string;
  sessionId: string;
  kind: "code_wrapper";
  callSeen: boolean;
  resultSeen: boolean;
  relationship: "trusted_fixture" | "unknown";
  childEventIds: readonly string[];
  sourceRef: ParserSourceRef;
}>;
export type MetadataSegment = Readonly<{
  id: string;
  ownerSessionId: string;
  declaredSessionId: string;
  versionFingerprint: string | null;
  forkParentId: string | null;
  origin: "ordinary" | "ambiguous" | "trusted_copied";
  sourceRef: ParserSourceRef;
}>;
export type CodexShape = "command_item" | "mcp_item" | "function_call" | "custom_call" | "tool_result" | "poll" | "code_wrapper" | "turn" | "response_usage" | "token_snapshot";
export type ParserCapabilities = Readonly<{
  provider: "codex";
  parserVersion: 1 | 2 | 3;
  support: "shape_verified_only";
  coverage: "recognized_shapes" | "partial";
  observedShapes: readonly CodexShape[];
  unsupportedRecords: number;
  ambiguousRecords: number;
  stateLimited: boolean;
  diagnosticsDropped: number;
}>;
export type CodexBatch = Readonly<{
  events: readonly NormalizedEvent[];
  turns: readonly NormalizedTurn[];
  usage: readonly UsageObservation[];
  observations: readonly SourceObservation[];
  diagnostics: readonly SafeDiagnostic[];
  capabilities: ParserCapabilities;
}>;
export type CodexSnapshot = CodexBatch & Readonly<{
  wrappers: readonly WrapperRepresentation[];
  metadata: readonly MetadataSegment[];
  stateCounts: Readonly<{ sources: number; streams: number; events: number; wrappers: number; wrapperChildLinks: number; unsupportedCalls: number; pendingResults: number; resultReplays: number; pollLinks: number; processLinks: number; turns: number; usage: number; usageOrders: number; snapshotSeries: number; observations: number; metadata: number; diagnostics: number }>;
}>;

// These relationships are supplied by a trusted test harness, never read from a log.
export type TrustedFixtureContext = Readonly<{
  knownCopiedOrdinals?: readonly number[];
  knownCompleteOutputOrdinals?: readonly number[];
  usageEvidence?: readonly Readonly<{ ordinal: number; finality: "partial" | "final"; order: number; orderingGroup: string; mapping: "openai_responses" }>[];
  wrapperRelations?: readonly Readonly<{ wrapperCallId: string; childItemIds: readonly string[] }>[];
}>;
export type CodexInputSource = Readonly<{
  fileIdentity: string;
  sourceAlias?: string;
  byteOffset: number;
  ordinal: number;
  trustedFixtureContext?: TrustedFixtureContext;
}>;
export type CodexLimits = Readonly<{
  events: number;
  turns: number;
  usage: number;
  sources: number;
  streams: number;
  links: number;
  observations: number;
  metadata: number;
  diagnostics: number;
}>;
