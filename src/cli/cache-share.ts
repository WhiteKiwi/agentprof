import type { SourceSummary } from "../analysis/source-summary.js";
import { context, finish, ratio, usageDetails, value } from "./source-display.js";

export function formatSourceCacheShare(s: SourceSummary): string {
  return finish([...context("AgentProf observed source-local cache read share", s), ...usageDetails(s, c => `input=${value(c.counts.input)}; cache read=${value(c.counts.cachedInput)}; cache read share=${ratio(c.counts.cachedInput, c.counts.input)}`), "Limits: Observed eligible usage only; cache share is not price savings or latency improvement. Complete machine-readable evidence remains available with --json."]);
}
