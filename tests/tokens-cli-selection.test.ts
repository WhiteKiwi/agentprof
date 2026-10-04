import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertScanHelpEnrollmentDelta } from "./scan-help-compatibility.js";
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
import { binary, bytes, invoke, keyId, persisted, scanned, sourceId } from "./tokens-support.js";
import { stored as storedRetry } from "./retry-overhead-fixture.js";
import { stored as storedActive } from "./active-time-fixture.js";

const flags = ["--failures", "--read-revisits", "--invocation-overlap", "--search-recurrence", "--recovery", "--retry-overhead", "--active-time"];
const invalid = [[], ["--source", "bad"], ["--source", sourceId, "--source", sourceId], ["--list-sources"], ["--source", sourceId, "--list-sources"], ...flags.map(flag => ["--source", sourceId, flag]), ["--source", sourceId, "--tokens"], ["--source", sourceId, "--codex-root", "FICTITIOUS_PRIVATE"], ["--source", sourceId, "--claude-root", "FICTITIOUS_PRIVATE"], ["--source", sourceId, "extra"], ["--source", sourceId, "--last", "7d"], ["--source", sourceId, "--tokens=true"], ["--source", sourceId, "--tokens=false"]];
it.each(invalid.map(args => [args]))("invalid tokens arguments reject before I/O: %j", args => {
  const data = join(temporaryDirectory(), "absent"), r = invoke(binary, data, ["--json", "stats", "--tokens", ...args]); expect(r.status).toBe(2); expect(r.stdout).toBe(""); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false); expect(r.stderr).not.toMatch(/FICTITIOUS_|SQLite/);
});
it.each(["scan", "insights", "report", "open"])("tokens option is rejected by %s before I/O", command => { const data = join(temporaryDirectory(), "absent"), r = invoke(binary, data, ["--json", command, "--tokens"]); expect(r.status).toBe(2); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false); });
it("help/version and valid missing-store tokens never initialize a directory", () => {
  const data = join(temporaryDirectory(), "absent"); for (const args of [["--help"], ["--version"], ["stats", "--help"]]) { const r = invoke(binary, data, args); expect(r.status).toBe(0); expect(r.stderr).toBe(""); }
  const r = invoke(binary, data, ["--json", "stats", "--source", sourceId, "--tokens"]); expect(r.status).toBe(2); expect(JSON.parse(r.stderr).error.code).toBe("STORE_NOT_FOUND"); expect(existsSync(data)).toBe(false);
});
it.each([null, 0, 1, "", "false", "true", [], {}])("programmatic nonboolean tokens=%j rejects before I/O", tokens => { const data = join(temporaryDirectory(), "absent"); expect(() => validateStatsArguments({ dataDir: data, source: sourceId, tokens: tokens as never })).toThrow(); expect(existsSync(data)).toBe(false); });
it.each([{}, { listSources: true }, { source: sourceId, listSources: true }, ...["failures", "readRevisits", "invocationOverlap", "searchRecurrence", "recovery", "retryOverhead", "activeTime"].map(flag => ({ source: sourceId, [flag]: true })), { source: sourceId, codexRoot: ["FICTITIOUS_PRIVATE"] }, { source: sourceId, claudeRoot: ["FICTITIOUS_PRIVATE"] }])("programmatic conflicting tokens selection rejects before I/O: %j", selection => { const data = join(temporaryDirectory(), "absent"); expect(() => validateStatsArguments({ dataDir: data, ...selection, tokens: true })).toThrow(); expect(existsSync(data)).toBe(false); });
it("uses one pinned source read and one unchanged summary with no other selected analyzer", async () => {
  const x = await persisted(), before = await bytes(x.data), original = stores.createSourceStore; let reads = 0;
  const storeSpy = vi.spyOn(stores, "createSourceStore").mockImplementation((db, key) => { const store = original(db, key); return { ...store, readSource(id) { reads++; expect(db.isTransaction).toBe(true); expect(id).toBe(x.sourceId); return store.readSource(id); }, listSources() { throw Error("catalogue not selected"); } }; });
  const selected = vi.spyOn(summary, "summarizeSource"), other = [vi.spyOn(active, "analyzeSourceActiveTime"), vi.spyOn(retry, "analyzeSourceRetryOverhead"), vi.spyOn(recovery, "analyzeSourceRecovery"), vi.spyOn(native, "analyzeSourceFailures"), vi.spyOn(search, "analyzeSourceSearchRecurrence"), vi.spyOn(read, "analyzeSourceReadRevisits"), vi.spyOn(overlap, "analyzeSourceInvocationOverlap")];
  try { const r = await runStats({ dataDir: x.data, source: x.sourceId, tokens: true }); expect(r.mode).toBe("selected_source_tokens"); expect(reads).toBe(1); expect(selected).toHaveBeenCalledTimes(1); other.forEach(spy => expect(spy).not.toHaveBeenCalled()); expect(await bytes(x.data)).toEqual(before); }
  finally { storeSpy.mockRestore(); selected.mockRestore(); other.forEach(spy => spy.mockRestore()); }
});
it("omitted and explicit-false tokens retain every previous selection result", async () => {
  const x = await persisted(), before = await bytes(x.data); for (const selection of [{ listSources: true }, { source: x.sourceId }, ...["failures", "readRevisits", "invocationOverlap", "searchRecurrence", "recovery", "retryOverhead", "activeTime"].map(flag => ({ source: x.sourceId, [flag]: true }))]) {
    const omitted = await runStats({ dataDir: x.data, ...selection }), disabled = await runStats({ dataDir: x.data, ...selection, tokens: false }); for (const json of [false, true]) expect(formatStatsResult(disabled, json)).toBe(formatStatsResult(omitted, json));
  } expect(await bytes(x.data)).toEqual(before);
});
it("wrong-key and absent full identities preserve existing database/key", async () => {
  const x = await persisted(), before = await bytes(x.data); for (const [selected, code] of [[x.sourceId.replace(keyId, "7".repeat(32)), "INVALID_IDENTITY_KEY"], [`h1:${keyId}:source:${"0".repeat(64)}`, "SOURCE_NOT_FOUND"]]) await expect(runStats({ dataDir: x.data, source: selected, tokens: true })).rejects.toMatchObject({ code }); expect(await bytes(x.data)).toEqual(before);
});

const baseline = process.env["AGENTPROF_TOKENS_BASELINE_BINARY"];
describe.skipIf(!baseline)("authentic immediate PR59 predecessor", () => {
  it("keeps complete previous human/JSON commands/modes and changes only two exact stats-help rows", async () => {
    const x = await scanned(), before = await bytes(x.data);
    for (const args of [["--version"], ["--help"], ["scan", "--help"], ["insights", "--help"], ["report", "--help"], ["open", "--help"]]) {
      if (args[0] === "scan") assertScanHelpEnrollmentDelta(invoke(binary, x.data, args), invoke(baseline!, x.data, args));
      else expect(invoke(binary, x.data, args)).toEqual(invoke(baseline!, x.data, args));
    }
    for (const args of [["stats", "--list-sources"], ["stats", "--source", x.sourceId], ["insights", "--source", x.sourceId], ...flags.map(flag => ["stats", "--source", x.sourceId, flag])]) for (const format of [[], ["--json"]]) expect(invoke(binary, x.data, [...args, ...format])).toEqual(invoke(baseline!, x.data, [...args, ...format]));
    const old = invoke(baseline!, x.data, ["stats", "--help"]), current = invoke(binary, x.data, ["stats", "--help"]), option = "  --tokens              show observed final-response token attribution\n", note = "--tokens requires --source and excludes other stats modes; observed eligible final-response usage only; no cost, tool attribution or savings claim.\n";
    expect(current.status).toBe(0); expect(current.stderr).toBe(""); expect(current.stdout.split(option)).toHaveLength(2); expect(current.stdout.split(note)).toHaveLength(2); expect(old.stdout).not.toContain("--tokens"); expect(current.stdout.replace(option, "").replace(note, "")).toBe(old.stdout); expect(await bytes(x.data)).toEqual(before);
  });
  it("preserves nonempty immediate-predecessor Recovery, retry and Active Time results", async () => {
    const retrySource = await storedRetry(), activeSource = await storedActive();
    for (const [x, flag, expected] of [[retrySource, "--recovery", { summary: { resolvedChains: 1 } }], [retrySource, "--retry-overhead", { summary: { resolvedChainN: 1, failedAttemptN: 1 } }], [activeSource, "--active-time", { partitions: [{ activeTimeMs: 15000, observedSpanMs: 15000 }] }]] as const) {
      const before = await bytes(x.data); for (const format of [[], ["--json"]]) { const args = ["stats", "--source", x.sourceId, flag, ...format], previous = invoke(baseline!, x.data, args), current = invoke(binary, x.data, args); expect(previous.status).toBe(0); expect(current).toEqual(previous); if (format.length) expect(JSON.parse(current.stdout).result.analysis).toMatchObject(expected); } expect(await bytes(x.data)).toEqual(before);
    }
  });
});
