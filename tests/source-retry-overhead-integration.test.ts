import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { analyzeSourceRetryOverhead } from "../src/analysis/source-retry-overhead.js";
import { formatStatsResult, runStats, validateStatsArguments } from "../src/cli/stats.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import * as stores from "../src/db/source-store.js";
import * as retry from "../src/analysis/source-retry-overhead.js";
import * as recovery from "../src/analysis/source-recovery.js";
import * as native from "../src/analysis/source-failures.js";
import * as summary from "../src/analysis/source-summary.js";
import * as search from "../src/analysis/source-search-recurrence.js";
import * as read from "../src/analysis/source-read-revisits.js";
import * as overlap from "../src/analysis/source-invocation-overlap.js";
import { temporaryDirectory } from "./helpers.js";
import { bytes, call, keyId, meta, output, positive, result, stored, structured, structuredMcp, turn } from "./retry-overhead-fixture.js";

const ordinary = [
  { name: "stored 20 ms", records: positive, duration: 20, overhead: 1000, failed: 1 },
  { name: "stored fractional 1.5 ms", records: [meta(), turn(), structured("f", 0, 1000, 2, 1.5), structured("s", 5000, 6000)], duration: 1.5, overhead: 1000, failed: 1 },
  { name: "stored zero ms", records: [meta(), turn(), structured("f", 0, 1000, 2, 0), structured("s", 5000, 6000)], duration: 0, overhead: 1000, failed: 1 },
  { name: "stored missing duration", records: [meta(), turn(), structured("f", 0, 1000, 2, null), structured("s", 5000, 6000)], duration: null, overhead: 1000, failed: 1 },
  { name: "paired invocation", records: [meta(), turn(), call("f", 0), result("f", 1000, 2), call("s", 5000), result("s", 6000)], duration: 1000, overhead: 1000, failed: 1 },
  { name: "structured MCP invocation latency", records: [meta(), turn(), structuredMcp("f", 0, 1000, true, 1.5), structuredMcp("s", 5000, 6000, false, 20)], duration: 1.5, overhead: 1000, failed: 1 },
  { name: "three failures then success", records: [meta(), turn(), structured("f1", 0, 1000, 2, 20), structured("f2", 2000, 2250, 2, 1.5), structured("f3", 3000, 3000, 2, 0), structured("s", 4000, 10000, 0, 6000)], duration: 21.5, overhead: 1250, failed: 3 },
  { name: "parallel distinct operations", records: [meta(), turn(), structured("fa", 0, 1000, 2, 20, "rg FICTITIOUS_A src"), structured("fb", 500, 1500, 2, 20, "rg FICTITIOUS_B src"), structured("sa", 2000, 2500, 0, 20, "rg FICTITIOUS_A src"), structured("sb", 3000, 4000, 0, 20, "rg FICTITIOUS_B src")], duration: 40, overhead: 1500, failed: 2 },
];
describe("ordinary synthetic scan/store/raw-delete/reopen duration and interval oracles", () => {
  it.each(ordinary)("preserves $name independently of lifecycle length", async test => {
    const x = await stored(test.records), before = await bytes(x.data), a = analyzeSourceRetryOverhead(x.source), r = await runStats({ dataDir: x.data, source: x.sourceId, retryOverhead: true });
    expect(existsSync(x.input)).toBe(false); expect(before.map(f => f.name)).toEqual(["agentprof.sqlite", "identity-key.json"]); expect(before.every(f => (f.mode & 0o777) === 0o600)).toBe(true);
    expect(r.mode).toBe("selected_source_retry_overhead"); if (r.mode !== "selected_source_retry_overhead") throw Error("wrong selection"); expect(r.analysis).toEqual(a);
    expect(a.summary).toMatchObject({ failedAttemptN: test.failed, failedAttemptDurationSumMs: test.duration, retryOverheadMs: test.overhead, unresolvedChainN: 0 });
    if (test.failed === 1) expect(x.source.events.find(e => e.status === "failed")!.durationMs).toBe(test.duration);
    expect(a).toMatchObject({ summaryScope: "admitted_recovery_chains", revision: 1, parserVersion: 1, normalizationVersion: 1, keyVersion: 1, availability: "available", persistedScope: "events_and_metric_evidence", completedOffset: Buffer.byteLength(x.raw), observedSize: Buffer.byteLength(x.raw), sourceFreshnessChecked: false, aggregationReady: false, parserResumeReady: false, crossSourceReconciled: false, queryPeriod: null, observationWindow: { unit: "source_bytes", startInclusive: 0, endExclusive: Buffer.byteLength(x.raw) } });
    const json = formatStatsResult(r, true), human = formatStatsResult(r, false); expect(JSON.parse(json).result).toEqual(r); expect(human).toContain(`Admitted failed duration sum=${test.duration === null ? "unavailable" : test.duration} ms`); expect(human).toContain(`retry overhead union=${test.overhead} ms`); expect(json + human).not.toMatch(/FICTITIOUS_|operationKey|errorFingerprint|contentFingerprint|sourceRef|commandPattern|synthetic.jsonl/);
    for (const e of x.source.events) if (e.operationKey) expect(json + human).not.toContain(e.operationKey);
    const reopened = await withReadOnlyStore(x.data, (db, key) => stores.createSourceStore(db, key).readSource(x.sourceId)); expect(reopened).toEqual(x.source); expect(await bytes(x.data)).toEqual(before);
    if (test.duration === null) { expect(a.durationCoverage!.exclusions).toEqual({ missing_duration: 1 }); expect(a.summary.measuredFailedAttemptN).toBe(0); }
    if (test.name === "parallel distinct operations") expect(a.chains!.map(c => c.retryOverheadMs)).toEqual([1000, 1000]);
  });
  it("ordinary mixed interval representations remain two partitions and null scalar totals", async () => {
    const x = await stored([meta(), turn(), structured("structured-f", 0, 1000, 2), structured("structured-s", 5000, 6000), call("paired-f", 500, "rg FICTITIOUS_OTHER src"), result("paired-f", 1500, 2), call("paired-s", 6500, "rg FICTITIOUS_OTHER src"), result("paired-s", 7500)]), before = await bytes(x.data), a = analyzeSourceRetryOverhead(x.source);
    expect(a.chains).toHaveLength(2); expect(a.durationCohorts!.map(c => c.sumMs).sort((a, b) => a! - b!)).toEqual([20, 1000]); expect(a.intervalPartitions!.map(p => p.retryOverheadMs)).toEqual([1000, 1000]); expect(a.summary).toMatchObject({ failedAttemptDurationSumMs: null, retryOverheadMs: null, failedAttemptDurationSumReason: "incompatible_duration_cohorts", retryOverheadReason: "incompatible_interval_partitions" }); expect(await bytes(x.data)).toEqual(before);
  });
  it("ordinary explicit sessions remain distinct after one source persists", async () => {
    const other = [structured("second-f", 0, 1000, 2), structured("second-s", 5000, 6000)].map(r => ({ ...r, payload: { ...r.payload, thread_id: "FICTITIOUS_RETRY_SECOND_SESSION", item: { ...r.payload.item, cwd: "/FICTITIOUS_RETRY_ROOT" } } }));
    const x = await stored([...positive, ...other]), before = await bytes(x.data), a = analyzeSourceRetryOverhead(x.source);
    expect(new Set(x.source.events.map(e => e.sessionId)).size).toBe(2); expect(a.chains).toHaveLength(2); expect(a.intervalPartitions).toHaveLength(2); expect(a.durationCohorts).toHaveLength(2); expect(a.summary.retryOverheadMs).toBeNull(); expect(a.summary.failedAttemptDurationSumMs).toBeNull(); expect(await bytes(x.data)).toEqual(before);
  });
  it("ordinary partial/pending operation exposes one blocked known failure without erasing admitted measurements", async () => {
    const x = await stored([...positive, call("blocked-f", 7000, "rg FICTITIOUS_BLOCKED src"), result("blocked-f", 8000, 2), call("blocked-p", 9000, "rg FICTITIOUS_BLOCKED src"), output("blocked-p", 9500, { session_id: 1042 })]), before = await bytes(x.data), a = analyzeSourceRetryOverhead(x.source), human = formatStatsResult({ mode: "selected_source_retry_overhead", analysis: a }, false);
    expect(a).toMatchObject({ assessment: "partial", capabilities: { coverage: "partial" }, summary: { chainN: 1, failedAttemptN: 1, failedAttemptDurationSumMs: 20, retryOverheadMs: 1000 }, recoveryContext: { summary: { knownFailedAttempts: 2, unavailableGroups: 1, unavailableKnownFailedAttempts: 1 } } });
    expect(a.recoveryContext.unavailableGroups[0]!.reasons).toContain("pending_attempt"); expect(a.recoveryContext.limitations).toContain("partial_shape_coverage"); expect(human).toContain("blocked known failures=1"); expect(human).toContain("pending_attempt"); expect(await bytes(x.data)).toEqual(before);
  });
  it("ordinary unresolved failure remains measurable after raw deletion", async () => {
    const x = await stored([meta(), turn(), structured("unresolved", 0, 1000, 2)]), before = await bytes(x.data), a = analyzeSourceRetryOverhead(x.source);
    expect(a.summary).toMatchObject({ unresolvedChainN: 1, resolvedChainN: 0, failedAttemptDurationSumMs: 20, retryOverheadMs: 1000 }); expect(a.chains![0]).toMatchObject({ resolved: false, terminalSuccessEventId: null, successfulResultAt: null }); expect(await bytes(x.data)).toEqual(before);
  });
});

it("performs one pinned selected read, one retry analyzer, one unchanged Recovery and native proof analysis", async () => {
  const x = await stored(), before = await bytes(x.data), original = stores.createSourceStore; let reads = 0;
  const storeSpy = vi.spyOn(stores, "createSourceStore").mockImplementation((db, key) => { const store = original(db, key); return { ...store, readSource(id) { reads++; expect(db.isTransaction).toBe(true); expect(id).toBe(x.sourceId); return store.readSource(id); }, listSources() { throw Error("unexpected catalogue read"); } }; });
  const selected = [vi.spyOn(retry, "analyzeSourceRetryOverhead"), vi.spyOn(recovery, "analyzeSourceRecovery"), vi.spyOn(native, "analyzeSourceFailures")], other = [vi.spyOn(summary, "summarizeSource"), vi.spyOn(search, "analyzeSourceSearchRecurrence"), vi.spyOn(read, "analyzeSourceReadRevisits"), vi.spyOn(overlap, "analyzeSourceInvocationOverlap")];
  try { expect((await runStats({ dataDir: x.data, source: x.sourceId, retryOverhead: true })).mode).toBe("selected_source_retry_overhead"); expect(reads).toBe(1); selected.forEach(spy => expect(spy).toHaveBeenCalledTimes(1)); other.forEach(spy => expect(spy).not.toHaveBeenCalled()); expect(await bytes(x.data)).toEqual(before); }
  finally { storeSpy.mockRestore(); selected.forEach(spy => spy.mockRestore()); other.forEach(spy => spy.mockRestore()); }
});
it("omitted and false preserve every existing stats selection without running retry analysis", async () => {
  const x = await stored(), before = await bytes(x.data), spy = vi.spyOn(retry, "analyzeSourceRetryOverhead").mockImplementation(() => { throw Error("retry not selected"); });
  try {
    for (const selection of [{ listSources: true }, { source: x.sourceId }, ...["failures", "readRevisits", "invocationOverlap", "searchRecurrence", "recovery"].map(flag => ({ source: x.sourceId, [flag]: true }))]) {
      const omitted = await runStats({ dataDir: x.data, ...selection }), disabled = await runStats({ dataDir: x.data, ...selection, retryOverhead: false }); for (const json of [false, true]) expect(formatStatsResult(disabled, json)).toBe(formatStatsResult(omitted, json));
    }
    expect(spy).not.toHaveBeenCalled(); expect(await bytes(x.data)).toEqual(before);
  } finally { spy.mockRestore(); }
});
it("wrong-key and missing identities preserve storage and subsequent selected reads", async () => {
  const x = await stored(), before = await bytes(x.data);
  for (const [source, code] of [[x.sourceId.replace(keyId, "6".repeat(32)), "INVALID_IDENTITY_KEY"], [`h1:${keyId}:source:${"0".repeat(64)}`, "SOURCE_NOT_FOUND"]]) await expect(runStats({ dataDir: x.data, source, retryOverhead: true })).rejects.toMatchObject({ code });
  expect(await bytes(x.data)).toEqual(before); expect((await runStats({ dataDir: x.data, source: x.sourceId, retryOverhead: true })).mode).toBe("selected_source_retry_overhead"); expect(await bytes(x.data)).toEqual(before);
});
const full = `h1:${"a".repeat(32)}:source:${"b".repeat(64)}`;
it.each([null, 0, 1, "", "false", "true", [], {}])("rejects nonboolean retryOverhead=%j before I/O", retryOverhead => {
  const data = join(temporaryDirectory(), "absent"); expect(() => validateStatsArguments({ dataDir: data, source: full, retryOverhead: retryOverhead as never })).toThrow(); expect(existsSync(data)).toBe(false);
});
it.each([{}, { listSources: true }, { source: full, listSources: true }, ...["failures", "readRevisits", "invocationOverlap", "searchRecurrence", "recovery"].map(flag => ({ source: full, [flag]: true })), { source: full, codexRoot: ["FICTITIOUS_PRIVATE"] }, { source: full, claudeRoot: ["FICTITIOUS_PRIVATE"] }])("rejects conflicting retry selection %j before I/O", selection => {
  const data = join(temporaryDirectory(), "absent"); expect(() => validateStatsArguments({ dataDir: data, ...selection, retryOverhead: true })).toThrow(); expect(existsSync(data)).toBe(false);
});
