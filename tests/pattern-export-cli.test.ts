import { existsSync } from "node:fs";
import { readFile, writeFile, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPatternExport, validatePatternExportArguments, formatPatternExport, patternExportExitCode } from "../src/cli/pattern-export.js";
import type { PatternExportArguments } from "../src/cli/pattern-export.js";
import * as patterns from "../src/cli/patterns.js";
import * as native from "../src/analysis/source-failures.js";
import * as stores from "../src/db/source-store.js";
import * as writer from "../src/report/write-output.js";
import { renderPatternPage } from "../src/report/pattern-page.js";
import { stored, bytes, id, positive } from "./recovery-fixture.js";
import { ordinaryClaudeCycle } from "./pattern-export-fixture.js";
import { temporaryDirectory } from "./helpers.js";

const binary = resolve("dist/agentprof.cjs");
const cli = (args: string[]) => spawnSync(process.execPath, [binary, ...args], { encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
afterEach(() => vi.restoreAllMocks());
describe("pattern HTML export", () => {
  it.each(["codex", "claude"] as const)("uses one pinned read for raw-deleted ordinary %s observations", async provider => {
    const x = await stored(provider === "codex" ? positive : ordinaryClaudeCycle(), provider), before = await bytes(x.data), output = join(x.root, "patterns.html");
    const original = stores.createSourceStore; let reads = 0;
    vi.spyOn(stores, "createSourceStore").mockImplementation((db, key) => {
      const store = original(db, key);
      return { ...store, readSource(sourceId) { reads++; expect(db.isTransaction).toBe(true); return store.readSource(sourceId); }, listSources() { throw Error("Unexpected discovery"); } };
    });
    const run = vi.spyOn(patterns, "runPatterns"), admission = vi.spyOn(native, "analyzeSourceFailures");
    const result = await runPatternExport({ source: x.sourceId, dataDir: x.data, output });
    expect(reads).toBe(1); expect(run).toHaveBeenCalledTimes(1); expect(admission).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ mode: "patterns_html", publication: { published: true, targetVerification: "verified" } });
    const html = await readFile(output, "utf8"); expect(html).not.toMatch(/h1:|FICTITIOUS_/); expect(html).not.toContain(x.data);
    if (provider === "claude") { expect(result.cycles).toBe(1); expect(html).toContain("First-pass / first-terminal</th><td>1 / 1</td>"); expect(html).toContain("declared scope=unknown"); expect(html).toContain("Full-validation ratio (0–1)</th><td>Unavailable</td>"); }
    else { expect(result.candidates).toBe(0); expect(html).toContain("not_evaluable"); expect(html).toContain("missing_error_identity"); }
    expect(await bytes(x.data)).toEqual(before); expect(JSON.parse(formatPatternExport(result, true)).result).toEqual(result);
  });
  it("preserves default human/JSON output and uses the built binary for clipped export", async () => {
    const x = await stored(ordinaryClaudeCycle(), "claude"), output = join(x.root, "real.html"), before = await bytes(x.data);
    const base = ["patterns", "--source", x.sourceId, "--data-dir", x.data];
    const a = await patterns.runPatterns({ source: x.sourceId, dataDir: x.data });
    for (const json of [false, true]) { const result = cli([...base, ...(json ? ["--json"] : [])]); expect(result.status, result.stderr).toBe(0); expect(result.stdout).toBe(patterns.formatPatterns(a, json)); }
    const period = { from: "2026-10-03T00:00:02Z", to: "2026-10-03T00:00:04Z" };
    const expected = await patterns.runPatterns({ source: x.sourceId, dataDir: x.data, ...period });
    const result = cli([...base, "--from", period.from, "--to", period.to, "--output", output, "--json"]);
    expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, command: "patterns", result: { mode: "patterns_html", cycles: 1 } });
    expect(await readFile(output, "utf8")).toBe(renderPatternPage(expected)); expect(await bytes(x.data)).toEqual(before);
    const again = cli([...base, "--output", output, "--json"]); expect(again.status).toBe(2); expect(JSON.parse(again.stderr).error.code).toBe("REPORT_OUTPUT_UNSAFE");
  });
  it("rejects existing/private/symlink output without replacing a user file or store", async () => {
    const x = await stored(), before = await bytes(x.data), output = join(x.root, "existing.html"), target = join(x.root, "target.txt"), linked = join(x.root, "linked.html");
    await writeFile(output, "existing"); await writeFile(target, "target"); await symlink(target, linked);
    const options = { source: x.sourceId, dataDir: x.data };
    for (const destination of [output, linked, join(x.data, "inside.html")]) await expect(runPatternExport({ ...options, output: destination })).rejects.toMatchObject({ code: "REPORT_OUTPUT_UNSAFE" });
    expect(await readFile(output, "utf8")).toBe("existing"); expect(await readFile(target, "utf8")).toBe("target"); expect(await bytes(x.data)).toEqual(before);
  });
  it.each([{ output: undefined }, { output: "" }, { output: "report.txt" }, { output: "evil\u0000.html" }, { output: 2 }, { json: 1 }, { dataDir: 42 }, { codexRoot: "" }, { claudeRoot: null }, { codexRoot: ["/FICTITIOUS_ROOT"] }, { from: "2026-10-03T00:00:00Z" }, { source: "invalid" }])("rejects malformed export options before I/O: %j", async patch => {
    const root = temporaryDirectory(), data = join(root, "absent"), output = join(root, "out.html"), run = vi.spyOn(patterns, "runPatterns");
    const options = { source: id("source", "selection"), dataDir: data, output, ...patch } as unknown as PatternExportArguments;
    expect(() => validatePatternExportArguments(options)).toThrow(); await expect(runPatternExport(options)).rejects.toThrow(); expect(run).not.toHaveBeenCalled(); expect(existsSync(data)).toBe(false); expect(existsSync(output)).toBe(false);
  });
  it("keeps missing source and wrong key errors safe without publication", async () => {
    const x = await stored(), before = await bytes(x.data), output = join(x.root, "absent.html");
    const wrongKey = x.sourceId.replace(/h1:[a-f0-9]{32}:/, `h1:${"a".repeat(32)}:`);
    await expect(runPatternExport({ source: wrongKey, dataDir: x.data, output })).rejects.toMatchObject({ code: "INVALID_IDENTITY_KEY" });
    await expect(runPatternExport({ source: id("source", "missing"), dataDir: x.data, output })).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
    expect(existsSync(output)).toBe(false); expect(await bytes(x.data)).toEqual(before);
  });
  it("does not misreport a post-link warning as an unpublished file", async () => {
    const x = await stored(), output = join(x.root, "warn.html");
    vi.spyOn(writer, "writeReportOutput").mockResolvedValue({ output, published: true, bytes: 100, durability: "unconfirmed", cleanup: "retained", targetVerification: "verified", status: "published_with_warning", warnings: ["temporary_cleanup_failed"] });
    const result = await runPatternExport({ source: x.sourceId, dataDir: x.data, output });
    expect(patternExportExitCode(result)).toBe(1); expect(formatPatternExport(result, false)).toContain("temporary_cleanup_failed");
    expect(JSON.parse(formatPatternExport(result, true))).toMatchObject({ ok: false, result: { publication: { published: true } } });
  });
  it("rejects duplicate/unknown/root/extra export flags without creating files", () => {
    const root = temporaryDirectory(), data = join(root, "absent"), output = join(root, "out.html"), sourceId = id("source", "selected");
    const base = ["patterns", "--source", sourceId, "--data-dir", data, "--output", output, "--json"];
    for (const extra of [["--output", output], ["--source", sourceId], ["--json"], ["--data-dir", data], ["--open"], ["--unknown"], ["extra"], ["--codex-root", root]]) {
      const bad = cli([...base, ...extra]); expect(bad.status).toBe(2); expect(bad.stdout).toBe(""); expect(JSON.parse(bad.stderr).error.code).toBe("INVALID_ARGUMENT");
      expect(existsSync(data)).toBe(false); expect(existsSync(output)).toBe(false);
    }
    const help = cli(["patterns", "--help", "--data-dir", data]); expect(help.status).toBe(0); expect(help.stdout).toContain("--output"); expect(existsSync(data)).toBe(false);
  });
});
