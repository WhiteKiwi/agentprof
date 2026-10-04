import type { StoredSource } from "../db/source-store.js";
import type { NormalizedEvent } from "../normalize/types.js";
import { SafeError } from "../privacy/diagnostics.js";
import { summarizeSource } from "../analysis/source-summary.js";
import { analyzeSourceSlowTool } from "../analysis/source-slow-tool.js";
import { analyzeSourceFailures } from "../analysis/source-failures.js";
import { analyzeSourceRecovery } from "../analysis/source-recovery.js";
import { analyzeSourceRetryOverhead } from "../analysis/source-retry-overhead.js";
import { analyzeSourceReadRevisits } from "../analysis/source-read-revisits.js";
import { analyzeSourceSearchRecurrence } from "../analysis/source-search-recurrence.js";
import { analyzeSourceActiveTime } from "../analysis/source-active-time.js";
import { analyzeSourceExploration } from "../analysis/source-exploration.js";
import { analyzeSourcePatterns } from "../analysis/source-patterns.js";
import { buildSourceCommandBreakdown } from "./command-breakdown.js";

export const UNIFIED_LIMITS = Object.freeze({ partitions: 12, rows: 12, candidates: 12, chains: 16, timeline: 48 });
export type UnifiedTimelineRow = Readonly<Pick<NormalizedEvent,
  "id" | "sessionId" | "category" | "status" | "startAt" | "endAt" | "intervalScope" | "intervalTimingEvidence">>;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Internal composition of one validated readSource result. Never a validator for arbitrary JSON.
 * Each domain retains its own authority; internal sub-analyzer reuse is not a single-admission claim. */
export function buildUnifiedSourceReport(source: StoredSource) {
  const summary = summarizeSource(source), slow = analyzeSourceSlowTool(source);
  const commands = buildSourceCommandBreakdown(source, slow), failures = analyzeSourceFailures(source);
  const recovery = analyzeSourceRecovery(source), retry = analyzeSourceRetryOverhead(source);
  const reads = analyzeSourceReadRevisits(source), searches = analyzeSourceSearchRecurrence(source);
  const patterns = analyzeSourcePatterns(source), exploration = analyzeSourceExploration(source);
  const activeTime = analyzeSourceActiveTime(source);
  for (const field of ["parserVersion", "normalizationVersion", "keyVersion"] as const) {
    if (activeTime[field] !== source[field]) throw new SafeError("INVALID_RECORD");
  }
  if (exploration.parserVersion !== source.parserVersion) throw new SafeError("INVALID_RECORD");
  for (const part of [summary, slow, commands, failures, recovery, retry, reads, searches, patterns, exploration, activeTime]) {
    for (const field of ["sourceId", "provider", "revision", "completedOffset", "observedSize"] as const) {
      if (part[field] !== source[field]) throw new SafeError("INVALID_RECORD");
    }
  }
  const events = new Map(source.events.map(e => [e.id, e]));
  const positioned = new Set<string>();
  for (const p of patterns.timePartitions ?? []) for (const id of p.positionedEventIds) {
    const e = events.get(id);
    if (e === undefined || e.sessionId !== p.sessionId || e.intervalScope !== p.intervalScope
      || e.intervalTimingEvidence !== p.intervalTimingEvidence || e.startAt === null || e.endAt === null) throw new SafeError("INVALID_RECORD");
    positioned.add(id);
  }
  const timeline: readonly UnifiedTimelineRow[] = Object.freeze([...positioned].map(id => events.get(id)!)
    .sort((a, b) => compare(a.startAt!, b.startAt!) || compare(a.endAt!, b.endAt!) || compare(a.id, b.id))
    .slice(0, UNIFIED_LIMITS.timeline).map(e => Object.freeze({ id: e.id, sessionId: e.sessionId, category: e.category,
      status: e.status, startAt: e.startAt, endAt: e.endAt, intervalScope: e.intervalScope, intervalTimingEvidence: e.intervalTimingEvidence })));
  const sessions = new Set(source.events.map(e => e.sessionId));
  for (const row of source.evidence?.usage ?? []) sessions.add(row.sessionId);
  for (const row of source.evidence?.turns ?? []) sessions.add(row.sessionId);
  return Object.freeze({ schema: "agentprof.unified-source-report/v1" as const,
    sourceId: source.sourceId, provider: source.provider, revision: source.revision,
    parserVersion: source.parserVersion, normalizationVersion: source.normalizationVersion, keyVersion: source.keyVersion, completedOffset: source.completedOffset, observedSize: source.observedSize,
    sessionIds: Object.freeze([...sessions].sort(compare)), eventIds: Object.freeze([...events.keys()].sort(compare)),
    summary, slow, commands, failures, recovery, retry, reads, searches, patterns, exploration, activeTime,
    timeline, positionedEventN: positioned.size, timelineSuppressed: patterns.timePartitions === null });
}
export type UnifiedSourceReport = ReturnType<typeof buildUnifiedSourceReport>;
