import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertScanHelpEnrollmentDelta } from "./scan-help-compatibility.js";
import { assertTopHelpDirectoryDelta } from "./top-help-compatibility.js";
import { formatStatsResult, runStats, validateStatsArguments } from "../src/cli/stats.js";
import * as stores from "../src/db/source-store.js";
import * as summary from "../src/analysis/source-summary.js";
import * as active from "../src/analysis/source-active-time.js";
import * as retry from "../src/analysis/source-retry-overhead.js";
import * as recovery from "../src/analysis/source-recovery.js";
import * as native from "../src/analysis/source-failures.js";
import * as search from "../src/analysis/source-search-recurrence.js";
import * as read from "../src/analysis/source-read-revisits.js";
import * as overlap from "../src/analysis/source-invocation-overlap.js";
import { temporaryDirectory } from "./helpers.js";
import { binary, bytes, input, invoke, keyId, persisted, scanned, sourceId } from "./time-breakdown-support.js";
import { stored as storedRetry } from "./retry-overhead-fixture.js";
import { stored as storedActive } from "./active-time-fixture.js";
import { input as tokensInput } from "./tokens-support.js";

const previousModes = ["failures", "readRevisits", "invocationOverlap", "searchRecurrence", "recovery", "retryOverhead", "activeTime", "tokens"];
const flags = ["--failures", "--read-revisits", "--invocation-overlap", "--search-recurrence", "--recovery", "--retry-overhead", "--active-time", "--tokens"];
const invalid = [[], ["--source", "bad"], ["--source", sourceId, "--source", sourceId], ["--list-sources"], ["--source", sourceId, "--list-sources"], ...flags.map(flag => ["--source", sourceId, flag]), ["--source", sourceId, "--time-breakdown"], ["--source", sourceId, "--codex-root", "FICTITIOUS_PRIVATE"], ["--source", sourceId, "--claude-root", "FICTITIOUS_PRIVATE"], ["--source", sourceId, "extra"], ["--source", sourceId, "--last", "7d"], ["--source", sourceId, "--time-breakdown=true"], ["--source", sourceId, "--time-breakdown=false"]];
it.each(invalid.map(args => [args]))("invalid time-breakdown arguments reject before I/O: %j", args => {
  const data = join(temporaryDirectory(), "absent"), r = invoke(binary, data, ["--json", "stats", "--time-breakdown", ...args]); expect(r.status).toBe(2); expect(r.stdout).toBe(""); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false); expect(r.stderr).not.toMatch(/FICTITIOUS_|SQLite/);
});
it.each(["scan", "insights", "report", "open"])("time-breakdown is rejected by %s before I/O", command => { const data = join(temporaryDirectory(), "absent"), r = invoke(binary, data, ["--json", command, "--time-breakdown"]); expect(r.status).toBe(2); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false); });
it("help/version and valid missing-store selection never initialize a directory", () => {
  const data = join(temporaryDirectory(), "absent"); for (const args of [["--help"], ["--version"], ["stats", "--help"]]) { const r = invoke(binary, data, args); expect(r.status).toBe(0); expect(r.stderr).toBe(""); }
  const r = invoke(binary, data, ["--json", "stats", "--source", sourceId, "--time-breakdown"]); expect(r.status).toBe(2); expect(JSON.parse(r.stderr).error.code).toBe("STORE_NOT_FOUND"); expect(existsSync(data)).toBe(false);
});
it.each([null, 0, 1, "", "false", "true", [], {}])("programmatic nonboolean timeBreakdown=%j rejects before I/O", timeBreakdown => { const data = join(temporaryDirectory(), "absent"); expect(() => validateStatsArguments({ dataDir: data, source: sourceId, timeBreakdown: timeBreakdown as never })).toThrow(); expect(existsSync(data)).toBe(false); });
it.each([{}, { listSources: true }, { source: sourceId, listSources: true }, ...previousModes.map(flag => ({ source: sourceId, [flag]: true })), { source: sourceId, codexRoot: ["FICTITIOUS_PRIVATE"] }, { source: sourceId, claudeRoot: ["FICTITIOUS_PRIVATE"] }])("programmatic conflicting selection rejects before I/O: %j", selection => { const data = join(temporaryDirectory(), "absent"); expect(() => validateStatsArguments({ dataDir: data, ...selection, timeBreakdown: true })).toThrow(); expect(existsSync(data)).toBe(false); });
it("uses one pinned source read and one unchanged summary without another selected analyzer", async () => {
  const x = await persisted(input()), before = await bytes(x.data), original = stores.createSourceStore; let reads = 0;
  const storeSpy = vi.spyOn(stores, "createSourceStore").mockImplementation((db, key) => { const store = original(db, key); return { ...store, readSource(id) { reads++; expect(db.isTransaction).toBe(true); expect(id).toBe(x.sourceId); return store.readSource(id); }, listSources() { throw Error("catalogue not selected"); } }; });
  const selected = vi.spyOn(summary, "summarizeSource"), other = [vi.spyOn(active, "analyzeSourceActiveTime"), vi.spyOn(retry, "analyzeSourceRetryOverhead"), vi.spyOn(recovery, "analyzeSourceRecovery"), vi.spyOn(native, "analyzeSourceFailures"), vi.spyOn(search, "analyzeSourceSearchRecurrence"), vi.spyOn(read, "analyzeSourceReadRevisits"), vi.spyOn(overlap, "analyzeSourceInvocationOverlap")];
  try { const r = await runStats({ dataDir: x.data, source: x.sourceId, timeBreakdown: true }); expect(r.mode).toBe("selected_source_time_breakdown"); expect(reads).toBe(1); expect(selected).toHaveBeenCalledTimes(1); other.forEach(spy => expect(spy).not.toHaveBeenCalled()); expect(await bytes(x.data)).toEqual(before); }
  finally { storeSpy.mockRestore(); selected.mockRestore(); other.forEach(spy => spy.mockRestore()); }
});
it("absent and explicit-false timeBreakdown retain every previous selection output", async () => {
  const x = await persisted(input()), before = await bytes(x.data); for (const selection of [{ listSources: true }, { source: x.sourceId }, ...previousModes.map(flag => ({ source: x.sourceId, [flag]: true }))]) {
    const omitted = await runStats({ dataDir: x.data, ...selection }), disabled = await runStats({ dataDir: x.data, ...selection, timeBreakdown: false }); for (const json of [false, true]) expect(formatStatsResult(disabled, json)).toBe(formatStatsResult(omitted, json));
  } expect(await bytes(x.data)).toEqual(before);
});
it("wrong-key and absent full identities preserve the database and key", async () => {
  const x = await persisted(input()), before = await bytes(x.data); for (const [selected, code] of [[x.sourceId.replace(keyId, "7".repeat(32)), "INVALID_IDENTITY_KEY"], [`h1:${keyId}:source:${"0".repeat(64)}`, "SOURCE_NOT_FOUND"]]) await expect(runStats({ dataDir: x.data, source: selected, timeBreakdown: true })).rejects.toMatchObject({ code }); expect(await bytes(x.data)).toEqual(before);
});

const baseline = process.env["AGENTPROF_TIME_BREAKDOWN_BASELINE_BINARY"];
describe.skipIf(!baseline)("authentic immediate PR61 predecessor", () => {
  it("preserves full previous commands/modes and removes only two exact new stats-help rows", async () => {
    const x = await scanned(), before = await bytes(x.data);
    for (const args of [["--version"], ["--help"], ["scan", "--help"], ["insights", "--help"], ["report", "--help"], ["open", "--help"]]) {
      if (args[0] === "--help") assertTopHelpDirectoryDelta(invoke(binary, x.data, args), invoke(baseline!, x.data, args));
      else if (args[0] === "scan") assertScanHelpEnrollmentDelta(invoke(binary, x.data, args), invoke(baseline!, x.data, args));
      else expect(invoke(binary, x.data, args)).toEqual(invoke(baseline!, x.data, args));
    }
    for (const args of [["stats", "--list-sources"], ["stats", "--source", x.sourceId], ["insights", "--source", x.sourceId], ...flags.map(flag => ["stats", "--source", x.sourceId, flag])]) for (const format of [[], ["--json"]]) expect(invoke(binary, x.data, [...args, ...format])).toEqual(invoke(baseline!, x.data, [...args, ...format]));
    const old = invoke(baseline!, x.data, ["stats", "--help"]), current = invoke(binary, x.data, ["stats", "--help"]), option = "  --time-breakdown      show recorded tool/command/category durations\n", note = "--time-breakdown requires --source and excludes other stats modes; recorded duration sums may overlap and are not elapsed/busy time or savings.\n";
    expect(current.status).toBe(0); expect(current.stderr).toBe(""); expect(current.stdout.split(option)).toHaveLength(2); expect(current.stdout.split(note)).toHaveLength(2); expect(old.stdout).not.toContain("--time-breakdown"); expect(current.stdout.replace(option, "").replace(note, "")).toBe(old.stdout); expect(await bytes(x.data)).toEqual(before);
  });
  it("retains nonempty genuine Recovery/retry/Active Time/tokens results", async () => {
    const retrySource = await storedRetry(), activeSource = await storedActive(), tokenSource = await persisted(tokensInput());
    for (const [x, flag, key, expected] of [[retrySource, "--recovery", "analysis", { summary: { resolvedChains: 1 } }], [retrySource, "--retry-overhead", "analysis", { summary: { resolvedChainN: 1, failedAttemptN: 1 } }], [activeSource, "--active-time", "analysis", { partitions: [{ activeTimeMs: 15000, observedSpanMs: 15000 }] }], [tokenSource, "--tokens", "summary", { usage: [{ observedResponses: 1, counts: { input: 80, output: 12, total: 92 } }] }]] as const) {
      const before = await bytes(x.data); for (const format of [[], ["--json"]]) { const args = ["stats", "--source", x.sourceId, flag, ...format], previous = invoke(baseline!, x.data, args), current = invoke(binary, x.data, args); expect(previous.status).toBe(0); expect(current).toEqual(previous); if (format.length) expect(JSON.parse(current.stdout).result[key]).toMatchObject(expected); } expect(await bytes(x.data)).toEqual(before);
    }
  });
});
