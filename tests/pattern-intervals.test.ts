import { describe, expect, it } from "vitest";
import { measurePatternIntervals, validatePatternPeriod } from "../src/analysis/pattern-intervals.js";
import type { PatternInterval, PatternMembership } from "../src/analysis/pattern-intervals.js";
const empty: PatternMembership = { "retry-loop": [], "repeated-error": [], "context-churn": [] };
const interval = (id: string, startMs: number, endMs: number, category = "test", extra: Partial<PatternInterval> = {}): PatternInterval => ({
  id, sessionId: "session", category, startMs, endMs, intervalScope: "invocation_latency", intervalTimingEvidence: "paired_timestamps", ...extra,
});
describe("compatible pattern interval sweep", () => {
  it("distinguishes 20 seconds of calls from a 15-second union and 5 seconds of category concurrency", () => {
    const [p] = measurePatternIntervals([interval("a", 0, 10000, "build"), interval("b", 5000, 15000, "test")], empty);
    expect(p).toMatchObject({ intervalLengthSumMs: 20000, toolBusyMs: 15000, concurrentCallsMs: 5000, concurrentCategoriesMs: 5000,
      exclusiveCategoryMs: { build: 5000, test: 5000 }, patternAssociatedMs: 0 });
  });
  it("keeps same-category overlap exclusive to that category", () => {
    const [p] = measurePatternIntervals([interval("a", 0, 10000), interval("b", 5000, 15000)], empty);
    expect(p).toMatchObject({ toolBusyMs: 15000, concurrentCallsMs: 5000, concurrentCategoriesMs: 0, exclusiveCategoryMs: { test: 15000 } });
  });
  it("unions retry12 + repeated8 with five seconds of overlap into 15", () => {
    const [p] = measurePatternIntervals([interval("a", 0, 12000), interval("b", 7000, 15000)], { ...empty, "retry-loop": ["a"], "repeated-error": ["b"] });
    expect(p).toMatchObject({ perRuleMs: { "retry-loop": 12000, "repeated-error": 8000, "context-churn": 0 },
      patternAssociatedMs: 15000, multipleRulesMs: 5000, ruleOverlapExcessMs: 5000 });
  });
  it("does not call triple-rule multiplicity excess concurrent wall time", () => {
    const [p] = measurePatternIntervals([interval("a", 0, 10000)], { "retry-loop": ["a"], "repeated-error": ["a"], "context-churn": ["a"] });
    expect(p).toMatchObject({ patternAssociatedMs: 10000, multipleRulesMs: 10000, ruleOverlapExcessMs: 20000, intervalLengthSumMs: 10000 });
  });
  it("deduplicates canonical IDs and repeated memberships before counting", () => {
    const a = interval("a", 0, 10000);
    expect(measurePatternIntervals([a, { ...a }], { ...empty, "retry-loop": ["a", "a"] })[0]).toMatchObject({ positionedEventIds: ["a"], toolBusyMs: 10000, patternAssociatedMs: 10000 });
  });
  it.each(["endMs", "category", "sessionId", "intervalScope", "intervalTimingEvidence"] as const)("rejects conflicting identity field %s", field => {
    const a = interval("a", 0, 10000);
    const values = { endMs: 11000, category: "read", sessionId: "other", intervalScope: "item_lifecycle", intervalTimingEvidence: "source_reported" } as const;
    expect(() => measurePatternIntervals([a, { ...a, [field]: values[field] }], empty)).toThrow("conflicting_pattern_interval");
  });
  it("does not combine sessions or timing contracts", () => {
    const ps = measurePatternIntervals([interval("a", 0, 10), interval("b", 0, 10, "test", { sessionId: "other" }),
      interval("c", 0, 10, "test", { intervalScope: "item_lifecycle", intervalTimingEvidence: "source_reported" })], empty);
    expect(ps).toHaveLength(3); expect(ps.every(p => p.toolBusyMs === 10)).toBe(true);
  });
  it("clips half-open contributions, excluding outside intervals and preserving adjacency", () => {
    const [p] = measurePatternIntervals([interval("a", 0, 10), interval("b", 10, 20), interval("c", 20, 30)],
      { ...empty, "retry-loop": ["a", "b", "c"] }, { startMs: 5, endMs: 20 });
    expect(p).toMatchObject({ positionedEventIds: ["a", "b"], toolBusyMs: 15, concurrentCallsMs: 0, patternAssociatedMs: 15 });
  });
  it("retains real zero intervals and does not fill gaps", () => {
    const [p] = measurePatternIntervals([interval("a", 0, 0), interval("b", 100, 110), interval("c", 1000, 1010)], empty);
    expect(p).toMatchObject({ positionedEventIds: ["a", "b", "c"], toolBusyMs: 20, intervalLengthSumMs: 20 });
    expect(measurePatternIntervals([interval("z", 1, 1)], empty)[0]?.toolBusyMs).toBe(0);
  });
  it("retains null on arithmetic overflow while preserving counts", () => {
    const [p] = measurePatternIntervals([interval("a", -8000000000000000, 0), interval("b", 0, 8000000000000000)], empty);
    expect(p).toMatchObject({ intervalLengthSumMs: null, toolBusyMs: null, arithmeticOverflow: true });
    expect(p?.positionedEventIds).toHaveLength(2);
  });
  it.each([{ startMs: 0, endMs: 0 }, { startMs: 10, endMs: 1 }, { startMs: NaN, endMs: 2 }, { startMs: 0.5, endMs: 2 },
    { startMs: -8000000000000000, endMs: 8000000000000000 }])("rejects invalid query %j", period => expect(() => validatePatternPeriod(period)).toThrow());
  it("is immutable, permutation invariant and bounded at 4096 independent executions", () => {
    const xs = Array.from({ length: 4096 }, (_, i) => interval(`e${i}`, i * 2, i * 2 + 1));
    const before = JSON.stringify(xs), a = measurePatternIntervals(xs, empty);
    expect(a).toEqual(measurePatternIntervals([...xs].reverse(), empty)); expect(JSON.stringify(xs)).toBe(before);
    expect(Object.isFrozen(xs)).toBe(false); expect(Object.isFrozen(a[0]?.exclusiveCategoryMs)).toBe(true);
    expect(a[0]?.toolBusyMs).toBe(4096); expect(() => measurePatternIntervals([...xs, interval("over", 1, 2)], empty)).toThrow();
  });
});
