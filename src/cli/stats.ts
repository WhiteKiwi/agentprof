import { SafeError } from "../privacy/diagnostics.js";
import { resolveDataDirectory } from "../privacy/paths.js";
import { identity, keyId } from "../db/source-validation.js";
import type { SourceCatalogue } from "../db/source-store.js";
import type { SourceSummary } from "../analysis/source-summary.js";
import { validateCliPath } from "./scan.js";

export type StatsArguments = Readonly<{ dataDir?: string; codexRoot?: readonly string[]; claudeRoot?: readonly string[]; listSources?: boolean; source?: string }>;
export type StatsResult = Readonly<
  { mode: "list_sources"; catalogue: SourceCatalogue }
  | { mode: "selected_source"; sourceFreshnessChecked: false; summary: SourceSummary }
>;
export function validateSourceSelection(value: string): string {
  try { const key = keyId(value.split(":")[1]); return identity(value, "source", key); }
  catch { throw new SafeError("INVALID_ARGUMENT"); }
}
export function validateStatsArguments(options: StatsArguments): string {
  if ((options.codexRoot?.length ?? 0) || (options.claudeRoot?.length ?? 0)) throw new SafeError("INVALID_ARGUMENT");
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
  return withReadOnlyStore(directory, (db, key) => {
    const store = createSourceStore(db, key);
    if (options.listSources) return Object.freeze({ mode: "list_sources", catalogue: store.listSources() });
    try { identity(options.source, "source", key); } catch { throw new SafeError("INVALID_IDENTITY_KEY"); }
    const source = store.readSource(options.source!);
    if (source === null) throw new SafeError("SOURCE_NOT_FOUND");
    return Object.freeze({ mode: "selected_source", sourceFreshnessChecked: false, summary: summarizeSource(source) });
  });
}
function value(n: number | null): string { return n === null ? "unknown" : String(n); }
export function formatStatsResult(result: StatsResult, json: boolean): string {
  if (json) return JSON.stringify({ schema: "agentprof.cli/v1", ok: true, command: "stats", result }) + "\n";
  const lines = ["AgentProf stored source-prefix stats", "Freshness and other-source conflicts were not checked. No global/session/history totals; no parser resume."];
  if (result.mode === "list_sources") {
    const c = result.catalogue;
    lines.push(`Source catalogue: ${c.returnedCount} returned; limit ${c.limit}; truncated=${c.truncated}; order=${c.selection}`,
      "Snapshot-consistent inventory metadata only; metric payloads not revalidated. A later selection may observe a different revision.");
    for (const item of c.items) lines.push(`${item.sourceId} | ${item.provider} | revision ${item.revision} | prefix ${item.completedOffset}/${item.observedSize} bytes | stored ${item.availability} | ${item.persistedScope}`,
      `  Stored rows: ${Object.entries(item.storedCounts).map(([k, n]) => `${k}=${value(n)}`).join("; ")}`);
    if (c.truncated) lines.push("Only the first 64 sources are listed. Select another full source ID from scan JSON.");
  } else {
    const s = result.summary;
    lines.push(`Source: ${s.sourceId}`, `Provider: ${s.provider}; revision: ${s.revision}; prefix: ${s.completedOffset}/${s.observedSize} bytes`,
      `Scope: ${s.scope}; stored availability: ${s.availability}; evidence: ${s.persistedScope}`,
      `Suppression: ${s.suppressionReason ?? "none"}`, `Capabilities: ${s.capabilities === null ? "unknown" : JSON.stringify(s.capabilities)}`,
      `Limitations: ${s.limitations.join(", ")}`, `Inventory: ${JSON.stringify(s.inventory)}`,
      `Duration eligibility: ${JSON.stringify(s.durationEligibility)}`, `Usage eligibility: ${s.usageEligibility === null ? "unknown" : JSON.stringify(s.usageEligibility)}`);
    if (s.suppressionReason !== null) lines.push(`Duration cohorts: unknown (suppressed: ${s.suppressionReason})`);
    else if (!s.durations?.length) lines.push("Duration cohorts: no eligible measured observations; totals unknown");
    else for (const c of s.durations) lines.push(`Duration cohort: ${c.sessionId} | ${c.category} | ${c.toolName ?? "unknown"} | ${c.commandPattern ?? "unknown"} | ${c.durationScope} | ${c.timingEvidence}`,
      `  n=${c.n}; sum=${value(c.sumMs)} ms; mean=${value(c.meanMs)} ms; max=${c.maxMs} ms; p50=${c.p50Ms} ms; p95=${c.p95Ms} ms; lowSampleP95=${c.lowSampleP95}`,
      `  Events: ${c.eventIds.join(", ")}; limitations: ${c.limitations.join(", ") || "none"}`);
    if (s.suppressionReason !== null) lines.push(`Usage cohorts: unknown (suppressed: ${s.suppressionReason})`);
    else if (!s.usage?.length) lines.push("Usage cohorts: no eligible final-response observations; token totals unknown");
    else for (const c of s.usage) lines.push(`Observed final-response usage cohort: ${c.sessionId} | ${c.provider} | ${c.mapping} | ${c.finality}; responses=${c.observedResponses}`,
      `  Tokens: ${Object.entries(c.counts).map(([k,n]) => `${k}=${value(n)}`).join("; ")}`,
      `  Usage rows: ${c.usageIds.join(", ")}; overflow: ${c.overflowComponents.join(", ") || "none"}; limitations: ${c.limitations.join(", ") || "none"}`);
  }
  lines.push("crossSourceReconciled=false; aggregationReady=false; parserResumeReady=false");
  return lines.join("\n") + "\n";
}
