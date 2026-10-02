import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { analyzeSourceInvocationOverlap } from "../src/analysis/source-invocation-overlap.js";
import * as failureModule from "../src/analysis/source-failures.js";
import { migrate } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import type { MetricEvidence, StoredSource } from "../src/db/source-store.js";
import { HEADER_FIELDS } from "../src/db/source-validation.js";
import { normalizeEvent } from "../src/normalize/event.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import type { NormalizedEvent } from "../src/normalize/types.js";
import type { ClaudeSourceObservation } from "../src/parsers/claude/types.js";

const identity = createIdentityContext(Buffer.alloc(32, 91), "8".repeat(32));
const id = (domain: "event" | "session" | "source" | "file" | "content", value: string) => identity.fingerprint(domain, [value]);
const epoch = Date.UTC(2026, 9, 2), at = (ms: number) => new Date(epoch + ms).toISOString();
function event(name: string, start = 0, end = 10000, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { ...normalizeEvent({ provider: "claude", eventIdentity: name, sessionIdentity: "session-one", projectIdentity: "project-one", filePath: "FICTITIOUS_FILE.ts",
    kind: "file_read", toolName: "Read", status: "completed", statusEvidence: "explicit", sourceRef: { fileIdentity: "source", byteOffset: 10, recordType: "user" } }, identity).event!, startAt: at(start), endAt: at(end), intervalScope: "invocation_latency", intervalTimingEvidence: "paired_timestamps", ...extra };
}
function observations(e: NormalizedEvent): ClaudeSourceObservation[] {
  const base = { eventId: e.id, sessionId: e.sessionId, messageId: null, usageId: null, turnId: null, origin: "ordinary" as const, observedUsage: null };
  return [{ ...base, id: id("source", `call-${e.id}`), representation: "call", observedResult: null, sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 1 } },
    { ...base, id: id("source", `result-${e.id}`), representation: "result", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 10 }, observedResult: {
      isError: e.status === "failed", completionKind: "invocation_result", unassignedAcknowledgement: false, observedAt: e.endAt, acknowledgementLatencyMs: null, durationMs: null, durationScope: "unknown" } }];
}
function source(events: NormalizedEvent[] = [], obs?: MetricEvidence["observations"]): StoredSource {
  return { sourceId: identity.fingerprint("source", ["claude", "source"]), provider: "claude", parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: identity.keyId,
    revision: 1, availability: "available", completedOffset: 100, observedSize: 101, boundaryFingerprint: id("content", "boundary"), cacheEvidence: null,
    relationshipEvidence: null, events, persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false,
    evidence: { turns: [], usage: [], observations: obs ?? events.flatMap(observations), diagnostics: [], capabilities: {
      provider: "claude", parserVersion: 1, support: "shape_verified_only", coverage: "recognized_shapes", observedShapes: ["tool_use", "tool_result"], unsupportedRecords: 0, ambiguousRecords: 0, stateLimited: false, diagnosticsDropped: 0 } } };
}
function validated(s: StoredSource): StoredSource {
  const db = new DatabaseSync(":memory:");
  try {
    migrate(db); const store = createSourceStore(db, identity.keyId);
    expect(store.replaceSourceSnapshot({ ...Object.fromEntries(HEADER_FIELDS.map(k => [k, s[k]])), events: s.events, evidence: s.evidence!, relationshipEvidence: s.relationshipEvidence } as never, null).status).toBe("committed");
    return store.readSource(s.sourceId)!;
  } finally { db.close(); }
}
function checked(s: StoredSource) {
  const r = analyzeSourceInvocationOverlap(s);
  for (const p of r.partitions) {
    const c = p.coverage;
    expect(c.positionedN + c.excludedN).toBe(c.admittedTerminalN);
    expect(Object.values(c.exclusions).reduce((a, b) => a + b, 0)).toBe(c.excludedN);
    expect(p.contributingEventIds).toHaveLength(c.positionedN);
    expect(p.evidenceObservationIds.length).toBeLessThanOrEqual(c.positionedN * 2);
    if (p.intervalLengthSumMs !== null) {
      expect(p.intervalLengthSumMs - p.intervalUnionMs!).toBe(p.excessMs);
      for (const n of [p.intervalLengthSumMs, p.intervalUnionMs, p.excessMs]) expect(Number.isSafeInteger(n) && n! >= 0).toBe(true);
    } else expect([p.intervalUnionMs, p.excessMs]).toEqual([null, null]);
  }
  return r;
}
function frozen(value: unknown): void { if (value !== null && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen); } }

describe("hand-calculated session-local interval geometry", () => {
  it.each([
    ["overlap", [[0, 10000], [5000, 15000]], [20000, 15000, 5000]],
    ["disjoint", [[0, 10000], [20000, 30000]], [20000, 20000, 0]],
    ["touching", [[0, 10000], [10000, 20000]], [20000, 20000, 0]],
    ["nested", [[0, 10000], [2000, 8000]], [16000, 10000, 6000]],
    ["three-identical", [[0, 10000], [0, 10000], [0, 10000]], [30000, 10000, 20000]],
    ["zero", [[5000, 5000]], [0, 0, 0]],
  ] as const)("%s exact frozen arithmetic", (_label, intervals, expected) => {
    const rows = intervals.map(([a, b], i) => event(`e${i}`, a, b));
    const p = checked(validated(source(rows))).partitions[0]!;
    expect([p.intervalLengthSumMs, p.intervalUnionMs, p.excessMs]).toEqual(expected);
    expect(p.coverage).toMatchObject({ positionedN: rows.length, complete: true, excludedN: 0 });
    expect(p.contributingEventIds).toEqual(rows.map(e => e.id).sort());
  });
  it("missing/all-invalid is null while a zero interval and partial subset remain distinct", () => {
    expect(checked(source()).assessment).toBe("unavailable");
    const missing = event("missing", 0, 0, { startAt: null, endAt: null });
    expect(checked(source([missing])).partitions[0]).toMatchObject({ reason: "no_positioned_intervals", intervalUnionMs: null });
    const p = checked(source([missing, event("zero", 0, 0)])).partitions[0]!;
    expect(p).toMatchObject({ status: "partial", intervalLengthSumMs: 0, intervalUnionMs: 0, excessMs: 0, coverage: { admittedTerminalN: 2, positionedN: 1, excludedN: 1, complete: false } });
  });
  it("does not derive positions from independent duration, scope or operation identity", () => {
    const rows = [event("one", 0, 10000, { durationMs: 999, durationScope: "process_runtime", timingEvidence: "source_reported", operationKey: null }), event("two", 5000, 15000, { durationMs: null, durationScope: "unknown", timingEvidence: "unknown" })];
    expect(checked(validated(source(rows))).partitions[0]).toMatchObject({ intervalLengthSumMs: 20000, intervalUnionMs: 15000, excessMs: 5000 });
    expect(checked(source([event("only-duration", 0, 0, { startAt: null, endAt: null, durationMs: 5000, durationScope: "invocation_latency", timingEvidence: "source_reported" })])).partitions[0].intervalUnionMs).toBeNull();
  });
  it("keeps validated-store synthetic sessions separate, without asserting ordinary raw multi-root support", () => {
    const rows = [event("one"), event("two", 0, 10000, { sessionId: id("session", "synthetic-other-session") })];
    const r = checked(validated(source(rows)));
    expect(r.partitions).toHaveLength(2);
    for (const p of r.partitions) expect(p).toMatchObject({ intervalLengthSumMs: 10000, intervalUnionMs: 10000, excessMs: 0 });
    expect(r).not.toHaveProperty("intervalUnionMs");
  });
  it("includes failed terminal and excludes nonterminal/unsupported native classes", () => {
    const rows = [event("ok"), event("failed", 5000, 15000, { status: "failed", executionOutcome: "error" }), ...(["pending", "cancelled", "unknown"] as const).map(status => event(status, 0, 10000, { status })), event("model", 0, 10000, { kind: "model", category: "model", toolName: null }), event("other", 0, 10000, { toolName: "unrecognized" })];
    const r = checked(source(rows));
    expect(r.partitions[0]).toMatchObject({ coverage: { admittedTerminalN: 2 }, intervalLengthSumMs: 20000, intervalUnionMs: 15000, excessMs: 5000 });
    expect(r.inheritedAdmission.exclusions).toMatchObject({ pending: 1, cancelled: 1, unknown_status: 1, model: 1, unsupported_call_class: 1 });
  });
});

describe("interval eligibility and conservative inherited provenance", () => {
  it("uses disjoint exclusion counts for missing, invalid, unsupported and mismatched evidence", () => {
    const rows = [event("missing", 0, 1, { startAt: null }), event("reversed", 10, 0), event("invalid", 0, 1, { startAt: "INVALID" }), event("scope", 0, 1, { intervalScope: "process_runtime" }), event("evidence", 0, 1, { intervalTimingEvidence: "estimated" }), event("proof"), event("good")];
    const obs = rows.flatMap(observations).map(o => o.eventId === rows[5]!.id && o.representation === "result" ? { ...o, observedResult: { ...o.observedResult!, observedAt: at(9000) } } : o);
    const r = checked(source(rows, obs));
    expect(r.partitions[0]).toMatchObject({ status: "partial", intervalUnionMs: 10000, coverage: { positionedN: 1, excludedN: 6, exclusions: { missing_boundary: 1, invalid_boundary: 2, unsupported_scope: 1, unsupported_evidence: 1, result_boundary_mismatch: 1 } } });
  });
  it.each(["unknown", "source_reported"] as const)("does not accept interval timing %s", intervalTimingEvidence => {
    expect(checked(validated(source([event("unsupported", 0, 10000, { intervalTimingEvidence, ...(intervalTimingEvidence === "unknown" ? { intervalScope: "unknown" } : {}) })]))).partitions[0]).toMatchObject({ intervalUnionMs: null, coverage: { exclusions: { [intervalTimingEvidence === "unknown" ? "unsupported_scope" : "unsupported_evidence"]: 1 } } });
  });
  it.each(["missing", "contradictory", "other-tool"])("preserves whole-session suppression for %s provenance", kind => {
    const rows = [event("one"), event("two", 0, 10000, kind === "other-tool" ? { kind: "file_write", category: "write", toolName: "Write" } : {})];
    const obs = rows.flatMap(observations).flatMap(o => o.eventId !== rows[1]!.id ? [o] : kind !== "contradictory" ? [] : [{ ...o, ...(o.representation === "result" ? { observedResult: { ...o.observedResult!, isError: true } } : {}) }]);
    const r = checked(validated(source(rows, obs)));
    expect(r.partitions[0]).toMatchObject({ reason: "provenance_unresolved", intervalUnionMs: null, contributingEventIds: [], coverage: { admittedTerminalN: 0 } });
    expect(r.inheritedAdmission.exclusions.provenance_unresolved_partition).toBe(2);
  });
  it.each(["source_unavailable", "evidence_absent", "state_limited", "ambiguous_origin", "unsupported_contract", "unresolved_execution_relation"] as const)("preserves source suppression %s", reason => {
    const s = source([event("one")]); let changed = s;
    if (reason === "source_unavailable") changed = { ...s, availability: "unavailable" };
    if (reason === "evidence_absent") changed = { ...s, evidence: null };
    if (reason === "state_limited") changed = { ...s, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, diagnosticsDropped: 1 } } };
    if (reason === "ambiguous_origin") changed = { ...s, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, ambiguousRecords: 1 } } };
    if (reason === "unsupported_contract") changed = { ...s, parserVersion: 2 };
    if (reason === "unresolved_execution_relation") changed = { ...s, events: [{ ...s.events[0]!, parentEventId: id("event", "parent") }] };
    expect(checked(changed)).toMatchObject({ assessment: "suppressed", suppressionReason: reason, partitions: [{ intervalUnionMs: null, reason: "source_suppressed" }] });
  });
  it("Codex is unsupported and no positioned zero is inferred", () => {
    const s = source(); const c = { ...s, provider: "codex" as const, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, provider: "codex" as const, observedShapes: [] } } };
    expect(checked(c)).toMatchObject({ assessment: "suppressed", suppressionReason: "unsupported_provider", partitions: [] });
    expect(checked({ ...c, evidence: null }).suppressionReason).toBe("evidence_absent");
  });
});

describe("safe arithmetic, bounded references and immutability", () => {
  it("rejects an unsafe endpoint difference even though each endpoint is a safe integer", () => {
    const e = event("wide", 0, 1, { startAt: new Date(-8e15).toISOString(), endAt: new Date(8e15).toISOString() });
    expect(checked(validated(source([e]))).partitions[0]).toMatchObject({ reason: "unsafe_endpoint_difference", intervalLengthSumMs: null, intervalUnionMs: null, excessMs: null, coverage: { positionedN: 1, unsafeDifferenceN: 1 } });
  });
  it("rejects sum overflow without returning an otherwise representable union", () => {
    const rows = ["a", "b"].map(name => event(name, 0, 1, { startAt: new Date(0).toISOString(), endAt: new Date(6e15).toISOString() }));
    expect(checked(validated(source(rows))).partitions[0]).toMatchObject({ reason: "unsafe_interval_sum", intervalLengthSumMs: null, intervalUnionMs: null, excessMs: null });
  });
  it("calls unchanged admission exactly once, freezes output and does not freeze or mutate input", () => {
    const s = source([event("a"), event("b", 5000, 15000)]), before = JSON.stringify(s), spy = vi.spyOn(failureModule, "analyzeSourceFailures");
    try { const r = checked(s); expect(spy).toHaveBeenCalledTimes(1); frozen(r); expect(JSON.stringify(s)).toBe(before); expect(Object.isFrozen(s)).toBe(false); expect(Object.isFrozen(s.events)).toBe(false); }
    finally { spy.mockRestore(); }
  });
  it("is deterministic across event/observation input permutations with linear maximum references", () => {
    const rows = Array.from({ length: 4096 }, (_, i) => event(`max-${i}`, i, i + 10));
    const s = validated(source(rows)), r = checked(s);
    expect(r.partitions[0]!.contributingEventIds).toHaveLength(4096); expect(r.partitions[0]!.evidenceObservationIds).toHaveLength(8192);
    expect(checked({ ...s, events: [...s.events].reverse(), evidence: { ...s.evidence!, observations: [...s.evidence!.observations].reverse() } })).toEqual(r);
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThan(8388608);
  });
  it.each(["events", "turns", "usage", "observations", "diagnostics"] as const)("rejects %s beyond inherited maximum before admission", key => {
    const s = source([event("one")]); const n = key === "observations" || key === "diagnostics" ? 8193 : 4097;
    const oversized = key === "events" ? { ...s, events: Array(n).fill(s.events[0]) } : { ...s, evidence: { ...s.evidence!, [key]: Array(n).fill({}) } };
    const spy = vi.spyOn(failureModule, "analyzeSourceFailures");
    try { expect(() => analyzeSourceInvocationOverlap(oversized as StoredSource)).toThrow("source_invocation_overlap_limit_exceeded"); expect(spy).not.toHaveBeenCalled(); }
    finally { spy.mockRestore(); }
  });
});
