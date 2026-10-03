import { SafeError } from "../privacy/diagnostics.js";
import { identity } from "../db/source-validation.js";
import type { StoredSource } from "../db/source-store.js";
import { validateHistoryArguments } from "./history.js";
import type { HistoryArguments } from "./history.js";
import { HistoryQueryError } from "../analysis/history-query.js";
import { USAGE_HISTORY_LIMITS, USAGE_TOKEN_FIELDS } from "../analysis/usage-history.js";
import type { SelectedUsageHistory } from "../analysis/usage-history.js";
import { validateReportPath } from "../report/write-output.js";
import type { Publication } from "../report/write-output.js";

export type UsageHistoryArguments = HistoryArguments & Readonly<{ tokens?: boolean; output?: string; provider?: string; input?: string }>;
function prepare(options: UsageHistoryArguments) {
  if (options.provider !== undefined || options.input !== undefined || options.tokens !== undefined && options.tokens !== true) throw new SafeError("INVALID_ARGUMENT");
  if (options.output !== undefined && (typeof options.output !== "string" || !/\.(?:html|htm)$/i.test(options.output))) throw new SafeError("INVALID_ARGUMENT");
  if (options.output !== undefined) validateReportPath(options.output);
  return validateHistoryArguments(options);
}
export async function runUsageHistory(options: UsageHistoryArguments): Promise<SelectedUsageHistory> {
  const { sources, query, directory } = prepare(options);
  const { withReadOnlyStore } = await import("../db/read-only.js");
  const { createSourceStore } = await import("../db/source-store.js");
  const { analyzeUsageHistory } = await import("../analysis/usage-history.js");
  return withReadOnlyStore(directory, (db, key) => {
    try { for (const id of sources) identity(id, "source", key); if (query.sessionId !== null) identity(query.sessionId, "session", key); }
    catch { throw new SafeError("INVALID_IDENTITY_KEY"); }
    const store = createSourceStore(db, key), selected: StoredSource[] = [];
    let usages = 0, observations = 0;
    for (const id of sources) {
      const s = store.readSource(id); if (s === null) throw new SafeError("SOURCE_NOT_FOUND");
      usages += s.evidence?.usage.length ?? 0; observations += s.evidence?.observations.length ?? 0;
      if (usages > USAGE_HISTORY_LIMITS.usageCopies || observations > USAGE_HISTORY_LIMITS.observationCopies) throw new SafeError("INVALID_ARGUMENT");
      selected.push(s);
    }
    try { return analyzeUsageHistory(selected, query); }
    catch (error) { if (error instanceof HistoryQueryError) throw new SafeError("INVALID_ARGUMENT"); throw error; }
  });
}
const value = (n: number | null) => n === null ? "unavailable" : String(n);
export function formatUsageHistory(a: SelectedUsageHistory, json: boolean): string {
  if (json) {
    const text = JSON.stringify({ schema: "agentprof.cli/v1", ok: true, command: "history", mode: "tokens", result: a }) + "\n";
    if (Buffer.byteLength(text) > USAGE_HISTORY_LIMITS.jsonBytes) throw new SafeError("INVALID_ARGUMENT");
    return text;
  }
  const days = a.days.slice(0, 12), i = a.inventory;
  const lines = ["AgentProf daily token evidence", `${a.query.startInclusive} .. ${a.query.endExclusive} [start,end); fixed offset=${a.query.offset}`,
    `Assessment=${a.assessment}; earliest known matching record timestamp, not billing/completion time.`,
    `Final responses=${i.datedFinalResponses}; provisional responses=${i.datedProvisionalResponses} (not combined); undated=${i.undatedResponses}; outside-window=${i.outsideWindowResponses}`,
    `Usage copies=${i.usageCopies}; response groups=${i.responseGroups}; equal duplicate copies=${i.duplicateCopies}; excluded copies=${i.excludedCopies}`,
    `Excluded: ${Object.entries(i.exclusions).map(([k, n]) => `${k}=${n}`).join("; ")}`,
    `Daily partitions: shown=${days.length}/${a.days.length}; omitted=${a.days.length - days.length}`];
  if (!days.length) lines.push("No dateable response evidence; this is not proof of zero usage.");
  for (const d of days) lines.push(`${d.date} ${d.provider} ${d.sessionId} ${d.selection}/${d.finality}/${d.mapping}; responses=${d.responseN}`,
    `  ${USAGE_TOKEN_FIELDS.map(k => `${k}=${value(d.counts[k])}`).join("; ")}; overflow=${d.overflowComponents.join(",") || "none"}`);
  lines.push(...a.limitations, "Complete response/copy/proof receipts: --tokens --json without --output.");
  return lines.join("\n") + "\n";
}
export type UsageHistoryPublication = Readonly<{ mode: "usage_history_html"; assessment: SelectedUsageHistory["assessment"]; dailyPartitions: number; publication: Publication }>;
export async function exportUsageHistory(options: UsageHistoryArguments): Promise<UsageHistoryPublication> {
  const { directory } = prepare(options);
  if (options.output === undefined) throw new SafeError("INVALID_ARGUMENT");
  const analysis = await runUsageHistory(options);
  const { renderUsageHistoryPage } = await import("../report/usage-history-page.js");
  const { writeReportOutput } = await import("../report/write-output.js");
  const publication = await writeReportOutput({ output: options.output, dataDirectory: directory, html: renderUsageHistoryPage(analysis) });
  return Object.freeze({ mode: "usage_history_html", assessment: analysis.assessment, dailyPartitions: analysis.days.length, publication });
}
export function formatUsagePublication(r: UsageHistoryPublication, json: boolean): string {
  return json ? JSON.stringify({ schema: "agentprof.cli/v1", command: "history", ok: r.publication.status === "published", result: r }) + "\n"
    : `AgentProf daily token HTML\nPublication=${r.publication.status}; assessment=${r.assessment}; daily partitions=${r.dailyPartitions}\nOutput: ${r.publication.output}\nWarnings: ${r.publication.warnings.join(", ") || "none"}\nFinal/provisional observations are separate; no billed-usage claim.\n`;
}
