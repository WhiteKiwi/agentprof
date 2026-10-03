import type { SourceSummary } from "../analysis/source-summary.js";
import { context, finish, usageDetails, value } from "./source-display.js";

export function formatOutputComposition(s: SourceSummary): string {
  return finish([...context("AgentProf source-local output token composition", s), ...usageDetails(s, c => `output=${value(c.counts.output)}; reasoning subset=${value(c.counts.reasoningOutput)}; non-reasoning derived=${value(c.counts.output === null || c.counts.reasoningOutput === null ? null : c.counts.output - c.counts.reasoningOutput)}`), "Limits: Derived non-reasoning requires both validated components; no quality or efficiency judgment. Complete machine-readable evidence remains available with --json."]);
}
