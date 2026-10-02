import type { MetricEvidence, StoredSource } from "../db/source-store.js";
import type { NormalizedEvent } from "../normalize/types.js";
import { analyzeSourceFailures } from "./source-failures.js";
import type { SourceFailureAnalysis } from "./source-failures.js";

type Statuses = Readonly<Record<NormalizedEvent["status"], number>>;
type PartitionReason = "source_suppressed" | "unsupported_provider" | "unsupported_metric_contract" | "provenance_unresolved" | "no_eligible_searches" | "identity_unresolved" | null;
export type SearchRecurrenceCohort = Readonly<{
  id: string; invocationN: number; repeatN: number; eventIds: readonly string[]; evidenceObservationIds: readonly string[];
}>;
export type SearchRecurrencePartition = Readonly<{
  id: string; sessionId: string; status: "evaluated" | "unavailable"; reason: PartitionReason;
  rawSearchStatuses: Statuses; candidateSearchN: number; missingLookupN: number;
  candidateEventIds: readonly string[]; missingLookupEventIds: readonly string[];
  validSearchN: number | null; uniqueLookupN: number | null; repeatN: number | null; repeatRatio: number | null;
  cohorts: readonly SearchRecurrenceCohort[] | null;
}>;
export type SourceSearchRecurrenceAnalysis = Readonly<{
  schema: "agentprof.source-search-recurrence/v1"; metric: "completed_native_search_recurrence"; scope: "source_prefix";
  sourceId: string; provider: StoredSource["provider"]; parserVersion: number; normalizationVersion: 1; keyVersion: 1;
  revision: number; completedOffset: number; observedSize: number; persistedScope: StoredSource["persistedScope"]; availability: StoredSource["availability"];
  observationWindow: Readonly<{ unit: "source_bytes"; startInclusive: 0; endExclusive: number }>; queryPeriod: null;
  crossSourceReconciled: false; aggregationReady: false; parserResumeReady: false; sourceFreshnessChecked: false;
  assessment: "suppressed" | "unavailable" | "partial" | "evaluated";
  suppressionReason: SourceFailureAnalysis["suppressionReason"] | "unsupported_provider" | "unsupported_metric_contract";
  capabilities: MetricEvidence["capabilities"] | null;
  inventory: Readonly<{ events: number; turns: number | null; usage: number | null; observations: number | null; diagnostics: number | null; eventStatuses: Statuses }>;
  searchClassification: Readonly<{ unit: "raw_events"; nonSearch: number; inconsistentSearchClass: number; completedSearch: number; failedSearch: number; pendingSearch: number; cancelledSearch: number; unknownSearch: number }>;
  completedSearchAdmission: Readonly<{ unit: "completed_search_events"; sourceSuppressed: number; unsupportedProvider: number; unsupportedMetricContract: number; provenanceUnresolved: number; admitted: number; missingLookup: number }>;
  inheritedProvenance: Readonly<{ unit: "native_events"; unresolvedEvents: number; failures: SourceFailureAnalysis["provenance"]["failures"]; exclusions: SourceFailureAnalysis["eligibility"]["exclusions"] }>;
  partitions: readonly SearchRecurrencePartition[];
  guidance: Readonly<{ meaning: string; limitations: readonly string[]; necessaryRecurrenceCounterexample: string; investigativeAction: string; matchedExperiment: string; qualityGuardrail: string }>;
}>;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const statuses = () => ({ completed: 0, failed: 0, cancelled: 0, pending: 0, unknown: 0 });
const search = (e: NormalizedEvent) => e.kind === "search" && e.category === "search" && (e.toolName === "Grep" || e.toolName === "Glob");
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** One validated stored generation only. The existing provenance gate is evaluated exactly once. */
export function analyzeSourceSearchRecurrence(source: StoredSource): SourceSearchRecurrenceAnalysis {
  const evidence = source.evidence;
  if (source.events.length > 4096 || evidence !== null && (evidence.turns.length > 4096 || evidence.usage.length > 4096 || evidence.observations.length > 8192 || evidence.diagnostics.length > 8192)) throw new RangeError("source_search_recurrence_limit_exceeded");
  const inherited = analyzeSourceFailures(source);
  const metricSupported = source.parserVersion === 2 && evidence?.capabilities.provider === "claude" && evidence.capabilities.parserVersion === 2;
  const suppressionReason = inherited.suppressionReason ?? (source.provider !== "claude" ? "unsupported_provider" : !metricSupported ? "unsupported_metric_contract" : null);
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
  const classification = { unit: "raw_events" as const, nonSearch: 0, inconsistentSearchClass: 0, completedSearch: 0, failedSearch: 0, pendingSearch: 0, cancelledSearch: 0, unknownSearch: 0 };
  const admission = { unit: "completed_search_events" as const, sourceSuppressed: 0, unsupportedProvider: 0, unsupportedMetricContract: 0, provenanceUnresolved: 0, admitted: 0, missingLookup: 0 };
  type Bucket = { statuses: ReturnType<typeof statuses>; candidates: NormalizedEvent[] };
  const buckets = new Map<string, Bucket>();
  for (const e of source.events) {
    let bucket = buckets.get(e.sessionId); if (!bucket) { bucket = { statuses: statuses(), candidates: [] }; buckets.set(e.sessionId, bucket); }
    if (!search(e)) {
      if (e.kind === "search" || e.toolName === "Grep" || e.toolName === "Glob") classification.inconsistentSearchClass++; else classification.nonSearch++;
      continue;
    }
    bucket.statuses[e.status]++;
    const statusKey = { completed: "completedSearch", failed: "failedSearch", pending: "pendingSearch", cancelled: "cancelledSearch", unknown: "unknownSearch" } as const;
    classification[statusKey[e.status]]++;
    if (e.status !== "completed") continue;
    if (inherited.suppressionReason !== null) { admission.sourceSuppressed++; continue; }
    if (source.provider !== "claude") { admission.unsupportedProvider++; continue; }
    if (!metricSupported) { admission.unsupportedMetricContract++; continue; }
    if (!completed.has(e.id)) { admission.provenanceUnresolved++; continue; }
    admission.admitted++; bucket.candidates.push(e);
    if (e.lookupKey === null) admission.missingLookup++;
  }
  const partitions: SearchRecurrencePartition[] = [];
  let evaluated = 0;
  for (const [sessionId, bucket] of [...buckets].sort(([a], [b]) => compare(a, b))) {
    const candidates = bucket.candidates.sort((a, b) => compare(a.id, b.id));
    const missing = candidates.filter(e => e.lookupKey === null);
    const reason: PartitionReason = inherited.suppressionReason !== null ? "source_suppressed" : source.provider !== "claude" ? "unsupported_provider"
      : !metricSupported ? "unsupported_metric_contract"
      : partitionsBySession.get(sessionId)?.status === "provenance_unresolved" ? "provenance_unresolved"
      : candidates.length === 0 ? "no_eligible_searches" : missing.length > 0 ? "identity_unresolved" : null;
    let cohorts: SearchRecurrenceCohort[] | null = null;
    if (reason === null) {
      evaluated++; const files = new Map<string, NormalizedEvent[]>();
      for (const e of candidates) { const rows = files.get(e.lookupKey!); if (rows) rows.push(e); else files.set(e.lookupKey!, [e]); }
      cohorts = [];
      for (const rows of [...files.values()].sort((a, b) => compare(a[0]!.id, b[0]!.id))) {
        const observationIds = new Set<string>();
        for (const e of rows) for (const id of proofs.get(e.id) ?? []) observationIds.add(id);
        cohorts.push({ id: `search-${cohorts.length + 1}`, invocationN: rows.length, repeatN: rows.length - 1,
          eventIds: rows.map(e => e.id), evidenceObservationIds: [...observationIds].sort(compare) });
      }
    }
    const n = reason === null ? candidates.length : null, u = cohorts?.length ?? null;
    partitions.push({ id: `partition-${partitions.length + 1}`, sessionId, status: reason === null ? "evaluated" : "unavailable", reason,
      rawSearchStatuses: bucket.statuses, candidateSearchN: candidates.length, missingLookupN: missing.length,
      candidateEventIds: candidates.map(e => e.id), missingLookupEventIds: missing.map(e => e.id),
      validSearchN: n, uniqueLookupN: u, repeatN: n === null || u === null ? null : n - u,
      repeatRatio: n === null || u === null ? null : (n - u) / n, cohorts });
  }
  return freeze({ schema: "agentprof.source-search-recurrence/v1", metric: "completed_native_search_recurrence", scope: "source_prefix",
    sourceId: source.sourceId, provider: source.provider, parserVersion: source.parserVersion, normalizationVersion: source.normalizationVersion, keyVersion: source.keyVersion,
    revision: source.revision, completedOffset: source.completedOffset, observedSize: source.observedSize, persistedScope: source.persistedScope, availability: source.availability,
    observationWindow: { unit: "source_bytes", startInclusive: 0, endExclusive: source.completedOffset }, queryPeriod: null,
    crossSourceReconciled: false, aggregationReady: false, parserResumeReady: false, sourceFreshnessChecked: false,
    assessment: suppressionReason !== null ? "suppressed" : evaluated === 0 ? "unavailable" : evaluated < partitions.length ? "partial" : "evaluated", suppressionReason,
    capabilities,
    inventory: { events: inherited.inventory.events, turns: inherited.inventory.turns, usage: inherited.inventory.usage, observations: inherited.inventory.observations, diagnostics: inherited.inventory.diagnostics, eventStatuses: { ...inherited.inventory.eventStatuses } },
    searchClassification: classification, completedSearchAdmission: admission,
    inheritedProvenance: { unit: "native_events", unresolvedEvents: inherited.provenance.unresolvedEvents, failures: { ...inherited.provenance.failures }, exclusions: { ...inherited.eligibility.exclusions } },
    partitions,
    guidance: {
      meaning: "Session-local completed native search recurrence; (N-U)/N counts invocations beyond distinct exact recorded request identities.",
      limitations: ["Not complete session/history or population coverage.", "Opaque identity retains supported query, root, tool, provider version, project, options and omission distinctions; it is not regenerated or decoded here.", "Snapshot-local search aliases are not stable search names or project partitions.", "No equal-results, content, retry, waste, avoidability, time, token or savings claim.", "Inherited unresolved native terminal provenance suppresses the whole session, including uncertainty in other native tools."],
      necessaryRecurrenceCounterexample: "Checking again after an edit or external change can require the same search request.",
      investigativeAction: "Review the counted invocations and task context before choosing one bounded search-planning change.",
      matchedExperiment: "Compare the same task and required evidence with one change; retain retries, refetches, overhead and inconclusive or worse results.",
      qualityGuardrail: "Preserve required output, source evidence, independent review and all mandatory regression, security and build checks.",
    },
  });
}
