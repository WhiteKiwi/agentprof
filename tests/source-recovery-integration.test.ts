import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { analyzeSourceRecovery } from "../src/analysis/source-recovery.js";
import * as recovery from "../src/analysis/source-recovery.js";
import * as native from "../src/analysis/source-failures.js";
import * as summary from "../src/analysis/source-summary.js";
import * as search from "../src/analysis/source-search-recurrence.js";
import * as read from "../src/analysis/source-read-revisits.js";
import * as overlap from "../src/analysis/source-invocation-overlap.js";
import * as stores from "../src/db/source-store.js";
import { runStats, formatStatsResult, validateStatsArguments } from "../src/cli/stats.js";
import { temporaryDirectory } from "./helpers.js";
import { bytes, stored, call, result, output, meta, turn, positive, structured, mcp, poll, keyId } from "./recovery-fixture.js";

const accepted: readonly [string, readonly unknown[]][] = [
  ["paired", positive],
  ["structured interval with independent 20 ms process duration", [meta(), turn(), structured("f", 0, 1000, 2), structured("s", 5000, 6000)]],
  ["terminal poll", [meta(), turn(), call("f", 0), output("f", 500, { session_id: 100 }), poll("pf", 750, 100), result("pf", 1000, 2), call("s", 5000), result("s", 6000)]],
  ["MCP", [meta(), turn(), mcp("f", 0), output("f", 1000, { isError: true }), mcp("s", 5000), output("s", 6000, { isError: false })]],
  ["unrelated intervening success", [meta(), turn(), call("f", 0), result("f", 1000, 2), call("other", 2000, "rg FICTITIOUS_OTHER src"), result("other", 3000), call("s", 5000), result("s", 6000)]],
  ["multiple failures", [meta(), turn(), call("f", 0), result("f", 1000, 2), call("f2", 2000), result("f2", 3000, 2), call("s", 5000), result("s", 6000)]],
];
describe("ordinary Codex scan/store/read-only Recovery", () => {
  it.each(accepted)("recovers 5000 ms after raw input deletion: %s", async (_name, records) => {
    const x = await stored(records), before = await bytes(x.data), a = analyzeSourceRecovery(x.source), r = await runStats({ dataDir: x.data, source: x.sourceId, recovery: true });
    expect(r.mode).toBe("selected_source_recovery"); if (r.mode !== "selected_source_recovery") throw Error("wrong mode");
    expect(r.analysis).toEqual(a); expect(a.summary).toMatchObject({ resolvedChains: 1, unresolvedChains: 0 }); expect(a.chains![0]!.recoveryElapsedMs).toBe(5000);
    expect(a.chains![0]!.firstFailedResultAt).toBe("2026-10-03T00:00:01.000Z"); expect(a.chains![0]!.successfulResultAt).toBe("2026-10-03T00:00:06.000Z");
    expect(x.source.events.filter(e => e.status === "failed").every(e => e.errorFingerprint === null)).toBe(true); expect(x.source.evidence!.turns).toEqual([]);
    expect(a).toMatchObject({ completedOffset: Buffer.byteLength(x.raw), observedSize: Buffer.byteLength(x.raw), revision: 1, parserVersion: 1, sourceFreshnessChecked: false, aggregationReady: false, parserResumeReady: false, crossSourceReconciled: false });
    const serialized = formatStatsResult(r, true), human = formatStatsResult(r, false); expect(JSON.parse(serialized).result).toEqual(r); expect(human).toContain("recovery ms=5000");
    expect(serialized + human).not.toMatch(/FICTITIOUS_|operationKey|errorFingerprint|contentFingerprint|sourceRef|commandPattern/);
    for (const e of x.source.events) if (e.operationKey) expect(serialized).not.toContain(e.operationKey);
    expect(await bytes(x.data)).toEqual(before);
  });
  it("keeps ordinary unrelated success unresolved with null endpoint/time", async () => {
    const x = await stored([meta(), turn(), call("f", 0), result("f", 1000, 2), call("other", 2000, "rg FICTITIOUS_OTHER src"), result("other", 3000)]), a = analyzeSourceRecovery(x.source);
    expect(a.summary).toMatchObject({ resolvedChains: 0, unresolvedChains: 1 }); expect(a.chains![0]).toMatchObject({ resolved: false, successfulEventId: null, successfulResultAt: null, recoveryElapsedMs: null }); expect(a.distributions).toEqual([]);
  });
  it("leaves actual ordinary Claude unavailable without inventing turn identity", async () => {
    const records = [0, 1].flatMap(i => [
      { timestamp: `2026-10-03T00:00:0${i * 5}.000Z`, type: "assistant", uuid: `call-${i}`, sessionId: "FICTITIOUS_CLAUDE_RECOVERY", cwd: "/FICTITIOUS_CLAUDE_ROOT", version: "2.1.241", isSidechain: false, message: { id: `message-${i}`, role: "assistant", content: [{ type: "tool_use", id: `tool-${i}`, name: "Bash", input: { command: "rg FICTITIOUS_QUERY src" } }] } },
      { timestamp: `2026-10-03T00:00:0${i * 5 + 1}.000Z`, type: "user", uuid: `result-${i}`, sessionId: "FICTITIOUS_CLAUDE_RECOVERY", isSidechain: false, message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tool-${i}`, is_error: i === 0, content: "FICTITIOUS_CLAUDE_OUTPUT" }] } },
    ]);
    const x = await stored(records, "claude"), before = await bytes(x.data), a = analyzeSourceRecovery(x.source);
    expect(x.source.events).toHaveLength(2); expect(x.source.events.every(e => e.turnId === null)).toBe(true); expect(native.analyzeSourceFailures(x.source).eligibility.admittedTerminalCalls).toBe(2);
    expect(a).toMatchObject({ provider: "claude", suppressionReason: "unsupported_contract", assessment: "suppressed", chains: null, distributions: null }); expect(await bytes(x.data)).toEqual(before);
  });
  it.each([
    ["missing turn", [meta(), ...positive.slice(2)]],
    ["missing operation", [meta(false), turn(), ...positive.slice(2)]],
    ["unknown intervening result", [meta(), turn(), call("f", 0), result("f", 1000, 2), call("x", 2000), output("x", 3000, {}), call("s", 5000), result("s", 6000)]],
    ["pending after apparent recovery", [...positive, call("pending", 7000), output("pending", 7500, { session_id: 123 })]],
    ["no match", [meta(), turn(), call("f", 0), result("f", 1000, 2), call("x", 2000), result("x", 3000, 1), call("s", 5000), result("s", 6000)]],
    ["change detected", [meta(), turn(), call("f", 0, "git diff --exit-code"), result("f", 1000, 2), call("x", 2000, "git diff --exit-code"), result("x", 3000, 1), call("s", 5000, "git diff --exit-code"), result("s", 6000)]],
    ["overlap", [meta(), turn(), call("f", 0), call("s", 500), result("f", 1000, 2), result("s", 6000)]],
    ["tied results", [meta(), turn(), call("f", 0), result("f", 1000, 2), call("s", 1000), result("s", 1000)]],
    ["mixed interval representations", [meta(), turn(), structured("f", 0, 1000, 2), call("s", 5000), result("s", 6000)]],
    ["source/time contradiction", [meta(), turn(), call("s", 5000), result("s", 6000), call("f", 0), result("f", 1000, 2)]],
  ] as const)("ordinary %s remains unavailable after persistence", async (_name, records) => {
    const x = await stored(records), before = await bytes(x.data), a = analyzeSourceRecovery(x.source);
    expect(a.chains).toBeNull(); expect(a.distributions).toBeNull(); expect(a.summary.resolvedChains).toBeNull(); expect(a.summary.unresolvedChains).toBeNull(); expect(await bytes(x.data)).toEqual(before);
  });
  it("performs one pinned read, one selected Recovery and one reused native proof analysis", async () => {
    const x = await stored(), original = stores.createSourceStore; let reads = 0;
    const storeSpy = vi.spyOn(stores, "createSourceStore").mockImplementation((db, key) => { const store = original(db, key); return { ...store, readSource(id) { reads++; expect(db.isTransaction).toBe(true); expect(id).toBe(x.sourceId); return store.readSource(id); }, listSources() { throw Error("unexpected list"); } }; });
    const recoverySpy = vi.spyOn(recovery, "analyzeSourceRecovery"), nativeSpy = vi.spyOn(native, "analyzeSourceFailures");
    const other = [vi.spyOn(summary, "summarizeSource"), vi.spyOn(search, "analyzeSourceSearchRecurrence"), vi.spyOn(read, "analyzeSourceReadRevisits"), vi.spyOn(overlap, "analyzeSourceInvocationOverlap")];
    try {
      const r = await runStats({ dataDir: x.data, source: x.sourceId, recovery: true }); expect(r.mode).toBe("selected_source_recovery"); expect(reads).toBe(1); expect(recoverySpy).toHaveBeenCalledTimes(1); expect(nativeSpy).toHaveBeenCalledTimes(1); for (const spy of other) expect(spy).not.toHaveBeenCalled();
    } finally { storeSpy.mockRestore(); recoverySpy.mockRestore(); nativeSpy.mockRestore(); other.forEach(spy => spy.mockRestore()); }
  });
  it("omitted and false preserve every older selected mode and do not call Recovery", async () => {
    const x = await stored(), before = await bytes(x.data), spy = vi.spyOn(recovery, "analyzeSourceRecovery").mockImplementation(() => { throw Error("not selected"); });
    try {
      for (const selection of [{ listSources: true }, { source: x.sourceId }, { source: x.sourceId, failures: true }, { source: x.sourceId, readRevisits: true }, { source: x.sourceId, invocationOverlap: true }, { source: x.sourceId, searchRecurrence: true }]) {
        const omitted = await runStats({ dataDir: x.data, ...selection }), disabled = await runStats({ dataDir: x.data, ...selection, recovery: false });
        for (const json of [false, true]) expect(formatStatsResult(disabled, json)).toBe(formatStatsResult(omitted, json));
      }
      expect(spy).not.toHaveBeenCalled(); expect(await bytes(x.data)).toEqual(before);
    } finally { spy.mockRestore(); }
  });
  it("wrong-key and absent identities do not mutate storage or poison later reads", async () => {
    const x = await stored(), before = await bytes(x.data);
    for (const [source, code] of [[x.sourceId.replace(keyId, "7".repeat(32)), "INVALID_IDENTITY_KEY"], [`h1:${keyId}:source:${"0".repeat(64)}`, "SOURCE_NOT_FOUND"]]) await expect(runStats({ dataDir: x.data, source, recovery: true })).rejects.toMatchObject({ code });
    expect(await bytes(x.data)).toEqual(before); expect((await runStats({ dataDir: x.data, source: x.sourceId, recovery: true })).mode).toBe("selected_source_recovery"); expect(await bytes(x.data)).toEqual(before);
  });
});

const full = `h1:${"a".repeat(32)}:source:${"b".repeat(64)}`;
it.each([null, 0, 1, "", "false", "true", [], {}])("rejects nonboolean recovery=%j before storage", value => {
  const data = join(temporaryDirectory(), "absent"); expect(() => validateStatsArguments({ dataDir: data, source: full, recovery: value as never })).toThrow(); expect(existsSync(data)).toBe(false);
});
it.each([{}, { listSources: true }, { source: full, listSources: true }, { source: full, failures: true }, { source: full, readRevisits: true }, { source: full, invocationOverlap: true }, { source: full, searchRecurrence: true }, { source: full, codexRoot: ["FICTITIOUS_PRIVATE"] }, { source: full, claudeRoot: ["FICTITIOUS_PRIVATE"] }])("rejects conflicting Recovery options %j before storage", selection => {
  const data = join(temporaryDirectory(), "absent"); expect(() => validateStatsArguments({ dataDir: data, ...selection, recovery: true })).toThrow(); expect(existsSync(data)).toBe(false);
});
