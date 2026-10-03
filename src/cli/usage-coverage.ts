import type { SourceSummary } from "../analysis/source-summary.js";
import { context, finish, usageContext } from "./source-display.js";

export function formatSourceUsageCoverage(s: SourceSummary): string {
  return finish([...context("AgentProf source-local usage coverage", s), ...usageContext(s), "Limits: Eligibility and accounting of stored responses only; not total model usage or billing coverage. Complete machine-readable evidence remains available with --json."]);
}
