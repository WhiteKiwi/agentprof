import type { SourceSummary } from "../analysis/source-summary.js";
import { context, finish, ratio, usageContext } from "./source-display.js";

function usageExclusions(s: SourceSummary): string[] {
  const e = s.usageEligibility;
  return e === null ? ["Usage exclusions: unavailable"] : Object.entries(e.exclusions).map(([key, n]) => `${key}: n=${n}; share of excluded rows=${ratio(n, e.excludedRows)}`);
}

export function formatUsageExclusions(s: SourceSummary): string {
  return finish([...context("AgentProf source-local usage exclusion mix", s), ...usageContext(s), ...usageExclusions(s), "Limits: Row exclusion shares describe usage accounting eligibility, not model or provider errors. Complete machine-readable evidence remains available with --json."]);
}
