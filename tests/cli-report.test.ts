import { createHmac } from "node:crypto";
import { mkdtemp, realpath, mkdir, writeFile, readFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { runReport, formatReportResult } from "../src/cli/report.js";
import { runScan } from "../src/cli/scan.js";
import { openDatabase } from "../src/db/database.js";
import * as storeModule from "../src/db/source-store.js";
import * as summaryModule from "../src/analysis/source-summary.js";
import * as slowModule from "../src/analysis/source-slow-tool.js";
const full = `h1:${"a".repeat(32)}:source:${"b".repeat(64)}`;
const sentinel = "FICTITIOUS_REPORT_PRIVATE_SENTINEL_<script>window.pwned=1</script>";
const epoch = Date.UTC(2026, 8, 20), at = (ms: number) => new Date(epoch + ms).toISOString();
function records(provider: "codex" | "claude") {
  if (provider === "codex") return [{ timestamp: at(0), type: "session_meta", payload: { id: "report-synthetic", cwd: `/${sentinel}` } },
    ...Array.from({ length: 6 }, (_, i) => ({ timestamp: at(1000), type: "event_msg", payload: { type: "item_completed", thread_id: "report-synthetic", started_at_ms: epoch, completed_at_ms: epoch + 1000,
      item: { type: "CommandExecution", id: `call-${i}`, source: "unified_exec_startup", command: i < 5 ? `npm test ${sentinel}-${i}` : "cargo build", status: "completed", exit_code: 0, duration: { secs: 0, nanos: (i < 5 ? 4 : 80) * 1e6 }, output: sentinel } } }))];
  return Array.from({ length: 6 }, (_, i) => [
    { type: "assistant", uuid: `call-${i}`, sessionId: "report-synthetic", isSidechain: false, timestamp: at(0), cwd: `/${sentinel}`, message: { id: `response-${i}`, role: "assistant", content: [{ type: "tool_use", id: `tool-${i}`, name: "Bash", input: { command: i < 5 ? `npm test ${sentinel}-${i}` : "cargo build" } }] } },
    { type: "user", uuid: `result-${i}`, sessionId: "report-synthetic", isSidechain: false, timestamp: at(i < 5 ? 4 : 80), message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tool-${i}`, is_error: false, content: sentinel }] } },
  ]).flat();
}
async function bytes(dir: string) { return Promise.all((await readdir(dir)).sort().map(async name => ({ name, bytes: await readFile(join(dir, name)), mode: (await stat(join(dir, name))).mode }))); }
async function fixture(provider: "codex" | "claude" = "codex") {
  const root = await mkdtemp(join(await realpath(tmpdir()), "agentprof-cli-report-")), data = join(root, "data"), input = join(root, "input"), output = join(root, "report.html");
  await mkdir(input); const path = join(input, "synthetic.jsonl"); await writeFile(path, records(provider).map(r => JSON.stringify(r)).join("\n") + "\n");
  const scan = await runScan({ dataDir: data, codexRoot: provider === "codex" ? [input] : [], claudeRoot: provider === "claude" ? [input] : [] }); expect(scan.counts.committed).toBe(1);
  const key = JSON.parse(await readFile(join(data, "identity-key.json"), "utf8"));
  const id = `h1:${key.keyId}:source:` + createHmac("sha256", Buffer.from(key.secret, "hex")).update(JSON.stringify([1, 1, "source", provider, path])).digest("hex");
  const db = await openDatabase(data), saved = storeModule.createSourceStore(db, key.keyId).readSource(id)!; db.close(); await rm(input, { recursive: true });
  expect(saved.revision).toBe(1); expect(saved.events).toHaveLength(6);
  return { root, data, output, id, key, saved };
}
it.each(["codex", "claude"] as const)("%s actual stored-source generation produces deterministic static measured HTML after input removal", async provider => {
  const f = await fixture(provider); try {
    const before = await bytes(f.data), result = await runReport({ dataDir: f.data, source: f.id, output: f.output });
    expect(result).toMatchObject({ mode: "selected_source", sourceId: f.id, revision: 1, output: f.output, published: true, cleanup: "removed", targetVerification: "verified", status: "published", warnings: [] });
    const html = await readFile(f.output, "utf8"); expect(Buffer.byteLength(html)).toBe(result.bytes); expect(result.bytes).toBeLessThanOrEqual(1048576);
    expect(html).toContain("AgentProf"); expect(html).toContain(f.id); expect(html).toContain("source_prefix"); expect(html).toContain(provider === "codex" ? "process_runtime" : "invocation_latency");
    expect(html).toMatch(/<table\b/); expect(html).toMatch(/<svg\b/); expect(html).toMatch(/Slow Tool|SlowTool/); expect(html).toContain("0.2");
    expect(html).not.toMatch(/FICTITIOUS_|window\.pwned|synthetic\.jsonl|sourceRef|boundaryFingerprint|cacheEvidence|<script\b|\sstyle\s*=/i);
    expect(html).not.toContain(f.data); expect(html).not.toContain(f.key.secret); expect((await stat(f.output)).mode & 0o777).toBe(0o600); expect(await bytes(f.data)).toEqual(before);
    const again = join(f.root, "again.html"); await runReport({ dataDir: f.data, source: f.id, output: again }); expect(await readFile(again, "utf8")).toBe(html);
    const receipt = JSON.parse(formatReportResult(result, true)); expect(receipt).toEqual({ schema: "agentprof.cli/v1", ok: true, command: "report", result });
    const human = formatReportResult(result, false); expect(human).toContain(f.output); expect(human).toContain("published"); expect(human).not.toContain("FICTITIOUS_");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
it("reads the selected source and both unchanged analyzers once in a single pinned transaction", async () => {
  const f = await fixture(), originalStore = storeModule.createSourceStore, originalSummary = summaryModule.summarizeSource, originalSlow = slowModule.analyzeSourceSlowTool;
  let reads = 0, summaries = 0, rules = 0, sourceObject: unknown; let transaction: (() => boolean) | undefined;
  const store = vi.spyOn(storeModule, "createSourceStore").mockImplementation((db, key) => {
    const value = originalStore(db, key); transaction = () => db.isTransaction;
    return { ...value, listSources() { throw Error("unexpected list"); }, readSource(id) { reads++; expect(id).toBe(f.id); expect(db.isTransaction).toBe(true); sourceObject = value.readSource(id); return sourceObject as ReturnType<typeof value.readSource>; } };
  });
  const summary = vi.spyOn(summaryModule, "summarizeSource").mockImplementation(source => { summaries++; expect(source).toBe(sourceObject); expect(transaction!()).toBe(true); return originalSummary(source); });
  const slow = vi.spyOn(slowModule, "analyzeSourceSlowTool").mockImplementation(source => { rules++; expect(source).toBe(sourceObject); expect(transaction!()).toBe(true); return originalSlow(source); });
  try { await runReport({ dataDir: f.data, source: f.id, output: f.output }); expect([reads, summaries, rules]).toEqual([1, 1, 1]); }
  finally { store.mockRestore(); summary.mockRestore(); slow.mockRestore(); await rm(f.root, { recursive: true, force: true }); }
});
it("rejects incomplete selection, invalid source, roots and terminal-control paths without bootstrap", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "agentprof-invalid-report-")); try {
    const dataDir = join(root, "absent"), output = join(root, "out.html");
    const cases = [
      [{ dataDir, output }, "REPORT_SELECTION_REQUIRED"], [{ dataDir, source: full }, "REPORT_SELECTION_REQUIRED"],
      [{ dataDir, output, source: "bad" }, "INVALID_ARGUMENT"], [{ dataDir, output, source: full, codexRoot: ["/FICTITIOUS_ROOT"] }, "INVALID_ARGUMENT"],
      [{ dataDir, output, source: full, claudeRoot: ["/FICTITIOUS_ROOT"] }, "INVALID_ARGUMENT"],
      ...["\u0000", "\t", "\n", "\r", "\u001b", "\u007f", "\u0085"].flatMap(c => [[{ dataDir, source: full, output: `${output}${c}` }, "INVALID_ARGUMENT"], [{ dataDir: `${dataDir}${c}`, source: full, output }, "INVALID_ARGUMENT"]]),
    ] as const;
    for (const [options, code] of cases) await expect(runReport(options as Parameters<typeof runReport>[0])).rejects.toMatchObject({ code });
    expect(await readdir(root)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("missing store, wrong key and absent source preserve private bytes and create no output", async () => {
  const f = await fixture(); try {
    const before = await bytes(f.data);
    const absent = `h1:${f.key.keyId}:source:${"0".repeat(64)}`;
    for (const [source, code] of [[full, "INVALID_IDENTITY_KEY"], [absent, "SOURCE_NOT_FOUND"]]) await expect(runReport({ dataDir: f.data, source: source!, output: f.output })).rejects.toMatchObject({ code });
    await expect(runReport({ dataDir: join(f.root, "missing-store"), source: f.id, output: f.output })).rejects.toMatchObject({ code: "STORE_NOT_FOUND" });
    expect(await bytes(f.data)).toEqual(before); expect((await readdir(f.root)).sort()).toEqual(["data"]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
it("existing output cannot be replaced and does not alter storage", async () => {
  const f = await fixture(); try { await writeFile(f.output, "keep me", { mode: 0o640 }); const before = await bytes(f.data); await expect(runReport({ dataDir: f.data, source: f.id, output: f.output })).rejects.toMatchObject({ code: "REPORT_OUTPUT_UNSAFE" }); expect(await readFile(f.output, "utf8")).toBe("keep me"); expect((await stat(f.output)).mode & 0o777).toBe(0o640); expect(await bytes(f.data)).toEqual(before); }
  finally { await rm(f.root, { recursive: true, force: true }); }
});
it("source-level suppression is visible and does not become a zero finding", async () => {
  const f = await fixture(); try {
    const { revision, availability, persistedScope, aggregationReady, parserResumeReady, evidence, cacheEvidence, relationshipEvidence, ...input } = f.saved;
    const db = await openDatabase(f.data); expect(storeModule.createSourceStore(db, f.key.keyId).replaceSource(input, revision)).toMatchObject({ status: "committed", revision: 2 }); db.close();
    const before = await bytes(f.data); await runReport({ dataDir: f.data, source: f.id, output: f.output }); const html = await readFile(f.output, "utf8"); expect(html).toContain("evidence_absent"); expect(html).toMatch(/unavailable|unknown/i); expect(html).not.toMatch(/0 findings|no bottleneck|healthy/i); expect(await bytes(f.data)).toEqual(before);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
it("a real peer cannot commit another generation during the pinned report read", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const f = await fixture(), peer = new DatabaseSync(join(f.data, "agentprof.sqlite"), { timeout: 1 }), original = storeModule.createSourceStore;
  const spy = vi.spyOn(storeModule, "createSourceStore").mockImplementation((db, key) => {
    const store = original(db, key); return { ...store, readSource(id) {
      const saved = store.readSource(id); peer.exec("BEGIN IMMEDIATE; UPDATE source_event_headers SET revision=2");
      expect(() => peer.exec("COMMIT")).toThrow(); peer.exec("ROLLBACK"); return saved;
    } };
  });
  try { const before = await bytes(f.data), result = await runReport({ dataDir: f.data, source: f.id, output: f.output }); expect(result.revision).toBe(1); expect(await bytes(f.data)).toEqual(before); }
  finally { spy.mockRestore(); peer.close(); await rm(f.root, { recursive: true, force: true }); }
});
it.each([false,true])("published-warning receipt keeps stdout and exit1 in json=%s",async json=>{
 const report=await import("../src/cli/report.js"),main=await import("../src/cli/main.js");
 const result={mode:"selected_source" as const,sourceId:full,revision:1,output:"/synthetic/report.html",published:true as const,bytes:10,durability:"unconfirmed" as const,cleanup:"retained" as const,targetVerification:"verified" as const,status:"published_with_warning" as const,warnings:["temporary_cleanup_failed" as const,"directory_sync_failed" as const]};
 const action=vi.spyOn(report,"runReport").mockResolvedValue(result);let stdout="",stderr="";const previous=process.exitCode;
 const out=vi.spyOn(process.stdout,"write").mockImplementation((chunk)=>{stdout+=String(chunk);return true;}),err=vi.spyOn(process.stderr,"write").mockImplementation((chunk)=>{stderr+=String(chunk);return true;});
 try{await main.run(["node","agentprof","report","--source",full,"--output","/synthetic/report.html",...(json?["--json"]:[])]);expect(process.exitCode).toBe(1);expect(stderr).toBe("");expect(stdout).toBe(formatReportResult(result,json));if(json)expect(JSON.parse(stdout)).toMatchObject({ok:false,result:{published:true,status:"published_with_warning",cleanup:"retained",durability:"unconfirmed"}});else{expect(stdout).toContain("published: true");expect(stdout).toContain("temporary_cleanup_failed");}}
 finally{action.mockRestore();out.mockRestore();err.mockRestore();process.exitCode=previous;}
});
