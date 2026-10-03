import type { SourceSummary } from "../analysis/source-summary.js";
import { context, finish, ratio, usageDetails, value } from "./source-display.js";

export function formatReasoningShare(s: SourceSummary): string {
  return finish([...context("AgentProf source-local reasoning output share", s), ...usageDetails(s, c => `output=${value(c.counts.output)}; reasoning output=${value(c.counts.reasoningOutput)}; reasoning share=${ratio(c.counts.reasoningOutput, c.counts.output)}`), "Limits: Reasoning is a supported output subset; never add it twice or infer quality or efficiency. Complete machine-readable evidence remains available with --json."]);
}
