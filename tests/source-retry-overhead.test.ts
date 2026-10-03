import { describe, expect, it } from "vitest";
import { analyzeSourceRetryOverhead } from "../src/analysis/source-retry-overhead.js";
import { analyzeSourceFailures } from "../src/analysis/source-failures.js";
import { formatSourceRetryOverhead } from "../src/cli/retry-overhead.js";
import { formatStatsResult } from "../src/cli/stats.js";
import { validateEvent } from "../src/db/source-validation.js";
import type { NormalizedEvent } from "../src/normalize/types.js";
import { event, id, observation, paired, proofs, source, success } from "./retry-overhead-fixture.js";

const analyze = (rows: readonly NormalizedEvent[]) => analyzeSourceRetryOverhead(source(rows));
const distinct = (name: string) => ({ operationKey: id("operation", name) });
const nativeMeasured = (rows: readonly NormalizedEvent[]) => analyzeSourceFailures(source(rows)).cohorts!.reduce((n, c) => n + c.timing.measuredN, 0);

describe("independent stored failed-duration admission", () => {
  it.each([20, 1.5, 0, Number.MAX_SAFE_INTEGER])("uses stored %s ms independently of 1000 ms lifecycle", durationMs => {
    const rows = [event("duration", 0, 1000, { durationMs }), event("success", 5000, 6000, { ...success, durationMs: 999 })], a = analyze(rows);
    expect(a.summary).toMatchObject({ failedAttemptN: 1, measuredFailedAttemptN: 1, failedAttemptDurationSumMs: durationMs, failedAttemptDurationSumReason: null, retryOverheadMs: 1000 });
    expect(a.chains![0]).toMatchObject({ resolved: true, terminalSuccessEventId: rows[1]!.id, durationCoverage: { selectedN: 1, measuredN: 1, unavailableN: 0 }, durationMeasurements: [{ durationScope: "process_runtime", timingEvidence: "source_reported", n: 1, sumMs: durationMs, eventIds: [rows[0]!.id] }] });
    expect(nativeMeasured(rows)).toBe(1);
  });
  const invalid: readonly [string, Partial<NormalizedEvent>, string][] = [
    ["missing", { durationMs: null, durationScope: "unknown", timingEvidence: "unknown" }, "missing_duration"],
    ["estimated", { timingEvidence: "estimated" }, "estimated_timing"],
    ["negative", { durationMs: -1 }, "invalid_duration"], ["infinite", { durationMs: Infinity }, "invalid_duration"],
    ["NaN", { durationMs: NaN }, "invalid_duration"], ["unsafe", { durationMs: Number.MAX_SAFE_INTEGER + 1 }, "invalid_duration"],
    ["unknown scope", { durationScope: "unknown" }, "unknown_scope"], ["unknown evidence", { timingEvidence: "unknown" }, "unknown_timing"],
    ["lifecycle duration", { durationMs: 1000, durationScope: "item_lifecycle" }, "unsupported_timing_representation"],
    ["shell invocation scope", { durationScope: "invocation_latency" }, "unsupported_timing_representation"],
    ["structured paired evidence", { durationScope: "invocation_latency", timingEvidence: "paired_timestamps" }, "unsupported_timing_representation"],
  ];
  it.each(invalid)("keeps %s duration unavailable while interval remains observed", (_name, change, reason) => {
    const rows = [event("failure", 0, 1000, change)], a = analyze(rows);
    expect(a.summary).toMatchObject({ chainN: 1, unresolvedChainN: 1, failedAttemptDurationSumMs: null, failedAttemptDurationSumReason: "incomplete_duration_coverage", measuredFailedAttemptN: 0, unavailableDurationAttemptN: 1, retryOverheadMs: 1000 });
    expect(a.chains![0]!.durationCoverage.exclusions).toEqual({ [reason]: 1 }); expect(a.durationCohorts).toEqual([]); expect(nativeMeasured(rows)).toBe(0);
  });
  it("accepts source-reported MCP invocation latency and rejects its process scope", () => {
    const e = event("mcp", 0, 1000, { kind: "mcp", category: "mcp", toolName: "mcp", durationScope: "invocation_latency", durationMs: 1.5 });
    expect(analyze([e]).summary.failedAttemptDurationSumMs).toBe(1.5); expect(nativeMeasured([e])).toBe(1);
    const wrong = { ...e, durationScope: "process_runtime" as const }; expect(analyze([wrong]).summary.failedAttemptDurationSumMs).toBeNull(); expect(nativeMeasured([wrong])).toBe(0);
  });
  it.each(["result", "poll"] as const)("accepts exactly consistent paired %s proof including zero", representation => {
    const rows = [paired(event("paired", 0, 1000)), paired(event("zero", 2000, 2000, distinct("zero")))], obs = rows.flatMap(proofs).map(o => o.representation === "result" ? { ...o, representation } : o);
    const a = analyzeSourceRetryOverhead(source(rows, obs)); expect(a.summary).toMatchObject({ measuredFailedAttemptN: 2, failedAttemptDurationSumMs: 1000, retryOverheadMs: 1000 }); expect(a.chains!.map(c => c.failedAttemptDurationSumMs).sort((a, b) => a! - b!)).toEqual([0, 1000]);
  });
  it.each([-1, 1])("rejects paired duration differing from endpoints by %i ms despite storage tolerance", delta => {
    const e = paired(event("contradiction", 0, 1000)), input = source([{ ...e, durationMs: 1000 + delta }]); validateEvent(input.events[0], input);
    const a = analyzeSourceRetryOverhead(input); expect(a.summary.failedAttemptDurationSumMs).toBeNull(); expect(a.summary.retryOverheadMs).toBe(1000); expect(a.durationCoverage!.exclusions).toEqual({ missing_timing_provenance: 1 }); expect(nativeMeasured(input.events)).toBe(0);
  });
  it("rejects source-reported duration on a paired representation", () => {
    const e = { ...paired(event("paired-source", 0, 1000)), timingEvidence: "source_reported" as const };
    expect(analyze([e]).durationCoverage!.exclusions).toEqual({ unsupported_timing_representation: 1 }); expect(nativeMeasured([e])).toBe(0);
  });
});

describe("hand-specified duration and interval arithmetic", () => {
  it("three failures then success sum 21.5 ms, union 1250 ms, excluding success and gaps", () => {
    const rows = [event("f1", 0, 1000), event("f2", 2000, 2250, { durationMs: 1.5 }), event("f3", 3000, 3000, { durationMs: 0 }), event("s", 4000, 10000, { ...success, durationMs: 6000 })], a = analyze(rows);
    expect(a.summary).toMatchObject({ chainN: 1, resolvedChainN: 1, unresolvedChainN: 0, failedAttemptN: 3, measuredFailedAttemptN: 3, failedAttemptDurationSumMs: 21.5, retryOverheadMs: 1250 });
    expect(a.chains![0]).toMatchObject({ attemptCount: 4, failedAttemptCount: 3, failedEventIds: rows.slice(0, 3).map(e => e.id), terminalSuccessEventId: rows[3]!.id, firstFailedResultAt: "1970-01-01T00:00:01.000Z", successfulResultAt: "1970-01-01T00:00:10.000Z" });
    expect(a.chains![0]!.evidenceObservationIds).toEqual(rows.flatMap(proofs).map(o => o.id).sort());
  });
  it.each([[500, 1500, 1500], [0, 1000, 1000], [1000, 2000, 2000]] as const)("unites parallel distinct operations [0,1000] and [%i,%i] into %i ms", (start, end, expected) => {
    const a = analyze([event("first", 0, 1000, distinct("first")), event("second", start, end, distinct("second"))]);
    expect(a.chains).toHaveLength(2); expect(a.chains!.map(c => c.retryOverheadMs)).toEqual([1000, 1000]); expect(a.summary).toMatchObject({ unresolvedChainN: 2, failedAttemptDurationSumMs: 40, retryOverheadMs: expected }); expect(a.intervalPartitions![0]).toMatchObject({ failedAttemptN: 2, retryOverheadMs: expected, chainIds: a.chains!.map(c => c.id) });
  });
  it("multiple chains in one operation retain separate success references and one compatible source union", () => {
    const a = analyze([event("f1", 0, 1000), event("s1", 1100, 1200, success), event("f2", 2000, 2500, { durationMs: 1.5 }), event("s2", 2600, 2700, success)]);
    expect(a.summary).toMatchObject({ chainN: 2, resolvedChainN: 2, failedAttemptDurationSumMs: 21.5, retryOverheadMs: 1500 }); expect(a.chains!.map(c => c.retryOverheadMs)).toEqual([1000, 500]);
  });
  it("missing one selected duration does not silently sum a measured subset", () => {
    const rows = [event("known", 0, 1000), event("missing", 2000, 3000, { durationMs: null, durationScope: "unknown", timingEvidence: "unknown" })], a = analyze(rows);
    expect(a.summary).toMatchObject({ failedAttemptDurationSumMs: null, measuredFailedAttemptN: 1, unavailableDurationAttemptN: 1, retryOverheadMs: 2000 }); expect(a.chains![0]!.failedAttemptDurationSumMs).toBeNull(); expect(a.durationCohorts![0]).toMatchObject({ n: 1, sumMs: 20 });
  });
  it.each(["session", "interval", "duration"])("separates incompatible %s contracts with explicit nullable source totals", dimension => {
    const first = event("first", 0, 1000, distinct("first")), second = event("second", 500, 1500, { ...distinct("second"), ...(dimension === "session" ? { sessionId: id("session", "other") } : dimension === "duration" ? { kind: "mcp", category: "mcp", toolName: "mcp", durationScope: "invocation_latency" } as const : {}) });
    const a = analyze([first, dimension === "interval" ? paired(second) : second]);
    expect(a.durationCohorts).toHaveLength(2); expect(a.summary.failedAttemptDurationSumMs).toBeNull(); expect(a.summary.failedAttemptDurationSumReason).toBe("incompatible_duration_cohorts"); expect(a.chains!.every(c => c.failedAttemptDurationSumMs !== null)).toBe(true);
    expect(a.intervalPartitions).toHaveLength(dimension === "duration" ? 1 : 2); expect(a.summary.retryOverheadMs).toBe(dimension === "duration" ? 1500 : null); expect(a.summary.retryOverheadReason).toBe(dimension === "duration" ? null : "incompatible_interval_partitions");
  });
  it.each([[Number.MAX_SAFE_INTEGER, 1], [Number.MAX_SAFE_INTEGER - 1, 1.5]] as const)("checks recorded duration overflow %s + %s independently of valid intervals", (a, b) => {
    const result = analyze([event("huge", 0, 1000, { durationMs: a }), event("plus", 2000, 3000, { durationMs: b })]);
    expect(result.summary).toMatchObject({ failedAttemptDurationSumMs: null, failedAttemptDurationSumReason: "numeric_overflow", measuredFailedAttemptN: 2, retryOverheadMs: 2000 }); expect(result.durationCohorts![0]!.sumMs).toBeNull(); expect(result.chains![0]!.failedAttemptDurationSumReason).toBe("numeric_overflow");
  });
  it.each([false, true])("checks interval union overflow across %s while retaining stored duration", sameOperation => {
    const a = analyze([event("early", -8e15, -3e15), event("late", 3e15, 8e15, sameOperation ? {} : distinct("other"))]);
    expect(a.summary).toMatchObject({ failedAttemptDurationSumMs: 40, retryOverheadMs: null, retryOverheadReason: "numeric_overflow" }); expect(a.intervalPartitions![0]!.reason).toBe("numeric_overflow"); expect(a.chains!.map(c => c.retryOverheadMs)).toEqual(sameOperation ? [null] : [5e15, 5e15]);
  });
});

describe("Recovery availability and explicit admitted subset context", () => {
  it.each([["empty", []], ["success only", [event("success-only", 0, 1000, success)]]] as const)("evaluated %s failed selection retains zero", (_name, rows) => {
    const a = analyze(rows); expect(a.summary).toMatchObject({ chainN: 0, failedAttemptN: 0, measuredFailedAttemptN: 0, failedAttemptDurationSumMs: 0, retryOverheadMs: 0 }); expect(a.durationCohorts).toEqual([]); expect(a.intervalPartitions).toEqual([]); expect(a.chains).toEqual([]);
  });
  it.each(["absent", "unavailable", "limited", "ambiguous", "parser"])("keeps %s source suppression null instead of zero", reason => {
    const s = source([event("failure", 0, 1000)]), a = analyzeSourceRetryOverhead({ ...s, availability: reason === "unavailable" ? "unavailable" : "available", parserVersion: reason === "parser" ? 2 : 1,
      evidence: reason === "absent" ? null : { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, stateLimited: reason === "limited", ambiguousRecords: reason === "ambiguous" ? 1 : 0 } } });
    expect(a.assessment).toBe("suppressed"); expect(a.chains).toBeNull(); expect(a.durationCoverage).toBeNull(); expect(a.durationCohorts).toBeNull(); expect(a.intervalPartitions).toBeNull(); expect(a.summary).toMatchObject({ chainN: null, failedAttemptN: null, failedAttemptDurationSumMs: null, retryOverheadMs: null, retryOverheadReason: "recovery_unavailable" });
  });
  it("an unresolved chain retains observed failed contribution and original proof", () => {
    const e = event("unresolved", 0, 1000), a = analyze([e]); expect(a.summary).toMatchObject({ resolvedChainN: 0, unresolvedChainN: 1, failedAttemptDurationSumMs: 20, retryOverheadMs: 1000 }); expect(a.chains![0]).toMatchObject({ resolved: false, terminalSuccessEventId: null, successfulResultAt: null, failedEventIds: [e.id], evidenceObservationIds: [observation(e).id] });
  });
  it("partial Recovery keeps admitted values, one blocked failure and pending group reason", () => {
    const rows = [event("usable", 0, 1000), event("success", 5000, 6000, success), event("blocked", 0, 1000, distinct("blocked")), event("pending", 2000, 3000, { ...distinct("blocked"), status: "pending", executionOutcome: "unknown" })], input = source(rows);
    const a = analyzeSourceRetryOverhead({ ...input, evidence: { ...input.evidence!, capabilities: { ...input.evidence!.capabilities, coverage: "partial", unsupportedRecords: 1 } } }), human = formatSourceRetryOverhead(a);
    expect(a).toMatchObject({ assessment: "partial", summaryScope: "admitted_recovery_chains", summary: { chainN: 1, failedAttemptN: 1, failedAttemptDurationSumMs: 20, retryOverheadMs: 1000 }, recoveryContext: { summary: { knownFailedAttempts: 2, unavailableGroups: 1, unavailableKnownFailedAttempts: 1 } } });
    expect(a.recoveryContext.unavailableGroups[0]!.reasons).toContain("pending_attempt"); expect(a.recoveryContext.unavailableGroups[0]!.blockedFailedEventIds).toEqual([rows[2]!.id]); expect(a.recoveryContext.blockedPartitions[0]!.reasons).toContain("unavailable_groups"); expect(a.recoveryContext.limitations).toContain("partial_shape_coverage"); expect(human).toContain("Admitted chains"); expect(human).toContain("blocked known failures=1"); expect(human).toContain("pending_attempt"); expect(human).toContain("partial_shape_coverage");
  });
  it("missing identity retains blocked session references without an assignable group", () => {
    const e = event("missing", 0, 1000, { operationKey: null, turnId: null }), a = analyze([e]);
    expect(a.chains).toBeNull(); expect(a.recoveryContext.summary.unavailableKnownFailedAttempts).toBe(1); expect(a.recoveryContext.unavailableGroups).toEqual([]); expect(a.recoveryContext.blockedPartitions[0]).toMatchObject({ reasons: ["missing_operation_identity", "missing_turn_identity"], missingOperationEventIds: [e.id], missingTurnEventIds: [e.id], unassignedFailedEventIds: [e.id] });
  });
  it("missing native terminal proof preserves provenance suppression rather than inventing a chain", () => {
    const rows = [event("failure", 0, 1000), event("success", 5000, 6000, success)], a = analyzeSourceRetryOverhead(source(rows, [observation(rows[0]!)]));
    expect(a.chains).toBeNull(); expect(a.recoveryContext.inheritedProvenance.unresolvedEvents).toBe(1); expect(a.recoveryContext.blockedPartitions[0]!.unresolvedProvenanceEventIds).toEqual([rows[1]!.id]);
  });
});

describe("owned output, ordering, privacy and complete bounds", () => {
  it("owns recursively frozen output without changing or freezing mutable source input", () => {
    const input = structuredClone(source([paired(event("mutable", 0, 1000))])), before = JSON.stringify(input), a = analyzeSourceRetryOverhead(input), output = JSON.stringify(a);
    expect(JSON.stringify(input)).toBe(before); expect(Object.isFrozen(input.events)).toBe(false); expect(Object.isFrozen(input.evidence!.capabilities.observedShapes)).toBe(false);
    const check = (v: unknown): void => { if (v && typeof v === "object") { expect(Object.isFrozen(v)).toBe(true); Object.values(v).forEach(check); } }; check(a);
    (input.events as NormalizedEvent[]).push(event("later", 2000, 3000)); (input.evidence!.capabilities.observedShapes as string[]).push("synthetic"); expect(JSON.stringify(a)).toBe(output);
    const text = output + formatSourceRetryOverhead(a); expect(text).not.toMatch(/FICTITIOUS_|operationKey|errorFingerprint|contentFingerprint|sourceRef|boundaryFingerprint|commandPattern/); expect(text).not.toContain(input.events[0]!.operationKey!);
  });
  it("event/proof permutations preserve all aliases, cohorts, partitions and sums", () => {
    const rows = [event("f1", 0, 1000), event("f2", 2000, 3000, { durationMs: 1.5 }), event("s", 5000, 6000, success), paired(event("p", 500, 1500, distinct("paired")))], input = source(rows), a = analyzeSourceRetryOverhead(input);
    for (let n = 0; n < rows.length; n++) expect(analyzeSourceRetryOverhead({ ...input, events: [...rows.slice(n), ...rows.slice(0, n)].reverse(), evidence: { ...input.evidence!, observations: [...input.evidence!.observations].reverse() } })).toEqual(a);
  });
  it("4096 admitted chains and 8192 proofs fit the actual complete CLI envelope", () => {
    const end = 8.64e15, start = end - Number.MAX_SAFE_INTEGER;
    const rows = Array.from({ length: 4096 }, (_, i) => paired(event(`max-${i}`, start, end, { sessionId: id("session", `s-${i}`), turnId: id("turn", `t-${i}`) }))), input = source(rows);
    rows.forEach(e => validateEvent(e, input)); const a = analyzeSourceRetryOverhead(input), result = { mode: "selected_source_retry_overhead" as const, analysis: a }, json = formatStatsResult(result, true), human = formatStatsResult(result, false);
    expect(a.chains).toHaveLength(4096); expect(a.durationCohorts).toHaveLength(4096); expect(a.intervalPartitions).toHaveLength(4096); expect(a.chains!.reduce((n, c) => n + c.evidenceObservationIds.length, 0)).toBe(8192); expect(a.chains!.reduce((n, c) => n + c.durationMeasurements.reduce((m, d) => m + d.eventIds.length, 0), 0)).toBe(4096);
    expect(a.chains!.every(c => c.failedAttemptDurationSumMs === Number.MAX_SAFE_INTEGER && c.retryOverheadMs === Number.MAX_SAFE_INTEGER)).toBe(true); expect(a.summary.failedAttemptDurationSumMs).toBeNull(); expect(a.summary.retryOverheadMs).toBeNull();
    expect(Buffer.byteLength(json)).toBeLessThan(8 * 1024 * 1024); expect(Buffer.byteLength(human)).toBeLessThan(32 * 1024); expect(human.split("\n").length).toBeLessThan(160); expect(JSON.parse(json).result.analysis.chains).toHaveLength(4096);
    expect(human).toContain("Duration cohorts: shown=6/4096; omitted=4090"); expect(human).toContain("Interval partitions: shown=6/4096; omitted=4090"); expect(human).toContain("Chain detail: shown=6/4096; omitted=4090");
  });
  it("bounded unavailable group detail retains complete blocked failures", () => {
    const rows = Array.from({ length: 2048 }, (_, i) => [event(`blocked-${i}`, 0, 1000, distinct(`group-${i}`)), event(`pending-${i}`, 2000, 3000, { ...distinct(`group-${i}`), status: "pending", executionOutcome: "unknown" })]).flat(), a = analyze(rows), json = formatStatsResult({ mode: "selected_source_retry_overhead", analysis: a }, true), human = formatSourceRetryOverhead(a);
    expect(a.recoveryContext.summary).toMatchObject({ unavailableGroups: 2048, unavailableKnownFailedAttempts: 2048 }); expect(a.recoveryContext.unavailableGroups.reduce((n, g) => n + g.blockedFailedEventIds.length, 0)).toBe(2048); expect(a.chains).toBeNull(); expect(Buffer.byteLength(json)).toBeLessThan(8 * 1024 * 1024); expect(Buffer.byteLength(human)).toBeLessThan(32 * 1024); expect(human.split("\n").length).toBeLessThan(160); expect(human).toContain("Unavailable groups: shown=6/2048; omitted=2042");
  });
  it("inherits Recovery event/proof limits before computing retry values", () => {
    const e = event("limit", 0, 1000), input = source([e]); expect(() => analyzeSourceRetryOverhead({ ...input, events: Array(4097).fill(e) })).toThrow("source_recovery_limit_exceeded"); expect(() => analyzeSourceRetryOverhead({ ...input, evidence: { ...input.evidence!, observations: Array(8193).fill(observation(e)) } })).toThrow("source_recovery_limit_exceeded");
  });
});
