import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { runPatterns, formatPatterns, validatePatternArguments } from "../src/cli/patterns.js";
import * as patterns from "../src/analysis/source-patterns.js";
import * as native from "../src/analysis/source-failures.js";
import * as stores from "../src/db/source-store.js";
import { bytes, stored, id, source, event } from "./recovery-fixture.js";
import { temporaryDirectory } from "./helpers.js";
const sourceId = id("source", "selected");
function claudeRecords() {
  return ["Edit", "Bash", "Bash"].flatMap((name, i) => [
    { type: "assistant", uuid: `a-${i}`, timestamp: `2026-10-03T00:00:0${i * 2}.000Z`, sessionId: "FICTITIOUS_PATTERN_SESSION",
      cwd: "/FICTITIOUS_PATTERN_ROOT", version: "2.1.241", isSidechain: false,
      message: { id: `m-${i}`, role: "assistant", content: [{ type: "tool_use", id: `t-${i}`, name,
        input: name === "Edit" ? { file_path: "/FICTITIOUS_PATTERN_ROOT/a.ts", old_string: "FICTITIOUS_OLD", new_string: "FICTITIOUS_NEW" } : { command: "npm test" } }] } },
    { type: "user", uuid: `u-${i}`, timestamp: `2026-10-03T00:00:0${i * 2 + 1}.000Z`, sessionId: "FICTITIOUS_PATTERN_SESSION", isSidechain: false,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t-${i}`, is_error: false, content: "FICTITIOUS_OUTPUT" }] } },
  ]);
}

describe("patterns arguments and stored input", () => {
  it.each([
    {}, { source: "invalid" }, { source: sourceId, from: "2026-10-03T00:00:00Z" },
    { source: sourceId, to: "2026-10-03T00:00:00Z" },
    { source: sourceId, from: "2026-02-30T00:00:00Z", to: "2026-03-01T00:00:00Z" },
    { source: sourceId, from: "2026-10-03", to: "2026-10-04" },
    { source: sourceId, from: "2026-10-03T00:00:00+09:00", to: "2026-10-04T00:00:00Z" },
    { source: sourceId, from: "2026-10-04T00:00:00Z", to: "2026-10-03T00:00:00Z" },
    { source: sourceId, codexRoot: ["/FICTITIOUS_ROOT"] },
    { source: sourceId, claudeRoot: ["/FICTITIOUS_ROOT"] },
  ])("rejects invalid options before storage: %j", async invalid => {
    const root = temporaryDirectory(), data = join(root, "absent");
    await expect(runPatterns({ ...invalid, dataDir: data })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(existsSync(data)).toBe(false);
  });
  it("accepts explicit UTC bounds with or without milliseconds", () => {
    expect(validatePatternArguments({ source: sourceId, from: "2026-10-03T00:00:00Z", to: "2026-10-03T00:00:01.000Z" }).period)
      .toEqual({ startMs: Date.UTC(2026, 9, 3), endMs: Date.UTC(2026, 9, 3) + 1000 });
  });
  it("reads genuine ordinary Codex evidence after raw input deletion without inventing error identity", async () => {
    const x = await stored(), before = await bytes(x.data);
    const a = await runPatterns({ source: x.sourceId, dataDir: x.data });
    expect(a.rules.find(r => r.ruleId === "retry-loop")?.status).toBe("not_evaluable");
    expect(a.candidates).toEqual([]); expect(a.coverage.nativeTerminalN).toBe(2);
    expect(await bytes(x.data)).toEqual(before);
    expect(JSON.parse(formatPatterns(a, true)).result).toEqual(a);
    expect(formatPatterns(a, false) + formatPatterns(a, true)).not.toMatch(/FICTITIOUS_|operationKey|lookupKey|errorFingerprint|sourceRef/);
  });
  it("measures a genuine Claude edit-validation cycle while keeping scope unknown", async () => {
    const x = await stored(claudeRecords(), "claude"), before = await bytes(x.data);
    const a = await runPatterns({ source: x.sourceId, dataDir: x.data });
    expect(a.editValidation.cycles).toHaveLength(1);
    expect(a.editValidation.cycles[0]).toMatchObject({ firstResult: "success", firstValidationScope: "unknown", resolved: true });
    expect(a.editValidation.partitions[0]).toMatchObject({ firstPassN: 1, firstTerminalN: 1, firstPassValidationRate: 1, scopeKnownN: 0, fullValidationRatio: null });
    expect(a.editValidation.cycles[0]?.validationEventIds).toHaveLength(2);
    expect(await bytes(x.data)).toEqual(before);
  });
  it("performs one pinned read and one native admission calculation", async () => {
    const x = await stored(), original = stores.createSourceStore; let reads = 0;
    const storeSpy = vi.spyOn(stores, "createSourceStore").mockImplementation((db, key) => {
      const s = original(db, key);
      return { ...s, readSource(value) { reads++; expect(db.isTransaction).toBe(true); return s.readSource(value); } };
    });
    const selected = vi.spyOn(patterns, "analyzeSourcePatterns"), admission = vi.spyOn(native, "analyzeSourceFailures");
    try {
      await runPatterns({ source: x.sourceId, dataDir: x.data });
      expect(reads).toBe(1); expect(selected).toHaveBeenCalledTimes(1); expect(admission).toHaveBeenCalledTimes(1);
    } finally { storeSpy.mockRestore(); selected.mockRestore(); admission.mockRestore(); }
  });
  it("checks selection key and keeps storage readable after failure", async () => {
    const x = await stored(), before = await bytes(x.data), other = x.sourceId.replace(/h1:[a-f0-9]{32}:/, `h1:${"a".repeat(32)}:`);
    await expect(runPatterns({ source: other, dataDir: x.data })).rejects.toMatchObject({ code: "INVALID_IDENTITY_KEY" });
    await expect(runPatterns({ source: x.sourceId, dataDir: x.data })).resolves.toMatchObject({ sourceId: x.sourceId });
    expect(await bytes(x.data)).toEqual(before);
  });
  it("uses actual built CLI JSON/human output and rejects duplicate flags/extra arguments", async () => {
    const binary = resolve("dist/agentprof.cjs"); expect(existsSync(binary)).toBe(true);
    const x = await stored(claudeRecords(), "claude"), before = await bytes(x.data);
    const run = (args: string[]) => spawnSync(process.execPath, [binary, ...args], { encoding: "utf8", timeout: 15000, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
    const base = ["patterns", "--data-dir", x.data, "--source", x.sourceId];
    const json = run([...base, "--json"]); expect(json.status, json.stderr).toBe(0);
    const a = await runPatterns({ source: x.sourceId, dataDir: x.data });
    expect(json.stdout).toBe(formatPatterns(a, true)); expect(run(base).stdout).toBe(formatPatterns(a, false));
    const period = ["--from", "2026-10-03T00:00:00Z", "--to", "2026-10-03T00:00:10Z"];
    expect(run([...base, ...period, "--json"]).status).toBe(0);
    for (const extra of [["--source", x.sourceId], ["--unknown"], ["extra"], ["--from", "2026-10-03T00:00:00Z"],
      [...period, "--from", "2026-10-03T00:00:00Z"], [...period, "--to", "2026-10-03T00:00:10Z"]]) {
      const bad = run([...base, ...extra, "--json"]); expect(bad.status).toBe(2); expect(bad.stdout).toBe("");
      expect(JSON.parse(bad.stderr).error.code).toBe("INVALID_ARGUMENT");
    }
    expect(await bytes(x.data)).toEqual(before);
  });
  it("bounds full positive JSON and human output without clipping proof arrays", () => {
    const es = Array.from({ length: 4096 }, (_, i) => event(`f${i}`, i * 2000, i * 2000 + 1000,
      { errorFingerprint: id("error", "same"), sessionId: id("session", `stream-${i % 2}`) }));
    const a = patterns.analyzeSourcePatterns(source(es)), json = formatPatterns(a, true), human = formatPatterns(a, false);
    expect(a.candidates.some(c => c.ruleId === "retry-loop")).toBe(true); expect(a.candidates.some(c => c.ruleId === "repeated-error")).toBe(true);
    expect(a.coverage.positionedN).toBe(4096); expect(Buffer.byteLength(json)).toBeLessThan(8 * 1024 * 1024);
    expect(Buffer.byteLength(human)).toBeLessThan(32768); expect(human.split("\n").length).toBeLessThan(160);
    const references = new Set(a.candidates.flatMap(c => c.evidenceEventIds)); expect(references.size).toBe(4096);
    expect(json).not.toMatch(/FICTITIOUS_|operationKey|errorFingerprint|sourceRef/);
  });
  it("never places await inside the transaction callback", () => {
    const code = readFileSync(resolve("src/cli/patterns.ts"), "utf8");
    expect(code.slice(code.indexOf("return withReadOnlyStore"), code.indexOf("function text"))).not.toMatch(/\bawait\b/);
  });
});
