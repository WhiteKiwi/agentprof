import type { SourceSummary } from "../analysis/source-summary.js";
import { context, durationContext, finish, mix } from "./source-display.js";

function evidenceCounts(s: SourceSummary): Record<string, number> {
  const x = { source_reported: 0, paired_timestamps: 0, estimated: 0, unknown: 0 };
  for (const c of s.durations ?? []) x[c.timingEvidence] += c.n;
  return x;
}

export function formatTimingEvidence(s: SourceSummary): string {
  return finish([...context("AgentProf source-local duration timing evidence mix", s), ...durationContext(s), ...mix("Eligible duration timing samples", evidenceCounts(s)), "Limits: Sample counts only; evidence classes are not interchangeable accuracy scores and durations are never pooled. Complete machine-readable evidence remains available with --json."]);
}
