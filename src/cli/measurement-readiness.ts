import type { SourceSummary } from "../analysis/source-summary.js";
import { context, durationContext, finish, usageContext } from "./source-display.js";

export function formatMeasurementReadiness(s: SourceSummary): string {
  return finish([...context("AgentProf source-local measurement readiness", s), ...durationContext(s), ...usageContext(s), "Limits: Evidence inventory only; no readiness score, PASS/FAIL gate or product-completeness verdict. Complete machine-readable evidence remains available with --json."]);
}
