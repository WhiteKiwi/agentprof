import type { MetricEvidence, StoredSource } from "../db/source-store.js";
import type { NormalizedEvent } from "../normalize/types.js";

type Observation = MetricEvidence["observations"][number];
type Suppression = "source_unavailable" | "evidence_absent" | "state_limited" | "ambiguous_origin" | "unsupported_contract" | "unresolved_execution_relation" | null;
type Exclusion = "source_suppressed" | "model" | "unsupported_call_class" | "inconsistent_category" | "cancelled" | "pending" | "unknown_status" | "provenance_unresolved_partition";
type TimingExclusion = "missing_duration" | "invalid_duration" | "unknown_scope" | "estimated_timing" | "unknown_timing" | "unsupported_timing_representation" | "missing_timing_provenance";
type ProvenanceFailure = "missing_provenance" | "contradictory_provenance";
type Group = Readonly<Pick<NormalizedEvent, "kind" | "category" | "toolName" | "commandPattern">>;
type Statuses = Readonly<Record<NormalizedEvent["status"], number>>;
export type FailurePartition = Readonly<{
  id: string; sessionId: string; status: "evaluated" | "no_eligible_events" | "provenance_unresolved" | "source_suppressed";
  inventoryStatuses: Statuses; exclusions: Readonly<Record<Exclusion, number>>; tentativeTerminalCalls: number;
  terminalN: number | null; completedN: number | null; failedN: number | null;
  eventIds: readonly string[]; unresolvedEventIds: readonly string[];
  terminalEventIds: readonly string[]; completedEventIds: readonly string[]; failedEventIds: readonly string[];
}>;
export type FailedDuration = Readonly<{
  id: string; durationScope: NormalizedEvent["durationScope"]; timingEvidence: NormalizedEvent["timingEvidence"];
  measurementBasis: "direct" | "observed"; unit: "ms"; n: number; confirmedFailedN: number;
  sumMs: number | null; meanMs: number | null; maxMs: number; p50Ms: number; p95Ms: number; lowSampleP95: boolean;
  eventIds: readonly string[]; limitations: readonly string[];
}>;
export type FailureCohort = Readonly<{
  id: string; partitionId: string; sessionId: string; group: Group; grouping: "safe_display_cohort" | "coarse_tool_family";
  failedN: number; missingOperationIdentityN: number; missingErrorIdentityN: number;
  eventIds: readonly string[]; evidenceObservationIds: readonly string[];
  timing: Readonly<{ measuredN: number; exclusions: Readonly<Record<TimingExclusion, number>> }>;
  measurements: readonly FailedDuration[];
}>;
export type SourceFailureAnalysis = Readonly<{
  schema: "agentprof.source-failures/v1"; scope: "source_prefix"; metric: "failed_executions";
  sourceId: string; provider: StoredSource["provider"]; parserVersion: number; normalizationVersion: 1; keyVersion: 1;
  revision: number; completedOffset: number; observedSize: number; persistedScope: StoredSource["persistedScope"]; availability: StoredSource["availability"];
  observationWindow: Readonly<{ unit: "source_bytes"; startInclusive: 0; endExclusive: number }>; queryPeriod: null;
  crossSourceReconciled: false; aggregationReady: false; parserResumeReady: false; sourceFreshnessChecked: false;
  assessment: "suppressed" | "no_eligible_events" | "evaluated" | "partial"; suppressionReason: Suppression;
  failureAssessmentReason: "source_suppressed" | "no_eligible_events" | "no_evaluable_partition" | null;
  capabilities: MetricEvidence["capabilities"] | null; limitations: readonly string[];
  inventory: Readonly<{ events: number; turns: number | null; usage: number | null; observations: number | null; diagnostics: number | null; eventStatuses: Statuses; eventOutcomes: Readonly<Record<NormalizedEvent["executionOutcome"], number>> }>;
  eligibility: Readonly<{ tentativeTerminalCalls: number; admittedTerminalCalls: number; exclusions: Readonly<Record<Exclusion, number>> }>;
  provenance: Readonly<{ unresolvedEvents: number; failures: Readonly<Record<ProvenanceFailure, number>> }>;
  observationInventory: Readonly<{ knownWrapperIds: number; linkedExecutionObservations: number; orphanEventReferences: number; unlinkedObservations: number }>;
  partitions: readonly FailurePartition[]; cohorts: readonly FailureCohort[] | null;
  guidance: Readonly<{ necessaryFailureCounterexample: string; investigativeAction: string; matchedExperiment: string; qualityGuardrail: string }>;
}>;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const statuses = () => ({ completed: 0, failed: 0, cancelled: 0, pending: 0, unknown: 0 });
const exclusions = (): Record<Exclusion, number> => ({ source_suppressed: 0, model: 0, unsupported_call_class: 0, inconsistent_category: 0, cancelled: 0, pending: 0, unknown_status: 0, provenance_unresolved_partition: 0 });
const timingExclusions = (): Record<TimingExclusion, number> => ({ missing_duration: 0, invalid_duration: 0, unknown_scope: 0, estimated_timing: 0, unknown_timing: 0, unsupported_timing_representation: 0, missing_timing_provenance: 0 });
const execution = (o: Observation) => ["call", "result", "structured", "poll", "wrapper"].includes(o.representation);
const valid = (n: number | null): n is number => n !== null && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const groupKey = (e: NormalizedEvent) => JSON.stringify([e.kind, e.category, e.toolName, e.commandPattern]);
function freeze<T>(v: T): T { if (v !== null && typeof v === "object") { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } return v; }
function classReason(e: NormalizedEvent, provider: StoredSource["provider"]): Exclusion | null {
  if (e.kind === "model" || e.category === "model") return "model";
  const tool = e.toolName;
  const native = provider === "codex"
    ? e.kind === "shell" && tool === "exec_command" || e.kind === "mcp" && tool === "mcp" || e.kind === "file_edit" && tool === "apply_patch"
    : e.kind === "shell" && tool === "Bash" || e.kind === "file_read" && tool === "Read" || e.kind === "file_write" && tool === "Write"
      || e.kind === "file_edit" && tool === "Edit" || e.kind === "search" && (tool === "Grep" || tool === "Glob") || e.kind === "mcp" && tool === "mcp" || e.kind === "browser" && tool === "browser";
  if (!native) return "unsupported_call_class";
  const category = e.kind === "shell" ? ["test", "build", "search", "read", "other"].includes(e.category)
    : e.category === ({ file_read: "read", file_write: "write", file_edit: "edit", search: "search", mcp: "mcp", browser: "browser" } as Record<string, string>)[e.kind];
  return category ? null : "inconsistent_category";
}
type Proof = { failure: ProvenanceFailure | null; ids: string[]; call: boolean; decisive: Observation | null };
function provenance(e: NormalizedEvent, observations: readonly Observation[], provider: StoredSource["provider"]): Proof {
  let call: string | null = null, decisive: Observation | null = null, contradictory = e.provider !== provider;
  const structured = provider === "codex" && e.sourceRef.recordType === "event_msg";
  const supported = provider === "claude" ? e.sourceRef.recordType === "user" : structured || e.sourceRef.recordType === "response_item";
  for (const o of observations) {
    const isClaude = "observedResult" in o;
    if (o.origin !== "ordinary" || isClaude !== (provider === "claude") || isClaude && o.sessionId !== e.sessionId) { contradictory = true; continue; }
    if (o.representation === "call" && (call === null || compare(o.id, call) < 0)) call = o.id;
    if (o.sourceRef.fileId !== e.sourceRef.fileId || o.sourceRef.byteOffset !== e.sourceRef.byteOffset) continue;
    let matches = false;
    if (isClaude) {
      const r = o.observedResult;
      matches = o.representation === "result" && r !== null && r.completionKind === "invocation_result" && !r.unassignedAcknowledgement && r.isError === (e.status === "failed");
      if (o.representation !== "call" && !matches) contradictory = true;
    } else if (structured) {
      const tuple = e.status === "failed" ? e.executionOutcome === "error" && o.transportStatus === "failed"
        : e.executionOutcome === "no_match" || e.executionOutcome === "change_detected" ? e.kind === "shell" && o.transportStatus === "failed"
        : (e.executionOutcome === "success" || e.executionOutcome === "unknown") && o.transportStatus === "completed";
      matches = o.representation === "structured" && tuple;
      if (o.representation !== "call" && !matches) contradictory = true;
    } else {
      // Stored normalized terminal status + exact result position are the bounded adapter contract.
      // Result/poll transportStatus is unknown by design; it does not establish terminal status.
      matches = (o.representation === "result" || o.representation === "poll") && o.transportStatus === "unknown";
      if (o.representation !== "call" && !matches) contradictory = true;
    }
    if (matches && (decisive === null || compare(o.id, decisive.id) < 0)) decisive = o;
  }
  const requiresCall = provider === "claude" || !structured;
  const failure = contradictory || !supported ? "contradictory_provenance" : decisive === null || requiresCall && call === null ? "missing_provenance" : null;
  return { failure, ids: failure !== null ? [] : (requiresCall ? [call!, decisive!.id] : [decisive!.id]).sort(compare), call: call !== null, decisive };
}
function timingReason(e: NormalizedEvent, p: Proof, provider: StoredSource["provider"]): TimingExclusion | null {
  if (e.durationMs === null) return "missing_duration";
  if (!valid(e.durationMs)) return "invalid_duration";
  if (e.durationScope === "unknown") return "unknown_scope";
  if (e.timingEvidence === "estimated") return "estimated_timing";
  if (e.timingEvidence !== "source_reported" && e.timingEvidence !== "paired_timestamps") return "unknown_timing";
  if (provider === "codex") {
    if (e.timingEvidence === "source_reported") {
      if (p.decisive?.representation !== "structured" || !(e.kind === "shell" && e.durationScope === "process_runtime" || e.kind === "mcp" && e.durationScope === "invocation_latency")) return "unsupported_timing_representation";
    } else if (e.durationScope !== "invocation_latency" || p.decisive?.representation !== "result" && p.decisive?.representation !== "poll") return "unsupported_timing_representation";
  } else if (e.timingEvidence === "source_reported") {
    const o = p.decisive;
    if (o === null || !("observedResult" in o) || o.observedResult?.durationMs !== e.durationMs || o.observedResult.durationScope !== e.durationScope) return "missing_timing_provenance";
  } else if (e.durationScope !== "invocation_latency") return "unsupported_timing_representation";
  if (e.timingEvidence === "paired_timestamps") {
    const start = e.startAt === null ? NaN : Date.parse(e.startAt), end = e.endAt === null ? NaN : Date.parse(e.endAt);
    if (!p.call || !Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start !== e.durationMs) return "missing_timing_provenance";
    if (provider === "claude" && (p.decisive === null || !("observedResult" in p.decisive) || p.decisive.observedResult?.observedAt !== e.endAt)) return "missing_timing_provenance";
  }
  return null;
}
function checkedSum(rows: readonly NormalizedEvent[]): number | null {
  let total = 0;
  for (const e of rows) { const n = e.durationMs!; if (n > Number.MAX_SAFE_INTEGER - total) return null; total += n; if (!valid(total)) return null; }
  return total;
}

/** Pure bounded analysis of one validated readSource generation, not arbitrary JSON. */
export function analyzeSourceFailures(source: StoredSource): SourceFailureAnalysis {
  const evidence = source.evidence;
  if (source.events.length > 4096 || evidence !== null && (evidence.turns.length > 4096 || evidence.usage.length > 4096 || evidence.observations.length > 8192 || evidence.diagnostics.length > 8192)) throw new RangeError("source_failures_limit_exceeded");
  const capabilities = evidence === null ? null : { ...evidence.capabilities, observedShapes: [...evidence.capabilities.observedShapes].sort(compare) } as MetricEvidence["capabilities"];
  const eventIds = new Set(source.events.map(e => e.id)), wrappers = new Set<string>(), index = new Map<string, Observation[]>();
  const observationInventory = { knownWrapperIds: 0, linkedExecutionObservations: 0, orphanEventReferences: 0, unlinkedObservations: 0 };
  let ambiguous = false;
  for (const o of evidence?.observations ?? []) {
    if (o.origin === "ambiguous") ambiguous = true;
    if (source.provider === "codex" && o.representation === "wrapper" && o.eventId !== null) wrappers.add(o.eventId);
    if (o.eventId === null) observationInventory.unlinkedObservations++;
    else if (!eventIds.has(o.eventId)) observationInventory.orphanEventReferences++;
    else if (execution(o)) { observationInventory.linkedExecutionObservations++; const rows = index.get(o.eventId); if (rows) rows.push(o); else index.set(o.eventId, [o]); }
  }
  observationInventory.knownWrapperIds = wrappers.size;
  const suppressionReason: Suppression = source.availability !== "available" ? "source_unavailable" : evidence === null ? "evidence_absent"
    : evidence.capabilities.stateLimited || evidence.capabilities.diagnosticsDropped > 0 ? "state_limited"
    : evidence.capabilities.ambiguousRecords > 0 || ambiguous ? "ambiguous_origin"
    : !["codex", "claude"].includes(source.provider) || source.parserVersion !== 1 || evidence.capabilities.provider !== source.provider || evidence.capabilities.parserVersion !== 1 ? "unsupported_contract"
    : source.events.some(e => e.parentEventId !== null || wrappers.has(e.id)) ? "unresolved_execution_relation" : null;
  const eligibility = { tentativeTerminalCalls: 0, admittedTerminalCalls: 0, exclusions: exclusions() };
  const eventStatuses = statuses(), eventOutcomes = { success: 0, no_match: 0, change_detected: 0, error: 0, unknown: 0 };
  const diagnostics = { unresolvedEvents: 0, failures: { missing_provenance: 0, contradictory_provenance: 0 } };
  type Bucket = { rows: NormalizedEvent[]; unresolved: string[]; statuses: ReturnType<typeof statuses>; exclusions: Record<Exclusion, number> };
  const buckets = new Map<string, Bucket>(), proofs = new Map<string, Proof>();
  for (const e of source.events) {
    eventStatuses[e.status]++; eventOutcomes[e.executionOutcome]++;
    let bucket = buckets.get(e.sessionId);
    if (!bucket) { bucket = { rows: [], unresolved: [], statuses: statuses(), exclusions: exclusions() }; buckets.set(e.sessionId, bucket); }
    bucket.statuses[e.status]++;
    const reason = suppressionReason !== null ? "source_suppressed" : classReason(e, source.provider) ?? (e.status === "completed" || e.status === "failed" ? null : e.status === "pending" || e.status === "cancelled" ? e.status : "unknown_status");
    if (reason !== null) { eligibility.exclusions[reason]++; bucket.exclusions[reason]++; continue; }
    eligibility.tentativeTerminalCalls++; bucket.rows.push(e);
    const p = provenance(e, index.get(e.id) ?? [], source.provider);
    if (p.failure !== null) { diagnostics.unresolvedEvents++; diagnostics.failures[p.failure]++; bucket.unresolved.push(e.id); }
    else proofs.set(e.id, p);
  }
  const partitions: FailurePartition[] = [], cohorts: FailureCohort[] = [];
  let evaluable = false, unevaluated = false;
  for (const [sessionId, b] of [...buckets].sort(([a], [z]) => compare(a, z))) {
    b.rows.sort((a, z) => compare(a.id, z.id)); b.unresolved.sort(compare);
    const status = suppressionReason !== null ? "source_suppressed" : b.rows.length === 0 ? "no_eligible_events" : b.unresolved.length ? "provenance_unresolved" : "evaluated";
    const admitted = status === "evaluated";
    if (status === "provenance_unresolved") { b.exclusions.provenance_unresolved_partition += b.rows.length; eligibility.exclusions.provenance_unresolved_partition += b.rows.length; }
    const failed = admitted ? b.rows.filter(e => e.status === "failed") : [], completed = admitted ? b.rows.filter(e => e.status === "completed") : [];
    const partition: FailurePartition = { id: `partition-${partitions.length + 1}`, sessionId, status, inventoryStatuses: b.statuses, exclusions: b.exclusions, tentativeTerminalCalls: b.rows.length,
      terminalN: admitted ? b.rows.length : null, completedN: admitted ? completed.length : null, failedN: admitted ? failed.length : null,
      eventIds: b.rows.map(e => e.id), unresolvedEventIds: b.unresolved, terminalEventIds: admitted ? b.rows.map(e => e.id) : [], completedEventIds: completed.map(e => e.id), failedEventIds: failed.map(e => e.id) };
    partitions.push(partition);
    if (!admitted) { unevaluated = true; continue; }
    evaluable = true; eligibility.admittedTerminalCalls += b.rows.length;
    const groups = new Map<string, NormalizedEvent[]>();
    for (const e of failed) { const key = groupKey(e), rows = groups.get(key); if (rows) rows.push(e); else groups.set(key, [e]); }
    for (const [, rows] of [...groups].sort(([a], [z]) => compare(a, z))) {
      const first = rows[0]!, timing = { measuredN: 0, exclusions: timingExclusions() }, measured = new Map<string, NormalizedEvent[]>();
      const refs: string[] = []; let missingOperationIdentityN = 0, missingErrorIdentityN = 0;
      for (const e of rows) {
        const proof = proofs.get(e.id)!;
        for (const ref of proof.ids) refs.push(ref);
        if (e.operationKey === null) missingOperationIdentityN++;
        if (e.errorFingerprint === null) missingErrorIdentityN++;
        const reason = timingReason(e, proof, source.provider);
        if (reason !== null) { timing.exclusions[reason]++; continue; }
        timing.measuredN++;
        const key = JSON.stringify([e.durationScope, e.timingEvidence]), samples = measured.get(key); if (samples) samples.push(e); else measured.set(key, [e]);
      }
      const measurements: FailedDuration[] = [];
      for (const [, samples] of [...measured].sort(([a], [z]) => compare(a, z))) {
        const e = samples[0]!, n = samples.length, sumMs = checkedSum(samples), ordered = [...samples].sort((a, z) => a.durationMs! - z.durationMs! || compare(a.id, z.id));
        measurements.push({ id: `measurement-${measurements.length + 1}`, durationScope: e.durationScope, timingEvidence: e.timingEvidence, measurementBasis: e.timingEvidence === "source_reported" ? "direct" : "observed", unit: "ms", n, confirmedFailedN: rows.length,
          sumMs, meanMs: sumMs === null ? null : sumMs / n, maxMs: ordered[n - 1]!.durationMs!, p50Ms: ordered[Math.ceil(n * 0.5) - 1]!.durationMs!, p95Ms: ordered[Math.ceil(n * 0.95) - 1]!.durationMs!, lowSampleP95: n < 20, eventIds: samples.map(row => row.id),
          limitations: ["recorded_duration_not_elapsed_or_savings", ...(sumMs === null ? ["numeric_overflow"] : []), ...(n < 20 ? ["low_sample_p95"] : []), ...(source.provider === "claude" && e.timingEvidence === "source_reported" ? ["claude_direct_duration_synthetic_contract_only"] : [])] });
      }
      cohorts.push({ id: `cohort-${cohorts.length + 1}`, partitionId: partition.id, sessionId, group: { kind: first.kind, category: first.category, toolName: first.toolName, commandPattern: first.commandPattern }, grouping: first.kind === "mcp" || first.kind === "browser" ? "coarse_tool_family" : "safe_display_cohort",
        failedN: rows.length, missingOperationIdentityN, missingErrorIdentityN, eventIds: rows.map(e => e.id), evidenceObservationIds: refs.sort(compare), timing, measurements });
    }
  }
  const partialCoverage = capabilities?.coverage === "partial" || (capabilities?.unsupportedRecords ?? 0) > 0;
  const excluded = Object.values(eligibility.exclusions).some(n => n > 0);
  return freeze({ schema: "agentprof.source-failures/v1", scope: "source_prefix", metric: "failed_executions", sourceId: source.sourceId, provider: source.provider, parserVersion: source.parserVersion, normalizationVersion: source.normalizationVersion, keyVersion: source.keyVersion, revision: source.revision, completedOffset: source.completedOffset, observedSize: source.observedSize, persistedScope: source.persistedScope, availability: source.availability,
    observationWindow: { unit: "source_bytes", startInclusive: 0, endExclusive: source.completedOffset }, queryPeriod: null, crossSourceReconciled: false, aggregationReady: false, parserResumeReady: false, sourceFreshnessChecked: false,
    assessment: suppressionReason !== null ? "suppressed" : eligibility.tentativeTerminalCalls === 0 ? "no_eligible_events" : partialCoverage || excluded || unevaluated ? "partial" : "evaluated", suppressionReason,
    failureAssessmentReason: suppressionReason !== null ? "source_suppressed" : eligibility.tentativeTerminalCalls === 0 ? "no_eligible_events" : !evaluable ? "no_evaluable_partition" : null,
    capabilities, limitations: ["admitted_source_local_subset_only", "native_records_not_physical_execution_proof", "display_cohort_not_same_operation_or_error", "no_complete_population_denominator", "no_global_failure_rate", "no_retry_recovery_waste_or_savings", "codex_generic_nonzero_status_may_be_unknown", ...(partialCoverage ? ["partial_shape_coverage"] : []), ...(excluded ? ["excluded_events"] : [])],
    inventory: { events: source.events.length, turns: evidence?.turns.length ?? null, usage: evidence?.usage.length ?? null, observations: evidence?.observations.length ?? null, diagnostics: evidence?.diagnostics.length ?? null, eventStatuses, eventOutcomes }, eligibility, provenance: diagnostics, observationInventory, partitions, cohorts: evaluable ? cohorts : null,
    guidance: { necessaryFailureCounterexample: "Intentional negative tests and expected failure probes can be necessary; a confirmed failed call is not proof of unnecessary work.",
      investigativeAction: "Use the bounded event evidence to inspect one supported setup or input correction locally. Safe display labels do not identify the same task or error; identify coarse MCP/browser invocations before acting. If no correction is supported, leave the evidence non-actionable.",
      matchedExperiment: "Optionally compare one setup/input change under matched task/repository revision, provider/model/configuration, cache state and workload/sample selection. Measure complete-cycle task elapsed and unique usage separately, including setup overhead and extra retries. Retain none, worse, noisy and incomparable outcomes; this analyzer has not run an experiment.",
      qualityGuardrail: "Preserve output completeness and success criteria, mandatory full validation, security/build/regression gates and defect detection. Never hide failures or disable checks to improve counts. Synthetic evidence does not establish real-user usefulness, causal effect or savings." } });
}
