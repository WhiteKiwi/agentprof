import type { DurationCohort, SourceSummary } from "../analysis/source-summary.js";
import { sourceSummaryContext } from "./source-summary-context.js";

const value = (n: number | null): string => n === null ? "unavailable" : String(n);
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const identity = (c: DurationCohort): string => JSON.stringify([c.sessionId, c.durationScope, c.timingEvidence, c.category, c.toolName, c.commandPattern]);

function assessment(s: SourceSummary): string {
  if (s.suppressionReason !== null) return `unavailable (${s.suppressionReason})`;
  if (s.inventory.events === 0) return "present_empty";
  if (s.durationEligibility.included === 0) return "no_eligible_observations";
  return "eligible_observed_subset";
}

function bucket(cohorts: readonly DurationCohort[], unknown: boolean): string[] {
  const ordered = [...cohorts].sort((a, b) => (unknown ? 0 : b.sumMs! - a.sumMs!) || compare(identity(a), identity(b)));
  const shown = ordered.slice(0, 3);
  const lines = [`  ${unknown ? "Unknown" : "Known"} sums: shown=${shown.length}; total=${ordered.length}; omitted=${ordered.length - shown.length}; ${unknown ? "unranked, identity order" : "recorded sum descending, within this partition only"}`];
  for (const c of shown) lines.push(
    `    category=${c.category}; tool=${c.toolName ?? "unknown"}; pattern=${c.commandPattern ?? "unknown"}; n=${c.n}; sum=${value(c.sumMs)} ms; mean=${value(c.meanMs)} ms; max=${c.maxMs} ms; p50=${c.p50Ms} ms; p95=${c.p95Ms} ms${c.lowSampleP95 ? " (low-N)" : ""}; limitations=${c.limitations.join(", ") || "none"}`,
  );
  return lines;
}

export function formatSourceTimeBreakdown(s: SourceSummary): string {
  const e = s.durationEligibility;
  const lines = [
    "AgentProf observed source-local time breakdown",
    ...sourceSummaryContext(s),
    `Duration evidence: ${assessment(s)}`,
    `Duration eligibility: terminal candidates=${e.terminalCandidates}; included=${e.included}`,
    `Exclusions: ${Object.entries(e.exclusions).map(([key, n]) => `${key}=${n}`).join("; ")}`,
    "Recorded duration sums may overlap. They are not elapsed time, busy time, time share, waste or savings.",
  ];
  // All source-wide counters precede presentation-only partition/cohort clipping.
  if (s.suppressionReason !== null) lines.push("Duration partitions: unknown (source suppressed)", "Duration cohort detail: unknown (source suppressed)");
  else {
    const partitions = new Map<string, DurationCohort[]>();
    for (const c of s.durations ?? []) {
      const key = JSON.stringify([c.sessionId, c.durationScope, c.timingEvidence]);
      const rows = partitions.get(key); if (rows) rows.push(c); else partitions.set(key, [c]);
    }
    const ordered = [...partitions].sort(([a], [b]) => compare(a, b)), shown = ordered.slice(0, 6);
    const shownCohorts = shown.reduce((n, [, rows]) => n + Math.min(3, rows.filter(c => c.sumMs !== null).length) + Math.min(3, rows.filter(c => c.sumMs === null).length), 0);
    const totalCohorts = s.durations?.length ?? 0;
    lines.push(
      `Duration partitions: shown=${shown.length}; total=${ordered.length}; omitted=${ordered.length - shown.length}; identity order, no partition ranking`,
      `Duration cohort detail: shown=${shownCohorts}; total=${totalCohorts}; omitted=${totalCohorts - shownCohorts}`,
    );
    if (!totalCohorts) lines.push("Duration cohorts: unavailable; no eligible measured observations.");
    for (const [, rows] of shown) {
      const first = rows[0]!;
      lines.push(`Session: ${first.sessionId}; scope=${first.durationScope}; evidence=${first.timingEvidence}; cohorts=${rows.length}`,
        ...bucket(rows.filter(c => c.sumMs !== null), false), ...bucket(rows.filter(c => c.sumMs === null), true));
    }
  }
  lines.push(
    "Limits: source-prefix recorded call durations only. Different session/scope/evidence partitions are not combined; overlapping calls can make sums exceed observed elapsed time.",
    "All cohorts, sample statistics and contributing event IDs are available with --json.",
  );
  return lines.join("\n") + "\n";
}
