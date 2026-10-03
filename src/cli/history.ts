import type { Command } from "commander";
import { SafeError } from "../privacy/diagnostics.js";
import { resolveDataDirectory } from "../privacy/paths.js";
import { identity, keyId } from "../db/source-validation.js";
import { validateCliPath } from "./scan.js";
import { validateSourceSelection } from "./stats.js";
import { HISTORY_LIMITS, HistoryQueryError, parseHistoryQuery } from "../analysis/history-query.js";
import type { HistoryWindowOptions, HistoryQuery } from "../analysis/history-query.js";
import type { SelectedHistoryAnalysis } from "../analysis/source-history.js";
import type { StoredSource } from "../db/source-store.js";

export type HistoryArguments = HistoryWindowOptions & Readonly<{
  source?: readonly string[]; dataDir?: string; codexRoot?: readonly string[]; claudeRoot?: readonly string[]; json?: boolean;
}>;
function sessionSelection(value: string): string {
  try { return identity(value, "session", keyId(value.split(":")[1])); }
  catch { throw new SafeError("INVALID_ARGUMENT"); }
}
export function validateHistoryArguments(options: HistoryArguments) {
  if (!Array.isArray(options.source) || options.source.length < 1 || options.source.length > HISTORY_LIMITS.sources
    || options.source.some(s => typeof s !== "string") || new Set(options.source).size !== options.source.length
    || options.json !== undefined && typeof options.json !== "boolean"
    || options.codexRoot !== undefined && (!Array.isArray(options.codexRoot) || options.codexRoot.length !== 0)
    || options.claudeRoot !== undefined && (!Array.isArray(options.claudeRoot) || options.claudeRoot.length !== 0)
    || options.dataDir !== undefined && typeof options.dataDir !== "string") throw new SafeError("INVALID_ARGUMENT");
  const sources = options.source.map(validateSourceSelection).sort();
  if (options.session !== undefined) sessionSelection(options.session);
  let query: HistoryQuery;
  try { query = parseHistoryQuery(options); } catch (error) {
    if (error instanceof HistoryQueryError) throw new SafeError("INVALID_ARGUMENT");
    throw error;
  }
  if (options.dataDir !== undefined) validateCliPath(options.dataDir);
  const directory = validateCliPath(resolveDataDirectory(options.dataDir === undefined ? {} : { dataDir: options.dataDir }));
  return { sources, query, directory };
}
export async function runHistory(options: HistoryArguments): Promise<SelectedHistoryAnalysis> {
  const { sources, query, directory } = validateHistoryArguments(options);
  const { withReadOnlyStore } = await import("../db/read-only.js");
  const { createSourceStore } = await import("../db/source-store.js");
  const { analyzeSelectedHistory } = await import("../analysis/source-history.js");
  return withReadOnlyStore(directory, (db, key) => {
    const store = createSourceStore(db, key), selected: StoredSource[] = [];
    try {
      for (const sourceId of sources) identity(sourceId, "source", key);
      if (query.sessionId !== null) identity(query.sessionId, "session", key);
    } catch { throw new SafeError("INVALID_IDENTITY_KEY"); }
    let events = 0, observations = 0;
    try {
      for (const sourceId of sources) {
        const source = store.readSource(sourceId);
        if (source === null) throw new SafeError("SOURCE_NOT_FOUND");
        events += source.events.length; observations += source.evidence?.observations.length ?? 0;
        if (events > HISTORY_LIMITS.eventCopies || observations > HISTORY_LIMITS.observationCopies) throw new HistoryQueryError();
        selected.push(source);
      }
      return analyzeSelectedHistory(selected, query);
    } catch (error) {
      if (error instanceof HistoryQueryError) throw new SafeError("INVALID_ARGUMENT");
      throw error;
    }
  });
}
const value = (n: number | null): string => n === null ? "unavailable" : String(n);
export function formatHistoryResult(a: SelectedHistoryAnalysis, json: boolean): string {
  if (json) {
    const output = JSON.stringify({ schema: "agentprof.cli/v1", ok: true, command: "history", result: a }) + "\n";
    if (Buffer.byteLength(output) > HISTORY_LIMITS.jsonBytes) throw new SafeError("INVALID_ARGUMENT");
    return output;
  }
  const r = a.reconciliation, sources = r.sources.slice(0, 6), days = a.days.slice(0, 8);
  const excluded = r.executions.filter(e => e.state !== "admitted"), shownExcluded = excluded.slice(0, 6);
  const lines = ["AgentProf selected-source native-call history",
    `[${a.query.startInclusive}, ${a.query.endExclusive}); fixed offset=${a.query.offset}; session=${a.query.sessionId ?? "all selected identities"}`,
    `Assessment=${a.assessment}; fullHistory=false; sourceFreshnessChecked=false; no zero-filled days`,
    `Prefix reconciliation: ${Object.entries(r.counts).map(([key, n]) => `${key}=${n}`).join("; ")}`,
    `Sources: shown=${sources.length}/${r.sources.length}; omitted=${r.sources.length - sources.length}`];
  for (const s of sources) lines.push(`${s.sourceId}: ${s.provider}; revision=${s.revision}; parser=${s.parserVersion}; bytes=${s.completedOffset}/${s.observedSize}`,
    `  availability=${s.availability}; native=${s.nativeAssessment}; suppression=${s.suppressionReason ?? "none"}; coverage=${s.parserCoverage ?? "unknown"}; unsupported=${value(s.unsupportedRecords)}`);
  lines.push(`Excluded/unpositioned/conflicting executions: shown=${shownExcluded.length}/${excluded.length}; omitted=${excluded.length - shownExcluded.length}; prefix-wide, not dated`);
  for (const e of shownExcluded) lines.push(`${e.id}: state=${e.state}; copies=${e.copies.length}; reasons=${e.reasons.join(",") || "none"}`);
  lines.push(`Daily partitions: shown=${days.length}/${a.days.length}; omitted=${a.days.length - days.length}; chronological, no global time sum`);
  if (!days.length) lines.push("No positioned observations in the selected period; this does not prove zero activity in full history.");
  for (const d of days) lines.push(`${d.date} ${d.provider} ${d.sessionId} ${d.intervalScope}/${d.intervalTimingEvidence}`,
    `  terminal completions=${d.terminalCompletions}; completed=${d.completedN}; failed=${d.failedN}; sum=${value(d.intervalLengthSumMs)} ms; busy=${value(d.toolBusyMs)} ms`,
    `  concurrent calls=${value(d.concurrentCallsMs)} ms; concurrent categories=${value(d.concurrentCategoriesMs)} ms; exclusive=${Object.entries(d.exclusiveCategoryMs).map(([k, n]) => `${k}:${value(n)}ms`).join(",")}`);
  lines.push(...a.limitations.map(x => `Limit: ${x}`), "Complete source/copy/proof receipts and all daily partitions: --json.");
  return lines.join("\n") + "\n";
}
export function registerHistoryCommand(program: Command): void {
  let dataFlags = 0, jsonFlags = 0;
  program.on("option:data-dir", () => { dataFlags++; });
  program.on("option:json", () => { jsonFlags++; });
  const command = program.command("history").description("Reconcile explicit stored sources and show dated native-call intervals (read-only)")
    .option("--source <id>", "select a source (repeatable, at most 16)", (v: string, previous: string[]) => [...previous, validateSourceSelection(v)], [])
    .option("--from <utc>", "inclusive UTC timestamp, required")
    .option("--to <utc>", "exclusive UTC timestamp, required; at most 366 days")
    .option("--offset <offset>", "fixed daily offset such as +09:00; default +00:00, no DST")
    .option("--session <id>", "filter daily rows by one exact session identity", sessionSelection)
    .allowExcessArguments(false)
    .addHelpText("after", "\nExplicit sources only; no scan/list/migration. Conflicting copies are withheld, not resolved by recency.\nCompletion counts and clipped interval time have different boundary populations.\nNo daily tokens, global busy time or complete-history claim. Unknown time has no invented day.");
  for (const flag of ["from", "to", "offset", "session"]) {
    let n = 0;
    command.on(`option:${flag}`, () => { if (++n > 1) throw new SafeError("INVALID_ARGUMENT"); });
  }
  command.action(async () => {
    if (dataFlags > 1 || jsonFlags > 1) throw new SafeError("INVALID_ARGUMENT");
    const options: HistoryArguments = { ...program.opts(), ...command.opts() };
    const result = await runHistory(options);
    process.stdout.write(formatHistoryResult(result, options.json === true));
    process.exitCode = 0;
  });
}
