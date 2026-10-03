import { describe, expect, it, vi } from "vitest";
import { analyzeSourceActiveTime } from "../src/analysis/source-active-time.js";
import { formatSourceActiveTime } from "../src/cli/active-time.js";
import { formatStatsResult } from "../src/cli/stats.js";
import { validateTurn } from "../src/db/source-metric-validation.js";
import * as summary from "../src/analysis/source-summary.js";
import { capability, id, maximumSource, observation, paired, proofs, source, turn } from "./active-time-fixture.js";

const analyzed = (turns: Parameters<typeof source>[0]) => analyzeSourceActiveTime(source(turns));
describe("supported native turn interval geometry", () => {
  it.each([
    ["overlap", [[0, 10000], [5000, 15000]], 15000, 15000],
    ["identical", [[0, 10000], [0, 10000]], 10000, 10000],
    ["adjacent", [[0, 10000], [10000, 20000]], 20000, 20000],
    ["zero", [[100, 100]], 0, 0],
    ["long gap", [[0, 10000], [100000, 110000]], 20000, 110000],
    ["nested and gap", [[0, 10000], [1000, 2000], [30000, 35000]], 15000, 35000],
  ] as const)("computes independent %s union/span", (_name, intervals, activeTimeMs, observedSpanMs) => {
    const a = analyzed(intervals.map(([s, e], i) => turn(`t${i}`, s, e)));
    expect(a).toMatchObject({ assessment: "evaluated", summary: { eligibleTurns: intervals.length, excludedTurns: 0, partitions: 1 }, partitions: [{ activeTimeMs, observedSpanMs, activeTimeReason: null, observedSpanReason: null }] });
  });
  it("does not equate monotonic duration with wall interval and includes cancellation", () => {
    const t = turn("wall", 0, 10000, { durationMs: 8150, status: "cancelled" }), s = source([t]); validateTurn(t, s);
    expect(analyzeSourceActiveTime(s).partitions![0]).toMatchObject({ activeTimeMs: 10000, turnEvidence: [{ status: "cancelled" }] });
  });
  it("keeps sessions and native contracts separate without a pooled scalar", () => {
    const a = analyzed([turn("wall", 0, 10000), paired(turn("paired", 0, 10000)), turn("other-session", 0, 10000, { sessionId: id("session", "other") })]);
    expect(a.partitions).toHaveLength(3); expect(a.partitions!.map(p => p.activeTimeMs)).toEqual([10000, 10000, 10000]); expect(a.summary).not.toHaveProperty("activeTimeMs");
  });
  it.each([
    ["individual", [[-8e15, 8e15]], null, null],
    ["disjoint total", [[-8e15, -3e15], [3e15, 8e15]], null, null],
    ["span only", [[-8e15, -8e15 + 1000], [8e15 - 1000, 8e15]], 2000, null],
  ] as const)("retains %s positioned membership and independent overflow reasons", (_name, intervals, union, span) => {
    const turns = intervals.map(([s, e], i) => turn(`overflow-${i}`, s, e)), a = analyzed(turns), p = a.partitions![0]!;
    turns.forEach(t => validateTurn(t, source(turns))); expect(p.turnN).toBe(turns.length); expect(p.turnIds).toHaveLength(turns.length);
    expect(p).toMatchObject({ activeTimeMs: union, activeTimeReason: union === null ? "numeric_overflow" : null, observedSpanMs: span, observedSpanReason: span === null ? "numeric_overflow" : null });
    expect(formatSourceActiveTime(a)).toContain("numeric_overflow");
  });
});
describe("supported boundary/status admission", () => {
  it.each([
    ["pending", { status: "pending" }, "pending"], ["unknown status", { status: "unknown" }, "unknownStatus"],
    ["missing start", { startAt: null, startTimingEvidence: "unknown" }, "missingBoundaries"], ["missing end", { endAt: null, endTimingEvidence: "unknown" }, "missingBoundaries"],
    ["unknown interval", { intervalScope: "unknown", intervalTimingEvidence: "unknown" }, "unknownInterval"],
    ["estimated interval", { intervalTimingEvidence: "estimated" }, "estimatedTiming"], ["estimated endpoint", { startTimingEvidence: "estimated" }, "estimatedTiming"],
    ["mixed endpoint", { startTimingEvidence: "paired_timestamps" }, "inconsistentInterval"], ["wrong scope", { intervalScope: "observed_turn" }, "inconsistentInterval"],
    ["reversed", { startAt: new Date(20000).toISOString() }, "invalidBoundaries"], ["malformed", { endAt: "invalid" }, "invalidBoundaries"],
    ["unknown endpoint", { endTimingEvidence: "unknown" }, "inconsistentInterval"],
  ])("excludes %s with explicit membership/reason", (_name, extra, reason) => {
    const t = turn("bad", 0, 10000, extra as never), a = analyzed([t]);
    expect(a.assessment).toBe("no_eligible_turns"); expect(a.exclusions).toHaveProperty(reason as string, 1); expect(a.excludedTurnEvidence).toEqual([{ turnId: t.id, reason }]); expect(a.partitions).toEqual([]);
  });
  it("keeps valid observed subset measurable beside exclusions", () => {
    const a = analyzed([turn("good", 0, 10000), turn("pending", 20000, 30000, { status: "pending" })]);
    expect(a).toMatchObject({ assessment: "partial", activeTimeAssessmentReason: "excluded_turns", summary: { eligibleTurns: 1, excludedTurns: 1 }, partitions: [{ activeTimeMs: 10000 }] });
  });
});
describe("ordinary observation proof without invented timestamps", () => {
  const t = turn("proof", 0, 10000);
  it.each([
    ["absent", [], "missingTerminalProof"],
    ["ref mismatch", [observation(t, { sourceRef: { ...t.sourceRef, byteOffset: 99 } })], "missingTerminalProof"],
    ["nonordinary", [observation(t, { origin: "trusted_copied" })], "missingTerminalProof"],
    ["nonturn", [observation(t, { representation: "provenance" })], "missingTerminalProof"],
    ["unknown terminal", [observation(t, { transportStatus: "unknown" })], "missingTerminalProof"],
    ["contradiction", [observation(t), observation(t, { id: id("source", "contradiction"), transportStatus: "cancelled" })], "contradictoryTerminalProof"],
    ["failed contradiction", [observation(t, { transportStatus: "failed" })], "contradictoryTerminalProof"],
  ] as const)("excludes %s proof", (_name, obs, reason) => {
    const a = analyzeSourceActiveTime(source([t], obs)); expect(a.exclusions![reason]).toBe(1); expect(a.partitions).toEqual([]);
  });
  it("source-reported complete record does not require pending proof", () => {
    expect(analyzeSourceActiveTime(source([t], [observation(t)])).partitions![0]!.activeTimeMs).toBe(10000);
  });
  it.each([[], [observation(t, { transportStatus: "pending", sourceRef: { ...t.sourceRef, byteOffset: 101 } })]].map(extra => [extra]))("paired requires earlier ordinary pending proof %j", extra => {
    const p = paired(t), a = analyzeSourceActiveTime(source([p], [observation(p), ...extra])); expect(a.exclusions!.missingPendingProof).toBe(1);
  });
  it("consistent terminal replay is allowed but pending must precede first terminal", () => {
    const p = paired(t), prior = observation(p, { id: id("source", "prior"), sourceRef: { ...p.sourceRef, byteOffset: 80 } }), pending = observation(p, { id: id("source", "pending"), transportStatus: "pending", sourceRef: { ...p.sourceRef, byteOffset: 90 } });
    expect(analyzeSourceActiveTime(source([p], [prior, pending, observation(p)])).exclusions!.missingPendingProof).toBe(1);
    const earlier = { ...pending, sourceRef: { ...pending.sourceRef, byteOffset: 70 } }, a = analyzeSourceActiveTime(source([p], [observation(p), prior, earlier]));
    expect(a.partitions![0]!.turnEvidence[0]!.evidenceObservationIds).toEqual([prior.id, earlier.id, observation(p).id].sort());
  });
});
describe("inherited generation/suppression/capability context", () => {
  const base = source([turn("t", 0, 10000)]);
  it.each([
    ["unavailable", { ...base, availability: "unavailable" }, "source_unavailable"],
    ["evidence absent", { ...base, evidence: null, persistedScope: "events_only" }, "evidence_absent"],
    ["limited", capability(base, { stateLimited: true }), "state_limited"],
    ["dropped", capability(base, { diagnosticsDropped: 1 }), "state_limited"],
    ["ambiguous count", capability(base, { ambiguousRecords: 1 }), "ambiguous_origin"],
    ["ambiguous proof", { ...base, evidence: { ...base.evidence!, observations: [observation(base.evidence!.turns[0] as never, { origin: "ambiguous" })] } }, "ambiguous_origin"],
    ["parser2", { ...base, parserVersion: 2 }, "unsupported_parser_contract"],
    ["capability parser", capability(base, { parserVersion: 2 as never }), "unsupported_parser_contract"],
    ["capability provider", capability(base, { provider: "claude" as never }), "unsupported_parser_contract"],
    ["unsupported support", capability(base, { support: "all" as never }), "unsupported_parser_contract"],
    ["Claude duration-only", { ...base, provider: "claude" }, "unsupported_provider"],
  ] as const)("keeps %s unavailable, not empty", (_name, input, reason) => {
    const a = analyzeSourceActiveTime(input as never); expect(a).toMatchObject({ assessment: "unavailable", activeTimeAssessmentReason: reason, summary: { eligibleTurns: null, excludedTurns: null, partitions: null }, partitions: null, exclusions: null });
    expect(formatSourceActiveTime(a)).toContain(`reason=${reason}`);
  });
  it("distinguishes evaluated empty and retains partial shape context", () => {
    expect(analyzed([])).toMatchObject({ assessment: "no_eligible_turns", activeTimeAssessmentReason: "no_supported_turn_intervals", summary: { eligibleTurns: 0, excludedTurns: 0, partitions: 0 }, partitions: [] });
    const a = analyzeSourceActiveTime(capability(base, { coverage: "partial", unsupportedRecords: 1 }));
    expect(a).toMatchObject({ assessment: "partial", activeTimeAssessmentReason: "partial_shape_coverage", revision: 2, parserVersion: 1, normalizationVersion: 1, keyVersion: 1, completedOffset: 1000000, observedSize: 1000005, sourceFreshnessChecked: false, queryPeriod: null, observationWindow: { unit: "source_bytes", startInclusive: 0, endExclusive: 1000000 }, partitions: [{ activeTimeMs: 10000 }] });
    expect(formatSourceActiveTime(a)).toContain("coverage=partial"); expect(a.limitations).toContain("partial_shape_coverage");
  });
  it("uses one unchanged source summary", () => {
    const spy = vi.spyOn(summary, "summarizeSource"); try { analyzeSourceActiveTime(base); expect(spy).toHaveBeenCalledExactlyOnceWith(base); } finally { spy.mockRestore(); }
  });
});
it("is deterministic, deeply frozen, independently owned and content-free", () => {
  const rows = [paired(turn("b", 20000, 30000)), turn("a", 0, 10000)], input = structuredClone(source(rows)), before = structuredClone(input), a = analyzeSourceActiveTime(input);
  const reversed = { ...source([...rows].reverse()), evidence: { ...source(rows).evidence!, turns: [...rows].reverse(), observations: rows.flatMap(proofs).reverse() } };
  expect(a).toEqual(analyzeSourceActiveTime(reversed)); expect(input).toEqual(before); expect(Object.isFrozen(input)).toBe(false);
  const frozen = (v: unknown): void => { if (v && typeof v === "object") { expect(Object.isFrozen(v)).toBe(true); Object.values(v).forEach(frozen); } }; frozen(a);
  (input.evidence!.turns as unknown as { startAt: string }[])[0]!.startAt = "changed"; (input.evidence!.capabilities.observedShapes as string[]).push("FICTITIOUS_ACTIVE_PRIVATE"); expect(a).toEqual(analyzeSourceActiveTime(before));
  expect(JSON.stringify(a)).not.toMatch(/sourceRef|byteOffset|commandPattern|operationKey|contentFingerprint|errorFingerprint|FICTITIOUS_/);
});
it("retains 4096 turns/8192 proofs before exact bounded human omissions", () => {
  const input = maximumSource(), a = analyzeSourceActiveTime(input), envelope = formatStatsResult({ mode: "selected_source_active_time", analysis: a }, true), human = formatSourceActiveTime(a);
  expect(a.summary).toEqual({ eligibleTurns: 4096, excludedTurns: 0, partitions: 4096 }); expect(a.partitions!.flatMap(p => p.turnEvidence.flatMap(t => t.evidenceObservationIds))).toHaveLength(8192);
  expect(Buffer.byteLength(envelope)).toBeLessThan(8 * 1024 * 1024); expect(Buffer.byteLength(human)).toBeLessThan(32 * 1024); expect(human.trimEnd().split("\n").length).toBeLessThan(160); expect(human).toContain("Partition detail: shown=6; omitted=4090");
});
it.each(["turns", "observations"])("enforces unchanged source-summary hard cap for %s", field => {
  const t = turn("t", 0, 10000), base = source([t]), evidence = { ...base.evidence!, [field]: Array(field === "turns" ? 4097 : 8193).fill(field === "turns" ? t : observation(t)) };
  expect(() => analyzeSourceActiveTime({ ...base, evidence })).toThrow("source_summary_limit_exceeded");
});
