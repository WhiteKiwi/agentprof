import { describe, expect, it } from "vitest";
import { analyzeSourceRecovery } from "../src/analysis/source-recovery.js";
import type { SourceRecoveryAnalysis } from "../src/analysis/source-recovery.js";
import type { NormalizedEvent } from "../src/normalize/types.js";
import { formatSourceRecovery } from "../src/cli/recovery.js";
import { validateEvent } from "../src/db/source-validation.js";
import { event, id, observation, paired, proofs, source, success } from "./recovery-fixture.js";

const analyze = (rows: readonly NormalizedEvent[]) => analyzeSourceRecovery(source(rows));
const positive = () => [event("failure", 0, 1000), event("success", 5000, 6000, success)];
function unavailable(a: SourceRecoveryAnalysis, reason?: string) {
  expect(a.summary).toMatchObject({ evaluatedGroups: 0, unavailableGroups: 1, resolvedChains: null, unresolvedChains: null });
  expect(a.chains).toBeNull(); expect(a.distributions).toBeNull();
  if (reason) expect(a.groups[0]!.reasons).toContain(reason);
}

describe("independent recovery endpoint and chain oracles", () => {
  it.each(["structured", "paired"])("measures 5000 ms from failed result, not call or duration: %s", kind => {
    const rows = positive().map(e => kind === "paired" ? paired(e) : e), a = analyze(rows);
    expect(a).toMatchObject({ schema: "agentprof.source-recovery/v1", version: "codex-same-turn-operation-v1", metric: "recovery_elapsed_time", assessment: "evaluated", summary: { resolvedChains: 1, unresolvedChains: 0, knownFailedAttempts: 1, unavailableKnownFailedAttempts: 0 } });
    expect(a.chains![0]).toMatchObject({ failedEventIds: [rows[0]!.id], successfulEventId: rows[1]!.id, failedAttemptCount: 1, attemptCount: 2, resolved: true, recoveryElapsedMs: 5000 });
    expect(a.distributions![0]).toMatchObject({ n: 1, resolvedOnly: true, minMs: 5000, maxMs: 5000, p50Ms: 5000, p95Ms: 5000, lowSampleP95: true });
    expect(a.chains![0]!.evidenceObservationIds).toEqual(rows.flatMap(proofs).map(o => o.id).sort());
  });
  it("starts at first of repeated failures, permits intervening unrelated work, and preserves unresolved null", () => {
    const f = event("first", 0, 1000), second = event("second", 2000, 3000), other = event("other", 3200, 4000, { ...success, operationKey: id("operation", "other") }), s = event("success", 5000, 6000, success), unresolved = event("unresolved", 8000, 9000);
    const a = analyze([f, second, other, s, unresolved]);
    expect(a.summary).toMatchObject({ resolvedChains: 1, unresolvedChains: 1 });
    expect(a.chains!.find(c => c.resolved)).toMatchObject({ failedAttemptCount: 2, attemptCount: 3, recoveryElapsedMs: 5000, failedEventIds: [f.id, second.id] });
    expect(a.chains!.find(c => !c.resolved)).toMatchObject({ failedEventIds: [unresolved.id], successfulEventId: null, successfulResultAt: null, recoveryElapsedMs: null, attemptCount: 1 });
    expect(a.distributions![0]!.n).toBe(1);
  });
  it("creates multiple chains and keeps successes before/after them in inventory", () => {
    const a = analyze([event("before", 0, 10, success), event("f1", 20, 30), event("s1", 40, 50, success), event("between", 60, 70, success), event("f2", 80, 90), event("s2", 100, 120, success)]);
    expect(a.chains!.map(c => c.recoveryElapsedMs)).toEqual([20, 30]); expect(a.groups[0]!.successesOutsideChains).toBe(2); expect(a.distributions![0]).toMatchObject({ n: 2, p50Ms: 20, p95Ms: 30 });
  });
  it.each(["operation", "turn", "session"])("a different %s success never resolves the failure", dimension => {
    const change = dimension === "operation" ? { operationKey: id("operation", "other") } : dimension === "turn" ? { turnId: id("turn", "other") } : { sessionId: id("session", "other") };
    const a = analyze([event("f", 0, 1000), event("s", 5000, 6000, { ...success, ...change })]);
    expect(a.summary).toMatchObject({ resolvedChains: 0, unresolvedChains: 1 }); expect(a.chains![0]!.recoveryElapsedMs).toBeNull();
  });
  it("does not require turn rows or error fingerprints", () => {
    const rows = positive(); expect(source(rows).evidence!.turns).toEqual([]); expect(rows.every(e => e.errorFingerprint === null)).toBe(true); expect(analyze(rows).chains![0]!.recoveryElapsedMs).toBe(5000);
  });
  it("distinguishes empty and no-failure evaluated results from unavailable", () => {
    expect(analyze([])).toMatchObject({ assessment: "no_eligible_events", chains: [], distributions: [], summary: { resolvedChains: 0, unresolvedChains: 0 } });
    expect(analyze([event("success-only", 0, 100, success)])).toMatchObject({ assessment: "evaluated", chains: [], distributions: [], groups: [{ successesOutsideChains: 1 }] });
    expect(analyzeSourceRecovery({ ...source(positive()), evidence: null })).toMatchObject({ assessment: "suppressed", chains: null, distributions: null, summary: { resolvedChains: null, unresolvedChains: null } });
  });
  it.each([1, 19, 20])("nearest-rank resolved-only quantiles at n=%i", n => {
    const rows = Array.from({ length: n }, (_, i) => [event(`f-${i}`, i * 100, i * 100 + 1), event(`s-${i}`, i * 100 + 2, i * 100 + 2 + i, success)]).flat();
    rows.push(event("unresolved", n * 100, n * 100 + 1)); const a = analyze(rows);
    expect(a.distributions![0]).toMatchObject({ n, p50Ms: Math.ceil(n * 0.5), p95Ms: Math.ceil(n * 0.95), lowSampleP95: n < 20 }); expect(a.summary.unresolvedChains).toBe(1);
  });
  it("separates distributions by session and interval contract", () => {
    const first = positive(), pairedRows = [paired(event("p-f", 0, 1000, { operationKey: id("operation", "paired") })), paired(event("p-s", 4000, 5000, { ...success, operationKey: id("operation", "paired") }))], other = [event("o-f", 0, 1000, { sessionId: id("session", "other") }), event("o-s", 6000, 7000, { ...success, sessionId: id("session", "other") })];
    const a = analyze([...first, ...pairedRows, ...other]); expect(a.distributions).toHaveLength(3); expect(a.distributions!.map(d => d.p50Ms).sort()).toEqual([4000, 5000, 6000]); expect(a.summary).not.toHaveProperty("sumMs");
  });
});

describe("whole-group and whole-session uncertainty", () => {
  it.each(["pending", "cancelled", "unknown", "no_match", "change_detected", "unknown_outcome"])("does not connect a convenient subset across %s, including a later attempt", kind => {
    const rows = positive(); const status = kind === "pending" || kind === "cancelled" || kind === "unknown" ? kind : "completed";
    const extra = event("ambiguous-later", 7000, 8000, { status, executionOutcome: kind === "no_match" || kind === "change_detected" ? kind : "unknown" });
    const a = analyze([...rows, extra]); unavailable(a); expect(a.groups[0]!.blockedFailedEventIds).toEqual([rows[0]!.id]); expect(a.summary.unavailableKnownFailedAttempts).toBe(1);
  });
  it.each(["operationKey", "turnId"] as const)("a missing %s suppresses only its own session", field => {
    const rows = positive(), missing = event("missing", 7000, 8000, { [field]: null }), other = [event("other-f", 0, 1000, { sessionId: id("session", "other") }), event("other-s", 5000, 6000, { ...success, sessionId: id("session", "other") })];
    const a = analyze([...rows, missing, ...other]); expect(a.summary).toMatchObject({ resolvedChains: 1, unresolvedChains: 0, unavailableGroups: 1, unavailableSessions: 1, unavailableKnownFailedAttempts: 2 }); expect(a.chains![0]!.sessionId).toBe(other[0]!.sessionId); expect(a.partitions.find(p => p.sessionId === missing.sessionId)!.reasons).toContain(field === "turnId" ? "missing_turn_identity" : "missing_operation_identity");
  });
  it("a fully identified ambiguous unrelated operation leaves a complete group usable", () => {
    const a = analyze([...positive(), event("unknown-other", 7000, 8000, { operationKey: id("operation", "other"), status: "pending", executionOutcome: "unknown" })]);
    expect(a.summary).toMatchObject({ resolvedChains: 1, unavailableGroups: 1 }); expect(a.partitions[0]!.status).toBe("partial");
  });
  it("missing native terminal proof suppresses its entire session", () => {
    const rows = positive(), a = analyzeSourceRecovery(source(rows, [observation(rows[0]!)])); unavailable(a, "session_unavailable"); expect(a.partitions[0]!.reasons).toContain("provenance_unresolved"); expect(a.inheritedProvenance.unresolvedEvents).toBe(1);
  });
  it("contradictory class/category tuples sharing an identity cannot be split", () => {
    const rows = positive(); unavailable(analyze([rows[0]!, { ...rows[1]!, category: "build" }]), "operation_class_conflict");
  });
  it("mixed timing contracts cannot split the same operation", () => { const rows = positive(); unavailable(analyze([rows[0]!, paired(rows[1]!)]), "mixed_interval_evidence"); });
  it.each(["unavailable", "absent", "limited", "dropped", "ambiguous", "parser", "capability", "parent", "wrapper", "claude"])("retains source suppression for %s", reason => {
    const rows = positive(), s = source(rows);
    const a = analyzeSourceRecovery({ ...s, availability: reason === "unavailable" ? "unavailable" : "available", parserVersion: reason === "parser" ? 2 : 1,
      provider: reason === "claude" ? "claude" : "codex", events: reason === "parent" ? [{ ...rows[0]!, parentEventId: id("event", "parent") }, rows[1]!] : rows,
      evidence: reason === "absent" ? null : { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, stateLimited: reason === "limited", diagnosticsDropped: reason === "dropped" ? 1 : 0, ambiguousRecords: reason === "ambiguous" ? 1 : 0, parserVersion: reason === "capability" ? 2 : 1 } as never,
        observations: reason === "wrapper" ? [...s.evidence!.observations, observation(rows[0]!, { id: id("source", "wrapper"), representation: "wrapper" })] : s.evidence!.observations } });
    expect(a.assessment).toBe("suppressed"); expect(a.chains).toBeNull();
  });
  it("models and other call classes remain counted exclusions", () => {
    const a = analyze([...positive(), event("model", 7000, 8000, { kind: "model", category: "model", toolName: null, operationKey: null, turnId: null }), event("other", 9000, 10000, { kind: "skill", category: "skill", toolName: "Skill", operationKey: null, turnId: null })]);
    expect(a.classification).toEqual({ candidateAttempts: 2, modelExcluded: 1, unsupportedClassExcluded: 1 }); expect(a.summary.resolvedChains).toBe(1);
  });
  it("shows missing-identity session reasons when no operation group can be formed", () => {
    const a = analyze([event("missing-only", 0, 1000, { operationKey: null, turnId: null })]), human = formatSourceRecovery(a);
    expect(a.groups).toEqual([]); expect(a.chains).toBeNull(); expect(human).toContain("Sessions shown=1/1; omitted=0"); expect(human).toContain("missing_operation_identity, missing_turn_identity"); expect(human).toContain("Operation groups shown=0/0; omitted=0");
  });
  it("does not count excluded native apply_patch failures as Recovery candidate failures", () => {
    const a = analyze([event("patch", 0, 1000, { kind: "file_edit", category: "edit", toolName: "apply_patch", operationKey: null, turnId: null })]);
    expect(a.classification).toMatchObject({ candidateAttempts: 0, unsupportedClassExcluded: 1 }); expect(a.summary).toMatchObject({ knownFailedAttempts: 0, unavailableKnownFailedAttempts: 0, resolvedChains: 0, unresolvedChains: 0 });
  });
});

describe("explicit chronology and decisive proof", () => {
  it.each([
    ["overlap", 0, 1000, 500, 6000, "overlapping_attempts"],
    ["equal ends", 0, 1000, 1000, 1000, "tied_boundaries"],
    ["equal starts including zero interval", 1000, 1000, 1000, 6000, "tied_boundaries"],
    ["source/time reversed", 5000, 6000, 0, 1000, "source_time_order_conflict"],
  ] as const)("rejects %s", (_name, a, b, c, d, reason) => unavailable(analyze([event("f", a, b), event("s", c, d, success)]), reason));
  it("accepts abutting intervals with distinct starts and completions", () => expect(analyze([event("f", 0, 1000), event("s", 1000, 6000, success)]).chains![0]!.recoveryElapsedMs).toBe(5000));
  it("equal decisive source offsets cannot supply chronology", () => { const rows = positive(); unavailable(analyze([rows[0]!, { ...rows[1]!, sourceRef: rows[0]!.sourceRef }]), "ambiguous_source_order"); });
  it.each(["missing", "invalid", "reversed", "unsafe", "scope", "evidence"])("rejects %s interval boundaries without inventing them from durations", kind => {
    const rows = positive(), extra = kind === "missing" ? { startAt: null } : kind === "invalid" ? { endAt: "not-a-time" } : kind === "reversed" ? { endAt: "1969-12-31T23:59:59.000Z" } : kind === "unsafe" ? { startAt: new Date(-8.64e15).toISOString(), endAt: new Date(8.64e15).toISOString() } : kind === "scope" ? { intervalScope: "process_runtime" as const } : { intervalTimingEvidence: "estimated" as const };
    unavailable(analyze([{ ...rows[0]!, ...extra }, rows[1]!]));
  });
  it("safe individual intervals do not make an unsafe recovery span safe", () => {
    const rows = [event("f", -8.64e15, -8.64e15 + 1000), event("s", 8.64e15 - 1000, 8.64e15, success)]; unavailable(analyze(rows), "unsafe_recovery_elapsed");
  });
  it("paired null-turn results and terminal polls are valid", () => {
    const rows = positive().map(paired), obs = rows.flatMap(proofs); const decisive = obs[1]!;
    expect(analyzeSourceRecovery(source(rows, [obs[0]!, { ...decisive, representation: "poll" }, ...obs.slice(2)])).chains![0]!.recoveryElapsedMs).toBe(5000);
  });
  it.each(["call-turn", "structured-turn", "result-turn", "call-after-result", "foreign-call"])("rejects %s proof", kind => {
    const rows = positive().map(e => kind === "structured-turn" ? e : paired(e)); const obs = rows.flatMap(proofs); const first = obs[0]!;
    if (kind === "result-turn") obs[1] = { ...obs[1]!, turnId: id("turn", "foreign") };
    else obs[0] = { ...first, ...(kind === "call-after-result" ? { sourceRef: { ...first.sourceRef, byteOffset: rows[0]!.sourceRef.byteOffset + 1 } } : kind === "foreign-call" ? { sourceRef: { ...first.sourceRef, fileId: id("source", "foreign") } } : { turnId: id("turn", "foreign") }) };
    unavailable(analyzeSourceRecovery(source(rows, obs)));
  });
  it("a later call replay, earlier result, fallback, orphan and wrapper never enter the decisive chain proof", () => {
    const rows = positive().map(paired), obs = rows.flatMap(proofs), extras = [observation(rows[0]!, { id: id("source", "replay"), representation: "call", sourceRef: { ...rows[0]!.sourceRef, byteOffset: rows[0]!.sourceRef.byteOffset + 1 } }), observation(rows[0]!, { id: id("source", "earlier-result"), representation: "result", transportStatus: "unknown", turnId: null, sourceRef: { ...rows[0]!.sourceRef, byteOffset: rows[0]!.sourceRef.byteOffset - 2 } }), observation(rows[0]!, { id: id("source", "orphan"), eventId: id("event", "absent"), representation: "wrapper" })];
    const a = analyzeSourceRecovery(source(rows, [...extras, ...obs])); expect(a.chains![0]!.evidenceObservationIds).toEqual(obs.map(o => o.id).sort());
    const structuredRows = positive(), structuredObs = structuredRows.flatMap(proofs), fallback = observation(structuredRows[0]!, { id: id("source", "fallback"), representation: "result", transportStatus: "unknown", turnId: null, sourceRef: { ...structuredRows[0]!.sourceRef, byteOffset: structuredRows[0]!.sourceRef.byteOffset + 1 } });
    expect(analyzeSourceRecovery(source(structuredRows, [fallback, ...structuredObs])).chains![0]!.evidenceObservationIds).toEqual(structuredObs.map(o => o.id).sort());
  });
});

describe("immutability, invariance, privacy and maximum bounds", () => {
  it("owns and recursively freezes output without freezing or aliasing mutable input", () => {
    const input = structuredClone(source(positive().map(paired))), before = JSON.stringify(input), a = analyzeSourceRecovery(input);
    expect(JSON.stringify(input)).toBe(before); expect(Object.isFrozen(input.events)).toBe(false); expect(Object.isFrozen(input.evidence!.capabilities.observedShapes)).toBe(false);
    const check = (v: unknown): void => { if (v && typeof v === "object") { expect(Object.isFrozen(v)).toBe(true); Object.values(v).forEach(check); } }; check(a);
    expect(a.capabilities).not.toBe(input.evidence!.capabilities); expect(a.inventory).not.toBe(input);
    const text = JSON.stringify(a) + formatSourceRecovery(a); expect(text).not.toMatch(/FICTITIOUS_|operationKey|errorFingerprint|contentFingerprint|sourceRef|boundaryFingerprint|commandPattern/); for (const e of input.events) expect(text).not.toContain(e.operationKey!);
  });
  it("event and observation permutations preserve complete output including aliases", () => {
    const rows = [...positive().map(paired), event("other-f", 2000, 3000, { operationKey: id("operation", "other") }), event("other-s", 6000, 7000, { ...success, operationKey: id("operation", "other") })], input = source(rows), expected = analyzeSourceRecovery(input);
    for (let n = 0; n < rows.length; n++) expect(analyzeSourceRecovery({ ...input, events: [...rows.slice(n), ...rows.slice(0, n)].reverse(), evidence: { ...input.evidence!, observations: [...input.evidence!.observations].reverse() } })).toEqual(expected);
  });
  it("4096 sessions/groups/chains and 8192 proofs retain complete evidence below output caps", () => {
    const rows = Array.from({ length: 4096 }, (_, i) => paired(event(`max-${i}`, i * 2, i * 2 + 1, { sessionId: id("session", `session-${i}`), turnId: id("turn", `turn-${i}`) }))), input = source(rows);
    for (const e of rows) validateEvent(e, input);
    const a = analyzeSourceRecovery(input), json = JSON.stringify(a), human = formatSourceRecovery(a);
    expect(a.partitions).toHaveLength(4096); expect(a.groups).toHaveLength(4096); expect(a.chains).toHaveLength(4096); expect(a.chains!.reduce((n, c) => n + c.evidenceObservationIds.length, 0)).toBe(8192);
    expect(Buffer.byteLength(json)).toBeLessThan(8 * 1024 * 1024); expect(Buffer.byteLength(human)).toBeLessThan(32 * 1024); expect(human.split("\n").length).toBeLessThan(160);
    expect(human).toContain("Operation groups shown=6/4096; omitted=4090"); expect(human).toContain("Chains shown=6/4096; omitted=4090");
  });
  it("rejects over-limit events and observations before reading evidence", () => {
    const e = event("limit", 0, 1), input = source([e]);
    expect(() => analyzeSourceRecovery({ ...input, events: Array(4097).fill(e) })).toThrow("source_recovery_limit_exceeded");
    expect(() => analyzeSourceRecovery({ ...input, evidence: { ...input.evidence!, observations: Array(8193).fill(observation(e)) } })).toThrow("source_recovery_limit_exceeded");
  });
});
