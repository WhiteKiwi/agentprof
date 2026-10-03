import type { MetricEvidence, StoredSource } from "../db/source-store.js";
import type { NormalizedEvent } from "../normalize/types.js";
import type { SourceObservation } from "../parsers/types.js";
import { analyzeSourceFailures } from "./source-failures.js";
import type { SourceFailureAnalysis } from "./source-failures.js";

type IntervalScope = "invocation_latency" | "item_lifecycle";
type IntervalEvidence = "paired_timestamps" | "source_reported";
type SessionReason = "source_suppressed" | "provenance_unresolved" | "missing_operation_identity" | "missing_turn_identity" | "unavailable_groups";
type GroupReason = "session_unavailable" | "operation_class_conflict" | "terminal_not_admitted" | "pending_attempt" | "cancelled_attempt" | "unknown_status"
  | "unconfirmed_outcome" | "missing_boundaries" | "invalid_boundaries" | "unsupported_interval" | "mixed_interval_evidence"
  | "missing_turn_proof" | "missing_call_before_result" | "contradictory_turn_proof" | "missing_terminal_proof"
  | "inconsistent_source_file" | "ambiguous_source_order" | "tied_boundaries" | "overlapping_attempts" | "source_time_order_conflict" | "unsafe_recovery_elapsed";
type OperationClass = Readonly<Pick<NormalizedEvent, "kind" | "category" | "toolName">>;
export type RecoveryPartition = Readonly<{
  id: string; sessionId: string; status: "evaluated" | "partial" | "unavailable" | "no_candidate_operations";
  reasons: readonly SessionReason[]; candidateAttemptN: number; groupIds: readonly string[];
  missingOperationEventIds: readonly string[]; missingTurnEventIds: readonly string[];
  unassignedFailedEventIds: readonly string[]; unresolvedProvenanceEventIds: readonly string[];
}>;
export type RecoveryGroup = Readonly<{
  id: string; partitionId: string; turnId: string; operationClass: OperationClass | null;
  status: "evaluated" | "unavailable"; reasons: readonly GroupReason[];
  intervalScope: IntervalScope | null; intervalTimingEvidence: IntervalEvidence | null;
  attemptN: number; knownFailedAttemptN: number; eventIds: readonly string[];
  blockedFailedEventIds: readonly string[]; evidenceObservationIds: readonly string[];
  successesOutsideChains: number | null; resolvedChainN: number | null; unresolvedChainN: number | null;
}>;
export type RecoveryChain = Readonly<{
  id: string; groupId: string; sessionId: string; turnId: string;
  intervalScope: IntervalScope; intervalTimingEvidence: IntervalEvidence;
  failedEventIds: readonly string[]; successfulEventId: string | null; evidenceObservationIds: readonly string[];
  firstFailedResultAt: string; successfulResultAt: string | null;
  failedAttemptCount: number; attemptCount: number; resolved: boolean; recoveryElapsedMs: number | null;
}>;
export type RecoveryDistribution = Readonly<{
  id: string; sessionId: string; intervalScope: IntervalScope; intervalTimingEvidence: IntervalEvidence;
  unit: "ms"; resolvedOnly: true; n: number; minMs: number; maxMs: number; p50Ms: number; p95Ms: number;
  lowSampleP95: boolean; chainIds: readonly string[];
}>;
export type SourceRecoveryAnalysis = Readonly<{
  schema: "agentprof.source-recovery/v1"; scope: "source_prefix"; metric: "recovery_elapsed_time"; version: "codex-same-turn-operation-v1";
  sourceId: string; provider: StoredSource["provider"]; parserVersion: number; normalizationVersion: 1; keyVersion: 1;
  revision: number; completedOffset: number; observedSize: number; availability: StoredSource["availability"]; persistedScope: StoredSource["persistedScope"];
  observationWindow: Readonly<{ unit: "source_bytes"; startInclusive: 0; endExclusive: number }>; queryPeriod: null;
  crossSourceReconciled: false; aggregationReady: false; parserResumeReady: false; sourceFreshnessChecked: false;
  assessment: "suppressed" | "no_eligible_events" | "evaluated" | "partial";
  suppressionReason: SourceFailureAnalysis["suppressionReason"];
  recoveryAssessmentReason: "source_suppressed" | "no_candidate_operations" | "no_evaluable_groups" | null;
  capabilities: MetricEvidence["capabilities"] | null;
  inventory: SourceFailureAnalysis["inventory"];
  classification: Readonly<{ candidateAttempts: number; modelExcluded: number; unsupportedClassExcluded: number }>;
  inheritedProvenance: Readonly<{ unresolvedEvents: number; failures: SourceFailureAnalysis["provenance"]["failures"]; exclusions: SourceFailureAnalysis["eligibility"]["exclusions"] }>;
  summary: Readonly<{ evaluatedGroups: number; unavailableGroups: number; unavailableSessions: number; knownFailedAttempts: number; unavailableKnownFailedAttempts: number; resolvedChains: number | null; unresolvedChains: number | null }>;
  partitions: readonly RecoveryPartition[]; groups: readonly RecoveryGroup[]; chains: readonly RecoveryChain[] | null; distributions: readonly RecoveryDistribution[] | null;
  limitations: readonly string[];
}>;

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const validDifference = (end: number, start: number): boolean => Number.isSafeInteger(end - start) && end >= start;
const nativeCandidate = (e: NormalizedEvent): boolean => e.kind === "shell" && e.toolName === "exec_command" || e.kind === "mcp" && e.toolName === "mcp";
const classKey = (e: NormalizedEvent): string => JSON.stringify([e.kind, e.category, e.toolName]);
function freeze<T>(value: T): T { if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function add<K, V>(map: Map<K, V[]>, key: K, value: V): void { const rows = map.get(key); if (rows) rows.push(value); else map.set(key, [value]); }

type Position = { start: number; end: number; scope: IntervalScope; evidence: IntervalEvidence; ids: string[] };
function position(e: NormalizedEvent, observations: readonly SourceObservation[], reasons: Set<GroupReason>): Position | null {
  if (e.startAt === null || e.endAt === null) { reasons.add("missing_boundaries"); return null; }
  const start = Date.parse(e.startAt), end = Date.parse(e.endAt);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !validDifference(end, start)) { reasons.add("invalid_boundaries"); return null; }
  const structured = e.intervalScope === "item_lifecycle" && e.intervalTimingEvidence === "source_reported" && e.sourceRef.recordType === "event_msg";
  const paired = e.intervalScope === "invocation_latency" && e.intervalTimingEvidence === "paired_timestamps" && e.sourceRef.recordType === "response_item";
  if (!structured && !paired) { reasons.add("unsupported_interval"); return null; }
  let call: SourceObservation | null = null, decisive: SourceObservation | null = null, badTurn = false;
  for (const o of observations) {
    // Native terminal admission already rejects contradictory provider/origin evidence.
    // Only the selected event's own source and decisive representation support this interval.
    if (o.origin !== "ordinary" || o.sourceRef.fileId !== e.sourceRef.fileId) continue;
    if (paired && o.representation === "call" && o.sourceRef.byteOffset < e.sourceRef.byteOffset) {
      if (o.turnId !== e.turnId) badTurn = true;
      else if (call === null || o.sourceRef.byteOffset < call.sourceRef.byteOffset || o.sourceRef.byteOffset === call.sourceRef.byteOffset && compare(o.id, call.id) < 0) call = o;
    }
    if (o.sourceRef.byteOffset !== e.sourceRef.byteOffset || (structured ? o.representation !== "structured" : o.representation !== "result" && o.representation !== "poll")) continue;
    if (structured ? o.turnId !== e.turnId : o.turnId !== null && o.turnId !== e.turnId) badTurn = true;
    if (decisive === null || compare(o.id, decisive.id) < 0) decisive = o;
  }
  if (badTurn) reasons.add("contradictory_turn_proof");
  if (decisive === null) reasons.add("missing_terminal_proof");
  if (paired && call === null) reasons.add(observations.some(o => o.representation === "call" && o.sourceRef.fileId === e.sourceRef.fileId && o.sourceRef.byteOffset < e.sourceRef.byteOffset) ? "missing_turn_proof" : "missing_call_before_result");
  if (badTurn || decisive === null || paired && call === null) return null;
  return { start, end, scope: structured ? "item_lifecycle" : "invocation_latency", evidence: structured ? "source_reported" : "paired_timestamps", ids: (paired ? [call!.id, decisive.id] : [decisive.id]).sort(compare) };
}

/** Pure bounded analysis of one validated readSource generation; source logs stay unopened. */
export function analyzeSourceRecovery(source: StoredSource): SourceRecoveryAnalysis {
  const evidence = source.evidence;
  if (source.events.length > 4096 || evidence !== null && (evidence.turns.length > 4096 || evidence.usage.length > 4096 || evidence.observations.length > 8192 || evidence.diagnostics.length > 8192)) throw new RangeError("source_recovery_limit_exceeded");
  const native = analyzeSourceFailures(source);
  const suppressionReason = native.suppressionReason ?? (source.provider === "codex" && source.parserVersion === 1 ? null : "unsupported_contract");
  const nativePartitions = new Map(native.partitions.map(p => [p.sessionId, p]));
  const admitted = new Set(native.partitions.flatMap(p => p.terminalEventIds));
  const knownFailed = new Set(source.events.filter(e => nativeCandidate(e) && admitted.has(e.id) && e.status === "failed" && e.executionOutcome === "error").map(e => e.id));
  const observations = new Map<string, SourceObservation[]>();
  for (const o of evidence?.observations ?? []) if (!("observedResult" in o) && o.eventId !== null && ["call", "result", "structured", "poll"].includes(o.representation)) add(observations, o.eventId, o);
  const classification = { candidateAttempts: 0, modelExcluded: 0, unsupportedClassExcluded: 0 };
  const sessions = new Map<string, NormalizedEvent[]>();
  for (const e of source.events) {
    if (!sessions.has(e.sessionId)) sessions.set(e.sessionId, []);
    if (nativeCandidate(e)) { sessions.get(e.sessionId)!.push(e); classification.candidateAttempts++; }
    else if (e.kind === "model" || e.category === "model") classification.modelExcluded++;
    else classification.unsupportedClassExcluded++;
  }
  const partitions: RecoveryPartition[] = [], groups: RecoveryGroup[] = [], chains: RecoveryChain[] = [];
  let unavailableKnownFailedAttempts = 0;
  for (const [sessionId, rows] of [...sessions].sort(([a], [b]) => compare(a, b))) {
    const inherited = nativePartitions.get(sessionId)!;
    const sessionReasons = new Set<SessionReason>();
    if (suppressionReason !== null) sessionReasons.add("source_suppressed");
    if (inherited.status === "provenance_unresolved") sessionReasons.add("provenance_unresolved");
    const missingOperation = rows.filter(e => e.operationKey === null).map(e => e.id).sort(compare);
    const missingTurn = rows.filter(e => e.turnId === null).map(e => e.id).sort(compare);
    if (missingOperation.length) sessionReasons.add("missing_operation_identity");
    if (missingTurn.length) sessionReasons.add("missing_turn_identity");
    const unassignedFailed = rows.filter(e => (e.operationKey === null || e.turnId === null) && knownFailed.has(e.id)).map(e => e.id).sort(compare);
    unavailableKnownFailedAttempts += unassignedFailed.length;
    const buckets = new Map<string, NormalizedEvent[]>();
    for (const e of rows) if (e.operationKey !== null && e.turnId !== null) add(buckets, JSON.stringify([e.turnId, e.operationKey]), e);
    const partitionId = `partition-${partitions.length + 1}`, groupIds: string[] = [];
    let evaluatedN = 0, unavailableN = 0;
    for (const [, attempts] of [...buckets].sort(([a], [b]) => compare(a, b))) {
      const groupId = `operation-${groups.length + 1}`, first = attempts[0]!, reasons = new Set<GroupReason>();
      groupIds.push(groupId);
      if (sessionReasons.size) reasons.add("session_unavailable");
      const classes = new Set(attempts.map(classKey));
      if (classes.size !== 1) reasons.add("operation_class_conflict");
      const positions = new Map<string, Position>(), representations = new Set<string>();
      for (const e of attempts) {
        if (!admitted.has(e.id)) reasons.add("terminal_not_admitted");
        if (e.status === "pending") reasons.add("pending_attempt");
        else if (e.status === "cancelled") reasons.add("cancelled_attempt");
        else if (e.status === "unknown") reasons.add("unknown_status");
        else if (!(e.status === "failed" && e.executionOutcome === "error" || e.status === "completed" && e.executionOutcome === "success")) reasons.add("unconfirmed_outcome");
        if (admitted.has(e.id)) {
          const p = position(e, observations.get(e.id) ?? [], reasons);
          if (p !== null) { positions.set(e.id, p); representations.add(JSON.stringify([p.scope, p.evidence])); }
        }
      }
      if (representations.size > 1) reasons.add("mixed_interval_evidence");
      if (new Set(attempts.map(e => e.sourceRef.fileId)).size > 1) reasons.add("inconsistent_source_file");
      const ordered = [...attempts].sort((a, b) => a.sourceRef.byteOffset - b.sourceRef.byteOffset || compare(a.id, b.id));
      for (let i = 1; i < ordered.length; i++) {
        const prior = ordered[i - 1]!, current = ordered[i]!;
        if (prior.sourceRef.byteOffset === current.sourceRef.byteOffset) reasons.add("ambiguous_source_order");
        const a = positions.get(prior.id), b = positions.get(current.id);
        if (a === undefined || b === undefined) continue;
        if (a.start === b.start || a.end === b.end) reasons.add("tied_boundaries");
        if (b.start < a.start || b.end < a.end) reasons.add("source_time_order_conflict");
        if (b.start < a.end) reasons.add("overlapping_attempts");
      }
      const groupChains: Omit<RecoveryChain, "id">[] = [], outside: NormalizedEvent[] = [];
      if (reasons.size === 0) {
        let failed: NormalizedEvent[] = [];
        const emit = (success: NormalizedEvent | null) => {
          const opened = failed[0]!, p = positions.get(opened.id)!;
          const recoveryElapsedMs = success === null ? null : positions.get(success.id)!.end - p.end;
          if (recoveryElapsedMs !== null && (!Number.isSafeInteger(recoveryElapsedMs) || recoveryElapsedMs < 0)) { reasons.add("unsafe_recovery_elapsed"); return; }
          const contributing = success === null ? failed : [...failed, success];
          groupChains.push({ groupId, sessionId, turnId: first.turnId!, intervalScope: p.scope, intervalTimingEvidence: p.evidence,
            failedEventIds: failed.map(e => e.id), successfulEventId: success?.id ?? null, evidenceObservationIds: contributing.flatMap(e => positions.get(e.id)!.ids).sort(compare),
            firstFailedResultAt: opened.endAt!, successfulResultAt: success?.endAt ?? null, failedAttemptCount: failed.length, attemptCount: contributing.length, resolved: success !== null, recoveryElapsedMs });
        };
        for (const e of ordered) {
          if (e.status === "failed") failed.push(e);
          else if (failed.length) { emit(e); failed = []; }
          else outside.push(e);
        }
        if (failed.length) emit(null);
      }
      const evaluated = reasons.size === 0;
      const failedIds = attempts.filter(e => knownFailed.has(e.id)).map(e => e.id).sort(compare);
      if (evaluated) { evaluatedN++; for (const chain of groupChains) chains.push({ id: `chain-${chains.length + 1}`, ...chain }); }
      else { unavailableN++; unavailableKnownFailedAttempts += failedIds.length; }
      const timing = representations.size === 1 ? positions.values().next().value as Position | undefined : undefined;
      groups.push({ id: groupId, partitionId, turnId: first.turnId!, operationClass: classes.size === 1 ? { kind: first.kind, category: first.category, toolName: first.toolName } : null,
        status: evaluated ? "evaluated" : "unavailable", reasons: [...reasons].sort(compare), intervalScope: timing?.scope ?? null, intervalTimingEvidence: timing?.evidence ?? null,
        attemptN: attempts.length, knownFailedAttemptN: failedIds.length, eventIds: attempts.map(e => e.id).sort(compare), blockedFailedEventIds: evaluated ? [] : failedIds,
        // Chain proofs are emitted once. This holds proofs for unavailable groups or successes outside chains.
        evidenceObservationIds: (evaluated ? outside : attempts).flatMap(e => positions.get(e.id)?.ids ?? []).sort(compare),
        successesOutsideChains: evaluated ? outside.length : null, resolvedChainN: evaluated ? groupChains.filter(c => c.resolved).length : null, unresolvedChainN: evaluated ? groupChains.filter(c => !c.resolved).length : null });
    }
    const status = sessionReasons.size ? "unavailable" : rows.length === 0 ? "no_candidate_operations" : unavailableN ? evaluatedN ? "partial" : "unavailable" : "evaluated";
    if (unavailableN && sessionReasons.size === 0) sessionReasons.add("unavailable_groups");
    partitions.push({ id: partitionId, sessionId, status, reasons: [...sessionReasons].sort(compare), candidateAttemptN: rows.length, groupIds,
      missingOperationEventIds: missingOperation, missingTurnEventIds: missingTurn, unassignedFailedEventIds: unassignedFailed, unresolvedProvenanceEventIds: [...inherited.unresolvedEventIds] });
  }
  const evaluatedGroups = groups.filter(g => g.status === "evaluated").length, unavailableGroups = groups.length - evaluatedGroups;
  const unavailable = suppressionReason !== null || classification.candidateAttempts > 0 && evaluatedGroups === 0;
  const distributionBuckets = new Map<string, RecoveryChain[]>();
  for (const c of chains) if (c.resolved) add(distributionBuckets, JSON.stringify([c.sessionId, c.intervalScope, c.intervalTimingEvidence]), c);
  const distributions: RecoveryDistribution[] = [];
  for (const [, samples] of [...distributionBuckets].sort(([a], [b]) => compare(a, b))) {
    const ordered = [...samples].sort((a, b) => a.recoveryElapsedMs! - b.recoveryElapsedMs!), first = samples[0]!, n = samples.length;
    distributions.push({ id: `distribution-${distributions.length + 1}`, sessionId: first.sessionId, intervalScope: first.intervalScope, intervalTimingEvidence: first.intervalTimingEvidence,
      unit: "ms", resolvedOnly: true, n, minMs: ordered[0]!.recoveryElapsedMs!, maxMs: ordered[n - 1]!.recoveryElapsedMs!, p50Ms: ordered[Math.ceil(n * 0.5) - 1]!.recoveryElapsedMs!, p95Ms: ordered[Math.ceil(n * 0.95) - 1]!.recoveryElapsedMs!, lowSampleP95: n < 20, chainIds: samples.map(c => c.id) });
  }
  const partialCoverage = native.capabilities?.coverage === "partial" || (native.capabilities?.unsupportedRecords ?? 0) > 0;
  const excluded = classification.modelExcluded + classification.unsupportedClassExcluded > 0;
  return freeze({ schema: "agentprof.source-recovery/v1", scope: "source_prefix", metric: "recovery_elapsed_time", version: "codex-same-turn-operation-v1",
    sourceId: source.sourceId, provider: source.provider, parserVersion: source.parserVersion, normalizationVersion: source.normalizationVersion, keyVersion: source.keyVersion,
    revision: source.revision, completedOffset: source.completedOffset, observedSize: source.observedSize, availability: source.availability, persistedScope: source.persistedScope,
    observationWindow: { unit: "source_bytes", startInclusive: 0, endExclusive: source.completedOffset }, queryPeriod: null,
    crossSourceReconciled: false, aggregationReady: false, parserResumeReady: false, sourceFreshnessChecked: false,
    assessment: suppressionReason !== null ? "suppressed" : classification.candidateAttempts === 0 ? "no_eligible_events" : partialCoverage || excluded || unavailableGroups || partitions.some(p => p.status === "unavailable") ? "partial" : "evaluated",
    suppressionReason, recoveryAssessmentReason: suppressionReason !== null ? "source_suppressed" : classification.candidateAttempts === 0 ? "no_candidate_operations" : unavailable ? "no_evaluable_groups" : null,
    capabilities: native.capabilities, inventory: native.inventory, classification,
    inheritedProvenance: { unresolvedEvents: native.provenance.unresolvedEvents, failures: native.provenance.failures, exclusions: native.eligibility.exclusions },
    summary: { evaluatedGroups, unavailableGroups, unavailableSessions: partitions.filter(p => p.status === "unavailable").length,
      knownFailedAttempts: knownFailed.size, unavailableKnownFailedAttempts, resolvedChains: unavailable ? null : chains.filter(c => c.resolved).length, unresolvedChains: unavailable ? null : chains.filter(c => !c.resolved).length },
    partitions, groups, chains: unavailable ? null : chains, distributions: unavailable ? null : distributions,
    limitations: ["admitted_source_local_subset_only", "same_explicit_codex_turn_and_operation_only", "native_records_not_physical_execution_proof", "recovery_can_include_other_work_or_waiting", "resolved_only_distribution_not_complete_population", "unknown_attempts_suppress_whole_group", "no_retry_loop_error_equality_waste_causation_or_savings", "no_cross_session_or_mixed_timing_total", "codex_generic_nonzero_status_may_be_unknown", ...(partialCoverage ? ["partial_shape_coverage"] : []), ...(excluded ? ["excluded_call_classes"] : [])] });
}
