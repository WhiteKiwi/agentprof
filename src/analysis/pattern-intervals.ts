/** Bounded half-open interval arithmetic. No durations are converted into positions. */
export type PatternPeriod = Readonly<{ startMs: number; endMs: number }>;
export type PatternInterval = Readonly<{
  id: string; sessionId: string; category: string;
  intervalScope: "invocation_latency" | "item_lifecycle";
  intervalTimingEvidence: "paired_timestamps" | "source_reported";
  startMs: number; endMs: number;
}>;
export const TIMED_PATTERN_RULES = ["retry-loop", "repeated-error", "context-churn"] as const;
export type TimedPatternRule = typeof TIMED_PATTERN_RULES[number];
export type PatternMembership = Readonly<Record<TimedPatternRule, readonly string[]>>;
export type PatternTimePartition = Readonly<{
  id: string; sessionId: string; intervalScope: PatternInterval["intervalScope"];
  intervalTimingEvidence: PatternInterval["intervalTimingEvidence"]; unit: "ms";
  positionedEventIds: readonly string[]; contributingEventIds: readonly string[];
  intervalLengthSumMs: number | null; toolBusyMs: number | null;
  concurrentCallsMs: number | null; concurrentCategoriesMs: number | null;
  exclusiveCategoryMs: Readonly<Record<string, number | null>>;
  perRuleMs: Readonly<Record<TimedPatternRule, number | null>>;
  patternAssociatedMs: number | null; multipleRulesMs: number | null;
  ruleOverlapExcessMs: number | null; arithmeticOverflow: boolean;
}>;
export const lexical = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export function freezeOwned<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeOwned(child);
    Object.freeze(value);
  }
  return value;
}
export function addSafe(a: number | null, b: number | null): number | null {
  return a !== null && b !== null && a >= 0 && b >= 0 && Number.isSafeInteger(a) && Number.isSafeInteger(b)
    && Number.isSafeInteger(a + b) ? a + b : null;
}
export function validatePatternPeriod(period: PatternPeriod | null): void {
  if (period !== null && (!Number.isSafeInteger(period.startMs) || !Number.isSafeInteger(period.endMs)
    || period.endMs <= period.startMs || !Number.isSafeInteger(period.endMs - period.startMs))) {
    throw new RangeError("invalid_pattern_period");
  }
}
const partitionKey = (x: PatternInterval) => JSON.stringify([x.sessionId, x.intervalScope, x.intervalTimingEvidence]);

/** One sweep per compatible partition; all changes at a tied endpoint are applied together. */
export function measurePatternIntervals(
  intervals: readonly PatternInterval[], membership: PatternMembership,
  period: PatternPeriod | null = null,
): readonly PatternTimePartition[] {
  validatePatternPeriod(period);
  if (intervals.length > 4096 || TIMED_PATTERN_RULES.some(rule => membership[rule].length > 4096)) throw new RangeError("pattern_interval_limit");
  const unique = new Map<string, PatternInterval>();
  for (const x of intervals) {
    if (!Number.isSafeInteger(x.startMs) || !Number.isSafeInteger(x.endMs) || x.endMs < x.startMs
      || !["invocation_latency", "item_lifecycle"].includes(x.intervalScope)
      || !["source_reported", "paired_timestamps"].includes(x.intervalTimingEvidence)) throw new RangeError("invalid_pattern_interval");
    const prior = unique.get(x.id);
    if (prior !== undefined && (partitionKey(prior) !== partitionKey(x) || prior.category !== x.category
      || prior.startMs !== x.startMs || prior.endMs !== x.endMs)) throw new RangeError("conflicting_pattern_interval");
    unique.set(x.id, x);
  }
  const memberSets = Object.fromEntries(TIMED_PATTERN_RULES.map(rule => [rule, new Set(membership[rule])])) as Record<TimedPatternRule, Set<string>>;
  const buckets = new Map<string, PatternInterval[]>();
  for (const x of unique.values()) {
    if (period !== null && (x.endMs <= period.startMs || x.startMs >= period.endMs)) continue;
    const clipped = { ...x, startMs: period === null ? x.startMs : Math.max(x.startMs, period.startMs), endMs: period === null ? x.endMs : Math.min(x.endMs, period.endMs) };
    const key = partitionKey(x), rows = buckets.get(key);
    if (rows) rows.push(clipped); else buckets.set(key, [clipped]);
  }
  const result: PatternTimePartition[] = [];
  for (const [, rows] of [...buckets].sort(([a], [b]) => lexical(a, b))) {
    rows.sort((a, b) => lexical(a.id, b.id));
    const first = rows[0]!;
    type Change = { at: number; delta: 1 | -1; category: string; rules: TimedPatternRule[] };
    const changes: Change[] = [], categories = new Map<string, number>();
    const exclusive: Record<string, number | null> = Object.create(null) as Record<string, number | null>;
    const ruleCounts: Record<TimedPatternRule, number> = { "retry-loop": 0, "repeated-error": 0, "context-churn": 0 };
    const perRule: Record<TimedPatternRule, number | null> = { "retry-loop": 0, "repeated-error": 0, "context-churn": 0 };
    let sum: number | null = 0, busy: number | null = 0, concurrent: number | null = 0, multiCategory: number | null = 0;
    let pattern: number | null = 0, multipleRules: number | null = 0, active = 0;
    const contributing: string[] = [];
    for (const x of rows) {
      exclusive[x.category] = 0;
      const rules = TIMED_PATTERN_RULES.filter(rule => memberSets[rule].has(x.id));
      if (rules.length) contributing.push(x.id);
      sum = addSafe(sum, x.endMs - x.startMs);
      if (x.startMs !== x.endMs) changes.push({ at: x.startMs, delta: 1, category: x.category, rules }, { at: x.endMs, delta: -1, category: x.category, rules });
    }
    changes.sort((a, b) => a.at - b.at);
    let previous = changes[0]?.at ?? 0, i = 0;
    while (i < changes.length) {
      const at = changes[i]!.at, delta = at - previous;
      if (active > 0) {
        busy = addSafe(busy, delta);
        if (active > 1) concurrent = addSafe(concurrent, delta);
        if (categories.size > 1) multiCategory = addSafe(multiCategory, delta);
        else {
          const category = categories.keys().next().value;
          if (category !== undefined) exclusive[category] = addSafe(exclusive[category] ?? null, delta);
        }
        let ruleN = 0;
        for (const rule of TIMED_PATTERN_RULES) if (ruleCounts[rule] > 0) { ruleN++; perRule[rule] = addSafe(perRule[rule], delta); }
        if (ruleN > 0) pattern = addSafe(pattern, delta);
        if (ruleN > 1) multipleRules = addSafe(multipleRules, delta);
      }
      while (i < changes.length && changes[i]!.at === at) {
        const c = changes[i++]!; active += c.delta;
        const count = (categories.get(c.category) ?? 0) + c.delta;
        if (count === 0) categories.delete(c.category); else categories.set(c.category, count);
        for (const rule of c.rules) ruleCounts[rule] += c.delta;
      }
      previous = at;
    }
    let ruleSum: number | null = 0;
    for (const rule of TIMED_PATTERN_RULES) ruleSum = addSafe(ruleSum, perRule[rule]);
    const excess = ruleSum === null || pattern === null ? null : ruleSum - pattern;
    const exclusiveOrdered = Object.fromEntries(Object.entries(exclusive).sort(([a], [b]) => lexical(a, b)));
    result.push({ id: `time-${result.length + 1}`, sessionId: first.sessionId,
      intervalScope: first.intervalScope, intervalTimingEvidence: first.intervalTimingEvidence, unit: "ms",
      positionedEventIds: rows.map(x => x.id), contributingEventIds: contributing,
      intervalLengthSumMs: sum, toolBusyMs: busy, concurrentCallsMs: concurrent,
      concurrentCategoriesMs: multiCategory, exclusiveCategoryMs: exclusiveOrdered,
      perRuleMs: perRule, patternAssociatedMs: pattern, multipleRulesMs: multipleRules,
      ruleOverlapExcessMs: excess,
      arithmeticOverflow: [sum, busy, concurrent, multiCategory, pattern, multipleRules, excess, ...Object.values(exclusiveOrdered), ...Object.values(perRule)].some(x => x === null),
    });
  }
  return freezeOwned(result);
}
