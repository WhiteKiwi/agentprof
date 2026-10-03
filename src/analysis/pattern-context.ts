import type { MetricEvidence, StoredSource } from "../db/source-store.js";
import type { NormalizedEvent } from "../normalize/types.js";
import type { SourceFailureAnalysis } from "./source-failures.js";
import { lexical } from "./pattern-intervals.js";
import type { PatternInterval } from "./pattern-intervals.js";

type Observation = MetricEvidence["observations"][number];
export type PositionedPatternEvent = Readonly<{ event: NormalizedEvent; interval: PatternInterval; proofIds: readonly string[] }>;
export type PatternSession = Readonly<{
  sessionId: string; ordered: readonly PositionedPatternEvent[];
  temporalReasons: readonly string[];
}>;
export type PatternContext = Readonly<{
  native: SourceFailureAnalysis;
  admitted: readonly NormalizedEvent[];
  positions: ReadonlyMap<string, PositionedPatternEvent>;
  proofIdsByEvent: ReadonlyMap<string, readonly string[]>;
  positionExclusions: readonly Readonly<{ eventId: string; reason: string }>[];
  sessions: readonly PatternSession[];
}>;
export const isEdit = (e: NormalizedEvent): boolean => e.kind === "file_edit" || e.kind === "file_write";
export const isValidation = (e: NormalizedEvent): boolean => e.kind === "shell" && (e.category === "test" || e.category === "build");
export const isLookup = (e: NormalizedEvent): boolean => e.kind === "file_read" || e.kind === "search";
const isOpaque = (e: NormalizedEvent): boolean => ["other", "skill", "subagent", "mcp", "browser"].includes(e.kind)
  || e.kind === "shell" && !["test", "build", "search", "read"].includes(e.category);

/** Called only after native terminal admission. Keep decisive proof and interval semantics separate from duration. */
function position(e: NormalizedEvent, observations: readonly Observation[]): PositionedPatternEvent | string {
  if (e.startAt === null || e.endAt === null) return "missing_boundaries";
  const start = Date.parse(e.startAt), end = Date.parse(e.endAt);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return "invalid_boundaries";
  const structured = e.provider === "codex" && e.sourceRef.recordType === "event_msg"
    && e.intervalScope === "item_lifecycle" && e.intervalTimingEvidence === "source_reported";
  const paired = e.intervalScope === "invocation_latency" && e.intervalTimingEvidence === "paired_timestamps"
    && (e.provider === "codex" ? e.sourceRef.recordType === "response_item" : e.sourceRef.recordType === "user");
  if (!structured && !paired) return "unsupported_interval";
  let call: Observation | null = null, terminal: Observation | null = null;
  for (const o of observations) {
    if (o.origin !== "ordinary" || o.sourceRef.fileId !== e.sourceRef.fileId) continue;
    if (o.representation === "call" && o.sourceRef.byteOffset < e.sourceRef.byteOffset) {
      if (o.turnId !== e.turnId) return "contradictory_turn_proof";
      if (call === null || o.sourceRef.byteOffset < call.sourceRef.byteOffset
        || o.sourceRef.byteOffset === call.sourceRef.byteOffset && lexical(o.id, call.id) < 0) call = o;
    }
    if (o.sourceRef.byteOffset !== e.sourceRef.byteOffset
      || (structured ? o.representation !== "structured" : o.representation !== "result" && o.representation !== "poll")) continue;
    if (o.turnId !== null && o.turnId !== e.turnId) return "contradictory_turn_proof";
    if ("observedResult" in o && o.observedResult?.observedAt !== e.endAt) return "contradictory_terminal_time";
    if (terminal === null || lexical(o.id, terminal.id) < 0) terminal = o;
  }
  if (terminal === null || paired && call === null) return "missing_position_proof";
  return { event: e, interval: { id: e.id, sessionId: e.sessionId, category: e.category,
    intervalScope: structured ? "item_lifecycle" : "invocation_latency",
    intervalTimingEvidence: structured ? "source_reported" : "paired_timestamps", startMs: start, endMs: end },
    proofIds: (paired ? [call!.id, terminal.id] : [terminal.id]).sort(lexical) };
}

/** One native admission pass and linear indexes; no source or caller-owned array is mutated. */
export function buildPatternContext(source: StoredSource, native: SourceFailureAnalysis): PatternContext {
  const eventIndex = new Map<string, NormalizedEvent>();
  for (const e of source.events) {
    if (eventIndex.has(e.id)) throw new RangeError("duplicate_pattern_execution_id");
    eventIndex.set(e.id, e);
  }
  const observationIndex = new Map<string, Observation[]>();
  for (const o of source.evidence?.observations ?? []) {
    if (o.eventId === null || !["call", "result", "structured", "poll"].includes(o.representation)) continue;
    const rows = observationIndex.get(o.eventId); if (rows) rows.push(o); else observationIndex.set(o.eventId, [o]);
  }
  const admittedIds = new Set(native.partitions.flatMap(p => p.terminalEventIds));
  const admitted = source.events.filter(e => admittedIds.has(e.id)).sort((a, b) => lexical(a.id, b.id));
  const positions = new Map<string, PositionedPatternEvent>();
  const proofIdsByEvent = new Map<string, readonly string[]>();
  const positionExclusions: { eventId: string; reason: string }[] = [];
  for (const e of admitted) {
    const observations = observationIndex.get(e.id) ?? [];
    const own = observations.filter(o => o.origin === "ordinary" && o.sourceRef.fileId === e.sourceRef.fileId);
    const terminal = own.filter(o => o.sourceRef.byteOffset === e.sourceRef.byteOffset
      && ["structured", "result", "poll"].includes(o.representation)).sort((a, b) => lexical(a.id, b.id))[0];
    const call = own.filter(o => o.representation === "call" && o.sourceRef.byteOffset < e.sourceRef.byteOffset)
      .sort((a, b) => a.sourceRef.byteOffset - b.sourceRef.byteOffset || lexical(a.id, b.id))[0];
    proofIdsByEvent.set(e.id, terminal === undefined ? [] : e.sourceRef.recordType === "event_msg" ? [terminal.id]
      : call === undefined ? [] : [call.id, terminal.id].sort(lexical));
    const p = position(e, observations);
    if (typeof p === "string") positionExclusions.push({ eventId: e.id, reason: p }); else positions.set(e.id, p);
  }
  const buckets = new Map<string, NormalizedEvent[]>();
  for (const e of source.events) {
    const rows = buckets.get(e.sessionId); if (rows) rows.push(e); else buckets.set(e.sessionId, [e]);
  }
  const partitions = new Map(native.partitions.map(p => [p.sessionId, p]));
  const sessions: PatternSession[] = [];
  for (const [sessionId, rows] of [...buckets].sort(([a], [b]) => lexical(a, b))) {
    const reasons = new Set<string>(), p = partitions.get(sessionId);
    if (native.suppressionReason !== null) reasons.add(native.suppressionReason);
    if (p?.status === "provenance_unresolved") reasons.add("provenance_unresolved");
    if (native.capabilities?.coverage !== "recognized_shapes" || native.capabilities.unsupportedRecords > 0) reasons.add("incomplete_temporal_context");
    const relevant = rows.filter(e => e.kind !== "model" && e.category !== "model");
    for (const e of relevant) {
      if (isOpaque(e)) reasons.add("opaque_action_in_stream");
      if (!admittedIds.has(e.id)) reasons.add("nonterminal_or_unadmitted_action");
      else if (!positions.has(e.id)) reasons.add("unpositioned_action");
      if (isEdit(e) && (e.status !== "completed" || e.executionOutcome !== "success")) reasons.add("unconfirmed_edit_effect");
      if (source.provider === "codex" && e.turnId === null) reasons.add("missing_turn_identity");
    }
    const ordered = relevant.flatMap(e => { const value = positions.get(e.id); return value === undefined ? [] : [value]; })
      .sort((a, b) => a.event.sourceRef.byteOffset - b.event.sourceRef.byteOffset || lexical(a.event.id, b.event.id));
    if (new Set(ordered.map(x => x.event.sourceRef.fileId)).size > 1) reasons.add("inconsistent_source_file");
    if (new Set(ordered.map(x => JSON.stringify([x.interval.intervalScope, x.interval.intervalTimingEvidence]))).size > 1) reasons.add("mixed_interval_contracts");
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1]!, b = ordered[i]!;
      if (a.event.sourceRef.byteOffset === b.event.sourceRef.byteOffset) reasons.add("ambiguous_source_order");
      if (b.interval.startMs < a.interval.endMs) reasons.add("overlapping_actions");
      if (b.interval.startMs <= a.interval.startMs || b.interval.endMs <= a.interval.endMs) reasons.add("tied_or_contradictory_boundaries");
    }
    sessions.push({ sessionId, ordered, temporalReasons: [...reasons].sort(lexical) });
  }
  return { native, admitted, positions, proofIdsByEvent, positionExclusions, sessions };
}
