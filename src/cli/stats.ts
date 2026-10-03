import { formatOutcomeMix } from "./outcome-mix.js";
import { formatReasoningShare } from "./reasoning-share.js";
import { formatCacheWriteShare } from "./cache-write-share.js";
import { formatOverlapSummary } from "./overlap-summary.js";
import { formatSearchRatio } from "./search-ratio.js";
import { formatReadRatio } from "./read-ratio.js";
import { formatSourceUsageCoverage } from "./usage-coverage.js";
import { formatSourceDurationCoverage } from "./duration-coverage.js";
import { formatSourceExecutionStatus } from "./execution-status.js";
import { formatSourceCacheShare } from "./cache-share.js";
import type { SourceToolBusyAnalysis } from "../analysis/source-tool-busy.js";
import { formatSourceToolBusy } from "./tool-busy.js";
import { formatSourceLatency } from "./latency.js";
import { SafeError } from "../privacy/diagnostics.js";
import { resolveDataDirectory } from "../privacy/paths.js";
import { identity, keyId } from "../db/source-validation.js";
import type { SourceCatalogue } from "../db/source-store.js";
import type { SourceSummary, DurationCohort, UsageCohort } from "../analysis/source-summary.js";
import { validateCliPath } from "./scan.js";
import type { SourceFailureAnalysis } from "../analysis/source-failures.js";
import { formatSourceFailures } from "./failures.js";
import type { SourceReadRevisitAnalysis } from "../analysis/source-read-revisits.js";
import { formatSourceReadRevisits } from "./read-revisits.js";

import type { SourceInvocationOverlapAnalysis } from "../analysis/source-invocation-overlap.js";
import { formatSourceInvocationOverlap } from "./invocation-overlap.js";

import type { SourceSearchRecurrenceAnalysis } from "../analysis/source-search-recurrence.js";
import { formatSourceSearchRecurrence } from "./search-recurrence.js";
import type { SourceRecoveryAnalysis } from "../analysis/source-recovery.js";
import { formatSourceRecovery } from "./recovery.js";
import type { SourceRetryOverheadAnalysis } from "../analysis/source-retry-overhead.js";
import { formatSourceRetryOverhead } from "./retry-overhead.js";

import type { SourceActiveTimeAnalysis } from "../analysis/source-active-time.js";
import { formatSourceActiveTime } from "./active-time.js";
import { formatSourceTokens } from "./tokens.js";
import { formatSourceTimeBreakdown } from "./time-breakdown.js";

export type StatsArguments = Readonly<{ dataDir?: string; codexRoot?: readonly string[]; claudeRoot?: readonly string[]; listSources?: boolean; source?: string; failures?: boolean; readRevisits?: boolean; invocationOverlap?: boolean; searchRecurrence?: boolean; recovery?: boolean; retryOverhead?: boolean; activeTime?: boolean; tokens?: boolean; timeBreakdown?: boolean; latency?: boolean; toolBusy?: boolean; cacheShare?: boolean; executionStatus?: boolean; durationCoverage?: boolean; usageCoverage?: boolean; readRatio?: boolean; searchRatio?: boolean; overlapSummary?: boolean; cacheWriteShare?: boolean; reasoningShare?: boolean; outcomeMix?: boolean }>;
export type StatsResult = Readonly<
  { mode: "selected_source_outcome_mix"; summary: SourceSummary }
  |
  { mode: "selected_source_reasoning_share"; summary: SourceSummary }
  |
  { mode: "selected_source_cache_write_share"; summary: SourceSummary }
  |
  { mode: "selected_source_overlap_summary"; analysis: SourceInvocationOverlapAnalysis }
  |
  { mode: "selected_source_search_ratio"; analysis: SourceSearchRecurrenceAnalysis }
  |
  { mode: "selected_source_read_ratio"; analysis: SourceReadRevisitAnalysis }
  |
  { mode: "selected_source_usage_coverage"; summary: SourceSummary }
  |
  { mode: "selected_source_duration_coverage"; summary: SourceSummary }
  |
  { mode: "selected_source_execution_status"; summary: SourceSummary }
  |
  { mode: "selected_source_cache_share"; summary: SourceSummary }
  |
  { mode: "selected_source_tool_busy"; analysis: SourceToolBusyAnalysis }
  |
  { mode: "selected_source_latency"; summary: SourceSummary }
  |
  { mode: "list_sources"; catalogue: SourceCatalogue }
  | { mode: "selected_source"; sourceFreshnessChecked: false; summary: SourceSummary }
  | { mode: "selected_source_failures"; analysis: SourceFailureAnalysis }
  | { mode: "selected_source_read_revisits"; analysis: SourceReadRevisitAnalysis }
  | { mode: "selected_source_invocation_overlap"; analysis: SourceInvocationOverlapAnalysis }
  | { mode: "selected_source_search_recurrence"; analysis: SourceSearchRecurrenceAnalysis }
  | { mode: "selected_source_recovery"; analysis: SourceRecoveryAnalysis }
  | { mode: "selected_source_retry_overhead"; analysis: SourceRetryOverheadAnalysis }
  | { mode: "selected_source_active_time"; analysis: SourceActiveTimeAnalysis }
  | { mode: "selected_source_tokens"; summary: SourceSummary }
  | { mode: "selected_source_time_breakdown"; summary: SourceSummary }
>;
export function validateSourceSelection(value: string): string {
  try { const key = keyId(value.split(":")[1]); return identity(value, "source", key); }
  catch { throw new SafeError("INVALID_ARGUMENT"); }
}
const displayFlags = ["latency", "toolBusy", "cacheShare", "executionStatus", "durationCoverage", "usageCoverage", "readRatio", "searchRatio", "overlapSummary", "cacheWriteShare", "reasoningShare", "outcomeMix"] as const;
export function validateStatsArguments(options: StatsArguments): string {
  for (const flag of displayFlags) if (options[flag] !== undefined && typeof options[flag] !== "boolean") throw new SafeError("INVALID_ARGUMENT");
  const selected = displayFlags.filter(flag => options[flag] === true);
  if (selected.length > 1 || selected.length === 1 && (options.source === undefined || options.listSources || options.failures || options.readRevisits || options.invocationOverlap || options.searchRecurrence || options.recovery || options.retryOverhead || options.activeTime || options.tokens || options.timeBreakdown)) throw new SafeError("INVALID_ARGUMENT");
  if (options.timeBreakdown !== undefined && typeof options.timeBreakdown !== "boolean") throw new SafeError("INVALID_ARGUMENT");
  if (options.timeBreakdown === true && (options.tokens || options.activeTime || options.retryOverhead || options.recovery || options.searchRecurrence || options.invocationOverlap || options.readRevisits || options.failures || options.listSources || options.source === undefined)) throw new SafeError("INVALID_ARGUMENT");
  if (options.tokens !== undefined && typeof options.tokens !== "boolean") throw new SafeError("INVALID_ARGUMENT");
  if (options.tokens === true && (options.activeTime || options.retryOverhead || options.recovery || options.searchRecurrence || options.invocationOverlap || options.readRevisits || options.failures || options.listSources || options.source === undefined)) throw new SafeError("INVALID_ARGUMENT");
  if (options.activeTime !== undefined && typeof options.activeTime !== "boolean") throw new SafeError("INVALID_ARGUMENT");
  if (options.activeTime === true && (options.retryOverhead || options.recovery || options.searchRecurrence || options.invocationOverlap || options.readRevisits || options.failures || options.listSources || options.source === undefined)) throw new SafeError("INVALID_ARGUMENT");
  if (options.retryOverhead !== undefined && typeof options.retryOverhead !== "boolean") throw new SafeError("INVALID_ARGUMENT");
  if (options.retryOverhead === true && (options.recovery || options.searchRecurrence || options.invocationOverlap || options.readRevisits || options.failures || options.listSources || options.source === undefined)) throw new SafeError("INVALID_ARGUMENT");
  if (options.recovery !== undefined && typeof options.recovery !== "boolean") throw new SafeError("INVALID_ARGUMENT");
  if (options.recovery === true && (options.searchRecurrence || options.invocationOverlap || options.readRevisits || options.failures || options.listSources || options.source === undefined)) throw new SafeError("INVALID_ARGUMENT");
  if ((options.codexRoot?.length ?? 0) || (options.claudeRoot?.length ?? 0)) throw new SafeError("INVALID_ARGUMENT");
  if (options.searchRecurrence && (options.failures || options.readRevisits || options.invocationOverlap || options.listSources || options.source === undefined)) throw new SafeError("INVALID_ARGUMENT");
  if (options.invocationOverlap && (options.failures || options.readRevisits || options.listSources || options.source === undefined)) throw new SafeError("INVALID_ARGUMENT");
  if (options.readRevisits && (options.failures || options.listSources || options.source === undefined)) throw new SafeError("INVALID_ARGUMENT");
  if (options.failures && (options.listSources || options.source === undefined)) throw new SafeError("INVALID_ARGUMENT");
  if (!options.listSources && options.source === undefined) throw new SafeError("STATS_SELECTION_REQUIRED");
  if (options.listSources && options.source !== undefined) throw new SafeError("INVALID_ARGUMENT");
  if (options.source !== undefined) validateSourceSelection(options.source);
  if (options.dataDir !== undefined) validateCliPath(options.dataDir);
  return validateCliPath(resolveDataDirectory(options.dataDir === undefined ? {} : { dataDir: options.dataDir }));
}
export async function runStats(options: StatsArguments): Promise<StatsResult> {
  const directory = validateStatsArguments(options);
  const { withReadOnlyStore } = await import("../db/read-only.js");
  const { createSourceStore } = await import("../db/source-store.js");
  const { summarizeSource } = await import("../analysis/source-summary.js");
  const analyzeFailures = options.failures ? (await import("../analysis/source-failures.js")).analyzeSourceFailures : null;
  const analyzeReadRevisits = options.readRevisits ? (await import("../analysis/source-read-revisits.js")).analyzeSourceReadRevisits : null;
  const analyzeInvocationOverlap = options.invocationOverlap ? (await import("../analysis/source-invocation-overlap.js")).analyzeSourceInvocationOverlap : null;
  const analyzeSearchRecurrence = options.searchRecurrence ? (await import("../analysis/source-search-recurrence.js")).analyzeSourceSearchRecurrence : null;
  const analyzeRecovery = options.recovery === true ? (await import("../analysis/source-recovery.js")).analyzeSourceRecovery : null;
  const analyzeRetryOverhead = options.retryOverhead === true ? (await import("../analysis/source-retry-overhead.js")).analyzeSourceRetryOverhead : null;
  const analyzeActiveTime = options.activeTime === true ? (await import("../analysis/source-active-time.js")).analyzeSourceActiveTime : null;
  const displayToolBusy = options.toolBusy === true ? (await import("../analysis/source-tool-busy.js")).analyzeSourceToolBusy : null;
  const displayReadRatio = options.readRatio === true ? (await import("../analysis/source-read-revisits.js")).analyzeSourceReadRevisits : null;
  const displaySearchRatio = options.searchRatio === true ? (await import("../analysis/source-search-recurrence.js")).analyzeSourceSearchRecurrence : null;
  const displayOverlapSummary = options.overlapSummary === true ? (await import("../analysis/source-invocation-overlap.js")).analyzeSourceInvocationOverlap : null;
  return withReadOnlyStore(directory, (db, key) => {
    const store = createSourceStore(db, key);
    if (options.listSources) return Object.freeze({ mode: "list_sources", catalogue: store.listSources() });
    try { identity(options.source, "source", key); } catch { throw new SafeError("INVALID_IDENTITY_KEY"); }
    const source = store.readSource(options.source!);
    if (source === null) throw new SafeError("SOURCE_NOT_FOUND");
    if (options.latency === true) return Object.freeze({ mode: "selected_source_latency", summary: summarizeSource(source) });
    if (displayToolBusy !== null) return Object.freeze({ mode: "selected_source_tool_busy", analysis: displayToolBusy(source) });
    if (options.cacheShare === true) return Object.freeze({ mode: "selected_source_cache_share", summary: summarizeSource(source) });
    if (options.executionStatus === true) return Object.freeze({ mode: "selected_source_execution_status", summary: summarizeSource(source) });
    if (options.durationCoverage === true) return Object.freeze({ mode: "selected_source_duration_coverage", summary: summarizeSource(source) });
    if (options.usageCoverage === true) return Object.freeze({ mode: "selected_source_usage_coverage", summary: summarizeSource(source) });
    if (displayReadRatio !== null) return Object.freeze({ mode: "selected_source_read_ratio", analysis: displayReadRatio(source) });
    if (displaySearchRatio !== null) return Object.freeze({ mode: "selected_source_search_ratio", analysis: displaySearchRatio(source) });
    if (displayOverlapSummary !== null) return Object.freeze({ mode: "selected_source_overlap_summary", analysis: displayOverlapSummary(source) });
    if (options.cacheWriteShare === true) return Object.freeze({ mode: "selected_source_cache_write_share", summary: summarizeSource(source) });
    if (options.reasoningShare === true) return Object.freeze({ mode: "selected_source_reasoning_share", summary: summarizeSource(source) });
    if (options.outcomeMix === true) return Object.freeze({ mode: "selected_source_outcome_mix", summary: summarizeSource(source) });
    if (options.timeBreakdown === true) return Object.freeze({ mode: "selected_source_time_breakdown", summary: summarizeSource(source) });
    if (options.tokens === true) return Object.freeze({ mode: "selected_source_tokens", summary: summarizeSource(source) });
    if (analyzeActiveTime !== null) return Object.freeze({ mode: "selected_source_active_time", analysis: analyzeActiveTime(source) });
    if (analyzeRetryOverhead !== null) return Object.freeze({ mode: "selected_source_retry_overhead", analysis: analyzeRetryOverhead(source) });
    if (analyzeRecovery !== null) return Object.freeze({ mode: "selected_source_recovery", analysis: analyzeRecovery(source) });
    if (analyzeSearchRecurrence !== null) return Object.freeze({ mode: "selected_source_search_recurrence", analysis: analyzeSearchRecurrence(source) });
    if (analyzeInvocationOverlap !== null) return Object.freeze({ mode: "selected_source_invocation_overlap", analysis: analyzeInvocationOverlap(source) });
    if (analyzeReadRevisits !== null) return Object.freeze({ mode: "selected_source_read_revisits", analysis: analyzeReadRevisits(source) });
    if (analyzeFailures !== null) return Object.freeze({ mode: "selected_source_failures", analysis: analyzeFailures(source) });
    return Object.freeze({ mode: "selected_source", sourceFreshnessChecked: false, summary: summarizeSource(source) });
  });
}
function value(n: number | null): string { return n === null ? "unknown" : String(n); }
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const durationIdentity = (c: DurationCohort): string => JSON.stringify([c.sessionId, c.category, c.toolName, c.commandPattern, c.durationScope, c.timingEvidence]);
const usageIdentity = (c: UsageCohort): string => JSON.stringify([c.sessionId, c.provider, c.mapping, c.finality]);
// Wrap at existing ASCII spaces, retaining indivisible identities and labels.
function wrap(line: string): string[] {
  const result: string[] = [];
  while (line.length > 100) {
    let at = line.lastIndexOf(" ", 100);
    if (at < 1) at = line.indexOf(" ", 100);
    if (at < 1) break;
    result.push(line.slice(0, at)); line = line.slice(at + 1);
  }
  result.push(line); return result;
}
function table(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(row => row[i]!.length)));
  const render = (row: readonly string[]) => row.map((cell, i) => cell.padEnd(widths[i]!)).join(" | ").trimEnd();
  return [render(headers), widths.map(n => "-".repeat(n)).join("-+-"), ...rows.map(render)];
}
function counts(map: Readonly<Record<string, number>> | null): string {
  return map === null ? "unknown" : Object.entries(map).map(([key, n]) => `${key}=${value(n)}`).join("; ");
}
function exclusions(map: Readonly<Record<string, number>>): string {
  return (Object.entries(map).filter(([, n]) => n !== 0).map(([key, n]) => `${key}=${value(n)}`).join("; ") || "none") + " (unlisted reasons=0)";
}
function durationBucket(cohorts: readonly DurationCohort[], unknown: boolean): string[] {
  const sorted = [...cohorts].sort((a, b) => (unknown ? 0 : b.sumMs! - a.sumMs!) || compare(durationIdentity(a), durationIdentity(b)));
  const shown = sorted.slice(0, 10), keys = shown.map((_, i) => `${unknown ? "U" : ""}${i + 1}`);
  const lines = [`${unknown ? "Unknown" : "Known"} sums: showing ${shown.length} of ${sorted.length} cohorts; omitted=${sorted.length - shown.length}; ${unknown ? "unranked" : "recorded duration sum descending"}`];
  if (shown.length) {
    lines.push(...table(["row", "n", "sum ms", "mean ms", "max ms", "p50 ms", "p95 ms"], shown.map((c, i) => [keys[i]!, value(c.n), value(c.sumMs), value(c.meanMs), value(c.maxMs), value(c.p50Ms), value(c.p95Ms) + (c.lowSampleP95 ? "*" : "")])));
    shown.forEach((c, i) => {
      lines.push(...wrap(`${keys[i]}: category=${c.category}; tool=${c.toolName ?? "unknown"}; pattern=${c.commandPattern ?? "unknown"}`));
      lines.push(...wrap(`${keys[i]} limitations: ${c.limitations.join(", ") || "none"}`));
    });
  }
  return lines;
}
function formatSelectedSource(s: SourceSummary): string[] {
  const inventory = s.inventory, capabilities = s.capabilities;
  const lines = ["AgentProf stored source-prefix stats", "Freshness and other-source conflicts were not checked.", "No global/session/history totals; no parser resume.",
    `Source: ${s.sourceId}`, `Provider: ${s.provider} | revision: ${s.revision} | prefix: ${s.completedOffset}/${s.observedSize} bytes`,
    `Scope: ${s.scope} | availability: ${s.availability}`, `Evidence: ${s.persistedScope} | suppression: ${s.suppressionReason ?? "none"}`,
    `Coverage: ${capabilities?.coverage ?? "unknown"}; support: ${capabilities?.support ?? "unknown"}`, "", "Inventory",
    ...table(["events", "turns", "usage rows", "observations", "diagnostics"], [[inventory.events, inventory.turns, inventory.usage, inventory.observations, inventory.diagnostics].map(value)])];
  for (const [label, map] of [["Event status", inventory.eventStatuses], ["Event outcome", inventory.eventOutcomes], ["Usage selection", inventory.usageSelections], ["Usage finality", inventory.usageFinalities]] as const) lines.push(...wrap(`${label}: ${counts(map)}`));
  lines.push("", `Duration eligibility: ${s.durationEligibility.included} included; ${s.durationEligibility.terminalCandidates} terminal candidates`, ...wrap(`Exclusions: ${exclusions(s.durationEligibility.exclusions)}`));
  const u = s.usageEligibility;
  if (u === null) lines.push("Usage eligibility: unknown", "Exclusions: unknown");
  else lines.push(...wrap(`Usage eligibility: ${u.observedResponses} observed eligible final responses; ${u.selectedRows} selected rows; ${u.deduplicatedRows} deduplicated rows; ${u.excludedRows} excluded rows; ${u.excludedResponseGroups} excluded response groups`), ...wrap(`Exclusions: ${exclusions(u.exclusions)}`));
  lines.push("", "Recorded durations: sums may overlap; they are not elapsed/busy time, time shares, waste or savings.", "All duration columns use milliseconds. * = p95 has fewer than 20 observations.");
  const partitions = new Map<string, DurationCohort[]>();
  for (const c of s.durations ?? []) {
    const key = JSON.stringify([c.sessionId, c.durationScope, c.timingEvidence]);
    const rows = partitions.get(key); if (rows) rows.push(c); else partitions.set(key, [c]);
  }
  lines.push(`Duration partitions: ${s.suppressionReason === null ? partitions.size : "unknown"}; rankings are only within each partition.`);
  if (s.suppressionReason !== null) lines.push(`Duration cohorts: unknown (suppressed: ${s.suppressionReason})`, `Usage cohorts: unknown (suppressed: ${s.suppressionReason})`);
  else {
    if (!s.durations?.length) lines.push("Duration cohorts: no eligible measured observations; totals unknown");
    if (!s.usage?.length) lines.push("Usage cohorts: no eligible final-response observations; token totals unknown");
    const sessions = new Map<string, { partitions: [string, DurationCohort[]][]; usage: UsageCohort[] }>();
    const sessionBucket = (id: string) => {
      let bucket = sessions.get(id);
      if (!bucket) { bucket = { partitions: [], usage: [] }; sessions.set(id, bucket); }
      return bucket;
    };
    for (const entry of partitions) sessionBucket(entry[1][0]!.sessionId).partitions.push(entry);
    for (const c of s.usage ?? []) sessionBucket(c.sessionId).usage.push(c);
    for (const [session, bucket] of [...sessions].sort(([a], [b]) => compare(a, b))) {
      lines.push("", `Session: ${session}`);
      for (const [, rows] of bucket.partitions.sort(([a], [b]) => compare(a, b))) {
        const first = rows[0]!;
        lines.push(`${first.durationScope} | ${first.timingEvidence}`, ...durationBucket(rows.filter(c => c.sumMs !== null), false), ...durationBucket(rows.filter(c => c.sumMs === null), true));
      }
      for (const c of bucket.usage.sort((a, b) => compare(usageIdentity(a), usageIdentity(b)))) {
        lines.push("", `Observed final-response usage: ${c.provider} | ${c.mapping} | ${c.finality}`, `Observed responses: ${c.observedResponses}`,
          ...table(["input", "output", "total", "cached input", "cache write", "reasoning", "uncached input"], [[c.counts.input, c.counts.output, c.counts.total, c.counts.cachedInput, c.counts.cacheWriteInput, c.counts.reasoningOutput, c.counts.uncachedInput].map(value)]),
          ...wrap(`Overflow: ${c.overflowComponents.join(", ") || "none"}`), ...wrap(`Usage limitations: ${c.limitations.join(", ") || "none"}`));
      }
    }
    if (s.usage?.length) lines.push(...wrap("Normalized input already includes cache components; do not add them again. Claude input is uncached + cache read + cache write. Codex reasoning output is a subset of output."));
  }
  lines.push("", "Evidence and limits");
  if (capabilities === null) lines.push("Capabilities: unknown");
  else lines.push(...wrap(`Support: ${capabilities.support}; coverage: ${capabilities.coverage}; parser version: ${capabilities.parserVersion}`),
    ...wrap(`Unsupported records: ${capabilities.unsupportedRecords}; ambiguous records: ${capabilities.ambiguousRecords}; state limited: ${capabilities.stateLimited}; dropped diagnostics: ${capabilities.diagnosticsDropped}`),
    ...wrap(`Observed shapes: ${capabilities.observedShapes.join(", ") || "none"}`));
  lines.push(...wrap(`Limitations: ${s.limitations.join(", ") || "none"}`), "All cohorts and contributing event/usage IDs are available with --json.");
  return lines;
}

export function formatStatsResult(result: StatsResult, json: boolean): string {
  if (json) return JSON.stringify({ schema: "agentprof.cli/v1", ok: true, command: "stats", result }) + "\n";
  if (result.mode === "selected_source_latency") return formatSourceLatency(result.summary);
  if (result.mode === "selected_source_tool_busy") return formatSourceToolBusy(result.analysis);
  if (result.mode === "selected_source_cache_share") return formatSourceCacheShare(result.summary);
  if (result.mode === "selected_source_execution_status") return formatSourceExecutionStatus(result.summary);
  if (result.mode === "selected_source_duration_coverage") return formatSourceDurationCoverage(result.summary);
  if (result.mode === "selected_source_usage_coverage") return formatSourceUsageCoverage(result.summary);
  if (result.mode === "selected_source_read_ratio") return formatReadRatio(result.analysis);
  if (result.mode === "selected_source_search_ratio") return formatSearchRatio(result.analysis);
  if (result.mode === "selected_source_overlap_summary") return formatOverlapSummary(result.analysis);
  if (result.mode === "selected_source_cache_write_share") return formatCacheWriteShare(result.summary);
  if (result.mode === "selected_source_reasoning_share") return formatReasoningShare(result.summary);
  if (result.mode === "selected_source_outcome_mix") return formatOutcomeMix(result.summary);
  if (result.mode === "selected_source_time_breakdown") return formatSourceTimeBreakdown(result.summary);
  if (result.mode === "selected_source_tokens") return formatSourceTokens(result.summary);
  if (result.mode === "selected_source_active_time") return formatSourceActiveTime(result.analysis);
  if (result.mode === "selected_source_retry_overhead") return formatSourceRetryOverhead(result.analysis);
  if (result.mode === "selected_source_recovery") return formatSourceRecovery(result.analysis);
  if (result.mode === "selected_source_search_recurrence") return formatSourceSearchRecurrence(result.analysis);
  if (result.mode === "selected_source_read_revisits") return formatSourceReadRevisits(result.analysis);
  if (result.mode === "selected_source_invocation_overlap") return formatSourceInvocationOverlap(result.analysis);
  if (result.mode === "selected_source_failures") return formatSourceFailures(result.analysis);
  const lines = ["AgentProf stored source-prefix stats", "Freshness and other-source conflicts were not checked. No global/session/history totals; no parser resume."];
  if (result.mode === "list_sources") {
    const c = result.catalogue;
    lines.push(`Source catalogue: ${c.returnedCount} returned; limit ${c.limit}; truncated=${c.truncated}; order=${c.selection}`,
      "Snapshot-consistent inventory metadata only; metric payloads not revalidated. A later selection may observe a different revision.");
    for (const item of c.items) lines.push(`${item.sourceId} | ${item.provider} | revision ${item.revision} | prefix ${item.completedOffset}/${item.observedSize} bytes | stored ${item.availability} | ${item.persistedScope}`,
      `  Stored rows: ${Object.entries(item.storedCounts).map(([k, n]) => `${k}=${value(n)}`).join("; ")}`);
    if (c.truncated) lines.push("Only the first 64 sources are listed. Select another full source ID from scan JSON.");
  } else {
    return formatSelectedSource(result.summary).concat("crossSourceReconciled=false; aggregationReady=false; parserResumeReady=false").join("\n") + "\n";
  }
  lines.push("crossSourceReconciled=false; aggregationReady=false; parserResumeReady=false");
  return lines.join("\n") + "\n";
}
