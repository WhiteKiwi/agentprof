import type { NormalizedEvent, DurationScope, TimingEvidence } from "../../normalize/types.js";
import type { SafeDiagnostic } from "../../privacy/diagnostics.js";
import type { ParserSourceRef } from "../types.js";

export type ClaudeCounts = Readonly<{
  input: number | null;
  uncachedInput: number | null;
  output: number | null;
  cachedInput: number | null;
  cacheWriteInput: number | null;
  reasoningOutput: null;
  total: number | null;
}>;
export type ClaudeUsage = Readonly<{
  id: string;
  sessionId: string;
  responseId: string | null;
  provider: "claude";
  source: "message_usage";
  scope: "response_snapshot";
  counts: ClaudeCounts | null;
  countStatus: "complete" | "partial" | "invalid";
  mapping: "anthropic_messages";
  finality: "unknown" | "trusted_partial" | "trusted_final";
  selection: "provisional" | "eligible" | "conflicted" | "invalid";
  stopReason: "end_turn" | "tool_use" | "unknown" | null;
  terminalCandidate: boolean;
  limitations: readonly ("unknown_finality" | "partial_counts" | "invalid_counts" | "missing_response_id" | "ambiguous_origin" | "conflict" | "unknown_source_order")[];
  turnId: null;
  toolEventId: null;
  phase: "unknown";
  sourceRef: ParserSourceRef;
}>;
export type ClaudeTurn = Readonly<{
  id: string;
  sessionId: string;
  provider: "claude";
  observedAt: string | null;
  startAt: null;
  endAt: null;
  intervalScope: "unknown";
  intervalTimingEvidence: "unknown";
  durationMs: number | null;
  timingEvidence: TimingEvidence;
  durationScope: "unknown";
  status: "unknown";
  selection: "duration_only" | "invalid" | "conflicted";
  sourceRef: ParserSourceRef;
}>;
export type ClaudeMessageLink = Readonly<{
  id: string;
  sessionId: string;
  kind: "assistant" | "user" | "system";
  parentMessageId: string | null;
  sourceToolAssistantMessageId: string | null;
  responseId: string | null;
  conflicted: boolean;
  sourceRef: ParserSourceRef;
}>;
export type ClaudeResultObservation = Readonly<{
  isError: boolean | null;
  completionKind: "invocation_result" | "background_acknowledgement" | "unknown";
  unassignedAcknowledgement: boolean;
  observedAt: string | null;
  acknowledgementLatencyMs: number | null;
  durationMs: number | null;
  durationScope: DurationScope;
}>;
export type ClaudeSourceObservation = Readonly<{
  id: string;
  sessionId: string | null;
  eventId: string | null;
  messageId: string | null;
  usageId: string | null;
  turnId: string | null;
  representation: "call" | "result" | "message" | "usage" | "turn" | "metadata" | "provenance" | "unsupported";
  origin: "ordinary" | "ambiguous" | "trusted_copied";
  observedUsage: Readonly<{ counts: ClaudeCounts; countStatus: ClaudeUsage["countStatus"]; finality: ClaudeUsage["finality"]; stopReason: ClaudeUsage["stopReason"]; mapping: "anthropic_messages" }> | null;
  observedResult: ClaudeResultObservation | null;
  sourceRef: ParserSourceRef;
}>;
export type ClaudeMetadata = Readonly<{
  id: string;
  ownerRootSessionId: string | null;
  declaredRootSessionId: string | null;
  sessionId: string | null;
  agentId: string | null;
  isSidechain: boolean | null;
  versionFingerprint: string | null;
  declarationFingerprint: string | null;
  origin: ClaudeSourceObservation["origin"];
  sourceRef: ParserSourceRef;
}>;
export type ClaudeShape = "tool_use" | "tool_result" | "message_link" | "message_usage" | "background_acknowledgement" | "turn_duration";
export type ClaudeCapabilities = Readonly<{
  provider: "claude";
  parserVersion: 1;
  support: "shape_verified_only";
  coverage: "recognized_shapes" | "partial";
  observedShapes: readonly ClaudeShape[];
  unsupportedRecords: number;
  ambiguousRecords: number;
  stateLimited: boolean;
  diagnosticsDropped: number;
}>;
export type ClaudeBatch = Readonly<{
  events: readonly NormalizedEvent[];
  turns: readonly ClaudeTurn[];
  usage: readonly ClaudeUsage[];
  observations: readonly ClaudeSourceObservation[];
  diagnostics: readonly SafeDiagnostic[];
  capabilities: ClaudeCapabilities;
}>;
export type ClaudeSnapshot = ClaudeBatch & Readonly<{
  messages: readonly ClaudeMessageLink[];
  metadata: readonly ClaudeMetadata[];
  stateCounts: Readonly<{
    sources: number; streams: number; events: number; turns: number; usage: number;
    messageLinks: number; messageEdges: number; uuidReplays: number; deferredResults: number;
    resultReplays: number; usageOrders: number; usageProofReplays: number; observations: number; metadata: number; diagnostics: number; shapes: number;
  }>;
}>;
export type ClaudeLimits = Readonly<{
  sources: number; streams: number; events: number; turns: number; usage: number;
  messageLinks: number; deferredResults: number; resultReplays: number; usageOrders: number; usageProofReplays: number;
  observations: number; metadata: number; diagnostics: number;
}>;
// A trusted test harness supplies these; none are read from provider annotations.
export type ClaudeTrustedFixtureContext = Readonly<{
  ownerSessionId?: string;
  knownCopiedOrdinals?: readonly number[];
  usageEvidence?: readonly Readonly<{ ordinal: number; messageId: string; finality: "partial" | "final"; order: number; orderingGroup: string; mapping: "anthropic_messages" }>[];
  toolTimings?: readonly Readonly<{ ordinal: number; toolUseId: string; durationScope: Exclude<DurationScope, "unknown">; source: "tool_use_result_duration_ms" }>[];
  completeResults?: readonly Readonly<{ ordinal: number; toolUseId: string }>[];
}>;
export type ClaudeInputSource = Readonly<{
  fileIdentity: string;
  sourceAlias?: string;
  byteOffset: number;
  ordinal: number;
  trustedFixtureContext?: ClaudeTrustedFixtureContext;
}>;
