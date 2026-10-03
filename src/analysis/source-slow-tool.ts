import type { MetricEvidence, StoredSource } from "../db/source-store.js";
import type { NormalizedEvent } from "../normalize/types.js";

type Observation = MetricEvidence["observations"][number];
type Capabilities = MetricEvidence["capabilities"];
type Suppression = "source_unavailable" | "evidence_absent" | "state_limited" | "ambiguous_origin" | "unsupported_contract" | "unresolved_execution_relation" | null;
type Exclusion = "source_suppressed" | "model" | "unsupported_call_class" | "inconsistent_category" | "cancelled" | "pending" | "unknown_status" | "missing_duration" | "invalid_duration" | "unknown_scope" | "estimated_timing" | "unknown_timing" | "identity_unresolved_partition";
type ProvenanceFailure = "contradictory_provenance" | "missing_provenance" | "unsupported_timing_representation";
type PartitionStatus = "evaluated" | "zero_denominator" | "numeric_overflow" | "identity_unresolved";
type Group = Readonly<Pick<NormalizedEvent, "kind" | "category" | "toolName" | "commandPattern">>;
type PartitionKey = Readonly<Pick<NormalizedEvent, "sessionId" | "durationScope" | "timingEvidence">>;
type Thresholds = Readonly<{ minimumTimedCalls: 5; minimumDurationShare: 0.2; p95LowSampleBelow: 20 }>;
export type SlowToolPartition = PartitionKey & Readonly<{
  id: string; status: PartitionStatus; tentativeTimedCalls: number; denominatorN: number | null;
  denominatorSumMs: number | null; unit: "ms"; eventIds: readonly string[]; unresolvedEventIds: readonly string[];
}>;
export type SourceSlowToolCandidate = Readonly<{
  id: string; ruleId: "slow-tool"; ruleVersion: "source-prefix-v1"; severity: "NOTICE"; thresholds: Thresholds;
  partitionId: string; observationWindowRef: "source.observationWindow"; sourceContextRef: "source";
  sessionId: string; group: Group; grouping: "coarse_tool_family" | "safe_display_cohort";
  durationScope: NormalizedEvent["durationScope"]; timingEvidence: NormalizedEvent["timingEvidence"];
  measurementBasis: "direct" | "observed";
  n: number; sumMs: number; meanMs: number; maxMs: number; p50Ms: number; p95Ms: number; lowSampleP95: boolean;
  denominatorN: number; denominatorSumMs: number; unit: "ms"; observedEligibleNativeToolDurationShare: number;
  evidenceEventIds: readonly string[]; evidenceObservationIds: readonly string[]; includedEventIds: readonly string[];
  confidence: Readonly<{ pattern: "candidate"; avoidableWork: "unestablished"; rootCause: "unestablished"; effect: "unestablished" }>;
  limitations: readonly string[]; necessaryWorkCounterexample: string;
  investigativeAction: string; matchedExperiment: string; qualityGuardrail: string;
}>;
export type SourceSlowToolAnalysis = Readonly<{
  schema: "agentprof.source-slow-tool/v1"; scope: "source_prefix";
  sourceId: string; provider: StoredSource["provider"]; parserVersion: number; normalizationVersion: 1; keyVersion: 1;
  revision: number; completedOffset: number; observedSize: number; persistedScope: StoredSource["persistedScope"]; availability: StoredSource["availability"];
  observationWindow: Readonly<{ unit: "source_bytes"; startInclusive: 0; endExclusive: number }>; queryPeriod: null;
  crossSourceReconciled: false; aggregationReady: false; parserResumeReady: false; sourceFreshnessChecked: false;
  ruleId: "slow-tool"; ruleVersion: "source-prefix-v1"; thresholds: Thresholds;
  assessment: "suppressed" | "no_eligible_events" | "evaluated" | "partial";
  suppressionReason: Suppression; candidateAssessmentReason: "source_suppressed" | "no_eligible_events" | "no_evaluable_partition" | null;
  capabilities: Capabilities | null; limitations: readonly string[];
  inventory: Readonly<{ events: number; turns: number | null; usage: number | null; observations: number | null; diagnostics: number | null;
    eventStatuses: Readonly<Record<NormalizedEvent["status"], number>>; eventOutcomes: Readonly<Record<NormalizedEvent["executionOutcome"], number>> }>;
  eligibility: Readonly<{ tentativeTimedCalls: number; admittedTimedCalls: number; exclusions: Readonly<Record<Exclusion, number>> }>;
  provenance: Readonly<{ unresolvedEvents: number; failures: Readonly<Record<ProvenanceFailure, number>> }>;
  observationInventory: Readonly<{ knownWrapperIds: number; linkedExecutionObservations: number; orphanEventReferences: number; unlinkedObservations: number }>;
  partitions: readonly SlowToolPartition[]; candidates: readonly SourceSlowToolCandidate[] | null;
}>;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const valid = (n: number | null): n is number => n !== null && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const executionObservation = (o: Observation): boolean => ["call", "result", "structured", "poll", "wrapper"].includes(o.representation);
const thresholds = (): Thresholds => ({ minimumTimedCalls: 5, minimumDurationShare: 0.2, p95LowSampleBelow: 20 });
// Only freshly allocated result objects reach this function; inputs remain untouched.
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function sum(rows: readonly NormalizedEvent[]): number | null {
  let total = 0;
  // The caller supplies event-ID order, independently of duration/quantile order.
  for (const row of rows) {
    const n = row.durationMs!;
    if (!valid(n) || n > Number.MAX_SAFE_INTEGER - total) return null;
    total += n;
    if (!valid(total)) return null;
  }
  return total;
}
function classReason(e: NormalizedEvent, provider: StoredSource["provider"]): Exclusion | null {
  if (e.kind === "model" || e.category === "model") return "model";
  const tool = e.toolName;
  const native = provider === "codex"
    ? e.kind === "shell" && tool === "exec_command" || e.kind === "mcp" && tool === "mcp" || e.kind === "file_edit" && tool === "apply_patch"
    : e.kind === "shell" && tool === "Bash" || e.kind === "file_read" && tool === "Read" || e.kind === "file_write" && tool === "Write"
      || e.kind === "file_edit" && tool === "Edit" || e.kind === "search" && (tool === "Grep" || tool === "Glob")
      || e.kind === "mcp" && tool === "mcp" || e.kind === "browser" && tool === "browser";
  if (!native) return "unsupported_call_class";
  const category = e.kind === "shell" ? ["test", "build", "search", "read", "other"].includes(e.category)
    : e.category === ({ file_read: "read", file_write: "write", file_edit: "edit", search: "search", mcp: "mcp", browser: "browser" } as Record<string, string>)[e.kind];
  return category ? null : "inconsistent_category";
}
function timingReason(e: NormalizedEvent): Exclusion | null {
  if (e.status === "cancelled" || e.status === "pending") return e.status;
  if (e.status !== "completed" && e.status !== "failed") return "unknown_status";
  if (e.durationMs === null) return "missing_duration";
  if (!valid(e.durationMs)) return "invalid_duration";
  if (e.durationScope === "unknown") return "unknown_scope";
  if (e.timingEvidence === "estimated") return "estimated_timing";
  if (e.timingEvidence !== "source_reported" && e.timingEvidence !== "paired_timestamps") return "unknown_timing";
  return null;
}
function provenance(e: NormalizedEvent, observations: readonly Observation[], provider: StoredSource["provider"]): { failure: ProvenanceFailure | null; ids: string[] } {
  let call: string | null = null, decisive: string | null = null;
  let contradictory = e.provider !== provider;
  const supported = provider === "codex" ? e.timingEvidence === "source_reported"
    ? e.kind === "shell" && e.durationScope === "process_runtime" || e.kind === "mcp" && e.durationScope === "invocation_latency"
    : e.durationScope === "invocation_latency"
    : e.timingEvidence === "source_reported" || e.durationScope === "invocation_latency";
  for (const o of observations) {
    if (!executionObservation(o)) continue;
    const claude = "observedResult" in o;
    if (o.origin !== "ordinary" || claude !== (provider === "claude") || claude && o.sessionId !== e.sessionId) { contradictory = true; continue; }
    if (o.representation === "call" && (call === null || compare(o.id, call) < 0)) call = o.id;
    if (o.sourceRef.fileId !== e.sourceRef.fileId || o.sourceRef.byteOffset !== e.sourceRef.byteOffset) continue;
    let matches = false;
    if (claude) {
      const r = o.observedResult;
      matches = o.representation === "result" && r !== null && r.completionKind === "invocation_result" && !r.unassignedAcknowledgement
        && r.observedAt === e.endAt && r.isError === (e.status === "failed")
        && (e.timingEvidence !== "source_reported" || r.durationMs === e.durationMs && r.durationScope === e.durationScope);
      // A decisive-position result cannot be discarded in favor of a convenient duplicate.
      if (o.representation === "result" && !matches) contradictory = true;
    } else if (e.timingEvidence === "source_reported") {
      matches = o.representation === "structured" && (o.transportStatus === "completed" || o.transportStatus === "failed");
      if (o.representation === "structured" && !matches) contradictory = true;
    } else matches = o.representation === "result" || o.representation === "poll";
    if (matches && (decisive === null || compare(o.id, decisive) < 0)) decisive = o.id;
  }
  if (contradictory) return { failure: "contradictory_provenance", ids: [] };
  if (!supported) return { failure: "unsupported_timing_representation", ids: [] };
  const requiresCall = provider === "claude" || e.timingEvidence === "paired_timestamps";
  if (decisive === null || requiresCall && call === null) return { failure: "missing_provenance", ids: [] };
  return { failure: null, ids: (requiresCall ? [call!, decisive] : [decisive]).sort(compare) };
}
const partitionKey = (e: NormalizedEvent): string => JSON.stringify([e.sessionId, e.durationScope, e.timingEvidence]);
const groupKey = (e: NormalizedEvent): string => JSON.stringify([e.kind, e.category, e.toolName, e.commandPattern]);

/** Pure internal rule for one non-null, validated readSource generation, not arbitrary JSON. */
export function analyzeSourceSlowTool(source: StoredSource): SourceSlowToolAnalysis {
  const evidence = source.evidence;
  if (source.events.length > 4096 || evidence !== null && (evidence.turns.length > 4096 || evidence.usage.length > 4096 || evidence.observations.length > 8192 || evidence.diagnostics.length > 8192)) {
    throw new RangeError("source_slow_tool_limit_exceeded");
  }
  const capabilities = evidence === null ? null : { ...evidence.capabilities, observedShapes: [...evidence.capabilities.observedShapes].sort(compare) } as Capabilities;
  const eventIds = new Set(source.events.map(e => e.id)), wrappers = new Set<string>(), index = new Map<string, Observation[]>();
  const observationInventory = { knownWrapperIds: 0, linkedExecutionObservations: 0, orphanEventReferences: 0, unlinkedObservations: 0 };
  let ambiguous = false;
  for (const o of evidence?.observations ?? []) {
    if (o.origin === "ambiguous") ambiguous = true;
    if (source.provider === "codex" && o.representation === "wrapper" && o.eventId !== null) wrappers.add(o.eventId);
    if (o.eventId === null) observationInventory.unlinkedObservations++;
    else if (!eventIds.has(o.eventId)) observationInventory.orphanEventReferences++;
    else if (executionObservation(o)) {
      observationInventory.linkedExecutionObservations++;
      const rows = index.get(o.eventId); if (rows) rows.push(o); else index.set(o.eventId, [o]);
    }
  }
  observationInventory.knownWrapperIds = wrappers.size;
  const suppressionReason: Suppression = source.availability !== "available" ? "source_unavailable" : evidence === null ? "evidence_absent"
    : evidence.capabilities.stateLimited || evidence.capabilities.diagnosticsDropped > 0 ? "state_limited"
    : evidence.capabilities.ambiguousRecords > 0 || ambiguous ? "ambiguous_origin"
    : (source.provider === "codex" ? source.parserVersion !== 1 && source.parserVersion !== 2 : source.parserVersion !== 1 && source.parserVersion !== 2 && source.parserVersion !== 3) || evidence.capabilities.provider !== source.provider || evidence.capabilities.parserVersion !== source.parserVersion ? "unsupported_contract"
    : source.events.some(e => e.parentEventId !== null || wrappers.has(e.id)) ? "unresolved_execution_relation" : null;
  const eligibility = { tentativeTimedCalls: 0, admittedTimedCalls: 0, exclusions: { source_suppressed: 0, model: 0, unsupported_call_class: 0, inconsistent_category: 0, cancelled: 0, pending: 0, unknown_status: 0, missing_duration: 0, invalid_duration: 0, unknown_scope: 0, estimated_timing: 0, unknown_timing: 0, identity_unresolved_partition: 0 } };
  const eventStatuses = { completed: 0, failed: 0, cancelled: 0, pending: 0, unknown: 0 }, eventOutcomes = { success: 0, no_match: 0, change_detected: 0, error: 0, unknown: 0 };
  const diagnostics = { unresolvedEvents: 0, failures: { contradictory_provenance: 0, missing_provenance: 0, unsupported_timing_representation: 0 } };
  const partitions = new Map<string, { rows: NormalizedEvent[]; unresolved: string[] }>(), proofs = new Map<string, string[]>();
  for (const e of source.events) {
    eventStatuses[e.status]++; eventOutcomes[e.executionOutcome]++;
    const reason = suppressionReason !== null ? "source_suppressed" : classReason(e, source.provider) ?? timingReason(e);
    if (reason !== null) { eligibility.exclusions[reason]++; continue; }
    eligibility.tentativeTimedCalls++;
    const key = partitionKey(e), partition = partitions.get(key) ?? { rows: [], unresolved: [] };
    if (!partitions.has(key)) partitions.set(key, partition);
    partition.rows.push(e);
    const proof = provenance(e, index.get(e.id) ?? [], source.provider);
    if (proof.failure !== null) { diagnostics.unresolvedEvents++; diagnostics.failures[proof.failure]++; partition.unresolved.push(e.id); }
    else proofs.set(e.id, proof.ids);
  }
  const results: SlowToolPartition[] = [], cards: SourceSlowToolCandidate[] = [];
  let evaluable = false, unevaluated = false;
  for (const [, p] of [...partitions].sort(([a], [b]) => compare(a, b))) {
    p.rows.sort((a, b) => compare(a.id, b.id)); p.unresolved.sort(compare);
    const first = p.rows[0]!, identityUnresolved = p.unresolved.length > 0;
    const total = identityUnresolved ? null : sum(p.rows);
    const status: PartitionStatus = identityUnresolved ? "identity_unresolved" : total === null ? "numeric_overflow" : total === 0 ? "zero_denominator" : "evaluated";
    const partition: SlowToolPartition = { id: `partition-${results.length + 1}`, sessionId: first.sessionId, durationScope: first.durationScope, timingEvidence: first.timingEvidence,
      status, tentativeTimedCalls: p.rows.length, denominatorN: identityUnresolved ? null : p.rows.length, denominatorSumMs: total, unit: "ms",
      eventIds: p.rows.map(e => e.id), unresolvedEventIds: p.unresolved };
    results.push(partition);
    if (identityUnresolved) eligibility.exclusions.identity_unresolved_partition += p.rows.length;
    else eligibility.admittedTimedCalls += p.rows.length;
    if (status === "identity_unresolved" || status === "numeric_overflow") { unevaluated = true; continue; }
    evaluable = true;
    if (total === 0) continue;
    const groups = new Map<string, NormalizedEvent[]>();
    for (const e of p.rows) { const key = groupKey(e), rows = groups.get(key); if (rows) rows.push(e); else groups.set(key, [e]); }
    const matches: { key: string; rows: NormalizedEvent[]; sum: number }[] = [];
    for (const [key, rows] of groups) {
      if (rows.length < 5) continue;
      const groupSum = sum(rows);
      if (groupSum !== null && groupSum / total! >= 0.2) matches.push({ key, rows, sum: groupSum });
    }
    matches.sort((a, b) => b.sum - a.sum || b.rows.length - a.rows.length || compare(a.key, b.key));
    for (const match of matches) {
      const rows = match.rows, e = rows[0]!, n = rows.length, coarse = e.kind === "mcp" || e.kind === "browser";
      const ordered = [...rows].sort((a, b) => a.durationMs! - b.durationMs! || compare(a.id, b.id));
      cards.push({ id: `candidate-${cards.length + 1}`, ruleId: "slow-tool", ruleVersion: "source-prefix-v1", severity: "NOTICE", thresholds: thresholds(),
        partitionId: partition.id, observationWindowRef: "source.observationWindow", sourceContextRef: "source", sessionId: e.sessionId,
        group: { kind: e.kind, category: e.category, toolName: e.toolName, commandPattern: e.commandPattern }, grouping: coarse ? "coarse_tool_family" : "safe_display_cohort",
        durationScope: e.durationScope, timingEvidence: e.timingEvidence, measurementBasis: e.timingEvidence === "source_reported" ? "direct" : "observed",
        n, sumMs: match.sum, meanMs: match.sum / n, maxMs: ordered[n - 1]!.durationMs!, p50Ms: ordered[Math.ceil(0.5 * n) - 1]!.durationMs!, p95Ms: ordered[Math.ceil(0.95 * n) - 1]!.durationMs!, lowSampleP95: n < 20,
        denominatorN: p.rows.length, denominatorSumMs: total!, unit: "ms", observedEligibleNativeToolDurationShare: match.sum / total!,
        evidenceEventIds: rows.map(row => row.id), evidenceObservationIds: rows.flatMap(row => proofs.get(row.id)!).sort(compare), includedEventIds: [],
        confidence: { pattern: "candidate", avoidableWork: "unestablished", rootCause: "unestablished", effect: "unestablished" },
        limitations: ["admitted_source_local_subset_only", "display_cohort_not_same_operation", "native_records_not_physical_execution_proof", "not_backend_or_network_latency", "not_waste_or_predicted_savings", ...(coarse ? ["coarse_tool_family"] : []), ...(n < 20 ? ["low_sample_p95"] : []), ...(source.provider === "claude" && e.timingEvidence === "source_reported" ? ["claude_direct_duration_synthetic_contract_only"] : [])],
        necessaryWorkCounterexample: "Five required full regression/build or complete retrieval calls can exceed 20% and all remain necessary. An only-tool workload naturally has 100% admitted share; this does not justify removing calls.",
        investigativeAction: `${coarse ? "First identify the particular invocation locally from authorized source context; the endpoint and target are unknown here. " : ""}Review this bounded evidence group for one supported input/target restriction preserving the exact required result. If none is established, leave the candidate non-actionable.`,
        matchedExperiment: "Compare the original path and that one restricted-input/target path on the same task/repository revision, provider/model/configuration, cache state and workload/sample selection. Record per-call n, same-scope distribution/sum and complete-cycle outcomes including extra retries/refetches and narrowing overhead. Compare task elapsed or full unique usage only when separately measured with proper boundaries/denominators. Retain effect-none, worse, noisy and incomparable outcomes; no fixed improvement is promised.",
        qualityGuardrail: "Preserve required answers/evidence, output completeness, success criteria, regression/security/build gates and mandatory full validation. Targeted-first ordering must still perform required full validation. Lower duration fails if correctness, required coverage or defect detection worsens. Synthetic checks alone establish no real-user usefulness, precision or causal effect.",
      });
    }
  }
  const partialCoverage = capabilities?.coverage === "partial" || (capabilities?.unsupportedRecords ?? 0) > 0;
  const excluded = Object.values(eligibility.exclusions).some(n => n > 0);
  const assessment = suppressionReason !== null ? "suppressed" : results.length === 0 ? "no_eligible_events" : partialCoverage || unevaluated || excluded ? "partial" : "evaluated";
  return freeze({ schema: "agentprof.source-slow-tool/v1", scope: "source_prefix", sourceId: source.sourceId, provider: source.provider,
    parserVersion: source.parserVersion, normalizationVersion: source.normalizationVersion, keyVersion: source.keyVersion, revision: source.revision,
    completedOffset: source.completedOffset, observedSize: source.observedSize, persistedScope: source.persistedScope, availability: source.availability,
    observationWindow: { unit: "source_bytes", startInclusive: 0, endExclusive: source.completedOffset }, queryPeriod: null,
    crossSourceReconciled: false, aggregationReady: false, parserResumeReady: false, sourceFreshnessChecked: false,
    ruleId: "slow-tool", ruleVersion: "source-prefix-v1", thresholds: thresholds(), assessment, suppressionReason,
    candidateAssessmentReason: suppressionReason !== null ? "source_suppressed" : results.length === 0 ? "no_eligible_events" : !evaluable ? "no_evaluable_partition" : null,
    capabilities, limitations: ["source_local_only", "observed_eligible_native_call_subset", "no_physical_execution_reconciliation", "no_complete_population_denominator", "no_interval_aggregation", ...(partialCoverage ? ["partial_shape_coverage"] : []), ...(excluded ? ["excluded_events"] : [])],
    inventory: { events: source.events.length, turns: evidence?.turns.length ?? null, usage: evidence?.usage.length ?? null, observations: evidence?.observations.length ?? null, diagnostics: evidence?.diagnostics.length ?? null, eventStatuses, eventOutcomes },
    eligibility, provenance: diagnostics, observationInventory, partitions: results, candidates: evaluable ? cards : null,
  });
}
