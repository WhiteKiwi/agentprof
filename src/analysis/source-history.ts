import type { StoredSource } from "../db/source-store.js";
import { reconcileHistorySources } from "./history-reconcile.js";
import { buildHistoryDays } from "./history-daily.js";
import { freezeOwned } from "./pattern-intervals.js";
import { historyOffsetLabel, validateHistoryQuery } from "./history-query.js";
import type { HistoryQuery } from "./history-query.js";

/** Selected-prefix execution history, not a latest-session or account-history reconstruction. */
export function analyzeSelectedHistory(sources: readonly StoredSource[], query: HistoryQuery) {
  validateHistoryQuery(query);
  const reconciliation = reconcileHistorySources(sources), days = buildHistoryDays(reconciliation, query);
  const partial = reconciliation.executions.some(e => e.state !== "admitted") || reconciliation.sources.some(s =>
    s.suppressionReason !== null || s.parserCoverage !== "recognized_shapes" || s.unsupportedRecords !== 0 || s.completedOffset !== s.observedSize);
  return freezeOwned({ schema: "agentprof.selected-history/v1" as const, scope: "explicit_selected_source_prefixes" as const,
    query: { startInclusive: new Date(query.startMs).toISOString(), endExclusive: new Date(query.endMs).toISOString(),
      offset: historyOffsetLabel(query.offsetMinutes), offsetMinutes: query.offsetMinutes, timezoneKind: "fixed_offset" as const,
      sessionId: query.sessionId },
    assessment: partial ? "partial" as const : days.length === 0 ? "no_observations" as const : "evaluated" as const,
    selectedExecutionIdsReconciled: true as const, sourceFreshnessChecked: false as const,
    fullHistory: false as const, dailyTokens: null, zeroFilledDays: false as const,
    reconciliation, days,
    limitations: [
      "Only the explicitly selected stored prefixes participate; no current-file freshness or deleted-source lifecycle check.",
      "Exact provider/execution IDs are reconciled. Different IDs are not heuristically merged; absent observations are not retractions.",
      "All copies are compared before filtering. Conflicting or unadmitted copies cannot be resolved by choosing a convenient winner.",
      "Reconciliation and exclusions describe the entire selected prefixes; only daily rows are date/session-filtered.",
      "Completion counts use verified terminal instants; time uses clipped positioned intervals. These populations differ at boundaries.",
      "Empty days are not filled. Unknown time has no invented day. Partial results describe an observed subset, not complete history.",
      "Busy/overlap/exclusive-category time stays partitioned by provider, session, interval scope and timing evidence; no global time sum.",
      "Fixed offset is not an IANA timezone and does not apply daylight-saving transitions.",
      "Daily token attribution is unavailable: stored usage has no general verified response timestamp. No file-mtime attribution.",
      "Observed interval time is not CPU time, task elapsed time, productivity, Detected Waste or proven savings.",
    ] });
}
export type SelectedHistoryAnalysis = ReturnType<typeof analyzeSelectedHistory>;
