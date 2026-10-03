import type { StoredSource } from "../db/source-store.js";
import type { NormalizedEvent } from "../normalize/types.js";
import { analyzeSourceFailures } from "./source-failures.js";
import { buildPatternContext } from "./pattern-context.js";
import { freezeOwned, lexical } from "./pattern-intervals.js";
import type { PatternInterval } from "./pattern-intervals.js";
import { HISTORY_LIMITS, HistoryQueryError } from "./history-query.js";

export type HistoryCopy = Readonly<{ sourceId: string; revision: number; admitted: boolean; positioned: boolean;
  proofIds: readonly string[]; reason: string | null }>;
export type HistoryExecution = Readonly<{
  id: string; eventId: string; provider: StoredSource["provider"]; sessionId: string | null; sessionIds: readonly string[];
  state: "admitted" | "conflict" | "excluded" | "unpositioned";
  status: NormalizedEvent["status"] | null; category: NormalizedEvent["category"] | null;
  interval: PatternInterval | null; copies: readonly HistoryCopy[]; reasons: readonly string[];
}>;
export type HistorySource = Readonly<{
  sourceId: string; provider: StoredSource["provider"]; revision: number; parserVersion: number;
  completedOffset: number; observedSize: number; availability: StoredSource["availability"];
  persistedScope: StoredSource["persistedScope"]; nativeAssessment: string; suppressionReason: string | null;
  parserCoverage: string | null; unsupportedRecords: number | null; events: number; admittedTerminals: number;
}>;
export type HistoryReconciliation = Readonly<{
  sources: readonly HistorySource[]; executions: readonly HistoryExecution[];
  counts: Readonly<{ eventCopies: number; canonicalExecutions: number; duplicateCopies: number;
    admittedExecutions: number; conflictingExecutions: number; excludedExecutions: number; unpositionedExecutions: number }>;
}>;
/** Stable comparison only. It is never included in a published result. */
function semantic(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(semantic).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => lexical(a, b)).map(([k, v]) => `${JSON.stringify(k)}:${semantic(v)}`).join(",")}}`;
}
/** Only these known capture contracts share native version interpretation; every event field still participates. */
function nativeEventParserVersion(source: StoredSource): number {
  return source.provider === "codex" && (source.parserVersion === 2 || source.parserVersion === 3) ? 1
    : source.provider === "claude" && (source.parserVersion === 3 || source.parserVersion === 4) ? 2 : source.parserVersion;
}
export function validateHistorySources(sources: readonly StoredSource[]): void {
  if (sources.length === 0 || sources.length > HISTORY_LIMITS.sources || new Set(sources.map(s => s.sourceId)).size !== sources.length) throw new HistoryQueryError();
  const first = sources[0]!;
  let events = 0, observations = 0;
  for (const s of sources) {
    if (s.keyId !== first.keyId || s.keyVersion !== first.keyVersion || s.normalizationVersion !== first.normalizationVersion) throw new HistoryQueryError();
    events += s.events.length; observations += s.evidence?.observations.length ?? 0;
    if (events > HISTORY_LIMITS.eventCopies || observations > HISTORY_LIMITS.observationCopies) throw new HistoryQueryError();
  }
}
/** Validated stored generations only; all selected copies participate before any date/session filter. */
export function reconcileHistorySources(sources: readonly StoredSource[]): HistoryReconciliation {
  validateHistorySources(sources);
  type Entry = { event: NormalizedEvent; signature: string; interval: PatternInterval | null; copy: HistoryCopy };
  const groups = new Map<string, Entry[]>(), manifests: HistorySource[] = [];
  let eventCopies = 0;
  for (const s of [...sources].sort((a, b) => lexical(a.sourceId, b.sourceId))) {
    const native = analyzeSourceFailures(s), context = buildPatternContext(s, native);
    const admitted = new Set(context.admitted.map(e => e.id));
    const exclusions = new Map(context.positionExclusions.map(e => [e.eventId, e.reason]));
    const partitions = new Map(native.partitions.map(p => [p.sessionId, p.status]));
    manifests.push({ sourceId: s.sourceId, provider: s.provider, revision: s.revision, parserVersion: s.parserVersion,
      completedOffset: s.completedOffset, observedSize: s.observedSize, availability: s.availability,
      persistedScope: s.persistedScope, nativeAssessment: native.assessment, suppressionReason: native.suppressionReason,
      parserCoverage: native.capabilities?.coverage ?? null, unsupportedRecords: native.capabilities?.unsupportedRecords ?? null,
      events: s.events.length, admittedTerminals: admitted.size });
    for (const e of s.events) {
      eventCopies++;
      const p = context.positions.get(e.id), isAdmitted = admitted.has(e.id);
      const reason = native.suppressionReason ?? (!isAdmitted
        ? partitions.get(e.sessionId) === "provenance_unresolved" ? "provenance_unresolved" : "native_excluded"
        : exclusions.get(e.id) ?? null);
      const signature = semantic([s.provider, nativeEventParserVersion(s), s.normalizationVersion, s.keyVersion,
        Object.fromEntries(Object.entries(e).filter(([key]) => key !== "sourceRef"))]);
      const entry: Entry = { event: e, signature, interval: p === undefined ? null : { ...p.interval },
        copy: { sourceId: s.sourceId, revision: s.revision, admitted: isAdmitted, positioned: p !== undefined,
          proofIds: [...(p?.proofIds ?? context.proofIdsByEvent.get(e.id) ?? [])].sort(lexical), reason } };
      const key = JSON.stringify([s.provider, e.id]), entries = groups.get(key);
      if (entries) entries.push(entry); else groups.set(key, [entry]);
      if (groups.size > HISTORY_LIMITS.canonicalExecutions) throw new HistoryQueryError();
    }
  }
  const executions: HistoryExecution[] = [];
  const counts = { eventCopies, canonicalExecutions: groups.size, duplicateCopies: eventCopies - groups.size,
    admittedExecutions: 0, conflictingExecutions: 0, excludedExecutions: 0, unpositionedExecutions: 0 };
  for (const [, entries] of [...groups].sort(([a], [b]) => lexical(a, b))) {
    const first = entries[0]!, sessions = [...new Set(entries.map(x => x.event.sessionId))].sort(lexical);
    const signaturesAgree = entries.every(x => x.signature === first.signature);
    const admittedN = entries.filter(x => x.copy.admitted).length;
    const reasons = new Set(entries.flatMap(x => x.copy.reason === null ? [] : [x.copy.reason]));
    let state: HistoryExecution["state"];
    if (!signaturesAgree) { state = "conflict"; reasons.add("semantic_or_contract_conflict"); }
    else if (admittedN > 0 && admittedN !== entries.length) { state = "conflict"; reasons.add("copy_admission_disagreement"); }
    else if (admittedN === 0) state = "excluded";
    else if (entries.some(x => x.interval === null)) state = "unpositioned";
    else if (entries.some(x => semantic(x.interval) !== semantic(first.interval))) { state = "conflict"; reasons.add("copy_position_disagreement"); }
    else state = "admitted";
    if (state === "admitted") counts.admittedExecutions++;
    else if (state === "conflict") counts.conflictingExecutions++;
    else if (state === "excluded") counts.excludedExecutions++;
    else counts.unpositionedExecutions++;
    executions.push({ id: `execution-${executions.length + 1}`, eventId: first.event.id, provider: first.event.provider,
      sessionId: sessions.length === 1 ? sessions[0]! : null, sessionIds: sessions, state,
      status: signaturesAgree ? first.event.status : null, category: signaturesAgree ? first.event.category : null,
      interval: state === "admitted" ? first.interval : null, copies: entries.map(x => x.copy), reasons: [...reasons].sort(lexical) });
  }
  return freezeOwned({ sources: manifests, executions, counts });
}
