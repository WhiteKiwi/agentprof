import type { StoredSource } from "../db/source-store.js";
import type { NormalizedEvent } from "../normalize/types.js";
import { analyzeSourceInvocationOverlap } from "./source-invocation-overlap.js";
import type { SourceInvocationOverlapAnalysis } from "./source-invocation-overlap.js";

export const EXPLORATION_LIMITS = Object.freeze({ events: 4096, observations: 8192, jsonBytes: 8 * 1024 * 1024 });
export const EXPLORATION_THRESHOLDS = Object.freeze({ windowMs: 600_000, minimumLookups: 20, minimumRepeatedSearch: 5, maximumMutations: 1 });
type State = "suppressed" | "unavailable" | "empty" | "insufficient" | "no_candidate" | "blocked" | "candidate";
type Reason = "source_suppressed" | "provenance_unresolved" | "inconsistent_lookup_class" | "incomplete_lookup" | "missing_search_identity" | "incomplete_mutation" | "incomplete_opaque" | "unsafe_window_boundary";
export type ExplorationPartition = Readonly<{
  id: string; sessionId: string; status: State;
  observedCompletedLookupN: number; positionedLookupN: number; excludedLookupN: number; mutationN: number; opaqueN: number;
  unresolvedEventIds: readonly string[]; reasons: readonly Reason[];
  windowEndpointsEvaluated: number | null; numericQualifiedWindows: number | null; opaqueBlockedWindows: number | null;
}>;
export type ExplorationCandidate = Readonly<{
  id: string; partitionId: string; sessionId: string; severity: "informational";
  window: Readonly<{ startInclusive: string; endInclusive: string; widthMs: 600000 }>;
  lookupN: number; mutationN: number; largestRepeatedSearchN: number;
  lookupEventIds: readonly string[]; mutationEventIds: readonly string[];
  repeatedSearchGroups: readonly Readonly<{ id: string; invocationN: number; eventIds: readonly string[] }>[];
  evidenceEventIds: readonly string[]; evidenceObservationIds: readonly string[]; includedEventIds: readonly never[];
}>;
export type SourceExplorationAnalysis = Readonly<{
  schema: "agentprof.source-exploration/v1"; ruleId: "exploration-thrashing"; ruleVersion: "source-prefix-native-v1";
  scope: "source_prefix"; sourceId: string; provider: StoredSource["provider"]; parserVersion: number; revision: number;
  completedOffset: number; observedSize: number; availability: StoredSource["availability"];
  assessment: State | "partial";
  suppressionReason: SourceInvocationOverlapAnalysis["suppressionReason"] | "unsupported_metric_contract" | "unsupported_records";
  capabilities: SourceInvocationOverlapAnalysis["capabilities"];
  inventory: SourceInvocationOverlapAnalysis["inventory"];
  inheritedAdmission: SourceInvocationOverlapAnalysis["inheritedAdmission"];
  inheritedProvenance: SourceInvocationOverlapAnalysis["inheritedProvenance"];
  thresholds: typeof EXPLORATION_THRESHOLDS;
  partitions: readonly ExplorationPartition[]; candidates: readonly ExplorationCandidate[] | null;
  includedEventIds: readonly never[];
  sourceFreshnessChecked: false; crossSourceReconciled: false; fullHistory: false;
  guidance: Readonly<{ meaning: string; necessaryWorkCounterexample: string; investigativeAction: string; matchedExperiment: string; qualityGuardrail: string; limitations: readonly string[] }>;
}>;
type Row = { eventId: string; start: number; end: number; searchKey: string | null };
type Bucket = { lookups: Row[]; mutations: Row[]; opaque: Row[]; completed: number; excluded: number; mutationN: number; opaqueN: number; reasons: Set<Reason>; unresolved: Set<string> };
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const nativeSearch = (e: NormalizedEvent): boolean => e.kind === "search" && e.category === "search" && (e.toolName === "Grep" || e.toolName === "Glob");
const nativeRead = (e: NormalizedEvent): boolean => e.kind === "file_read" && e.category === "read" && e.toolName === "Read";
const nativeMutation = (e: NormalizedEvent): boolean => e.kind === "file_edit" && e.category === "edit" && e.toolName === "Edit" || e.kind === "file_write" && e.category === "write" && e.toolName === "Write";

/** Both cursors only advance. Closed interval intersection: starts <= right minus ends < left. */
function intervalCounter(rows: readonly Row[]): (left: number, right: number) => number {
  const starts = rows.map(r => r.start).sort((a, b) => a - b), ends = rows.map(r => r.end).sort((a, b) => a - b);
  let started = 0, ended = 0;
  return (left, right) => {
    while (started < starts.length && starts[started]! <= right) started++;
    while (ended < ends.length && ends[ended]! < left) ended++;
    return started - ended;
  };
}

/** No full collection or frequency-map scan per endpoint; membership is materialized once on selection. */
function firstWindow(bucket: Bucket) {
  const rows = [...bucket.lookups].sort((a, b) => a.end - b.end || compare(a.eventId, b.eventId));
  const mutationCount = intervalCounter(bucket.mutations), opaqueCount = intervalCounter(bucket.opaque);
  const counts = new Map<string, number>(), frequencies = new Map<number, number>();
  let maximum = 0, leftIndex = 0, rightIndex = 0, endpoints = 0, qualified = 0, blocked = 0;
  const change = (key: string | null, delta: 1 | -1): void => {
    if (key === null) return;
    const old = counts.get(key) ?? 0, next = old + delta;
    if (old > 0) { const n = frequencies.get(old)! - 1; if (n) frequencies.set(old, n); else frequencies.delete(old); }
    if (next > 0) { counts.set(key, next); frequencies.set(next, (frequencies.get(next) ?? 0) + 1); }
    else counts.delete(key);
    maximum = Math.max(maximum, next);
    while (maximum > 0 && !frequencies.has(maximum)) maximum--;
  };
  while (rightIndex < rows.length) {
    const right = rows[rightIndex]!.end, left = right - EXPLORATION_THRESHOLDS.windowMs;
    // Add the entire completion tie before evaluation. Input ordering never chooses a subset of a tie.
    while (rightIndex < rows.length && rows[rightIndex]!.end === right) change(rows[rightIndex++]!.searchKey, 1);
    while (leftIndex < rightIndex && rows[leftIndex]!.end < left) change(rows[leftIndex++]!.searchKey, -1);
    endpoints++;
    const mutations = mutationCount(left, right), opaque = opaqueCount(left, right);
    if (rightIndex - leftIndex < EXPLORATION_THRESHOLDS.minimumLookups || maximum < EXPLORATION_THRESHOLDS.minimumRepeatedSearch || mutations > EXPLORATION_THRESHOLDS.maximumMutations) continue;
    qualified++;
    if (opaque > 0) { blocked++; continue; }
    return { endpoints, qualified, blocked, selected: { left, right, maximum, rows: rows.slice(leftIndex, rightIndex), mutations: bucket.mutations.filter(r => r.start <= right && r.end >= left) } };
  }
  return { endpoints, qualified, blocked, selected: null };
}

/** Validated stored generation only. The unchanged native paired-boundary authority runs exactly once. */
export function analyzeSourceExploration(source: StoredSource): SourceExplorationAnalysis {
  const evidence = source.evidence;
  if (source.events.length > EXPLORATION_LIMITS.events || (evidence?.observations.length ?? 0) > EXPLORATION_LIMITS.observations) throw new RangeError("source_exploration_limit_exceeded");
  const inherited = analyzeSourceInvocationOverlap(source);
  const metricSupported = source.provider === "claude" && [2, 3, 4].includes(source.parserVersion)
    && evidence?.capabilities.provider === "claude" && evidence.capabilities.parserVersion === source.parserVersion;
  const suppressionReason = inherited.suppressionReason ?? (!metricSupported ? "unsupported_metric_contract"
    : (evidence?.capabilities.unsupportedRecords ?? 0) > 0 ? "unsupported_records" : null);
  const inheritedPartitions = new Map(inherited.partitions.map(p => [p.sessionId, p]));
  const admitted = new Set(inherited.partitions.flatMap(p => p.contributingEventIds));
  const allowedProofs = new Set(inherited.partitions.flatMap(p => p.evidenceObservationIds));
  const events = new Map(source.events.map(e => [e.id, e]));
  if (events.size !== source.events.length) throw new RangeError("source_exploration_duplicate_event");
  const proofs = new Map<string, string[]>();
  for (const o of evidence?.observations ?? []) {
    if (!allowedProofs.has(o.id) || o.eventId === null || !admitted.has(o.eventId) || !("observedResult" in o)
      || o.origin !== "ordinary" || o.sessionId !== events.get(o.eventId)?.sessionId
      || o.representation !== "call" && o.representation !== "result") continue;
    const rows = proofs.get(o.eventId); if (rows) rows.push(o.id); else proofs.set(o.eventId, [o.id]);
  }
  const buckets = new Map<string, Bucket>();
  for (const e of source.events) {
    let b = buckets.get(e.sessionId);
    if (!b) { b = { lookups: [], mutations: [], opaque: [], completed: 0, excluded: 0, mutationN: 0, opaqueN: 0, reasons: new Set(), unresolved: new Set() }; buckets.set(e.sessionId, b); }
    const bad = (reason: Reason): void => { b!.reasons.add(reason); b!.unresolved.add(e.id); };
    if (e.kind === "model" && e.category === "model" && e.toolName === null) continue;
    const lookup = nativeRead(e) || nativeSearch(e), mutation = nativeMutation(e);
    const resemblesLookup = e.kind === "file_read" || e.kind === "search" || e.toolName === "Read" || e.toolName === "Grep" || e.toolName === "Glob";
    if (resemblesLookup && !lookup) bad("inconsistent_lookup_class");
    if (lookup) { if (e.status !== "completed") { b.excluded++; continue; } b.completed++; }
    else if (mutation) b.mutationN++; else b.opaqueN++;
    const terminal = e.status === "completed" || e.status === "failed";
    if (!terminal || !admitted.has(e.id) || e.startAt === null || e.endAt === null || (proofs.get(e.id)?.length ?? 0) !== 2) {
      bad(lookup ? "incomplete_lookup" : mutation ? "incomplete_mutation" : "incomplete_opaque"); continue;
    }
    const start = Date.parse(e.startAt), end = Date.parse(e.endAt);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) { bad(lookup ? "incomplete_lookup" : mutation ? "incomplete_mutation" : "incomplete_opaque"); continue; }
    if (lookup && !Number.isFinite(new Date(end - EXPLORATION_THRESHOLDS.windowMs).getTime())) { bad("unsafe_window_boundary"); continue; }
    if (nativeSearch(e) && e.lookupKey === null) { bad("missing_search_identity"); continue; }
    const row = { eventId: e.id, start, end, searchKey: nativeSearch(e) ? e.lookupKey : null };
    if (lookup) b.lookups.push(row); else if (mutation) b.mutations.push(row); else b.opaque.push(row);
  }
  const partitions: ExplorationPartition[] = [], candidates: ExplorationCandidate[] = [];
  for (const [sessionId, b] of [...buckets].sort(([a], [z]) => compare(a, z))) {
    if (suppressionReason !== null) b.reasons.add("source_suppressed");
    if (inheritedPartitions.get(sessionId)?.reason === "provenance_unresolved") b.reasons.add("provenance_unresolved");
    const id = `partition-${partitions.length + 1}`;
    let status: State, endpoints: number | null = 0, qualified: number | null = 0, blocked: number | null = 0;
    if (b.reasons.size) { status = suppressionReason === null ? "unavailable" : "suppressed"; endpoints = qualified = blocked = null; }
    else if (b.lookups.length === 0) status = "empty";
    else if (b.lookups.length < EXPLORATION_THRESHOLDS.minimumLookups) status = "insufficient";
    else {
      const result = firstWindow(b); endpoints = result.endpoints; qualified = result.qualified; blocked = result.blocked;
      status = result.selected !== null ? "candidate" : blocked > 0 ? "blocked" : "no_candidate";
      if (result.selected !== null) {
        const s = result.selected, repeated = new Map<string, string[]>();
        for (const r of s.rows) if (r.searchKey !== null) { const members = repeated.get(r.searchKey); if (members) members.push(r.eventId); else repeated.set(r.searchKey, [r.eventId]); }
        const groups = [...repeated.values()].filter(ids => ids.length >= EXPLORATION_THRESHOLDS.minimumRepeatedSearch)
          .map(ids => ids.sort(compare)).sort((a, z) => compare(a[0]!, z[0]!));
        const lookupIds = s.rows.map(r => r.eventId).sort(compare), mutationIds = s.mutations.map(r => r.eventId).sort(compare);
        const selectedIds = [...lookupIds, ...mutationIds].sort(compare);
        candidates.push({ id: `exploration-${candidates.length + 1}`, partitionId: id, sessionId, severity: "informational",
          window: { startInclusive: new Date(s.left).toISOString(), endInclusive: new Date(s.right).toISOString(), widthMs: 600000 },
          lookupN: lookupIds.length, mutationN: mutationIds.length, largestRepeatedSearchN: s.maximum,
          lookupEventIds: lookupIds, mutationEventIds: mutationIds,
          repeatedSearchGroups: groups.map((ids, i) => ({ id: `search-${i + 1}`, invocationN: ids.length, eventIds: ids })),
          evidenceEventIds: selectedIds, evidenceObservationIds: [...new Set(selectedIds.flatMap(eid => proofs.get(eid) ?? []))].sort(compare), includedEventIds: [] });
      }
    }
    partitions.push({ id, sessionId, status, observedCompletedLookupN: b.completed, positionedLookupN: b.lookups.length,
      excludedLookupN: b.excluded, mutationN: b.mutationN, opaqueN: b.opaqueN, unresolvedEventIds: [...b.unresolved].sort(compare), reasons: [...b.reasons].sort(compare),
      windowEndpointsEvaluated: endpoints, numericQualifiedWindows: qualified, opaqueBlockedWindows: blocked });
  }
  const unknown = partitions.filter(p => p.status === "unavailable" || p.status === "blocked").length;
  const partial = inherited.capabilities?.coverage === "partial";
  const assessment: SourceExplorationAnalysis["assessment"] = suppressionReason !== null ? "suppressed"
    : partitions.length === 0 ? "empty" : partitions.every(p => p.status === "unavailable") ? "unavailable"
    : partitions.every(p => p.status === "blocked") ? "blocked" : unknown > 0 || partial ? "partial"
    : candidates.length > 0 ? "candidate" : partitions.every(p => p.status === "empty") ? "empty"
    : partitions.every(p => p.status === "empty" || p.status === "insufficient") ? "insufficient" : "no_candidate";
  return freeze({ schema: "agentprof.source-exploration/v1", ruleId: "exploration-thrashing", ruleVersion: "source-prefix-native-v1",
    scope: "source_prefix", sourceId: source.sourceId, provider: source.provider, parserVersion: source.parserVersion, revision: source.revision,
    completedOffset: source.completedOffset, observedSize: source.observedSize, availability: source.availability, assessment, suppressionReason,
    capabilities: inherited.capabilities, inventory: inherited.inventory, inheritedAdmission: inherited.inheritedAdmission,
    inheritedProvenance: inherited.inheritedProvenance, thresholds: EXPLORATION_THRESHOLDS, partitions,
    candidates: assessment === "suppressed" || assessment === "unavailable" ? null : candidates, includedEventIds: [],
    sourceFreshnessChecked: false, crossSourceReconciled: false, fullHistory: false,
    guidance: {
      meaning: "Informational heuristic: frequent completed native lookups and repeated exact search requests with little observed editing.",
      necessaryWorkCounterexample: "Repository orientation, auditing and independent review can require many repeated searches without editing.",
      investigativeAction: "Inspect the selected lookup evidence and task intent; consider one repository-map or search-scope improvement.",
      matchedExperiment: "Repeat a matched task with one change; compare lookup counts and observed time while retaining inconclusive or worse results.",
      qualityGuardrail: "Preserve required source evidence, search breadth, answer correctness and all review, regression, security and build checks.",
      limitations: ["No result equivalence, unchanged-content or causation inference.", "No waste, avoidability, productivity or savings verdict; includedEventIds is empty.", "Only the first qualified closed trailing window per session is selected.", "Stored source-prefix only; no ongoing freshness, cross-source reconciliation or complete-history claim.", "Experiments are suggestions, not automatically executed."] },
  });
}
