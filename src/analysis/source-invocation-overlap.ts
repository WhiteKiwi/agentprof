import type { MetricEvidence, StoredSource } from "../db/source-store.js";
import type { NormalizedEvent } from "../normalize/types.js";
import { analyzeSourceFailures } from "./source-failures.js";
import type { SourceFailureAnalysis } from "./source-failures.js";

type Observation = MetricEvidence["observations"][number];
type IntervalExclusion = "missing_boundary" | "invalid_boundary" | "unsupported_scope" | "unsupported_evidence" | "result_boundary_mismatch";
type ArithmeticReason = "unsafe_endpoint_difference" | "unsafe_interval_sum" | "unsafe_union" | "unsafe_excess";
type PartitionReason = "source_suppressed" | "unsupported_provider" | "provenance_unresolved" | "no_eligible_terminal_events" | "no_positioned_intervals" | ArithmeticReason | null;
export type InvocationOverlapPartition = Readonly<{
  id: string; sessionId: string; intervalScope: "invocation_latency"; intervalTimingEvidence: "paired_timestamps"; unit: "ms";
  status: "evaluated" | "partial" | "unavailable"; reason: PartitionReason;
  coverage: Readonly<{ admittedTerminalN: number; positionedN: number; excludedN: number; unsafeDifferenceN: number; complete: boolean; exclusions: Readonly<Record<IntervalExclusion, number>> }>;
  intervalLengthSumMs: number | null; intervalUnionMs: number | null; excessMs: number | null;
  contributingEventIds: readonly string[]; evidenceObservationIds: readonly string[];
}>;
export type SourceInvocationOverlapAnalysis = Readonly<{
  schema: "agentprof.source-invocation-overlap/v1"; metric: "observed_invocation_interval_union"; scope: "source_prefix";
  sourceId: string; provider: StoredSource["provider"]; parserVersion: number; normalizationVersion: 1; keyVersion: 1;
  revision: number; completedOffset: number; observedSize: number; persistedScope: StoredSource["persistedScope"]; availability: StoredSource["availability"];
  observationWindow: Readonly<{ unit: "source_bytes"; startInclusive: 0; endExclusive: number }>; queryPeriod: null;
  crossSourceReconciled: false; aggregationReady: false; parserResumeReady: false; sourceFreshnessChecked: false;
  assessment: "suppressed" | "unavailable" | "partial" | "evaluated";
  suppressionReason: SourceFailureAnalysis["suppressionReason"] | "unsupported_provider";
  capabilities: MetricEvidence["capabilities"] | null;
  inventory: SourceFailureAnalysis["inventory"];
  inheritedAdmission: SourceFailureAnalysis["eligibility"];
  inheritedProvenance: SourceFailureAnalysis["provenance"];
  partitions: readonly InvocationOverlapPartition[];
  guidance: Readonly<{ meaning: string; limitations: readonly string[]; necessaryOverlapCounterexample: string; investigativeAction: string; matchedExperiment: string; qualityGuardrail: string }>;
}>;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const exclusions = (): Record<IntervalExclusion, number> => ({ missing_boundary: 0, invalid_boundary: 0, unsupported_scope: 0, unsupported_evidence: 0, result_boundary_mismatch: 0 });
function freeze<T>(value: T): T { if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
const safe = (n: number) => Number.isSafeInteger(n) && n >= 0;
type Positioned = { eventId: string; start: number; end: number; length: number; proofIds: string[] };
function position(e: NormalizedEvent, observations: readonly Observation[]): { excluded: IntervalExclusion } | Positioned {
  if (e.startAt === null || e.endAt === null) return { excluded: "missing_boundary" };
  const start = Date.parse(e.startAt), end = Date.parse(e.endAt);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return { excluded: "invalid_boundary" };
  if (e.intervalScope !== "invocation_latency") return { excluded: "unsupported_scope" };
  if (e.intervalTimingEvidence !== "paired_timestamps") return { excluded: "unsupported_evidence" };
  let call: string | null = null, result: string | null = null, conflictingResult = false;
  for (const o of observations) {
    if (!("observedResult" in o) || o.origin !== "ordinary" || o.sessionId !== e.sessionId) continue;
    if (o.representation === "call" && (call === null || compare(o.id, call) < 0)) call = o.id;
    if (o.representation !== "result" || o.sourceRef.fileId !== e.sourceRef.fileId || o.sourceRef.byteOffset !== e.sourceRef.byteOffset) continue;
    const r = o.observedResult;
    if (r === null || r.completionKind !== "invocation_result" || r.unassignedAcknowledgement || r.isError !== (e.status === "failed") || r.observedAt !== e.endAt) { conflictingResult = true; continue; }
    if (result === null || compare(o.id, result) < 0) result = o.id;
  }
  if (call === null || result === null || conflictingResult) return { excluded: "result_boundary_mismatch" };
  // Call observations have no timestamp: start is the independently verified stored adapter contract.
  // durationMs and its scope/evidence are deliberately not consulted.
  return { eventId: e.id, start, end, length: end - start, proofIds: [call, result].sort(compare) };
}
function geometry(rows: readonly Positioned[]): { reason: ArithmeticReason | null; sum: number | null; union: number | null; excess: number | null } {
  const unavailable = (reason: ArithmeticReason) => ({ reason, sum: null, union: null, excess: null });
  let sum = 0;
  for (const row of rows) {
    if (!safe(row.length)) return unavailable("unsafe_endpoint_difference");
    if (!safe(sum + row.length)) return unavailable("unsafe_interval_sum");
    sum += row.length;
  }
  let union = 0, start: number | null = null, end: number | null = null;
  const sorted = [...rows].sort((a, b) => a.start - b.start || a.end - b.end || compare(a.eventId, b.eventId));
  for (const row of sorted) {
    if (start === null || end === null) { start = row.start; end = row.end; }
    else if (row.start <= end) end = Math.max(end, row.end);
    else { const delta = end - start; if (!safe(delta) || !safe(union + delta)) return unavailable("unsafe_union"); union += delta; start = row.start; end = row.end; }
  }
  if (start !== null && end !== null) { const delta = end - start; if (!safe(delta) || !safe(union + delta)) return unavailable("unsafe_union"); union += delta; }
  const excess = sum - union; if (!safe(excess)) return unavailable("unsafe_excess");
  return { reason: null, sum, union, excess };
}

/** Pure, bounded, one validated generation. Existing terminal provenance is evaluated once. */
export function analyzeSourceInvocationOverlap(source: StoredSource): SourceInvocationOverlapAnalysis {
  const evidence = source.evidence;
  if (source.events.length > 4096 || evidence !== null && (evidence.turns.length > 4096 || evidence.usage.length > 4096 || evidence.observations.length > 8192 || evidence.diagnostics.length > 8192)) throw new RangeError("source_invocation_overlap_limit_exceeded");
  const inherited = analyzeSourceFailures(source);
  const suppressionReason = inherited.suppressionReason ?? (source.provider !== "claude" ? "unsupported_provider" : null);
  const events = new Map(source.events.map(e => [e.id, e]));
  const observationIndex = new Map<string, Observation[]>();
  for (const o of evidence?.observations ?? []) {
    if (o.eventId === null) continue;
    const prior = observationIndex.get(o.eventId); if (prior) prior.push(o); else observationIndex.set(o.eventId, [o]);
  }
  const partitions: InvocationOverlapPartition[] = [];
  for (const inheritedPartition of inherited.partitions) {
    const counts = exclusions(), rows: Positioned[] = [];
    const admittedIds = source.provider === "claude" ? inheritedPartition.terminalEventIds : [];
    for (const id of admittedIds) {
      const e = events.get(id)!;
      const row = position(e, observationIndex.get(id) ?? []);
      if ("excluded" in row) counts[row.excluded]++; else rows.push(row);
    }
    rows.sort((a, b) => compare(a.eventId, b.eventId));
    const excludedN = Object.values(counts).reduce((a, b) => a + b, 0);
    const reason: PartitionReason = inherited.suppressionReason !== null ? "source_suppressed" : source.provider !== "claude" ? "unsupported_provider"
      : inheritedPartition.status === "provenance_unresolved" ? "provenance_unresolved"
      : admittedIds.length === 0 ? "no_eligible_terminal_events" : rows.length === 0 ? "no_positioned_intervals" : null;
    const measured = reason === null ? geometry(rows) : { reason: null, sum: null, union: null, excess: null };
    const finalReason = reason ?? measured.reason;
    const proofIds = new Set<string>(); for (const row of rows) for (const id of row.proofIds) proofIds.add(id);
    partitions.push({ id: `partition-${partitions.length + 1}`, sessionId: inheritedPartition.sessionId, intervalScope: "invocation_latency", intervalTimingEvidence: "paired_timestamps", unit: "ms",
      status: finalReason !== null ? "unavailable" : excludedN > 0 ? "partial" : "evaluated", reason: finalReason,
      coverage: { admittedTerminalN: admittedIds.length, positionedN: rows.length, excludedN, unsafeDifferenceN: rows.filter(r => !safe(r.length)).length,
        complete: finalReason === null && excludedN === 0, exclusions: counts },
      intervalLengthSumMs: measured.sum, intervalUnionMs: measured.union, excessMs: measured.excess,
      contributingEventIds: rows.map(r => r.eventId), evidenceObservationIds: [...proofIds].sort(compare) });
  }
  const evaluable = partitions.filter(p => p.status !== "unavailable").length;
  const capabilities = inherited.capabilities === null ? null : { ...inherited.capabilities, observedShapes: [...inherited.capabilities.observedShapes] } as MetricEvidence["capabilities"];
  return freeze({ schema: "agentprof.source-invocation-overlap/v1", metric: "observed_invocation_interval_union", scope: "source_prefix",
    sourceId: source.sourceId, provider: source.provider, parserVersion: source.parserVersion, normalizationVersion: source.normalizationVersion, keyVersion: source.keyVersion,
    revision: source.revision, completedOffset: source.completedOffset, observedSize: source.observedSize, persistedScope: source.persistedScope, availability: source.availability,
    observationWindow: { unit: "source_bytes", startInclusive: 0, endExclusive: source.completedOffset }, queryPeriod: null,
    crossSourceReconciled: false, aggregationReady: false, parserResumeReady: false, sourceFreshnessChecked: false,
    assessment: suppressionReason !== null ? "suppressed" : evaluable === 0 ? "unavailable" : partitions.some(p => p.status !== "evaluated") ? "partial" : "evaluated", suppressionReason,
    capabilities, inventory: { ...inherited.inventory, eventStatuses: { ...inherited.inventory.eventStatuses }, eventOutcomes: { ...inherited.inventory.eventOutcomes } },
    inheritedAdmission: { ...inherited.eligibility, exclusions: { ...inherited.eligibility.exclusions } },
    inheritedProvenance: { ...inherited.provenance, failures: { ...inherited.provenance.failures } }, partitions,
    guidance: {
      meaning: "Observed session-local positioned invocation intervals: length sum, union and excess=sum-union. Partial coverage describes only the positioned subset.",
      limitations: ["No complete session/history or date-range coverage; no cross-session/source union.", "No runtime, active-time, task-elapsed, waste, avoidability, causality or savings claim.", "Excess is multiplicity-weighted overlap, not concurrent wall time: three identical 10-second intervals yield 30/10/20 seconds.", "Start relies on the validated ordinary adapter contract; call observations retain no timestamp. Duration fields never position intervals.", "Unresolved native terminal provenance suppresses the whole affected session."],
      necessaryOverlapCounterexample: "Independent required tools may intentionally overlap; waiting for external work can occupy an invocation interval.",
      investigativeAction: "Inspect the contributing invocations and required dependencies before choosing one bounded scheduling change.",
      matchedExperiment: "Compare the same task and required evidence with one scheduling change, retaining overhead, retries and inconclusive or worse results.",
      qualityGuardrail: "Preserve required outputs, source evidence, independent review and mandatory regression, security and build checks.",
    },
  });
}
