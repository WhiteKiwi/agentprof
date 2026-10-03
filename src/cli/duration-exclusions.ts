import type { SourceSummary } from "../analysis/source-summary.js";
import { context, durationContext, finish, mix } from "./source-display.js";

export function formatDurationExclusions(s: SourceSummary): string {
  return finish([...context("AgentProf source-local duration exclusion mix", s), ...durationContext(s), ...mix("Duration exclusions", s.durationEligibility.exclusions), "Limits: Exclusion shares describe stored eligibility, not failure causes. Complete machine-readable evidence remains available with --json."]);
}
