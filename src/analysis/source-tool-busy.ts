import type { StoredSource } from "../db/source-store.js";
import type { NormalizedEvent } from "../normalize/types.js";
import { analyzeSourceFailures } from "./source-failures.js";
import type { SourceFailureAnalysis } from "./source-failures.js";
import { analyzeSourceInvocationOverlap } from "./source-invocation-overlap.js";

type Metadata = Pick<SourceFailureAnalysis, "scope" | "sourceId" | "provider" | "parserVersion" | "normalizationVersion" | "keyVersion" | "revision" | "completedOffset" | "observedSize" | "persistedScope" | "availability" | "observationWindow" | "queryPeriod" | "crossSourceReconciled" | "aggregationReady" | "parserResumeReady" | "sourceFreshnessChecked" | "capabilities" | "inventory">;
type IntervalReason = "missing_boundary" | "invalid_boundary" | "unsupported_scope" | "unsupported_evidence" | "result_boundary_mismatch";
type Counts = Readonly<Record<IntervalReason, number>>;
export type ToolBusyPartition = Readonly<{
  sessionId: string; intervalScope: NormalizedEvent["intervalScope"]; intervalTimingEvidence: NormalizedEvent["intervalTimingEvidence"];
  eventN: number; durationSumMs: number | null; toolBusyMs: number | null;
  status: "evaluated" | "partial" | "unavailable"; reason: string | null;
  coverage: Readonly<{ admittedTerminalN: number; positionedN: number; excludedN: number; unsafeDifferenceN: number; complete: boolean; exclusions: Counts }>;
  contributingEventIds: readonly string[]; evidenceObservationIds: readonly string[];
}>;
export type SourceToolBusyAnalysis = Readonly<Metadata & {
  schema: "agentprof.source-tool-busy/v1"; excluded: number; partitions: readonly ToolBusyPartition[]; limitations: readonly string[];
  assessment: "suppressed" | "unavailable" | "partial" | "evaluated"; suppressionReason: string | null;
  inheritedAdmission: SourceFailureAnalysis["eligibility"]; inheritedProvenance: SourceFailureAnalysis["provenance"];
  intervalEligibility: Readonly<{ admittedTerminalN: number; positionedN: number; excludedN: number; exclusions: Counts }>;
}>;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const safe = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;
const exclusions = (): Record<IntervalReason, number> => ({ missing_boundary: 0, invalid_boundary: 0, unsupported_scope: 0, unsupported_evidence: 0, result_boundary_mismatch: 0 });
function freeze<T>(v: T): T { if (v !== null && typeof v === "object") { for (const x of Object.values(v)) freeze(x); Object.freeze(v); } return v; }
function metadata(a: Metadata): Metadata {
  return { scope: a.scope, sourceId: a.sourceId, provider: a.provider, parserVersion: a.parserVersion, normalizationVersion: a.normalizationVersion, keyVersion: a.keyVersion,
    revision: a.revision, completedOffset: a.completedOffset, observedSize: a.observedSize, persistedScope: a.persistedScope, availability: a.availability,
    observationWindow: { ...a.observationWindow }, queryPeriod: null, crossSourceReconciled: false, aggregationReady: false, parserResumeReady: false, sourceFreshnessChecked: false,
    capabilities: a.capabilities === null ? null : { ...a.capabilities, observedShapes: [...a.capabilities.observedShapes] } as Metadata["capabilities"],
    inventory: { ...a.inventory, eventStatuses: { ...a.inventory.eventStatuses }, eventOutcomes: { ...a.inventory.eventOutcomes } } };
}
type Positioned = { eventId: string; start: number; end: number; proofIds: string[] };
function geometry(rows: readonly Positioned[]): { sum: number | null; union: number | null; reason: string | null } {
  let sum = 0;
  for (const row of rows) {
    const length = row.end - row.start;
    if (!safe(length)) return { sum: null, union: null, reason: "unsafe_endpoint_difference" };
    if (!safe(sum + length)) return { sum: null, union: null, reason: "unsafe_interval_sum" };
    sum += length;
  }
  const sorted = [...rows].sort((a, b) => a.start - b.start || a.end - b.end || compare(a.eventId, b.eventId));
  let union = 0, start: number | null = null, end: number | null = null;
  for (const row of sorted) {
    if (start === null || end === null) { start = row.start; end = row.end; }
    else if (row.start <= end) end = Math.max(end, row.end);
    else { const length = end - start; if (!safe(length) || !safe(union + length)) return { sum: null, union: null, reason: "unsafe_union" }; union += length; start = row.start; end = row.end; }
  }
  if (start !== null && end !== null) { const length = end - start; if (!safe(length) || !safe(union + length)) return { sum: null, union: null, reason: "unsafe_union" }; union += length; }
  return { sum, union, reason: null };
}
function codexPosition(e: NormalizedEvent, observations: NonNullable<StoredSource["evidence"]>["observations"]): Positioned | IntervalReason {
  if (e.startAt === null || e.endAt === null) return "missing_boundary";
  const start = Date.parse(e.startAt), end = Date.parse(e.endAt);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return "invalid_boundary";
  const structured = e.sourceRef.recordType === "event_msg";
  if (e.intervalScope !== (structured ? "item_lifecycle" : "invocation_latency")) return "unsupported_scope";
  if (e.intervalTimingEvidence !== (structured ? "source_reported" : "paired_timestamps")) return "unsupported_evidence";
  if (e.sourceRef.recordType !== "event_msg" && e.sourceRef.recordType !== "response_item") return "result_boundary_mismatch";
  const candidates = observations.filter(o => "transportStatus" in o).filter(o => o.origin === "ordinary");
  const calls = candidates.filter(o => o.representation === "call").map(o => o.id).sort(compare);
  const decisive = candidates.filter(o => o.sourceRef.fileId === e.sourceRef.fileId && o.sourceRef.byteOffset === e.sourceRef.byteOffset && (structured ? o.representation === "structured" : (o.representation === "result" || o.representation === "poll") && o.transportStatus === "unknown")).map(o => o.id).sort(compare);
  if (decisive.length === 0 || !structured && calls.length === 0) return "result_boundary_mismatch";
  // Endpoint timestamps belong to the admitted parser1 native tuple; observations have no timestamps.
  return { eventId: e.id, start, end, proofIds: (structured ? [decisive[0]!] : [calls[0]!, decisive[0]!]).sort(compare) };
}
/** One validated generation, one inherited admission; complete partitions are presentation-independent. */
export function analyzeSourceToolBusy(source: StoredSource): SourceToolBusyAnalysis {
  let base: Metadata, admission: SourceFailureAnalysis["eligibility"], provenance: SourceFailureAnalysis["provenance"], suppressionReason: string | null;
  const partitions: ToolBusyPartition[] = [];
  if (source.provider === "claude") {
    const a = analyzeSourceInvocationOverlap(source); base = a; admission = a.inheritedAdmission; provenance = a.inheritedProvenance; suppressionReason = a.suppressionReason;
    for (const p of a.partitions) partitions.push({ sessionId: p.sessionId, intervalScope: p.intervalScope, intervalTimingEvidence: p.intervalTimingEvidence,
      eventN: p.coverage.positionedN, durationSumMs: p.intervalLengthSumMs, toolBusyMs: p.intervalUnionMs, status: p.status, reason: p.reason,
      coverage: { ...p.coverage, exclusions: { ...p.coverage.exclusions } }, contributingEventIds: [...p.contributingEventIds], evidenceObservationIds: [...p.evidenceObservationIds] });
  } else {
    const a = analyzeSourceFailures(source); base = a; admission = a.eligibility; provenance = a.provenance; suppressionReason = a.suppressionReason;
    const events = new Map(source.events.map(e => [e.id, e]));
    const proofs = new Map<string, NonNullable<StoredSource["evidence"]>["observations"][number][]>();
    for (const o of source.evidence?.observations ?? []) { if (o.eventId === null) continue; const rows = proofs.get(o.eventId); if (rows) rows.push(o); else proofs.set(o.eventId, [o]); }
    for (const inherited of a.partitions) {
      const buckets = new Map<string, { scope: NormalizedEvent["intervalScope"]; timing: NormalizedEvent["intervalTimingEvidence"]; rows: Positioned[]; counts: Record<IntervalReason, number>; admitted: number }>();
      for (const id of inherited.terminalEventIds) {
        const e = events.get(id)!, key = JSON.stringify([e.intervalScope, e.intervalTimingEvidence]); let bucket = buckets.get(key);
        if (!bucket) { bucket = { scope: e.intervalScope, timing: e.intervalTimingEvidence, rows: [], counts: exclusions(), admitted: 0 }; buckets.set(key, bucket); }
        bucket.admitted++; const positioned = codexPosition(e, proofs.get(e.id) ?? []);
        if (typeof positioned === "string") bucket.counts[positioned]++; else bucket.rows.push(positioned);
      }
      if (buckets.size === 0) buckets.set("unknown", { scope: "unknown", timing: "unknown", rows: [], counts: exclusions(), admitted: 0 });
      for (const [, bucket] of [...buckets].sort(([a], [b]) => compare(a, b))) {
        const rows = bucket.rows.sort((a, b) => compare(a.eventId, b.eventId));
        const reason = suppressionReason !== null ? "source_suppressed" : inherited.status === "provenance_unresolved" ? "provenance_unresolved" : bucket.admitted === 0 ? "no_eligible_terminal_events" : rows.length === 0 ? "no_positioned_intervals" : null;
        const measured = reason === null ? geometry(rows) : { sum: null, union: null, reason: null }, finalReason = reason ?? measured.reason;
        const excludedN = Object.values(bucket.counts).reduce((a, b) => a + b, 0);
        partitions.push({ sessionId: inherited.sessionId, intervalScope: bucket.scope, intervalTimingEvidence: bucket.timing, eventN: rows.length,
          durationSumMs: measured.sum, toolBusyMs: measured.union, status: finalReason !== null ? "unavailable" : excludedN > 0 ? "partial" : "evaluated", reason: finalReason,
          coverage: { admittedTerminalN: bucket.admitted, positionedN: rows.length, excludedN, unsafeDifferenceN: rows.filter(row => !safe(row.end - row.start)).length, complete: finalReason === null && excludedN === 0, exclusions: bucket.counts },
          contributingEventIds: rows.map(row => row.eventId), evidenceObservationIds: [...new Set(rows.flatMap(row => row.proofIds))].sort(compare) });
      }
    }
  }
  partitions.sort((a, b) => compare(JSON.stringify([a.sessionId, a.intervalScope, a.intervalTimingEvidence]), JSON.stringify([b.sessionId, b.intervalScope, b.intervalTimingEvidence])));
  const counts = exclusions(); for (const p of partitions) for (const key of Object.keys(counts) as IntervalReason[]) counts[key] += p.coverage.exclusions[key];
  const positionedN = partitions.reduce((n, p) => n + p.eventN, 0), excludedN = Object.values(counts).reduce((a, b) => a + b, 0);
  return freeze({ ...metadata(base), schema: "agentprof.source-tool-busy/v1", excluded: source.events.length - positionedN, partitions,
    limitations: ["interval_union_not_cpu_time", "different_scope_or_evidence_not_combined", "no_waste_or_savings_inference"],
    assessment: suppressionReason !== null ? "suppressed" : !partitions.some(p => p.status !== "unavailable") ? "unavailable" : partitions.some(p => p.status !== "evaluated") || excludedN > 0 ? "partial" : "evaluated", suppressionReason,
    inheritedAdmission: { ...admission, exclusions: { ...admission.exclusions } }, inheritedProvenance: { ...provenance, failures: { ...provenance.failures } },
    intervalEligibility: { admittedTerminalN: admission.admittedTerminalCalls, positionedN, excludedN, exclusions: counts } });
}
