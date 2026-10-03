import type { SourceSummary } from "../analysis/source-summary.js";
import { context, finish, ratio, usageDetails, value } from "./source-display.js";

export function formatCacheWriteShare(s: SourceSummary): string {
  return finish([...context("AgentProf source-local cache write share", s), ...usageDetails(s, c => `input=${value(c.counts.input)}; cache write=${value(c.counts.cacheWriteInput)}; cache write share=${ratio(c.counts.cacheWriteInput, c.counts.input)}`), "Limits: Component share only; cache subsets are not added again and do not prove savings. Complete machine-readable evidence remains available with --json."]);
}
