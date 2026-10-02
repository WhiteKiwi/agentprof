import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { analyzeSourceSearchRecurrence } from "../src/analysis/source-search-recurrence.js";
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
  return { ...normalizeEvent({ provider: "claude", eventIdentity: name, sessionIdentity: "session-one", projectIdentity: "project-one", searchQuery: file, searchRoot: "[\"explicit_path\",\"src\"]", searchOptions: ["claude_native_search/v1", "Grep", "2.1.241", "{}"],
    kind: "search", toolName: "Grep", status: "completed", statusEvidence: "explicit", sourceRef: { fileIdentity: "source", byteOffset: 10, recordType: "user" } }, identity).event!, ...extra };
}
function observations(e: NormalizedEvent): ClaudeSourceObservation[] {
  const base = { eventId: e.id, sessionId: e.sessionId, messageId: null, usageId: null, turnId: null, origin: "ordinary" as const, observedUsage: null };
  return [{ ...base, id: id("source", `call-${e.id}`), representation: "call", observedResult: null, sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 1 } },
    { ...base, id: id("source", `result-${e.id}`), representation: "result", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 10 }, observedResult: {
      isError: e.status === "failed", completionKind: "invocation_result", unassignedAcknowledgement: false, observedAt: null, acknowledgementLatencyMs: null, durationMs: null, durationScope: "unknown" } }];
}
function source(events: NormalizedEvent[] = [], obs?: MetricEvidence["observations"]): StoredSource {
  return { sourceId: identity.fingerprint("source", ["claude", "source"]), provider: "claude", parserVersion: 2, normalizationVersion: 1, keyVersion: 1, keyId: identity.keyId,
    revision: 1, availability: "available", completedOffset: 100, observedSize: 101, boundaryFingerprint: id("content", "boundary"), cacheEvidence: null,
    relationshipEvidence: null, events, persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false,
    evidence: { turns: [], usage: [], observations: obs ?? events.flatMap(observations), diagnostics: [], capabilities: {
      provider: "claude", parserVersion: 2, support: "shape_verified_only", coverage: "recognized_shapes", observedShapes: ["tool_use", "tool_result"], unsupportedRecords: 0, ambiguousRecords: 0, stateLimited: false, diagnosticsDropped: 0 } } };
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
  const r = analyzeSourceSearchRecurrence(s);
  const { unit: _unit, ...counts } = r.searchClassification;
  expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(s.events.length);
  const a = r.completedSearchAdmission;
  expect(a.sourceSuppressed + a.unsupportedProvider + a.unsupportedMetricContract + a.provenanceUnresolved + a.admitted).toBe(r.searchClassification.completedSearch);
  expect(a.missingLookup).toBeLessThanOrEqual(a.admitted);
  expect(r.partitions.reduce((n, p) => n + p.candidateSearchN, 0)).toBe(a.admitted);
  for (const p of r.partitions) if (p.reason === null) {
    expect(p.validSearchN! - p.uniqueLookupN!).toBe(p.repeatN);
    expect(p.repeatRatio).toBe(p.repeatN! / p.validSearchN!);
    expect(p.cohorts!.reduce((n, c) => n + c.invocationN, 0)).toBe(p.validSearchN);
  }
  return r;
}
function frozen(value: unknown): void {
  if (value !== null && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen); }
}

describe("pure completed native search cardinality", () => {
  it("returns exact A,A,B,A DTO and ordinary proof references", () => {
    const rows = [event("a1"), event("a2"), event("b1", "B"), event("a3")], s = validated(source(rows));
    const r = checked(s), p = r.partitions[0]!;
    expect(r).toMatchObject({ schema: "agentprof.source-search-recurrence/v1", metric: "completed_native_search_recurrence", assessment: "evaluated", suppressionReason: null });
    expect(p).toMatchObject({ id: "partition-1", sessionId: rows[0]!.sessionId, status: "evaluated", reason: null,
      rawSearchStatuses: { completed: 4, failed: 0, pending: 0, cancelled: 0, unknown: 0 }, candidateSearchN: 4, missingLookupN: 0,
      candidateEventIds: rows.map(e => e.id).sort(), missingLookupEventIds: [], validSearchN: 4, uniqueLookupN: 2, repeatN: 2, repeatRatio: 0.5 });
    if (process.env["AGENTPROF_SEARCH_RECURRENCE_RECEIPTS"]) writeFileSync(join(process.env["AGENTPROF_SEARCH_RECURRENCE_RECEIPTS"]!, "ordinary-dto.json"), JSON.stringify(r, null, 2) + "\n");
    expect(p.cohorts!.map(c => c.invocationN).sort()).toEqual([1, 3]);
    expect(p.cohorts!.flatMap(c => c.evidenceObservationIds).sort()).toEqual(rows.flatMap(observations).map(o => o.id).sort());
    expect(p.cohorts!.flatMap(c => c.eventIds).sort()).toEqual(rows.map(e => e.id).sort());
    expect(JSON.stringify(r)).not.toMatch(/lookupKey|fileFingerprint|operationKey|contentFingerprint|sourceRef|commandPattern|project-one/);
  });
  it.each([[91, 38, 53 / 91], [1, 1, 0], [9, 9, 0]])("N=%i U=%i gives exact ratio", (n, u, ratio) => {
    const r = checked(source(Array.from({ length: n }, (_, i) => event(`n${i}`, `file${i % u}`))));
    expect(r.partitions[0]).toMatchObject({ validSearchN: n, uniqueLookupN: u, repeatN: n - u, repeatRatio: ratio });
  });
  it("distinguishes empty/no native search from observed zero and suppresses entire missing-identity denominator", () => {
    expect(checked(source())).toMatchObject({ assessment: "unavailable", partitions: [] });
    expect(checked(source([event("pending", "A", { status: "pending" })])).partitions[0]).toMatchObject({ reason: "no_eligible_searches", validSearchN: null, repeatRatio: null, cohorts: null });
    const rows = [event("known"), event("missing", "A", { lookupKey: null })];
    expect(checked(source(rows)).partitions[0]).toMatchObject({ reason: "identity_unresolved", candidateSearchN: 2, missingLookupN: 1,
      candidateEventIds: rows.map(e => e.id).sort(), missingLookupEventIds: [rows[1]!.id], validSearchN: null, uniqueLookupN: null, repeatN: null, repeatRatio: null, cohorts: null });
  });
  it("keeps distinct sessions separate and never uses operation identity or timing as a count gate", () => {
    const rows = [event("a"), event("b", "A", { operationKey: null, durationMs: null, startAt: null, endAt: null }), event("c", "A", { sessionId: id("session", "other") })];
    const r = checked(source(rows)); expect(r.partitions).toHaveLength(2);
    expect(r.partitions.map(p => p.repeatRatio).sort()).toEqual([0, 0.5]);
  });
  it("has disjoint raw status/class exclusions", () => {
    const rows = [event("ok"), ...(["failed", "pending", "cancelled", "unknown"] as const).map(status => event(status, "A", { status })),
      event("class", "A", { category: "write" }), event("non", "A", { kind: "file_write", category: "write", toolName: "Write" })];
    expect(checked(source(rows)).searchClassification).toEqual({ unit: "raw_events", nonSearch: 1, inconsistentSearchClass: 1, completedSearch: 1, failedSearch: 1, pendingSearch: 1, cancelledSearch: 1, unknownSearch: 1 });
  });
});

describe("inherited conservative provenance", () => {
  it.each(["missing", "contradictory", "mixed-session", "other-native-tool"])("suppresses whole native session for %s", kind => {
    const a = event("a"), b = event("b", "A", kind === "other-native-tool" ? { kind: "file_write", category: "write", toolName: "Write" } : {});
    let obs = [...observations(a), ...observations(b)];
    if (kind === "missing" || kind === "other-native-tool") obs = obs.filter(o => o.eventId !== b.id);
    else obs = obs.map(o => o.eventId === b.id && o.representation === "result" ? kind === "mixed-session" ? { ...o, sessionId: id("session", "wrong") } : { ...o, observedResult: { ...o.observedResult!, isError: true } } : o);
    const r = checked(validated(source([a, b], obs)));
    expect(r.partitions[0]).toMatchObject({ reason: "provenance_unresolved", candidateSearchN: 0, repeatRatio: null, cohorts: null });
    expect(r.inheritedProvenance.unresolvedEvents).toBe(1);
  });
  it.each(["source_unavailable", "evidence_absent", "state_limited", "ambiguous_origin", "unsupported_contract", "unresolved_execution_relation"] as const)("preserves source reason %s", reason => {
    const s = source([event("a")]); let changed = s;
    if (reason === "source_unavailable") changed = { ...s, availability: "unavailable" };
    if (reason === "evidence_absent") changed = { ...s, evidence: null };
    if (reason === "state_limited") changed = { ...s, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, diagnosticsDropped: 1 } } };
    if (reason === "ambiguous_origin") changed = { ...s, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, ambiguousRecords: 1 } } };
    if (reason === "unsupported_contract") changed = { ...s, parserVersion: 3 };
    if (reason === "unresolved_execution_relation") changed = { ...s, events: [{ ...s.events[0]!, parentEventId: id("event", "parent") }] };
    expect(checked(changed)).toMatchObject({ assessment: "suppressed", suppressionReason: reason, partitions: [{ reason: "source_suppressed", cohorts: null }] });
  });
  it("Codex is unsupported, with source suppression retaining priority", () => {
    const s = source(), codex = { ...s, provider: "codex" as const, parserVersion: 1, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, provider: "codex" as const, parserVersion: 1, observedShapes: [] } } };
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
    try { const r = analyzeSourceSearchRecurrence(s); expect(spy).toHaveBeenCalledTimes(1); frozen(r);
      expect(r.capabilities).not.toBe(s.evidence!.capabilities); expect(r.capabilities!.observedShapes).not.toBe(s.evidence!.capabilities.observedShapes);
      expect(checked({ ...s, events: [...s.events].reverse(), evidence: { ...s.evidence!, observations: [...s.evidence!.observations].reverse() } })).toEqual(r);
      expect(JSON.stringify(s)).toBe(before);
    } finally { spy.mockRestore(); }
  });
});

describe("source-valid bounded output", () => {
  it.each(["one-session", "many-sessions", "missing-identities"])("retains complete references and JSON ceiling for 4096 events: %s", shape => {
    const rows = Array.from({ length: 4096 }, (_, i) => event(`max-${i}`, `file-${i}`, {
      ...(shape === "many-sessions" ? { sessionId: id("session", `s-${i}`) } : {}), ...(shape === "missing-identities" ? { lookupKey: null } : {}) }));
    const s = validated(source(rows)), r = checked(s);
    const candidates = r.partitions.flatMap(p => p.candidateEventIds), missing = r.partitions.flatMap(p => p.missingLookupEventIds);
    const cohorts = r.partitions.flatMap(p => p.cohorts ?? []), events = cohorts.flatMap(c => c.eventIds), proofs = cohorts.flatMap(c => c.evidenceObservationIds);
    expect(candidates).toHaveLength(4096); expect(new Set(candidates).size).toBe(4096);
    expect(missing.length + events.length).toBe(4096); expect(cohorts.length).toBeLessThanOrEqual(4096);
    expect(proofs).toHaveLength(shape === "missing-identities" ? 0 : 8192); expect(new Set(proofs).size).toBe(proofs.length);
    const envelope = JSON.stringify({ schema: "agentprof.cli/v1", ok: true, command: "stats", result: { mode: "selected_source_search_recurrence", analysis: r } }) + "\n";
    const outputBytes = Buffer.byteLength(envelope);
    if (process.env["AGENTPROF_SEARCH_RECURRENCE_RECEIPTS"]) writeFileSync(join(process.env["AGENTPROF_SEARCH_RECURRENCE_RECEIPTS"]!, `${shape}-bounds.json`), JSON.stringify({ events: s.events.length, observations: s.evidence!.observations.length, partitions: r.partitions.length, cohorts: cohorts.length, candidates: candidates.length, missing: missing.length, cohortEvents: events.length, proofs: proofs.length, envelopeBytes: outputBytes }) + "\n");
    expect(outputBytes).toBeLessThanOrEqual(8_388_608);
  });
  it("checks input ceilings before inherited analysis", () => {
    expect(() => analyzeSourceSearchRecurrence(source(Array(4097).fill(event("a"))))).toThrow("source_search_recurrence_limit_exceeded");
    const s = source(); expect(() => analyzeSourceSearchRecurrence({ ...s, evidence: { ...s.evidence!, observations: Array(8193).fill(observations(event("a"))[0]) } })).toThrow("source_search_recurrence_limit_exceeded");
  });
});

describe("metric-specific contract and exact request cohorts", () => {
  it("reads validated historical parser1 but refuses metric inference", () => {
    const s = source([event("legacy", "A", { lookupKey:null })]);
    const legacy = validated({ ...s, parserVersion:1, evidence:{...s.evidence!, capabilities:{...s.evidence!.capabilities, parserVersion:1}} });
    expect(legacy.events).toHaveLength(1); expect(legacy.parserVersion).toBe(1);
    expect(analyzeSourceSearchRecurrence(legacy)).toMatchObject({assessment:"suppressed", suppressionReason:"unsupported_metric_contract", partitions:[{reason:"unsupported_metric_contract",validSearchN:null,uniqueLookupN:null,repeatN:null,repeatRatio:null,cohorts:null}]});
    expect(failureModule.analyzeSourceFailures(legacy).suppressionReason).toBeNull();
  });
  it.each([0,1,4])("all-null input with %i completed events never becomes zero", n => {
    const r = analyzeSourceSearchRecurrence(source(Array.from({length:n},(_,i)=>event(`null-${i}`,"A",{lookupKey:null}))));
    if(n===0) expect(r).toMatchObject({assessment:"unavailable",partitions:[]});
    else expect(r.partitions[0]).toMatchObject({reason:"identity_unresolved",candidateSearchN:n,missingLookupN:n,validSearchN:null,uniqueLookupN:null,repeatN:null,repeatRatio:null,cohorts:null});
  });
  it("counts Grep/Glob only and never treats shell search or MCP as native search", () => {
    const rows=[event("grep"),event("glob","B",{toolName:"Glob"}),event("shell","A",{kind:"shell",category:"search",toolName:"Bash"}),event("mcp","A",{kind:"mcp",category:"mcp",toolName:"mcp"}),event("custom","A",{toolName:"other"}),event("badcategory","A",{category:"read"})];
    const r=analyzeSourceSearchRecurrence(source(rows));
    expect(r.partitions[0]).toMatchObject({validSearchN:2,uniqueLookupN:2,repeatN:0,repeatRatio:0});
    expect(r.partitions[0]!.candidateEventIds).toEqual([rows[0]!.id,rows[1]!.id].sort());
  });
  it("retains partial assessment without aggregating or discarding unknown sessions", () => {
    const rows=[event("known"),event("missing","A",{sessionId:id("session","unknown"),lookupKey:null})];
    const r=analyzeSourceSearchRecurrence(source(rows)); expect(r.assessment).toBe("partial");
    expect(r.partitions.map(p=>p.repeatRatio).filter(x=>x===null)).toHaveLength(1);
    expect(r.partitions.map(p=>p.repeatRatio).filter(x=>x===0)).toHaveLength(1);
    expect(r).not.toHaveProperty("repeatRatio"); expect(r).not.toHaveProperty("validSearchN");
  });
  it("orders opaque cohorts by first member event ID, not lookup identity", () => {
    const rows=[event("a"),event("b","B"),event("c","B"),event("d","C")];
    const r=analyzeSourceSearchRecurrence(source(rows)), cohorts=r.partitions[0]!.cohorts!;
    expect(cohorts.map(c=>c.id)).toEqual(["search-1","search-2","search-3"]);
    expect(cohorts.map(c=>c.eventIds[0])).toEqual(cohorts.map(c=>c.eventIds[0]).sort());
    const replacement = new Map(rows.map(e=>[e.lookupKey!, e.lookupKey!]).reverse());
    const keys=[...new Set(rows.map(e=>e.lookupKey!))]; const reversed=[...keys].reverse(); keys.forEach((k,i)=>replacement.set(k,reversed[i]!));
    const renumbered=analyzeSourceSearchRecurrence(source(rows.map(e=>({...e,lookupKey:replacement.get(e.lookupKey!)!}))));
    expect(renumbered.partitions).toEqual(r.partitions);
    for(const e of rows) {expect(JSON.stringify(r)).not.toContain(e.lookupKey!);if(e.operationKey)expect(JSON.stringify(r)).not.toContain(e.operationKey);}
  });
  it("does not export specific missing-key causes or causal performance claims", () => {
    const r=analyzeSourceSearchRecurrence(source([event("unknown","A",{lookupKey:null})]));
    for(const p of r.partitions) expect(p).not.toHaveProperty("missingLookupCauses");
    expect(JSON.stringify(r)).not.toMatch(/"(?:wasteMs|avoidableMs|savedTokens|sameResults|contentEqual|rootMissing|versionMissing)"/);
  });
});
