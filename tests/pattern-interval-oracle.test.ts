import { expect, it } from "vitest";
import { measurePatternIntervals, TIMED_PATTERN_RULES } from "../src/analysis/pattern-intervals.js";
import type { PatternInterval, PatternMembership, PatternPeriod } from "../src/analysis/pattern-intervals.js";

/** Independent integer-grid oracle: enumerate covered unit cells, not sweep endpoints. */
it("matches 500 reproducible random overlap populations, including half-open query clipping", () => {
  let seed = 131071;
  const random = (n: number): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let trial = 0; trial < 500; trial++) {
    const intervals: PatternInterval[] = Array.from({ length: random(20) + 1 }, (_, i) => {
      const a = random(50), b = random(50);
      return { id: `event-${i}`, sessionId: "synthetic-session", category: ["test", "read", "build"][random(3)]!,
        intervalScope: "invocation_latency", intervalTimingEvidence: "paired_timestamps", startMs: Math.min(a, b), endMs: Math.max(a, b) };
    });
    const membership: PatternMembership = {
      "retry-loop": intervals.filter(() => random(2) === 1).map(x => x.id),
      "repeated-error": intervals.filter(() => random(2) === 1).map(x => x.id),
      "context-churn": intervals.filter(() => random(2) === 1).map(x => x.id),
    };
    const period: PatternPeriod | null = trial % 2 === 0 ? null : { startMs: random(25), endMs: 25 + random(25) };
    const [result] = measurePatternIntervals(intervals, membership, period);
    const expected = { busy: 0, concurrent: 0, multiCategory: 0, pattern: 0, multipleRules: 0,
      exclusive: { test: 0, read: 0, build: 0 } as Record<string, number>,
      rules: { "retry-loop": 0, "repeated-error": 0, "context-churn": 0 } };
    for (let t = 0; t < 50; t++) {
      if (period !== null && (t < period.startMs || t >= period.endMs)) continue;
      const active = intervals.filter(x => x.startMs <= t && t < x.endMs), categories = new Set(active.map(x => x.category));
      if (active.length > 0) expected.busy++;
      if (active.length > 1) expected.concurrent++;
      if (categories.size > 1) expected.multiCategory++;
      if (categories.size === 1) expected.exclusive[categories.values().next().value!]!++;
      let activeRuleN = 0;
      for (const rule of TIMED_PATTERN_RULES) if (active.some(x => membership[rule].includes(x.id))) { expected.rules[rule]++; activeRuleN++; }
      if (activeRuleN > 0) expected.pattern++;
      if (activeRuleN > 1) expected.multipleRules++;
    }
    if (result === undefined) { expect(expected.busy).toBe(0); continue; }
    expect(result.toolBusyMs).toBe(expected.busy);
    expect(result.concurrentCallsMs).toBe(expected.concurrent);
    expect(result.concurrentCategoriesMs).toBe(expected.multiCategory);
    expect(result.perRuleMs).toEqual(expected.rules);
    expect(result.patternAssociatedMs).toBe(expected.pattern);
    expect(result.multipleRulesMs).toBe(expected.multipleRules);
    expect(result.ruleOverlapExcessMs).toBe(Object.values(expected.rules).reduce((a, b) => a + b, 0) - expected.pattern);
    for (const category of Object.keys(expected.exclusive)) expect(result.exclusiveCategoryMs[category] ?? 0).toBe(expected.exclusive[category]);
    expect(measurePatternIntervals([...intervals].reverse(), membership, period)).toEqual([result]);
  }
});
