import { DatabaseSync } from "node:sqlite";
import { normalizeEvent } from "../src/normalize/event.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import type { NormalizedEvent } from "../src/normalize/types.js";
import type { StoredSource, MetricEvidence } from "../src/db/source-store.js";
import { createSourceStore } from "../src/db/source-store.js";
import { HEADER_FIELDS } from "../src/db/source-validation.js";
import { migrate } from "../src/db/database.js";
import type { ClaudeSourceObservation } from "../src/parsers/claude/types.js";
export const context = createIdentityContext(Buffer.alloc(32, 72), "7".repeat(32));
export const at = (ms: number): string => new Date(Date.parse("2026-10-03T12:00:00Z") + ms).toISOString();
export const id = (domain: "source" | "content" | "session", value: string): string => context.fingerprint(domain, [value]);
export function event(name: string, end = 1000, key = "same", extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { ...normalizeEvent({ provider: "claude", eventIdentity: name, sessionIdentity: "synthetic-session", projectIdentity: "synthetic-project",
    searchQuery: key, searchRoot: '["explicit_path","src"]', searchOptions: ["claude_native_search/v1", "Grep", "2.1.63", "{}"],
    kind: "search", toolName: "Grep", status: "completed", statusEvidence: "explicit", sourceRef: { fileIdentity: "source", byteOffset: 10, recordType: "user" } }, context).event!,
    startAt: at(end - 1), endAt: at(end), intervalScope: "invocation_latency", intervalTimingEvidence: "paired_timestamps", ...extra };
}
export function observations(e: NormalizedEvent): ClaudeSourceObservation[] {
  const base = { eventId: e.id, sessionId: e.sessionId, messageId: null, usageId: null, turnId: null, origin: "ordinary" as const, observedUsage: null };
  return [{ ...base, id: id("source", `call-${e.id}`), representation: "call", observedResult: null, sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 1 } },
    { ...base, id: id("source", `result-${e.id}`), representation: "result", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 10 },
      observedResult: { isError: e.status === "failed", completionKind: "invocation_result", unassignedAcknowledgement: false, observedAt: e.endAt, acknowledgementLatencyMs: null, durationMs: null, durationScope: "unknown" } }];
}
export function source(events: readonly NormalizedEvent[] = [], obs?: MetricEvidence["observations"]): StoredSource {
  return { sourceId: context.fingerprint("source", ["claude", "source"]), provider: "claude", parserVersion: 2, normalizationVersion: 1, keyVersion: 1, keyId: context.keyId,
    revision: 1, availability: "available", completedOffset: 100, observedSize: 100, boundaryFingerprint: id("content", "boundary"), cacheEvidence: null,
    relationshipEvidence: null, events, persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false,
    evidence: { turns: [], usage: [], observations: obs ?? events.flatMap(observations), diagnostics: [], capabilities: {
      provider: "claude", parserVersion: 2, support: "shape_verified_only", coverage: "recognized_shapes", observedShapes: ["tool_use", "tool_result"], unsupportedRecords: 0, ambiguousRecords: 0, stateLimited: false, diagnosticsDropped: 0 } } };
}
export function validated(s: StoredSource): StoredSource {
  const db = new DatabaseSync(":memory:");
  try { migrate(db); const store = createSourceStore(db, context.keyId);
    store.replaceSourceSnapshot({ ...Object.fromEntries(HEADER_FIELDS.map(k => [k, s[k]])), events: s.events, evidence: s.evidence!, relationshipEvidence: s.relationshipEvidence } as never, null);
    return store.readSource(s.sourceId)!;
  } finally { db.close(); }
}
export const lookups = (n = 20, repeat = 5): NormalizedEvent[] => Array.from({ length: n }, (_, i) => event(`q${i}`, 1000 + i * 1000, i < repeat ? "same" : `unique-${i}`));
export function mutation(name = "edit", start = 0, end = 21000, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return event(name, end, "unused", { kind: "file_edit", category: "edit", toolName: "Edit", lookupKey: null, startAt: at(start), ...extra });
}
export function opaque(name = "bash", start = 0, end = 21000, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return event(name, end, "unused", { kind: "shell", category: "test", toolName: "Bash", lookupKey: null, startAt: at(start), ...extra });
}
