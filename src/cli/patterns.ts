import type { Command } from "commander";
import { SafeError } from "../privacy/diagnostics.js";
import { resolveDataDirectory } from "../privacy/paths.js";
import { identity } from "../db/source-validation.js";
import { validateCliPath } from "./scan.js";
import { validateSourceSelection } from "./stats.js";
import type { SourcePatternAnalysis } from "../analysis/source-patterns.js";
import type { PatternPeriod } from "../analysis/pattern-intervals.js";

export type PatternArguments = Readonly<{
  source?: string; dataDir?: string; from?: string; to?: string;
  codexRoot?: readonly string[]; claudeRoot?: readonly string[];
}>;
function utc(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new SafeError("INVALID_ARGUMENT");
  const ms = Date.parse(value);
  if (!Number.isSafeInteger(ms) || new Date(ms).toISOString() !== (value.includes(".") ? value : `${value.slice(0, -1)}.000Z`)) throw new SafeError("INVALID_ARGUMENT");
  return ms;
}
/** No paths are opened and no imports of storage/analyzers occur before validation. */
export function validatePatternArguments(options: PatternArguments): Readonly<{ directory: string; sourceId: string; period: PatternPeriod | null }> {
  if (typeof options.source !== "string" || (options.codexRoot?.length ?? 0) > 0 || (options.claudeRoot?.length ?? 0) > 0) throw new SafeError("INVALID_ARGUMENT");
  const sourceId = validateSourceSelection(options.source);
  if ((options.from === undefined) !== (options.to === undefined)) throw new SafeError("INVALID_ARGUMENT");
  let period: PatternPeriod | null = null;
  if (options.from !== undefined) {
    const startMs = utc(options.from), endMs = utc(options.to);
    if (endMs <= startMs || !Number.isSafeInteger(endMs - startMs)) throw new SafeError("INVALID_ARGUMENT");
    period = Object.freeze({ startMs, endMs });
  }
  if (options.dataDir !== undefined) validateCliPath(options.dataDir);
  const directory = validateCliPath(resolveDataDirectory(options.dataDir === undefined ? {} : { dataDir: options.dataDir }));
  return Object.freeze({ directory, sourceId, period });
}
export async function runPatterns(options: PatternArguments): Promise<SourcePatternAnalysis> {
  const { directory, sourceId, period } = validatePatternArguments(options);
  const { withReadOnlyStore } = await import("../db/read-only.js");
  const { createSourceStore } = await import("../db/source-store.js");
  const { analyzeSourcePatterns } = await import("../analysis/source-patterns.js");
  return withReadOnlyStore(directory, (db, key) => {
    try { identity(sourceId, "source", key); } catch { throw new SafeError("INVALID_IDENTITY_KEY"); }
    const source = createSourceStore(db, key).readSource(sourceId);
    if (source === null) throw new SafeError("SOURCE_NOT_FOUND");
    return analyzeSourcePatterns(source, period);
  });
}
function text(value: string | number | boolean | null): string {
  if (value === null) return "unavailable";
  const clean = String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  return clean.length > 240 ? `${clean.slice(0, 240)} [see JSON]` : clean;
}
const shown = (n: number, total: number) => `shown=${n}/${total}; omitted=${total - n}`;
export function formatPatterns(a: SourcePatternAnalysis, json: boolean): string {
  if (json) return JSON.stringify({ schema: "agentprof.cli/v1", ok: true, command: "patterns", result: a }) + "\n";
  const lines = ["AgentProf observed source-local patterns", `Source: ${text(a.sourceId)}`,
    `${a.provider}; revision=${a.revision}; parser=${a.parserVersion}; bytes [0,${a.completedOffset})/${a.observedSize}`,
    `Assessment=${a.assessment}; suppression=${a.suppressionReason ?? "none"}; source freshness/cross-source reconciliation not checked.`,
    `Native terminals=${text(a.coverage.nativeTerminalN)}; positioned=${a.coverage.positionedN}; unpositioned=${a.coverage.positionExclusions.length}; unresolved provenance=${a.coverage.unresolvedProvenanceN}`,
    `Contribution period: ${a.queryPeriod === null ? "stored prefix" : `${a.queryPeriod.startAt} .. ${a.queryPeriod.endAt} [start,end)`}`];
  for (const r of a.rules) lines.push(`${r.ruleId}: ${r.status}; eligible=${r.eligibleEventN}; missing=${r.missingEvidenceEventIds.length}; blocked streams=${r.blockedSessionIds.length}; candidates=${r.candidateIds.length}`,
    `  Rule ${r.version}; minimum=${r.thresholds.minimumOccurrences}; window ms=${text(r.thresholds.windowMs)}; minimum streams=${r.thresholds.minimumSessions}; reasons=${r.reasons.map(text).join(",") || "none"}`);
  const partitions = a.editValidation.partitions.slice(0, 6);
  lines.push(`Edit-validation streams: ${shown(partitions.length, a.editValidation.partitions.length)}; prefix counts, ordered association only.`);
  for (const p of partitions) lines.push(`  ${text(p.sessionId)}: ${p.status}; cycles=${text(p.cycleN)}; first pass=${text(p.firstPassN)}/${text(p.firstTerminalN)}; fraction=${text(p.firstPassValidationRate)}; full scope=${text(p.fullScopeN)}/${text(p.scopeKnownN)}; awaiting edits=${text(p.awaitingValidationEditN)}`);
  const times = a.timePartitions?.slice(0, 6) ?? [];
  lines.push(a.timePartitions === null ? "Time partitions: unavailable" : `Time partitions: ${shown(times.length, a.timePartitions.length)}; compatible intervals, milliseconds.`);
  for (const p of times) lines.push(`  ${p.id}: ${text(p.sessionId)}; ${p.intervalScope}/${p.intervalTimingEvidence}`,
    `  interval sum=${text(p.intervalLengthSumMs)}; busy union=${text(p.toolBusyMs)}; multi-category=${text(p.concurrentCategoriesMs)}; pattern union=${text(p.patternAssociatedMs)}; rule excess=${text(p.ruleOverlapExcessMs)}; subset only=${p.qualifiedSubsetOnly}`,
    `  Exclusive categories: ${Object.entries(p.exclusiveCategoryMs).map(([key, value]) => `${key}=${text(value)}`).join(", ")}`);
  const cards = a.candidates.slice(0, 6);
  lines.push(`Pattern candidates: ${shown(cards.length, a.candidates.length)}; no savings or root-cause assertion.`);
  for (const c of cards) lines.push(`  ${c.id}: ${c.ruleId}; ${c.severity}; occurrences=${c.occurrences}; contributing calls=${c.includedEventIds.length}; untimed=${c.untimedContributionEventIds.length}`,
    `  Necessary work: ${text(c.necessaryWorkCounterexample)}`, `  Investigate: ${text(c.investigativeAction)}`);
  lines.push("Experiment: change one prerequisite/workflow choice and compare equivalent tasks; retain no-effect/worse/incomparable results.",
    "Quality: preserve required evidence and all mandatory full regression/security/build gates, including follow-up retries/refetches.",
    ...a.limitations.map(x => `Limit: ${text(x)}`), "All candidates, cycles, time partitions, exclusions and proof IDs: --json.");
  return lines.join("\n") + "\n";
}
export function registerPatternCommand(program: Command): void {
  let dataFlags = 0, jsonFlags = 0;
  program.on("option:data-dir", () => { dataFlags++; });
  program.on("option:json", () => { jsonFlags++; });
  const command = program.command("patterns").description("Inspect one stored source's observed validation cycles and evidence-gated patterns")
    .option("--source <id>", "one full stored source ID", validateSourceSelection)
    .option("--provider <provider>", "fresh input provider: codex or claude; requires --input and --output")
    .option("--input <file>", "collect one explicit regular .jsonl file before export; excludes --source/roots")
    .option("--from <utc>", "inclusive UTC contribution boundary; requires --to")
    .option("--to <utc>", "exclusive UTC contribution boundary; requires --from")
    .option("--output <file>", "write a new offline .html/.htm report; stdout becomes a publication receipt")
    .allowExcessArguments(false)
    .addHelpText("after", "\nStored mode is read-only; no scan/migration. Missing error/content/scope proof stays unavailable.\nFresh --provider/--input mode requires --output; only the scan-receipt generation is exported.\nPartial evidence keeps exit1; failed/stale/aborted collection never falls back to old data.\nCycle counts describe the stored prefix; time boundaries clip contributions, not all rule windows.\nSlow Tool and exploration are separate. Pattern time is not avoided time or savings.");
  for (const name of ["source", "from", "to", "output", "provider", "input"]) {
    let n = 0;
    command.on(`option:${name}`, () => { if (++n > 1) throw new SafeError("INVALID_ARGUMENT"); });
  }
  command.action(async () => {
    const options = { ...program.opts(), ...command.opts() } as PatternArguments & { json?: boolean; output?: string; provider?: string; input?: string };
    if (options.provider !== undefined || options.input !== undefined) {
      if (dataFlags > 1 || jsonFlags > 1) throw new SafeError("INVALID_ARGUMENT");
      const { runFreshAnalysis, formatFreshAnalysis, freshAnalysisExitCode } = await import("./fresh-analysis.js");
      const result = await runFreshAnalysis("patterns", options);
      process.stdout.write(formatFreshAnalysis(result, options.json === true));
      process.exitCode = freshAnalysisExitCode(result);
      return;
    }
    if (options.output !== undefined) {
      if (dataFlags > 1 || jsonFlags > 1) throw new SafeError("INVALID_ARGUMENT");
      const { runPatternExport, formatPatternExport, patternExportExitCode } = await import("./pattern-export.js");
      const result = await runPatternExport(options);
      process.stdout.write(formatPatternExport(result, options.json === true));
      process.exitCode = patternExportExitCode(result);
      return;
    }
    const result = await runPatterns(options);
    process.stdout.write(formatPatterns(result, options.json === true));
    process.exitCode = 0;
  });
}
