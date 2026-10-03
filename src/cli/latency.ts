import type { DurationCohort, SourceSummary } from "../analysis/source-summary.js";
import { compare, context, detailLimit, durationContext, finish, omission, value } from "./source-display.js";

const identity = (c: DurationCohort): string => JSON.stringify([c.sessionId, c.durationScope, c.timingEvidence, c.category, c.toolName, c.commandPattern]);
export function formatSourceLatency(s: SourceSummary): string {
  const lines = [...context("AgentProf observed source-local tool latency", s), ...durationContext(s), "p50/p95 use nearest-rank cohort quantiles; low-N means n < 20. Comparisons are within a compatible partition."];
  const partitions = new Map<string, DurationCohort[]>();
  for (const c of s.durations ?? []) {
    const key = JSON.stringify([c.sessionId, c.durationScope, c.timingEvidence]), rows = partitions.get(key);
    if (rows) rows.push(c); else partitions.set(key, [c]);
  }
  const shown = [...partitions].sort(([a], [b]) => compare(a, b)).slice(0, detailLimit);
  const totalCohorts = s.durations?.length ?? 0, shownCohorts = shown.reduce((n, [, rows]) => n + Math.min(rows.length, detailLimit), 0);
  lines.push(omission("Latency partitions", shown.length, partitions.size), omission("Latency cohorts", shownCohorts, totalCohorts));
  for (const [, all] of shown) {
    const first = all[0]!, rows = [...all].sort((a, b) => b.p95Ms - a.p95Ms || compare(identity(a), identity(b))).slice(0, detailLimit);
    lines.push(`session=${first.sessionId}; scope=${first.durationScope}; evidence=${first.timingEvidence}; ${omission("cohorts", rows.length, all.length)}`);
    for (const c of rows) lines.push(`category=${c.category}; tool=${c.toolName ?? "unknown"}; pattern=${c.commandPattern ?? "unknown"}; n=${c.n}; mean=${value(c.meanMs)} ms; max=${c.maxMs} ms; p50=${c.p50Ms} ms; p95=${c.p95Ms} ms; low-N=${c.lowSampleP95}; limitations=${c.limitations.join(",") || "none"}`);
  }
  lines.push("Limits: recorded eligible call durations only. No global p95, pooled timing, performance verdict, waste or savings. Complete cohorts and memberships remain available with --json.");
  return finish(lines);
}
