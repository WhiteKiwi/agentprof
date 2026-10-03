import type { StoredSource, MetricEvidence } from "../src/db/source-store.js";
import type { NormalizedEvent } from "../src/normalize/types.js";
import { event as baseEvent } from "./time-breakdown-support.js";
import { source as tokenSource, sourceId, id, capabilities } from "./tokens-support.js";
export const epoch = Date.UTC(2026, 9, 3), at = (ms: number) => new Date(epoch + ms).toISOString();
export function busyEvent(name: string, start = 0, end = 10000, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return baseEvent(name, { provider: "claude", kind: "file_read", category: "read", toolName: "Read", fileFingerprint: id("file", name),
    startAt: at(start), endAt: at(end), durationMs: null, durationScope: "unknown", timingEvidence: "unknown", intervalScope: "invocation_latency", intervalTimingEvidence: "paired_timestamps", exitCode: null,
    sourceRef: { fileId: sourceId, byteOffset: 10, recordType: "user" }, ...extra });
}
export function proofs(e: NormalizedEvent): MetricEvidence["observations"][number][] {
  const base = { eventId: e.id, turnId: null, usageId: null, origin: "ordinary" as const, observedUsage: null };
  if (e.provider === "codex") return e.sourceRef.recordType === "event_msg" ? [{ ...base, id: id("source", `structured-${e.id}`), representation: "structured", transportStatus: e.status === "failed" || e.executionOutcome === "no_match" || e.executionOutcome === "change_detected" ? "failed" : "completed", sourceRef: { fileId: sourceId, byteOffset: 10 } }]
    : [{ ...base, id: id("source", `call-${e.id}`), representation: "call", transportStatus: "unknown", sourceRef: { fileId: sourceId, byteOffset: 1 } }, { ...base, id: id("source", `result-${e.id}`), representation: "result", transportStatus: "unknown", sourceRef: { fileId: sourceId, byteOffset: 10 } }];
  const claude = { ...base, sessionId: e.sessionId, messageId: null };
  return [{ ...claude, id: id("source", `call-${e.id}`), representation: "call", observedResult: null, sourceRef: { fileId: sourceId, byteOffset: 1 } },
    { ...claude, id: id("source", `result-${e.id}`), representation: "result", sourceRef: { fileId: sourceId, byteOffset: 10 }, observedResult: { isError: e.status === "failed", completionKind: "invocation_result", unassignedAcknowledgement: false, observedAt: e.endAt, acknowledgementLatencyMs: null, durationMs: null, durationScope: "unknown" } }];
}
export function busySource(events: readonly NormalizedEvent[], observations = events.flatMap(proofs)): StoredSource {
  const provider = events[0]?.provider ?? "claude", caps = provider === "claude" ? { provider: "claude" as const, parserVersion: 1 as const, support: "shape_verified_only" as const, coverage: "recognized_shapes" as const, observedShapes: ["tool_use", "tool_result"] as const, unsupportedRecords: 0, ambiguousRecords: 0, stateLimited: false, diagnosticsDropped: 0 } : capabilities;
  return { ...tokenSource([]), provider, events, evidence: { turns: [], usage: [], observations, diagnostics: [], capabilities: caps } };
}
export function codexEvent(name: string, start = 0, end = 10000, structured = false, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return busyEvent(name, start, end, { provider: "codex", kind: "shell", category: "test", toolName: "exec_command", fileFingerprint: null, commandPattern: "npm test", sourceRef: { fileId: sourceId, byteOffset: 10, recordType: structured ? "event_msg" : "response_item" }, intervalScope: structured ? "item_lifecycle" : "invocation_latency", intervalTimingEvidence: structured ? "source_reported" : "paired_timestamps", ...extra });
}
