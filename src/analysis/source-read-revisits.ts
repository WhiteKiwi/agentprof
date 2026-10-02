import type { MetricEvidence, StoredSource } from "../db/source-store.js";
import type { NormalizedEvent } from "../normalize/types.js";
import { analyzeSourceFailures } from "./source-failures.js";
import type { SourceFailureAnalysis } from "./source-failures.js";

type Statuses = Readonly<Record<NormalizedEvent["status"], number>>;
type PartitionReason = "source_suppressed" | "unsupported_provider" | "provenance_unresolved" | "no_eligible_reads" | "identity_unresolved" | null;
export type ReadRevisitCohort = Readonly<{
  id: string; readN: number; revisitN: number; eventIds: readonly string[]; evidenceObservationIds: readonly string[];
}>;
export type ReadRevisitPartition = Readonly<{
  id: string; sessionId: string; status: "evaluated" | "unavailable"; reason: PartitionReason;
  rawReadStatuses: Statuses; candidateReadN: number; missingFileIdentityN: number;
  candidateEventIds: readonly string[]; missingFileIdentityEventIds: readonly string[];
  validReadN: number | null; uniqueFileN: number | null; revisitN: number | null; revisitRatio: number | null;
  cohorts: readonly ReadRevisitCohort[] | null;
}>;
export type SourceReadRevisitAnalysis = Readonly<{
  schema: "agentprof.source-read-revisits/v1"; metric: "completed_file_revisits"; scope: "source_prefix";
  sourceId: string; provider: StoredSource["provider"]; parserVersion: number; normalizationVersion: 1; keyVersion: 1;
  revision: number; completedOffset: number; observedSize: number; persistedScope: StoredSource["persistedScope"]; availability: StoredSource["availability"];
  observationWindow: Readonly<{ unit: "source_bytes"; startInclusive: 0; endExclusive: number }>; queryPeriod: null;
  crossSourceReconciled: false; aggregationReady: false; parserResumeReady: false; sourceFreshnessChecked: false;
  assessment: "suppressed" | "unavailable" | "partial" | "evaluated";
  suppressionReason: SourceFailureAnalysis["suppressionReason"] | "unsupported_provider";
  capabilities: MetricEvidence["capabilities"] | null;
  inventory: Readonly<{ events: number; turns: number | null; usage: number | null; observations: number | null; diagnostics: number | null; eventStatuses: Statuses }>;
  readClassification: Readonly<{ unit: "raw_events"; nonRead: number; inconsistentReadClass: number; completedRead: number; failedRead: number; pendingRead: number; cancelledRead: number; unknownRead: number }>;
  completedReadAdmission: Readonly<{ unit: "completed_read_events"; sourceSuppressed: number; unsupportedProvider: number; provenanceUnresolved: number; admitted: number; missingFileIdentity: number }>;
  inheritedProvenance: Readonly<{ unit: "native_events"; unresolvedEvents: number; failures: SourceFailureAnalysis["provenance"]["failures"]; exclusions: SourceFailureAnalysis["eligibility"]["exclusions"] }>;
  partitions: readonly ReadRevisitPartition[];
  guidance: Readonly<{ meaning: string; limitations: readonly string[]; necessaryRereadCounterexample: string; investigativeAction: string; matchedExperiment: string; qualityGuardrail: string }>;
}>;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const statuses = () => ({ completed: 0, failed: 0, cancelled: 0, pending: 0, unknown: 0 });
const read = (e: NormalizedEvent) => e.kind === "file_read" && e.category === "read" && e.toolName === "Read";
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** One validated stored generation only. The existing provenance gate is evaluated exactly once. */
export function analyzeSourceReadRevisits(source: StoredSource): SourceReadRevisitAnalysis {
  const evidence = source.evidence;
  if (source.events.length > 4096 || evidence !== null && (evidence.turns.length > 4096 || evidence.usage.length > 4096 || evidence.observations.length > 8192 || evidence.diagnostics.length > 8192)) throw new RangeError("source_read_revisits_limit_exceeded");
  const inherited = analyzeSourceFailures(source);
  const suppressionReason = inherited.suppressionReason ?? (source.provider !== "claude" ? "unsupported_provider" : null);
  const capabilities: MetricEvidence["capabilities"] | null = inherited.capabilities === null ? null
    : inherited.capabilities.provider === "claude"
      ? { ...inherited.capabilities, observedShapes: [...inherited.capabilities.observedShapes] }
      : { ...inherited.capabilities, observedShapes: [...inherited.capabilities.observedShapes] };
  const partitionsBySession = new Map(inherited.partitions.map(p => [p.sessionId, p]));
  const completed = new Set(inherited.partitions.flatMap(p => p.completedEventIds));
  const proofs = new Map<string, Set<string>>();
  for (const o of evidence?.observations ?? []) {
    if (o.eventId === null || !completed.has(o.eventId) || o.origin !== "ordinary" || o.representation !== "call" && o.representation !== "result") continue;
    let ids = proofs.get(o.eventId); if (!ids) { ids = new Set(); proofs.set(o.eventId, ids); } ids.add(o.id);
  }
  const classification = { unit: "raw_events" as const, nonRead: 0, inconsistentReadClass: 0, completedRead: 0, failedRead: 0, pendingRead: 0, cancelledRead: 0, unknownRead: 0 };
  const admission = { unit: "completed_read_events" as const, sourceSuppressed: 0, unsupportedProvider: 0, provenanceUnresolved: 0, admitted: 0, missingFileIdentity: 0 };
  type Bucket = { statuses: ReturnType<typeof statuses>; candidates: NormalizedEvent[] };
  const buckets = new Map<string, Bucket>();
  for (const e of source.events) {
    let bucket = buckets.get(e.sessionId); if (!bucket) { bucket = { statuses: statuses(), candidates: [] }; buckets.set(e.sessionId, bucket); }
    if (!read(e)) {
      if (e.kind === "file_read" || e.toolName === "Read") classification.inconsistentReadClass++; else classification.nonRead++;
      continue;
    }
    bucket.statuses[e.status]++;
    const statusKey = { completed: "completedRead", failed: "failedRead", pending: "pendingRead", cancelled: "cancelledRead", unknown: "unknownRead" } as const;
    classification[statusKey[e.status]]++;
    if (e.status !== "completed") continue;
    if (inherited.suppressionReason !== null) { admission.sourceSuppressed++; continue; }
    if (source.provider !== "claude") { admission.unsupportedProvider++; continue; }
    if (!completed.has(e.id)) { admission.provenanceUnresolved++; continue; }
    admission.admitted++; bucket.candidates.push(e);
    if (e.fileFingerprint === null) admission.missingFileIdentity++;
  }
  const partitions: ReadRevisitPartition[] = [];
  let evaluated = 0;
  for (const [sessionId, bucket] of [...buckets].sort(([a], [b]) => compare(a, b))) {
    const candidates = bucket.candidates.sort((a, b) => compare(a.id, b.id));
    const missing = candidates.filter(e => e.fileFingerprint === null);
    const reason: PartitionReason = inherited.suppressionReason !== null ? "source_suppressed" : source.provider !== "claude" ? "unsupported_provider"
      : partitionsBySession.get(sessionId)?.status === "provenance_unresolved" ? "provenance_unresolved"
      : candidates.length === 0 ? "no_eligible_reads" : missing.length > 0 ? "identity_unresolved" : null;
    let cohorts: ReadRevisitCohort[] | null = null;
    if (reason === null) {
      evaluated++; const files = new Map<string, NormalizedEvent[]>();
      for (const e of candidates) { const rows = files.get(e.fileFingerprint!); if (rows) rows.push(e); else files.set(e.fileFingerprint!, [e]); }
      cohorts = [];
      for (const [, rows] of [...files].sort(([a], [b]) => compare(a, b))) {
        const observationIds = new Set<string>();
        for (const e of rows) for (const id of proofs.get(e.id) ?? []) observationIds.add(id);
        cohorts.push({ id: `file-${cohorts.length + 1}`, readN: rows.length, revisitN: rows.length - 1,
          eventIds: rows.map(e => e.id), evidenceObservationIds: [...observationIds].sort(compare) });
      }
    }
    const n = reason === null ? candidates.length : null, u = cohorts?.length ?? null;
    partitions.push({ id: `partition-${partitions.length + 1}`, sessionId, status: reason === null ? "evaluated" : "unavailable", reason,
      rawReadStatuses: bucket.statuses, candidateReadN: candidates.length, missingFileIdentityN: missing.length,
      candidateEventIds: candidates.map(e => e.id), missingFileIdentityEventIds: missing.map(e => e.id),
      validReadN: n, uniqueFileN: u, revisitN: n === null || u === null ? null : n - u,
      revisitRatio: n === null || u === null ? null : (n - u) / n, cohorts });
  }
  return freeze({ schema: "agentprof.source-read-revisits/v1", metric: "completed_file_revisits", scope: "source_prefix",
    sourceId: source.sourceId, provider: source.provider, parserVersion: source.parserVersion, normalizationVersion: source.normalizationVersion, keyVersion: source.keyVersion,
    revision: source.revision, completedOffset: source.completedOffset, observedSize: source.observedSize, persistedScope: source.persistedScope, availability: source.availability,
    observationWindow: { unit: "source_bytes", startInclusive: 0, endExclusive: source.completedOffset }, queryPeriod: null,
    crossSourceReconciled: false, aggregationReady: false, parserResumeReady: false, sourceFreshnessChecked: false,
    assessment: suppressionReason !== null ? "suppressed" : evaluated === 0 ? "unavailable" : evaluated < partitions.length ? "partial" : "evaluated", suppressionReason,
    capabilities,
    inventory: { events: inherited.inventory.events, turns: inherited.inventory.turns, usage: inherited.inventory.usage, observations: inherited.inventory.observations, diagnostics: inherited.inventory.diagnostics, eventStatuses: { ...inherited.inventory.eventStatuses } },
    readClassification: classification, completedReadAdmission: admission,
    inheritedProvenance: { unit: "native_events", unresolvedEvents: inherited.provenance.unresolvedEvents, failures: { ...inherited.provenance.failures }, exclusions: { ...inherited.eligibility.exclusions } },
    partitions,
    guidance: {
      meaning: "Session-local completed file-path revisits; (N-U)/N counts invocations beyond distinct keyed file identities.",
      limitations: ["Not complete session/history or population coverage.", "Project and exact path spelling are included in opaque identity; aliases, symlinks and cross-source executions are not reconciled.", "Snapshot-local file aliases are not stable file names or project partitions.", "No same-content, search, retry, waste, avoidability, time, token or savings claim.", "Inherited unresolved native terminal provenance suppresses the whole session, including uncertainty in other native tools."],
      necessaryRereadCounterexample: "Reading another range, checking after an edit or external change, and independent review can require a reread.",
      investigativeAction: "Review the counted invocations and their task context before choosing one bounded navigation improvement.",
      matchedExperiment: "Compare the same task and required evidence with one navigation change; retain retries, refetches, overhead and inconclusive or worse results.",
      qualityGuardrail: "Preserve required output, source evidence, independent review and all mandatory regression, security and build checks.",
    },
  });
}
