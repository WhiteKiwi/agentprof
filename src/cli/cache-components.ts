import type { SourceSummary } from "../analysis/source-summary.js";
import { context, finish, usageDetails, value } from "./source-display.js";

export function formatCacheComponents(s: SourceSummary): string {
  return finish([...context("AgentProf source-local cache component breakdown", s), ...usageDetails(s, c => `input=${value(c.counts.input)}; cached input=${value(c.counts.cachedInput)}; cache write input=${value(c.counts.cacheWriteInput)}; uncached input=${value(c.counts.uncachedInput)}`), "Limits: Provider-normalized components only; cache components are input subsets and are not added again. Complete machine-readable evidence remains available with --json."]);
}
