import type { StoredSource } from "../db/source-store.js";
import type { NormalizedEvent } from "../normalize/types.js";
import type { SourceSlowToolAnalysis, SlowToolPartition } from "../analysis/source-slow-tool.js";
import { SafeError } from "../privacy/diagnostics.js";

export type NativeCommandIdentity = Readonly<Pick<NormalizedEvent, "kind" | "category" | "toolName" | "commandPattern">>;
export type NativeCommandGroup = Readonly<{ ordinal: number; group: NativeCommandIdentity; n: number; sumMs: number; share: number | null }>;
export type NativeCommandCall = Readonly<{ ordinal: number; groupOrdinal: number; group: NativeCommandIdentity; status: "completed" | "failed"; durationMs: number }>;
export type DetailState = "suppressed" | "no_native_partitions" | "details_available" | "details_partial" | "details_unavailable";
export type NativeCommandPartition = Readonly<Pick<SlowToolPartition, "id" | "sessionId" | "durationScope" | "timingEvidence" | "status" | "denominatorN" | "denominatorSumMs"> & {
  groups: readonly NativeCommandGroup[] | null; calls: readonly NativeCommandCall[] | null;
}>;
export const BREAKDOWN_HEADER_FIELDS = ["sourceId", "provider", "parserVersion", "normalizationVersion", "keyVersion", "revision", "completedOffset", "observedSize", "persistedScope", "availability"] as const;
export type CommandBreakdownHeader = Readonly<Pick<SourceSlowToolAnalysis, typeof BREAKDOWN_HEADER_FIELDS[number] | "assessment" | "suppressionReason">>;
export type SourceCommandBreakdown = CommandBreakdownHeader & Readonly<{
  schema: "agentprof.source-command-breakdown/v1"; state: DetailState; partitions: readonly NativeCommandPartition[];
}>;
function invalid(): never { throw new SafeError("INVALID_RECORD"); }
function limit(): never { throw new SafeError("REPORT_LIMIT"); }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const partitionKey = (p: Pick<SlowToolPartition, "sessionId" | "durationScope" | "timingEvidence">) => JSON.stringify([p.sessionId, p.durationScope, p.timingEvidence]);
const groupKey = (e: NativeCommandIdentity) => JSON.stringify([e.kind, e.category, e.toolName, e.commandPattern]);
const identity = (e: NativeCommandIdentity): NativeCommandIdentity => ({ kind: e.kind, category: e.category, toolName: e.toolName, commandPattern: e.commandPattern });
const valid = (n: number | null): n is number => n !== null && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
function sum(rows: readonly NormalizedEvent[]): number {
  let total = 0;
  for (const row of rows) {
    const n = row.durationMs;
    if (!valid(n) || n > Number.MAX_SAFE_INTEGER - total) invalid();
    total += n;
    if (!valid(total)) invalid();
  }
  return total;
}
function freeze<T>(v: T): T {
  if (v !== null && typeof v === "object") { for (const child of Object.values(v)) freeze(child); Object.freeze(v); }
  return v;
}
export function commandDetailState(suppression: SourceSlowToolAnalysis["suppressionReason"], partitions: readonly Pick<SlowToolPartition, "status">[]): DetailState {
  if (suppression !== null) return "suppressed";
  if (partitions.length === 0) return "no_native_partitions";
  const eligible = partitions.filter(p => p.status === "evaluated" || p.status === "zero_denominator").length;
  return eligible === 0 ? "details_unavailable" : eligible === partitions.length ? "details_available" : "details_partial";
}

/** A pure consistency join of one validated stored generation and its already computed native rule.
 * The analyzer owns admission. In particular, tentative unresolved IDs do not become detail rows. */
export function buildSourceCommandBreakdown(source: StoredSource, slow: SourceSlowToolAnalysis): SourceCommandBreakdown {
  for (const field of BREAKDOWN_HEADER_FIELDS) if (source[field] !== slow[field]) invalid();
  if (source.events.length > 4096 || slow.partitions.length > 4096) limit();
  let memberships = 0;
  for (const p of slow.partitions) { memberships += p.eventIds.length; if (memberships > 4096) limit(); }
  const events = new Map<string, NormalizedEvent>();
  for (const e of source.events) { if (events.has(e.id)) invalid(); events.set(e.id, e); }
  const used = new Set<string>(), partitionIds = new Set<string>(), tuples = new Set<string>();
  const partitions: NativeCommandPartition[] = slow.partitions.map(p => {
    const tuple = partitionKey(p);
    if (partitionIds.has(p.id) || tuples.has(tuple)) invalid();
    partitionIds.add(p.id); tuples.add(tuple);
    const head = { id: p.id, sessionId: p.sessionId, durationScope: p.durationScope, timingEvidence: p.timingEvidence,
      status: p.status, denominatorN: p.denominatorN, denominatorSumMs: p.denominatorSumMs };
    // Membership consistency is independent of whether a native partition is evaluable.
    const rows = [...p.eventIds].sort(compare).map(id => {
      const row = events.get(id);
      if (!row || used.has(id) || partitionKey(row) !== tuple) invalid();
      used.add(id); return row;
    });
    if (p.status === "identity_unresolved" || p.status === "numeric_overflow") return { ...head, groups: null, calls: null };
    if (p.status !== "evaluated" && p.status !== "zero_denominator") invalid();
    const denominator = p.denominatorSumMs;
    if (!valid(denominator) || p.denominatorN !== rows.length || rows.length === 0 ||
      (p.status === "zero_denominator") !== (denominator === 0) || sum(rows) !== denominator) invalid();
    const grouped = new Map<string, NormalizedEvent[]>();
    for (const row of rows) {
      if (row.status !== "completed" && row.status !== "failed") invalid();
      const key = groupKey(row), group = grouped.get(key);
      if (group) group.push(row); else grouped.set(key, [row]);
    }
    const ordered = [...grouped].map(([key, members]) => ({ key, group: identity(members[0]!), n: members.length, sumMs: sum(members) }))
      .sort((a, b) => b.sumMs - a.sumMs || b.n - a.n || compare(a.key, b.key));
    const ordinals = new Map<string, number>();
    const groups = ordered.map((g, i): NativeCommandGroup => {
      const share = denominator === 0 ? null : g.sumMs / denominator;
      if (g.sumMs > denominator || share !== null && (!valid(share) || share > 1)) invalid();
      ordinals.set(g.key, i + 1);
      return { ordinal: i + 1, group: g.group, n: g.n, sumMs: g.sumMs, share };
    });
    const calls = rows.map((e, i): NativeCommandCall => ({ ordinal: i + 1, groupOrdinal: ordinals.get(groupKey(e))!, group: identity(e),
      status: e.status as "completed" | "failed", durationMs: e.durationMs! }))
      .sort((a, b) => b.durationMs - a.durationMs || a.ordinal - b.ordinal);
    return { ...head, groups, calls };
  });
  const header = Object.fromEntries(BREAKDOWN_HEADER_FIELDS.map(field => [field, slow[field]])) as Pick<CommandBreakdownHeader, typeof BREAKDOWN_HEADER_FIELDS[number]>;
  return freeze({ schema: "agentprof.source-command-breakdown/v1", ...header, assessment: slow.assessment, suppressionReason: slow.suppressionReason,
    state: commandDetailState(slow.suppressionReason, partitions), partitions });
}
