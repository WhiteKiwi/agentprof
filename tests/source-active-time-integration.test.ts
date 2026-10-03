import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { analyzeSourceActiveTime } from "../src/analysis/source-active-time.js";
import { formatStatsResult, runStats, validateStatsArguments } from "../src/cli/stats.js";
import { openDatabase } from "../src/db/database.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import * as stores from "../src/db/source-store.js";
import * as active from "../src/analysis/source-active-time.js";
import * as summary from "../src/analysis/source-summary.js";
import * as recovery from "../src/analysis/source-recovery.js";
import * as retry from "../src/analysis/source-retry-overhead.js";
import * as native from "../src/analysis/source-failures.js";
import * as search from "../src/analysis/source-search-recurrence.js";
import * as read from "../src/analysis/source-read-revisits.js";
import * as overlap from "../src/analysis/source-invocation-overlap.js";
import { temporaryDirectory } from "./helpers.js";
import { bytes, capability, end, keyId, meta, observation, paired, pairedPositive, persisted, positive, record, snapshotInput, source, start, stored, turn, wall } from "./active-time-fixture.js";

const cases = [
  { name: "wall overlap", records: positive, union: 15000, span: 15000, eligible: 2, scope: "turn_wall" },
  { name: "paired cancellation and long gap", records: pairedPositive, union: 25000, span: 110000, eligible: 3, scope: "observed_turn" },
  { name: "native task_started terminal replay", records: [meta(), start("a", 0), end("a", 10000), start("a", 20000)], union: 10000, span: 10000, eligible: 1, scope: "observed_turn" },
  { name: "zero wall", records: [meta(), wall("zero", 0, 0)], union: 0, span: 0, eligible: 1, scope: "turn_wall" },
];
it.each(cases)("ordinary $name survives scan/store/raw deletion/read-only reopen", async test => {
  const x = await stored(test.records), before = await bytes(x.data), a = analyzeSourceActiveTime(x.source), result = await runStats({ dataDir: x.data, source: x.sourceId, activeTime: true });
  expect(existsSync(x.input)).toBe(false); expect(before.map(f => f.name)).toEqual(["agentprof.sqlite", "identity-key.json"]); expect(before.every(f => (f.mode & 0o777) === 0o600)).toBe(true);
  expect(result.mode).toBe("selected_source_active_time"); if (result.mode !== "selected_source_active_time") throw Error("wrong mode"); expect(result.analysis).toEqual(a);
  expect(a).toMatchObject({ assessment: "evaluated", revision: 1, sourceFreshnessChecked: false, completedOffset: Buffer.byteLength(x.raw), observedSize: Buffer.byteLength(x.raw), summary: { eligibleTurns: test.eligible, excludedTurns: 0, partitions: 1 }, partitions: [{ intervalScope: test.scope, activeTimeMs: test.union, observedSpanMs: test.span }] });
  const json = formatStatsResult(result, true), human = formatStatsResult(result, false); expect(JSON.parse(json).result).toEqual(result); expect(human).toContain(`active=${test.union} ms`); expect(human).toContain(`span=${test.span} ms`); expect(json + human).not.toMatch(/FICTITIOUS_|sourceRef|byteOffset|commandPattern|secret|synthetic.jsonl/);
  if (test.name === "wall overlap") { expect(x.source.evidence!.turns[0]!.durationMs).toBe(8150); expect(a.partitions![0]!.turnEvidence.every(t => t.evidenceObservationIds.length === 1)).toBe(true); }
  if (test.name === "native task_started terminal replay") expect(a.partitions![0]!.turnEvidence[0]!.evidenceObservationIds).toHaveLength(3);
  expect(await withReadOnlyStore(x.data, (db, key) => stores.createSourceStore(db, key).readSource(x.sourceId))).toEqual(x.source); expect(await bytes(x.data)).toEqual(before);
});
it("ordinary partial shape coverage retains observed union and source limitation", async () => {
  const x = await stored([...positive, record({ type: "FICTITIOUS_UNSUPPORTED" }, 20000)]), a = analyzeSourceActiveTime(x.source), before = await bytes(x.data);
  expect(a).toMatchObject({ assessment: "partial", capabilities: { coverage: "partial", unsupportedRecords: 1 }, partitions: [{ activeTimeMs: 15000 }] }); expect(a.limitations).toContain("partial_shape_coverage"); expect(formatStatsResult({ mode: "selected_source_active_time", analysis: a }, false)).toContain("coverage=partial"); expect(await bytes(x.data)).toEqual(before);
});
it("ordinary mixed missing and pending boundaries cannot be inferred from duration", async () => {
  const x = await stored([meta(), record({ type: "task_started", turn_id: "mixed", started_at: Date.UTC(2026, 9, 3) / 1000 }, 0), end("mixed", 10000), end("missing", 20000), start("pending", 30000)]), before = await bytes(x.data), a = analyzeSourceActiveTime(x.source);
  expect(a.summary).toEqual({ eligibleTurns: 0, excludedTurns: 3, partitions: 0 }); expect(a.exclusions).toMatchObject({ pending: 1, missingBoundaries: 1, unknownInterval: 1 }); expect(await bytes(x.data)).toEqual(before);
});
it("markUnavailable and events-only replacement retain unavailable reasons after actual reopen", async () => {
  const x = await stored(); let db = await openDatabase(x.data);
  try { expect(stores.createSourceStore(db, keyId).markUnavailable(x.sourceId, 1).status).toBe("committed"); } finally { db.close(); }
  let before = await bytes(x.data), r = await runStats({ dataDir: x.data, source: x.sourceId, activeTime: true });
  expect(r).toMatchObject({ analysis: { assessment: "unavailable", activeTimeAssessmentReason: "source_unavailable", revision: 2, partitions: null } }); expect(await bytes(x.data)).toEqual(before);
  db = await openDatabase(x.data); const { evidence: _evidence, ...input } = snapshotInput(x.source);
  try { expect(stores.createSourceStore(db, keyId).replaceSource(input, 2).status).toBe("committed"); } finally { db.close(); }
  before = await bytes(x.data); r = await runStats({ dataDir: x.data, source: x.sourceId, activeTime: true }); expect(r).toMatchObject({ analysis: { assessment: "unavailable", activeTimeAssessmentReason: "evidence_absent", revision: 3, partitions: null } }); expect(await bytes(x.data)).toEqual(before);
});
describe("actual persisted broader shape contract remains narrower metric admission", () => {
  const t = turn("t", 0, 10000), base = source([t]);
  const tests = [
    ["stateLimited", capability(base, { stateLimited: true }), "state_limited"], ["dropped", capability(base, { diagnosticsDropped: 1 }), "state_limited"], ["ambiguous", capability(base, { ambiguousRecords: 1 }), "ambiguous_origin"],
    ["mixed endpoint", source([{ ...t, endTimingEvidence: "paired_timestamps" }]), "inconsistentInterval"], ["wrong scope", source([{ ...t, intervalScope: "observed_turn" }]), "inconsistentInterval"],
    ["estimated", source([{ ...t, startTimingEvidence: "estimated", endTimingEvidence: "estimated", intervalTimingEvidence: "estimated" }]), "estimatedTiming"], ["unknown", source([{ ...t, status: "unknown" }]), "unknownStatus"],
    ["missing terminal", source([t], []), "missingTerminalProof"], ["terminal ref mismatch", source([t], [observation(t, { sourceRef: { ...t.sourceRef, byteOffset: 99 } })]), "missingTerminalProof"],
    ["terminal contradiction", source([t], [observation(t, { transportStatus: "cancelled" })]), "contradictoryTerminalProof"], ["paired pending missing", source([paired(t)], [observation(t)]), "missingPendingProof"],
  ] as const;
  it.each(tests)("keeps %s explicit after store validates and reopens", async (_name, input, reason) => {
    const x = await persisted(input), before = await bytes(x.data), r = await runStats({ dataDir: x.data, source: x.sourceId, activeTime: true });
    if (["state_limited", "ambiguous_origin"].includes(reason)) expect(r).toMatchObject({ analysis: { assessment: "unavailable", activeTimeAssessmentReason: reason, partitions: null } });
    else expect(r).toMatchObject({ analysis: { assessment: "no_eligible_turns", exclusions: { [reason]: 1 }, partitions: [] } });
    expect(await bytes(x.data)).toEqual(before);
  });
});
it("one pinned selected read, one active analysis and one source summary; no other metric", async () => {
  const x = await stored(), before = await bytes(x.data), original = stores.createSourceStore; let reads = 0;
  const storeSpy = vi.spyOn(stores, "createSourceStore").mockImplementation((db, key) => { const store = original(db, key); return { ...store, readSource(id) { reads++; expect(db.isTransaction).toBe(true); expect(id).toBe(x.sourceId); return store.readSource(id); }, listSources() { throw Error("catalogue not selected"); } }; });
  const selected = [vi.spyOn(active, "analyzeSourceActiveTime"), vi.spyOn(summary, "summarizeSource")], other = [vi.spyOn(retry, "analyzeSourceRetryOverhead"), vi.spyOn(recovery, "analyzeSourceRecovery"), vi.spyOn(native, "analyzeSourceFailures"), vi.spyOn(search, "analyzeSourceSearchRecurrence"), vi.spyOn(read, "analyzeSourceReadRevisits"), vi.spyOn(overlap, "analyzeSourceInvocationOverlap")];
  try { expect((await runStats({ dataDir: x.data, source: x.sourceId, activeTime: true })).mode).toBe("selected_source_active_time"); expect(reads).toBe(1); selected.forEach(spy => expect(spy).toHaveBeenCalledTimes(1)); other.forEach(spy => expect(spy).not.toHaveBeenCalled()); expect(await bytes(x.data)).toEqual(before); }
  finally { storeSpy.mockRestore(); selected.forEach(spy => spy.mockRestore()); other.forEach(spy => spy.mockRestore()); }
});
it("omitted and false preserve all older selection outputs without active analysis", async () => {
  const x = await stored(), before = await bytes(x.data), spy = vi.spyOn(active, "analyzeSourceActiveTime").mockImplementation(() => { throw Error("active not selected"); });
  try { for (const selection of [{ listSources: true }, { source: x.sourceId }, ...["failures", "readRevisits", "invocationOverlap", "searchRecurrence", "recovery", "retryOverhead"].map(flag => ({ source: x.sourceId, [flag]: true }))]) {
    const omitted = await runStats({ dataDir: x.data, ...selection }), disabled = await runStats({ dataDir: x.data, ...selection, activeTime: false }); for (const json of [false, true]) expect(formatStatsResult(disabled, json)).toBe(formatStatsResult(omitted, json));
  } expect(spy).not.toHaveBeenCalled(); expect(await bytes(x.data)).toEqual(before); } finally { spy.mockRestore(); }
});
it("wrong-key/missing selection cannot change storage", async () => {
  const x = await stored(), before = await bytes(x.data); for (const [selected, code] of [[x.sourceId.replace(keyId, "6".repeat(32)), "INVALID_IDENTITY_KEY"], [`h1:${keyId}:source:${"0".repeat(64)}`, "SOURCE_NOT_FOUND"]]) await expect(runStats({ dataDir: x.data, source: selected, activeTime: true })).rejects.toMatchObject({ code }); expect(await bytes(x.data)).toEqual(before);
});
const full = `h1:${"a".repeat(32)}:source:${"b".repeat(64)}`;
it.each([null, 0, 1, "", "false", "true", [], {}])("nonboolean activeTime=%j rejects before storage", activeTime => { const data = join(temporaryDirectory(), "absent"); expect(() => validateStatsArguments({ dataDir: data, source: full, activeTime: activeTime as never })).toThrow(); expect(existsSync(data)).toBe(false); });
it.each([{}, { listSources: true }, { source: full, listSources: true }, ...["failures", "readRevisits", "invocationOverlap", "searchRecurrence", "recovery", "retryOverhead"].map(flag => ({ source: full, [flag]: true })), { source: full, codexRoot: ["FICTITIOUS_PRIVATE"] }, { source: full, claudeRoot: ["FICTITIOUS_PRIVATE"] }])("conflicting active selection %j rejects before storage", selection => { const data = join(temporaryDirectory(), "absent"); expect(() => validateStatsArguments({ dataDir: data, ...selection, activeTime: true })).toThrow(); expect(existsSync(data)).toBe(false); });
