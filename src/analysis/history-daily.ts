import type { HistoryReconciliation, HistoryExecution } from "./history-reconcile.js";
import { freezeOwned, lexical, measurePatternIntervals } from "./pattern-intervals.js";
import type { PatternInterval, PatternTimePartition } from "./pattern-intervals.js";
import { HISTORY_DAY_MS, HISTORY_LIMITS, HistoryQueryError, validateHistoryQuery } from "./history-query.js";
import type { HistoryQuery } from "./history-query.js";

export type HistoryDay = Readonly<{
  id: string; date: string; provider: "codex" | "claude"; sessionId: string;
  intervalScope: PatternInterval["intervalScope"]; intervalTimingEvidence: PatternInterval["intervalTimingEvidence"];
  windowStartMs: number; windowEndMs: number; unit: "ms";
  terminalCompletions: number; completedN: number; failedN: number;
  completedEventIds: readonly string[]; failedEventIds: readonly string[];
  memberExecutionIds: readonly string[];
  intervalLengthSumMs: number | null; toolBusyMs: number | null; concurrentCallsMs: number | null;
  concurrentCategoriesMs: number | null; exclusiveCategoryMs: PatternTimePartition["exclusiveCategoryMs"];
  arithmeticOverflow: boolean;
}>;
/** Sparse local-calendar days: count by terminal boundary, time by clipped intersection. */
export function buildHistoryDays(reconciliation: HistoryReconciliation, query: HistoryQuery): readonly HistoryDay[] {
  validateHistoryQuery(query);
  type Bucket = { date: string; provider: "codex" | "claude"; start: number; end: number;
    intervals: Map<string, PatternInterval>; members: Map<string, HistoryExecution>; completions: Map<string, HistoryExecution> };
  const buckets = new Map<string, Bucket>();
  let memberships = 0;
  const shift = query.offsetMinutes * 60_000;
  function bucket(e: HistoryExecution, at: number): Bucket {
    const x = e.interval!;
    const localDay = Math.floor((at + shift) / HISTORY_DAY_MS), dayStart = localDay * HISTORY_DAY_MS - shift;
    const date = new Date(localDay * HISTORY_DAY_MS).toISOString().slice(0, 10);
    const key = JSON.stringify([date, e.provider, e.sessionId, x.intervalScope, x.intervalTimingEvidence]);
    let b = buckets.get(key);
    if (!b) {
      b = { date, provider: e.provider, start: Math.max(dayStart, query.startMs), end: Math.min(dayStart + HISTORY_DAY_MS, query.endMs),
        intervals: new Map(), members: new Map(), completions: new Map() };
      buckets.set(key, b);
    }
    return b;
  }
  function member(b: Bucket, e: HistoryExecution, start: number, end: number): void {
    if (!b.members.has(e.eventId)) {
      if (++memberships > HISTORY_LIMITS.dailyMemberships) throw new HistoryQueryError();
      b.members.set(e.eventId, e);
    }
    const previous = b.intervals.get(e.eventId);
    if (previous === undefined || start < end) b.intervals.set(e.eventId, { ...e.interval!, startMs: start, endMs: end });
  }
  for (const e of reconciliation.executions) {
    if (e.state !== "admitted" || e.interval === null || query.sessionId !== null && e.sessionId !== query.sessionId) continue;
    const x = e.interval;
    if (x.endMs >= query.startMs && x.endMs < query.endMs) {
      const b = bucket(e, x.endMs);
      member(b, e, x.endMs, x.endMs);
      b.completions.set(e.eventId, e);
    }
    const end = Math.min(x.endMs, query.endMs);
    let start = Math.max(x.startMs, query.startMs);
    while (start < end) {
      const b = bucket(e, start), boundary = Math.min(end, b.end);
      if (boundary <= start) throw new HistoryQueryError();
      member(b, e, start, boundary); start = boundary;
    }
  }
  const result: HistoryDay[] = [];
  for (const [, b] of [...buckets].sort(([a], [z]) => lexical(a, z))) {
    const measured = measurePatternIntervals([...b.intervals.values()], { "retry-loop": [], "repeated-error": [], "context-churn": [] });
    const m = measured[0];
    if (m === undefined || measured.length !== 1) throw new HistoryQueryError();
    const completed = [...b.completions.values()].filter(e => e.status === "completed").map(e => e.eventId).sort(lexical);
    const failed = [...b.completions.values()].filter(e => e.status === "failed").map(e => e.eventId).sort(lexical);
    result.push({ id: `day-${result.length + 1}`, date: b.date, provider: b.provider, sessionId: m.sessionId,
      intervalScope: m.intervalScope, intervalTimingEvidence: m.intervalTimingEvidence,
      windowStartMs: b.start, windowEndMs: b.end, unit: "ms", terminalCompletions: b.completions.size,
      completedN: completed.length, failedN: failed.length, completedEventIds: completed, failedEventIds: failed,
      memberExecutionIds: [...b.members.values()].map(e => e.id).sort(lexical),
      intervalLengthSumMs: m.intervalLengthSumMs, toolBusyMs: m.toolBusyMs, concurrentCallsMs: m.concurrentCallsMs,
      concurrentCategoriesMs: m.concurrentCategoriesMs, exclusiveCategoryMs: m.exclusiveCategoryMs,
      arithmeticOverflow: m.arithmeticOverflow });
  }
  return freezeOwned(result);
}
