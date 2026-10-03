import type { SourceSummary } from "../analysis/source-summary.js";
import { context, durationContext, finish, ratio } from "./source-display.js";

export function formatSourceDurationCoverage(s: SourceSummary): string {
  return finish([...context("AgentProf source-local duration coverage", s), ...durationContext(s), `Duration coverage=${ratio(s.suppressionReason === null ? s.durationEligibility.included : null, s.durationEligibility.terminalCandidates)}`, "Limits: Stored duration eligibility only; not source completeness, quality or performance. Complete machine-readable evidence remains available with --json."]);
}
