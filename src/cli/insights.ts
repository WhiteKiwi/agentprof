import { SafeError } from "../privacy/diagnostics.js";
import { resolveDataDirectory } from "../privacy/paths.js";
import { identity } from "../db/source-validation.js";
import type { SourceSlowToolAnalysis, SourceSlowToolCandidate } from "../analysis/source-slow-tool.js";
import { validateCliPath } from "./scan.js";
import { validateSourceSelection } from "./stats.js";

export type InsightsArguments = Readonly<{ dataDir?: string; codexRoot?: readonly string[]; claudeRoot?: readonly string[]; source?: string }>;
export type InsightsResult = Readonly<{ mode: "selected_source"; analysis: SourceSlowToolAnalysis }>;
export function validateInsightsArguments(options: InsightsArguments): string {
  if ((options.codexRoot?.length ?? 0) || (options.claudeRoot?.length ?? 0)) throw new SafeError("INVALID_ARGUMENT");
  if (options.source === undefined) throw new SafeError("INSIGHTS_SELECTION_REQUIRED");
  validateSourceSelection(options.source);
  if (options.dataDir !== undefined) validateCliPath(options.dataDir);
  return validateCliPath(resolveDataDirectory(options.dataDir === undefined ? {} : { dataDir: options.dataDir }));
}
export async function runInsights(options: InsightsArguments): Promise<InsightsResult> {
  const directory = validateInsightsArguments(options);
  const { withReadOnlyStore } = await import("../db/read-only.js");
  const { createSourceStore } = await import("../db/source-store.js");
  const { analyzeSourceSlowTool } = await import("../analysis/source-slow-tool.js");
  return withReadOnlyStore(directory, (db, key) => {
    try { identity(options.source, "source", key); } catch { throw new SafeError("INVALID_IDENTITY_KEY"); }
    const source = createSourceStore(db, key).readSource(options.source!);
    if (source === null) throw new SafeError("SOURCE_NOT_FOUND");
    return Object.freeze({ mode: "selected_source", analysis: analyzeSourceSlowTool(source) });
  });
}
function value(n: number | null): string { return n === null ? "unknown" : String(n); }
// Advance through the original string once; never clip an indivisible safe label.
function prose(lines: string[], text: string): void {
  let start = 0;
  while (text.length - start > 100) {
    let end = text.lastIndexOf(" ", start + 100);
    if (end <= start) end = text.indexOf(" ", start + 100);
    if (end <= start) break;
    lines.push(text.slice(start, end)); start = end + 1;
  }
  lines.push(text.slice(start));
}
function counts(map: Readonly<Record<string, number>>): string {
  return Object.entries(map).map(([key, n]) => `${key}=${value(n)}`).join("; ");
}
function candidate(lines: string[], c: SourceSlowToolCandidate): void {
  lines.push("", `Candidate ${c.id} | partition=${c.partitionId} | severity=${c.severity}`);
  prose(lines, `Group: kind=${c.group.kind}; category=${c.group.category}; tool=${c.group.toolName ?? "unknown"}; pattern=${c.group.commandPattern ?? "unknown"}`);
  prose(lines, `Grouping: ${c.grouping}; display cohorts do not establish same-task or same-operation identity.`);
  prose(lines, `Measurement basis: ${c.measurementBasis}; duration scope=${c.durationScope}; timing evidence=${c.timingEvidence}`);
  lines.push(`n=${value(c.n)}; sum=${value(c.sumMs)} ms; mean=${value(c.meanMs)} ms; max=${value(c.maxMs)} ms`,
    `p50=${value(c.p50Ms)} ms; p95=${value(c.p95Ms)} ms; lowSampleP95=${c.lowSampleP95}`,
    `Compatible denominator: n=${value(c.denominatorN)}; sum=${value(c.denominatorSumMs)} ms`);
  prose(lines, `observedEligibleNativeToolDurationShare=${String(c.observedEligibleNativeToolDurationShare)} (fraction of admitted compatible native-call recorded duration; 1=100%).`);
  prose(lines, `Evidence counts: event IDs=${c.evidenceEventIds.length}; decisive observation IDs=${c.evidenceObservationIds.length}; includedEventIds=${c.includedEventIds.length} (no Detected Waste contribution from this rule).`);
  prose(lines, `Confidence: ${Object.entries(c.confidence).map(([key, val]) => `${key}=${val}`).join("; ")}`);
  prose(lines, `Candidate limitations: ${c.limitations.join(", ") || "none"}`);
  prose(lines, `Necessary-work counterexample: ${c.necessaryWorkCounterexample}`);
  prose(lines, `Investigative action: ${c.investigativeAction}`);
  prose(lines, `Matched experiment: ${c.matchedExperiment}`);
  prose(lines, `Quality guardrail: ${c.qualityGuardrail}`);
}
function formatHuman(a: SourceSlowToolAnalysis): string {
  const lines = ["AgentProf stored source-prefix insights", `Source: ${a.sourceId}`,
    `Provider: ${a.provider} | revision: ${a.revision} | prefix: ${a.completedOffset}/${a.observedSize} bytes`,
    `Scope: ${a.scope} | availability: ${a.availability} | persisted scope: ${a.persistedScope}`,
    `Observation window: ${a.observationWindow.unit} [${a.observationWindow.startInclusive}, ${a.observationWindow.endExclusive}); query period: unknown`];
  prose(lines, "The byte window is not a date range. Freshness and other-source conflicts were not checked. No complete-session/history claim.");
  lines.push(`Versions: parser=${a.parserVersion}; normalization=${a.normalizationVersion}; key=${a.keyVersion}`,
    `Rule: ${a.ruleId} / ${a.ruleVersion}`);
  prose(lines, `Thresholds: minimum timed calls=${a.thresholds.minimumTimedCalls}; minimum admitted duration fraction=${String(a.thresholds.minimumDurationShare)}; p95 low-sample below=${a.thresholds.p95LowSampleBelow}`);
  prose(lines, `Assessment: ${a.assessment}; suppression=${a.suppressionReason ?? "none"}; candidate-assessment reason=${a.candidateAssessmentReason ?? "none"}`);
  const capabilities = a.capabilities;
  if (capabilities === null) lines.push("Support: unknown; coverage: unknown; parser capabilities: unknown");
  else {
    prose(lines, `Support: ${capabilities.support}; coverage: ${capabilities.coverage}; capability parser version=${capabilities.parserVersion}`);
    prose(lines, `Unsupported records=${capabilities.unsupportedRecords}; ambiguous records=${capabilities.ambiguousRecords}; state limited=${capabilities.stateLimited}; dropped diagnostics=${capabilities.diagnosticsDropped}`);
    prose(lines, `Observed shapes: ${capabilities.observedShapes.join(", ") || "none"}`);
  }
  if (a.assessment === "partial") prose(lines, "Assessment is partial: excluded records or unevaluated partitions remain visible and prevent a whole-source diagnosis.");
  prose(lines, `Source limitations: ${a.limitations.join(", ") || "none"}`);
  const i = a.inventory;
  lines.push("", "Stored inventory (record counts; null is unknown)");
  prose(lines, `events=${value(i.events)}; turns=${value(i.turns)}; usage rows=${value(i.usage)}; observations=${value(i.observations)}; diagnostics=${value(i.diagnostics)}`);
  prose(lines, `Event statuses: ${counts(i.eventStatuses)}`); prose(lines, `Event outcomes: ${counts(i.eventOutcomes)}`);
  lines.push(`Native timed calls: tentative=${a.eligibility.tentativeTimedCalls}; admitted=${a.eligibility.admittedTimedCalls}`);
  const excluded = Object.entries(a.eligibility.exclusions).filter(([, n]) => n !== 0).map(([key, n]) => `${key}=${value(n)}`).join("; ");
  prose(lines, `Disjoint event exclusions: ${excluded || "none"} (unlisted reasons=0)`);
  prose(lines, `Provenance: unresolvedEvents=${a.provenance.unresolvedEvents}; ${counts(a.provenance.failures)}`);
  prose(lines, "Provenance failures are a separate diagnostic dimension, not additional event exclusions.");
  prose(lines, `Observation inventory (not call counts): ${counts(a.observationInventory)}`);
  lines.push("", `Partitions: ${a.partitions.length}; all bounded partitions and candidates are shown in rule order.`);
  prose(lines, "Denominators contain every admitted compatible native call in the selected source/provider/revision/session/scope/evidence partition, including other categories and cohorts below five calls.");
  prose(lines, "Recorded duration sums may overlap; they are not elapsed/busy time, occupancy, waste, savings or population coverage. There is no global ranking or total.");
  if (a.candidates === null) prose(lines, `Candidate assessment unavailable: ${a.candidateAssessmentReason ?? "unknown"}; candidates=unknown, not zero findings.`);
  else if (a.candidates.length === 0) prose(lines, "No candidate met thresholds in the evaluated observed partitions. Zero-denominator shares remain unavailable; excluded/suppressed evidence is not a healthy zero.");
  else lines.push(`Candidates: ${a.candidates.length}`);
  // One bucketing pass prevents a partition-by-candidate Cartesian scan.
  const buckets = new Map<string, SourceSlowToolCandidate[]>();
  for (const c of a.candidates ?? []) {
    const bucket = buckets.get(c.partitionId);
    if (bucket) bucket.push(c); else buckets.set(c.partitionId, [c]);
  }
  for (const p of a.partitions) {
    lines.push("", `Partition: ${p.id}`, `Session: ${p.sessionId}`, `Duration scope: ${p.durationScope} | timing evidence: ${p.timingEvidence}`,
      `Status: ${p.status}; tentative timed calls=${p.tentativeTimedCalls}`,
      `Compatible denominator n=${value(p.denominatorN)}; denominator sum=${value(p.denominatorSumMs)} ms`,
      `Partition event references=${p.eventIds.length}; unresolved event references=${p.unresolvedEventIds.length}`);
    if (p.status === "zero_denominator") lines.push("Observed duration sum is 0 ms; duration share is unavailable.");
    if (p.status === "identity_unresolved" || p.status === "numeric_overflow") lines.push("Candidate assessment is unavailable for this partition; it is not a healthy zero.");
    for (const c of buckets.get(p.id) ?? []) candidate(lines, c);
  }
  lines.push("", "Evidence and limits");
  prose(lines, "All denominator event IDs, candidate event IDs and decisive observation IDs are available with --json. Human evidence counts use their own units.");
  prose(lines, "Causal/root-cause, avoidable-work and effect confidence remain unestablished. No token savings, full usage/time total or global Detected Waste value is established.");
  lines.push(`crossSourceReconciled=${a.crossSourceReconciled}; aggregationReady=${a.aggregationReady}; parserResumeReady=${a.parserResumeReady}`, `sourceFreshnessChecked=${a.sourceFreshnessChecked}; scope remains unreconciled.`);
  return lines.join("\n") + "\n";
}
export function formatInsightsResult(result: InsightsResult, json: boolean): string {
  if (json) return JSON.stringify({ schema: "agentprof.cli/v1", ok: true, command: "insights", result }) + "\n";
  return formatHuman(result.analysis);
}
