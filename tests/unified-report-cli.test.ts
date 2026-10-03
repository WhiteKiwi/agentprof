import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, symlink, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runReport, formatReportResult } from "../src/cli/report.js";
import { runFreshReport, freshReportExitCode } from "../src/cli/report-fresh.js";
import { runReportAndOpen, reportAndOpenExitCode } from "../src/cli/report-open.js";
import { SafeError } from "../src/privacy/diagnostics.js";
import * as storeModule from "../src/db/source-store.js";
import * as readOnly from "../src/db/read-only.js";
import * as scanner from "../src/cli/scan.js";
import * as writer from "../src/report/write-output.js";
import * as opener from "../src/cli/open.js";
import { buildUnifiedSourceReport } from "../src/report/unified-model.js";
import { renderUnifiedSourceReport } from "../src/report/unified-page.js";
import { bytes, stored, positive, id } from "./recovery-fixture.js";
import { ordinaryClaudeCycle } from "./pattern-export-fixture.js";
import { freshFixture, appendExecution } from "./fresh-analysis-fixture.js";
import { temporaryDirectory } from "./helpers.js";

const binary = resolve("dist/agentprof.cjs");
const invoke = (args: string[], cwd?: string) => spawnSync(process.execPath, [binary, ...args], { cwd, env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf8", timeout: 15000 });
afterEach(() => vi.restoreAllMocks());

describe("unified source report CLI", () => {
  it.each(["codex", "claude"] as const)("%s stored scan/raw-removal/report uses exactly one pinned read and unchanged private bytes", async provider => {
    const x = await stored(provider === "codex" ? positive : ordinaryClaudeCycle(), provider), before = await bytes(x.data);
    const output = join(x.root, "unified.html"), original = storeModule.createSourceStore; let reads = 0;
    vi.spyOn(storeModule, "createSourceStore").mockImplementation((...args) => {
      expect(args[0].prepare("PRAGMA query_only").get()!.query_only).toBe(1);
      const store = original(...args); return { ...store, readSource: (id: string) => { reads++; return store.readSource(id); } };
    });
    const r = await runReport({ unified: true, source: x.sourceId, dataDir: x.data, output });
    expect(r).toMatchObject({ layout: "unified", mode: "selected_source", sourceId: x.sourceId, revision: x.source.revision, status: "published" });
    expect(reads).toBe(1); expect(await bytes(x.data)).toEqual(before);
    const html = await readFile(output, "utf8"); expect(html).toBe(renderUnifiedSourceReport(buildUnifiedSourceReport(x.source)));
    expect(html).not.toMatch(/FICTITIOUS_|h1:[a-f0-9]{32}:/); expect(html).not.toContain(x.data);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(formatReportResult(r, true)).result.layout).toBe("unified");
  });
  it.each(["codex", "claude"] as const)("%s fresh mode forwards unified across commit/reuse/append and keeps partial status", async provider => {
    const x = await freshFixture("patterns", provider, provider === "codex");
    const options = { provider, input: x.input, dataDir: x.data, output: x.output, unified: true };
    const first = await runFreshReport(options); expect(first.report).toMatchObject({ status: "published", layout: "unified", revision: 1 });
    expect(freshReportExitCode(first)).toBe(provider === "codex" ? 1 : 0);
    const before = await bytes(x.data), reused = await runFreshReport({ ...options, output: join(x.root, "reuse.html") });
    expect(reused.report).toMatchObject({ layout: "unified", revision: 1 }); expect(reused.scan.counts.unchanged).toBe(1);
    expect(await bytes(x.data)).toEqual(before);
    await appendExecution(x.input, provider);
    const next = await runFreshReport({ ...options, output: join(x.root, "append.html") });
    expect(next.report).toMatchObject({ layout: "unified", revision: 2 });
  });
  it("unified=false preserves the default old report layout and receipt fields", async () => {
    const x = await stored(), a = await runReport({ source: x.sourceId, dataDir: x.data, output: join(x.root, "old.html") });
    const b = await runReport({ unified: false, source: x.sourceId, dataDir: x.data, output: join(x.root, "false.html") });
    expect(await readFile(a.output, "utf8")).toBe(await readFile(b.output, "utf8")); expect(b).not.toHaveProperty("layout");
  });
  it.each(["yes", 1, null, {}])("rejects nonboolean unified=%j before any private I/O in stored and fresh mode", async unified => {
    const directory = join(temporaryDirectory(), "not-created"), read = vi.spyOn(readOnly, "withReadOnlyStore"), scan = vi.spyOn(scanner, "collectScan");
    await expect(runReport({ unified, source: id("source", "some"), dataDir: directory, output: "new.html" } as any)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(runFreshReport({ unified, provider: "codex", input: "session.jsonl", dataDir: directory, output: "new.html" } as any)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(read).not.toHaveBeenCalled(); expect(scan).not.toHaveBeenCalled(); expect(existsSync(directory)).toBe(false);
  });
  it.each([{ codexRoot: {} }, { claudeRoot: "" }, { open: "true" }])("rejects malformed unified fresh options %j before collection", async extra => {
    const x = await freshFixture(), scan = vi.spyOn(scanner, "collectScan");
    await expect(runFreshReport({ unified: true, provider: "codex", input: x.input, dataDir: x.data, output: x.output, ...extra } as any)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(scan).not.toHaveBeenCalled(); expect(existsSync(x.data)).toBe(false);
  });
  it.each(["not-html.txt", "", "bad\n.html"])("rejects unsafe unified output %j before collection", async output => {
    const x = await freshFixture(), scan = vi.spyOn(scanner, "collectScan");
    await expect(runFreshReport({ unified: true, provider: "codex", input: x.input, dataDir: x.data, output })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(scan).not.toHaveBeenCalled(); expect(existsSync(x.data)).toBe(false);
  });
  it("retains exact revision refusal without output or private writes", async () => {
    const x = await stored(), before = await bytes(x.data), output = join(x.root, "changed.html");
    await expect(runReport({ unified: true, source: x.sourceId, dataDir: x.data, output }, { expectedRevision: x.source.revision + 1 })).rejects.toMatchObject({ code: "SOURCE_REVISION_CHANGED" });
    expect(existsSync(output)).toBe(false); expect(await bytes(x.data)).toEqual(before);
  });
  it.each(["missing-source", "wrong-key", "missing-store"])("preserves safe %s refusal and does not bootstrap", async kind => {
    const x = await stored(), before = await bytes(x.data), output = join(x.root, "error.html");
    const source = kind === "missing-source" ? id("source", "absent") : kind === "wrong-key" ? x.sourceId.replace(":" + "6".repeat(32) + ":", ":" + "7".repeat(32) + ":") : x.sourceId;
    await expect(runReport({ unified: true, source, dataDir: kind === "missing-store" ? join(x.root, "absent") : x.data, output })).rejects.toMatchObject({ code: kind === "missing-source" ? "SOURCE_NOT_FOUND" : kind === "wrong-key" ? "INVALID_IDENTITY_KEY" : "STORE_NOT_FOUND" });
    expect(existsSync(output)).toBe(false); expect(await bytes(x.data)).toEqual(before);
  });
  it.each(["existing", "symlink", "private"])("protects %s output and original private bytes", async kind => {
    const x = await stored(), before = await bytes(x.data); let output = join(x.root, "report.html");
    if (kind === "existing") await writeFile(output, "DO NOT REPLACE");
    if (kind === "symlink") await symlink(join(x.data, "identity-key.json"), output);
    if (kind === "private") output = join(x.data, "report.html");
    await expect(runReport({ unified: true, source: x.sourceId, dataDir: x.data, output })).rejects.toMatchObject({ code: "REPORT_OUTPUT_UNSAFE" });
    expect(await bytes(x.data)).toEqual(before); if (kind === "existing") expect(await readFile(output, "utf8")).toBe("DO NOT REPLACE");
  });
  it("keeps publication warnings and failed opener without losing the published report", async () => {
    const x = await stored(), output = join(x.root, "warning.html"), write = writer.writeReportOutput;
    vi.spyOn(writer, "writeReportOutput").mockImplementationOnce(async (...args) => ({ ...await write(...args), status: "published_with_warning", durability: "unconfirmed", warnings: ["directory_sync_failed"] }));
    const open = vi.spyOn(opener, "runOpen").mockRejectedValueOnce(new SafeError("OPEN_FAILED"));
    const r = await runReportAndOpen({ unified: true, source: x.sourceId, dataDir: x.data, output });
    expect(r).toMatchObject({ layout: "unified", published: true, status: "published_with_warning", open: { status: "failed", error: { code: "OPEN_FAILED" } } });
    expect(open).toHaveBeenCalledExactlyOnceWith({ file: output }); expect(reportAndOpenExitCode(r)).toBe(1); expect(existsSync(output)).toBe(true);
  });
  it("fresh unified --open forwards layout and never invokes a real native helper in the test", async () => {
    const x = await freshFixture();
    const open = vi.spyOn(opener, "runOpen").mockRejectedValueOnce(new SafeError("OPEN_OPENER_UNAVAILABLE"));
    const r = await runFreshReport({ unified: true, provider: "codex", input: x.input, dataDir: x.data, output: x.output, open: true });
    expect(r.report).toMatchObject({ layout: "unified", published: true, open: { status: "failed" } });
    expect(open).toHaveBeenCalledOnce(); expect(freshReportExitCode(r)).toBe(1);
  });
  it("actual built binary supports stored and fresh unified reports with independent receipt parity", async () => {
    const x = await stored(), output = join(x.root, "binary.html"), before = await bytes(x.data);
    const child = invoke(["--json", "report", "--unified", "--source", x.sourceId, "--data-dir", x.data, "--output", output], x.root);
    expect(child.status, child.stderr).toBe(0); expect(JSON.parse(child.stdout)).toMatchObject({ ok: true, command: "report", result: { layout: "unified" } });
    expect(await readFile(output, "utf8")).toBe(renderUnifiedSourceReport(buildUnifiedSourceReport(x.source))); expect(await bytes(x.data)).toEqual(before);
    const fresh = await freshFixture();
    const run = invoke(["report", "--provider", "codex", "--input", fresh.input, "--data-dir", fresh.data, "--unified", "--output", fresh.output, "--json"], fresh.root);
    expect(run.status, run.stderr).toBe(0); expect(JSON.parse(run.stdout).result.report.layout).toBe("unified");
  });
  it("actual built invalid or duplicate flags fail before creating a store or invoking an opener", async () => {
    const root = temporaryDirectory(), data = join(root, "absent"), base = ["report", "--unified", "--source", id("source", "not-found"), "--data-dir", data, "--output", join(root, "none.html"), "--json"];
    for (const extra of [["--unified"], ["--json"], ["--data-dir", data], ["--source", id("source", "second")], ["--input", "input.jsonl"], ["--provider", "claude"], ["extra"], ["--bogus"]]) {
      const child = invoke([...base, ...extra], root); expect(child.status, child.stdout + child.stderr).toBe(2);
      expect(JSON.parse(child.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(child.stdout).toBe(""); expect(existsSync(data)).toBe(false);
    }
  });
});
