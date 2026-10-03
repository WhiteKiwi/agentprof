import type { SourceSummary } from "../analysis/source-summary.js";
import { context, durationContext, finish, mix } from "./source-display.js";

function scopeCounts(s: SourceSummary): Record<string, number> | null {
  if (s.suppressionReason !== null) return null;
  const x = { invocation_latency: 0, process_runtime: 0, item_lifecycle: 0, unknown: 0 };
  for (const c of s.durations ?? []) x[c.durationScope] += c.n;
  return x;
}

export function formatDurationScope(s: SourceSummary): string {
  return finish([...context("AgentProf source-local duration scope mix", s), ...durationContext(s), ...mix("Eligible duration scope samples", scopeCounts(s)), "Limits: Sample counts only; runtime, lifecycle and invocation latency remain separate meanings; no pooled milliseconds. Complete machine-readable evidence remains available with --json."]);
}
