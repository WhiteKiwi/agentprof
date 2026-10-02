import type { NormalizedEvent } from "../../normalize/types.js";
import type { SafeDiagnostic } from "../../privacy/diagnostics.js";
import type { CodexShape, MetadataSegment, NormalizedTurn, ParserSourceRef, SourceObservation, TokenCounts, UsageObservation, WrapperRepresentation } from "../types.js";
import type { ExitPolicy } from "./command.js";
import type { SafeOutput } from "./output.js";

/** Caller assertions only: neither the source prefix nor its LF boundary is authenticated. */
export type CodexCheckpointBinding = Readonly<{ sourceId: string; completedOffset: number; nextOrdinal: number }>;
export type CodexCheckpointOptions = Readonly<{ maxBytes?: number }>;
export type CodexCheckpointUnavailableReason = "unsupported_state" | "unsafe_positions" | "incompatible_binding" | "checkpoint_budget";
export type CodexCheckpointExport = Readonly<{ status: "captured"; checkpoint: string } | { status: "unavailable"; reason: CodexCheckpointUnavailableReason }>;
export type CodexCheckpointRestore = Readonly<{ status: "restored"; adapter: import("./index.js").CodexAdapter } | { status: "rejected"; reason: "invalid_checkpoint" }>;

// Private adapter/codec crossing types. No raw provider objects cross this boundary.
export type SourceState = { ownerId: string | null; activeTurnId: string | null; ambiguous: boolean; nativeUsageVerified: boolean };
export type StreamState = { projectId: string | null; versionFingerprint: string | null; forkParentId: string | null };
export type ExecutionState = { event: NormalizedEvent; policy: ExitPolicy; mode: "exec" | "mcp" | "patch"; callSeen: boolean; callOperationKey: string | null; structured: boolean; conflicted: boolean; result: SafeResult | null; structuredDigest: string | null };
export type SafeResult = Readonly<{ exec: SafeOutput; mcp: SafeOutput; other: SafeOutput; at: string | null; sourceRef: ParserSourceRef; digest: string; conflicted: boolean }>;
export type UsageOrder = Readonly<{ group: string; order: number }>;
export type CheckpointPosition = Readonly<{ firstOrdinal: number | null; lastOrdinal: number | null; lastByteOffset: number | null; recordCount: number }>;
export type CheckpointMaps = {
  sources: SourceState; streams: StreamState; events: ExecutionState; pendingResults: SafeResult;
  processes: string | null; polls: string; turns: NormalizedTurn; usage: UsageObservation;
  usageOrder: UsageOrder; lastSnapshots: Readonly<{ counts: TokenCounts; at: string | null }>;
  wrappers: WrapperRepresentation; metadata: MetadataSegment; observations: SourceObservation; diagnostics: SafeDiagnostic;
};
export type CheckpointSets = { unsupportedCalls: string; resultReplays: string; shapes: CodexShape };
export type CheckpointCounters = { wrapperChildLinks: number; partial: boolean; limited: boolean; unsupported: number; ambiguous: number; diagnosticsDropped: number };
export type CheckpointState = { [K in keyof CheckpointMaps]: ReadonlyMap<string, CheckpointMaps[K]> } & { [K in keyof CheckpointSets]: ReadonlySet<CheckpointSets[K]> } & CheckpointCounters;
export type DecodedCheckpoint = { position: CheckpointPosition; state: { [K in keyof CheckpointMaps]: [string, CheckpointMaps[K]][] } & { [K in keyof CheckpointSets]: CheckpointSets[K][] } & CheckpointCounters };
