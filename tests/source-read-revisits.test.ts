import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { analyzeSourceReadRevisits } from "../src/analysis/source-read-revisits.js";
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
function event(name: string, file = "A", extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { ...normalizeEvent({ provider: "claude", eventIdentity: name, sessionIdentity: "session-one", projectIdentity: "project-one", filePath: file,
    kind: "file_read", toolName: "Read", status: "completed", statusEvidence: "explicit", sourceRef: { fileIdentity: "source", byteOffset: 10, recordType: "user" } }, identity).event!, ...extra };
}
function observations(e: NormalizedEvent): ClaudeSourceObservation[] {
  const base = { eventId: e.id, sessionId: e.sessionId, messageId: null, usageId: null, turnId: null, origin: "ordinary" as const, observedUsage: null };
  return [{ ...base, id: id("source", `call-${e.id}`), representation: "call", observedResult: null, sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 1 } },
    { ...base, id: id("source", `result-${e.id}`), representation: "result", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 10 }, observedResult: {
      isError: e.status === "failed", completionKind: "invocation_result", unassignedAcknowledgement: false, observedAt: null, acknowledgementLatencyMs: null, durationMs: null, durationScope: "unknown" } }];
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
  const r = analyzeSourceReadRevisits(s);
  const { unit: _unit, ...counts } = r.readClassification;
  expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(s.events.length);
  const a = r.completedReadAdmission;
  expect(a.sourceSuppressed + a.unsupportedProvider + a.provenanceUnresolved + a.admitted).toBe(r.readClassification.completedRead);
  expect(a.missingFileIdentity).toBeLessThanOrEqual(a.admitted);
  expect(r.partitions.reduce((n, p) => n + p.candidateReadN, 0)).toBe(a.admitted);
  for (const p of r.partitions) if (p.reason === null) {
    expect(p.validReadN! - p.uniqueFileN!).toBe(p.revisitN);
    expect(p.revisitRatio).toBe(p.revisitN! / p.validReadN!);
    expect(p.cohorts!.reduce((n, c) => n + c.readN, 0)).toBe(p.validReadN);
  }
  return r;
}
function frozen(value: unknown): void {
  if (value !== null && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen); }
}

describe("pure completed Read cardinality", () => {
  it("returns exact A,A,B,A DTO and ordinary proof references", () => {
    const rows = [event("a1"), event("a2"), event("b1", "B"), event("a3")], s = validated(source(rows));
    const r = checked(s), p = r.partitions[0]!;
    expect(r).toMatchObject({ schema: "agentprof.source-read-revisits/v1", metric: "completed_file_revisits", assessment: "evaluated", suppressionReason: null });
    expect(p).toMatchObject({ id: "partition-1", sessionId: rows[0]!.sessionId, status: "evaluated", reason: null,
      rawReadStatuses: { completed: 4, failed: 0, pending: 0, cancelled: 0, unknown: 0 }, candidateReadN: 4, missingFileIdentityN: 0,
      candidateEventIds: rows.map(e => e.id).sort(), missingFileIdentityEventIds: [], validReadN: 4, uniqueFileN: 2, revisitN: 2, revisitRatio: 0.5 });
    if (process.env["AGENTPROF_READ_REVISITS_RECEIPTS"]) writeFileSync(join(process.env["AGENTPROF_READ_REVISITS_RECEIPTS"]!, "ordinary-dto.json"), JSON.stringify(r, null, 2) + "\n");
    expect(p.cohorts!.map(c => c.readN).sort()).toEqual([1, 3]);
    expect(p.cohorts!.flatMap(c => c.evidenceObservationIds).sort()).toEqual(rows.flatMap(observations).map(o => o.id).sort());
    expect(p.cohorts!.flatMap(c => c.eventIds).sort()).toEqual(rows.map(e => e.id).sort());
    expect(JSON.stringify(r)).not.toMatch(/fileFingerprint|operationKey|contentFingerprint|sourceRef|commandPattern|project-one/);
  });
  it.each([[91, 38, 53 / 91], [1, 1, 0], [9, 9, 0]])("N=%i U=%i gives exact ratio", (n, u, ratio) => {
    const r = checked(source(Array.from({ length: n }, (_, i) => event(`n${i}`, `file${i % u}`))));
    expect(r.partitions[0]).toMatchObject({ validReadN: n, uniqueFileN: u, revisitN: n - u, revisitRatio: ratio });
  });
  it("distinguishes empty/no Read from observed zero and suppresses entire missing-identity denominator", () => {
    expect(checked(source())).toMatchObject({ assessment: "unavailable", partitions: [] });
    expect(checked(source([event("pending", "A", { status: "pending" })])).partitions[0]).toMatchObject({ reason: "no_eligible_reads", validReadN: null, revisitRatio: null, cohorts: null });
    const rows = [event("known"), event("missing", "A", { fileFingerprint: null })];
    expect(checked(source(rows)).partitions[0]).toMatchObject({ reason: "identity_unresolved", candidateReadN: 2, missingFileIdentityN: 1,
      candidateEventIds: rows.map(e => e.id).sort(), missingFileIdentityEventIds: [rows[1]!.id], validReadN: null, uniqueFileN: null, revisitN: null, revisitRatio: null, cohorts: null });
  });
  it("keeps distinct sessions separate and never uses operation identity or timing as a count gate", () => {
    const rows = [event("a"), event("b", "A", { operationKey: null, durationMs: null, startAt: null, endAt: null }), event("c", "A", { sessionId: id("session", "other") })];
    const r = checked(source(rows)); expect(r.partitions).toHaveLength(2);
    expect(r.partitions.map(p => p.revisitRatio).sort()).toEqual([0, 0.5]);
  });
  it("has disjoint raw status/class exclusions", () => {
    const rows = [event("ok"), ...(["failed", "pending", "cancelled", "unknown"] as const).map(status => event(status, "A", { status })),
      event("class", "A", { category: "write" }), event("non", "A", { kind: "file_write", category: "write", toolName: "Write" })];
    expect(checked(source(rows)).readClassification).toEqual({ unit: "raw_events", nonRead: 1, inconsistentReadClass: 1, completedRead: 1, failedRead: 1, pendingRead: 1, cancelledRead: 1, unknownRead: 1 });
  });
});

describe("inherited conservative provenance", () => {
  it.each(["missing", "contradictory", "mixed-session", "other-native-tool"])("suppresses whole native session for %s", kind => {
    const a = event("a"), b = event("b", "A", kind === "other-native-tool" ? { kind: "file_write", category: "write", toolName: "Write" } : {});
    let obs = [...observations(a), ...observations(b)];
    if (kind === "missing" || kind === "other-native-tool") obs = obs.filter(o => o.eventId !== b.id);
    else obs = obs.map(o => o.eventId === b.id && o.representation === "result" ? kind === "mixed-session" ? { ...o, sessionId: id("session", "wrong") } : { ...o, observedResult: { ...o.observedResult!, isError: true } } : o);
    const r = checked(validated(source([a, b], obs)));
    expect(r.partitions[0]).toMatchObject({ reason: "provenance_unresolved", candidateReadN: 0, revisitRatio: null, cohorts: null });
    expect(r.inheritedProvenance.unresolvedEvents).toBe(1);
  });
  it.each(["source_unavailable", "evidence_absent", "state_limited", "ambiguous_origin", "unsupported_contract", "unresolved_execution_relation"] as const)("preserves source reason %s", reason => {
    const s = source([event("a")]); let changed = s;
    if (reason === "source_unavailable") changed = { ...s, availability: "unavailable" };
    if (reason === "evidence_absent") changed = { ...s, evidence: null };
    if (reason === "state_limited") changed = { ...s, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, diagnosticsDropped: 1 } } };
    if (reason === "ambiguous_origin") changed = { ...s, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, ambiguousRecords: 1 } } };
    if (reason === "unsupported_contract") changed = { ...s, parserVersion: 2 };
    if (reason === "unresolved_execution_relation") changed = { ...s, events: [{ ...s.events[0]!, parentEventId: id("event", "parent") }] };
    expect(checked(changed)).toMatchObject({ assessment: "suppressed", suppressionReason: reason, partitions: [{ reason: "source_suppressed", cohorts: null }] });
  });
  it("Codex is unsupported, with source suppression retaining priority", () => {
    const s = source(), codex = { ...s, provider: "codex" as const, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, provider: "codex" as const, observedShapes: [] } } };
    expect(checked(codex)).toMatchObject({ assessment: "suppressed", suppressionReason: "unsupported_provider" });
    expect(checked({ ...codex, availability: "unavailable" }).suppressionReason).toBe("source_unavailable");
  });
  it("absent, captured-empty and budget-unavailable relationships do not promote or suppress eligibility", () => {
    const s = validated(source([event("a"), event("b")])), expected = checked(s);
    for (const relationshipEvidence of [null, { contractVersion: 1, capturePolicyVersion: 1, provider: "claude", status: "captured", metadata: [], messages: [] }, { contractVersion: 1, capturePolicyVersion: 1, provider: "claude", status: "unavailable", reason: "relationship_budget_exceeded" }] as const) expect(checked({ ...s, relationshipEvidence })).toEqual(expected);
  });
  it("returns owned deeply immutable data, ignores permutations, and invokes existing analyzer once", () => {
    const s = source([event("a"), event("b"), event("c", "B")]), before = JSON.stringify(s);
    const spy = vi.spyOn(failureModule, "analyzeSourceFailures");
    try { const r = analyzeSourceReadRevisits(s); expect(spy).toHaveBeenCalledTimes(1); frozen(r);
      expect(r.capabilities).not.toBe(s.evidence!.capabilities); expect(r.capabilities!.observedShapes).not.toBe(s.evidence!.capabilities.observedShapes);
      expect(checked({ ...s, events: [...s.events].reverse(), evidence: { ...s.evidence!, observations: [...s.evidence!.observations].reverse() } })).toEqual(r);
      expect(JSON.stringify(s)).toBe(before);
    } finally { spy.mockRestore(); }
  });
});

describe("source-valid bounded output", () => {
  it.each(["one-session", "many-sessions", "missing-identities"])("retains complete references and JSON ceiling for 4096 events: %s", shape => {
    const rows = Array.from({ length: 4096 }, (_, i) => event(`max-${i}`, `file-${i}`, {
      ...(shape === "many-sessions" ? { sessionId: id("session", `s-${i}`) } : {}), ...(shape === "missing-identities" ? { fileFingerprint: null } : {}) }));
    const s = validated(source(rows)), r = checked(s);
    const candidates = r.partitions.flatMap(p => p.candidateEventIds), missing = r.partitions.flatMap(p => p.missingFileIdentityEventIds);
    const cohorts = r.partitions.flatMap(p => p.cohorts ?? []), events = cohorts.flatMap(c => c.eventIds), proofs = cohorts.flatMap(c => c.evidenceObservationIds);
    expect(candidates).toHaveLength(4096); expect(new Set(candidates).size).toBe(4096);
    expect(missing.length + events.length).toBe(4096); expect(cohorts.length).toBeLessThanOrEqual(4096);
    expect(proofs).toHaveLength(shape === "missing-identities" ? 0 : 8192); expect(new Set(proofs).size).toBe(proofs.length);
    const envelope = JSON.stringify({ schema: "agentprof.cli/v1", ok: true, command: "stats", result: { mode: "selected_source_read_revisits", analysis: r } }) + "\n";
    const outputBytes = Buffer.byteLength(envelope);
    if (process.env["AGENTPROF_READ_REVISITS_RECEIPTS"]) writeFileSync(join(process.env["AGENTPROF_READ_REVISITS_RECEIPTS"]!, `${shape}-bounds.json`), JSON.stringify({ events: s.events.length, observations: s.evidence!.observations.length, partitions: r.partitions.length, cohorts: cohorts.length, candidates: candidates.length, missing: missing.length, cohortEvents: events.length, proofs: proofs.length, envelopeBytes: outputBytes }) + "\n");
    expect(outputBytes).toBeLessThanOrEqual(8_388_608);
  });
  it("checks input ceilings before inherited analysis", () => {
    expect(() => analyzeSourceReadRevisits(source(Array(4097).fill(event("a"))))).toThrow("source_read_revisits_limit_exceeded");
    const s = source(); expect(() => analyzeSourceReadRevisits({ ...s, evidence: { ...s.evidence!, observations: Array(8193).fill(observations(event("a"))[0]) } })).toThrow("source_read_revisits_limit_exceeded");
  });
});
