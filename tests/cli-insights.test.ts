import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { temporaryDirectory } from "./helpers.js";
import { runInsights, formatInsightsResult } from "../src/cli/insights.js";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import * as sourceStoreModule from "../src/db/source-store.js";
import * as analysisModule from "../src/analysis/source-slow-tool.js";
import { loadOrCreateIdentityContext } from "../src/normalize/identity.js";
import { MESSAGES } from "../src/privacy/diagnostics.js";
const binary = fileURLToPath(new URL("../dist/agentprof.cjs", import.meta.url));
const full = "h1:" + "a".repeat(32) + ":source:" + "b".repeat(64);
const privateSentinel = "FICTITIOUS_INSIGHTS_PRIVATE_SENTINEL";
const run = (args: string[]) => spawnSync(process.execPath, [binary, ...args], { encoding: "utf8", env: { ...process.env, CLAUDE_CONFIG_DIR: "\nINVALID_UNRELATED" } });
function bytes(dir: string) { return readdirSync(dir).sort().map(name => ({ name, bytes: readFileSync(join(dir, name)), mode: statSync(join(dir, name)).mode })); }
function jsonError(r: ReturnType<typeof run>) { expect(r.status).toBe(2); expect(r.stdout).toBe(""); return JSON.parse(r.stderr); }
const epoch = Date.UTC(2026, 8, 20), at = (ms: number) => new Date(epoch + ms).toISOString();
function records(provider: "codex" | "claude") {
  if (provider === "codex") return [{ timestamp: at(0), type: "session_meta", payload: { id: "synthetic-insights", cwd: `/${privateSentinel}` } },
    ...Array.from({ length: 6 }, (_, i) => ({ timestamp: at(1000), type: "event_msg", payload: { type: "item_completed", thread_id: "synthetic-insights", started_at_ms: epoch, completed_at_ms: epoch + 1000,
      item: { type: "CommandExecution", id: `call-${i}`, source: "unified_exec_startup", command: i < 5 ? `npm test ${privateSentinel}-${i}` : "cargo build", status: "completed", exit_code: 0, duration: { secs: 0, nanos: (i < 5 ? 4 : 80) * 1e6 }, output: privateSentinel } } }))];
  return Array.from({ length: 6 }, (_, i) => [
    { type: "assistant", uuid: `call-${i}`, sessionId: "synthetic-insights", isSidechain: false, cwd: `/${privateSentinel}`, timestamp: at(0), message: { id: `response-${i}`, role: "assistant", content: [{ type: "tool_use", id: `tool-${i}`, name: "Bash", input: { command: i < 5 ? `npm test ${privateSentinel}-${i}` : "cargo build" } }] } },
    { type: "user", uuid: `result-${i}`, sessionId: "synthetic-insights", isSidechain: false, timestamp: at(i < 5 ? 4 : 80), message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tool-${i}`, is_error: false, content: privateSentinel }] } },
  ]).flat();
}
async function fixture(provider: "codex" | "claude" = "codex") {
  const root = temporaryDirectory(), data = join(root, "data"), input = join(root, "input");
  await mkdir(input); await writeFile(join(input, "synthetic.jsonl"), records(provider).map(r => JSON.stringify(r)).join("\n") + "\n");
  const scan = run(["scan", `--${provider}-root`, input, "--data-dir", data, "--json"]);
  expect([0, 1]).toContain(scan.status); expect(JSON.parse(scan.stdout).result.counts.committed).toBe(1);
  await rm(input, { recursive: true });
  const context = await loadOrCreateIdentityContext(data), db = await openDatabase(data), store = createSourceStore(db, context.keyId);
  const id = store.listSources().items[0]!.sourceId, saved = store.readSource(id)!;
  const expected = analysisModule.analyzeSourceSlowTool(saved); db.close();
  return { root, data, context, id, saved, expected };
}
it.each([
  ["insights"], ["insights", "--source", "bad"], ["insights", "--source", full.slice(0, -1)], ["insights", "--source", full.replace(":source:", ":event:")],
  ["insights", "--source", full, "--source", full], ["insights", "--list-sources"], ["insights", "--last", "7d"], ["insights", "--source", full, "extra"],
  ["insights", "--source", full, "--unknown"], ["insights", "--source", full, "--codex-root", privateSentinel], ["--codex-root", privateSentinel, "insights", "--source", full],
  ["insights", "--source", full, "--claude-root", privateSentinel], ["--claude-root", privateSentinel, "insights", "--source", full],
])("rejects unsupported selection before I/O: %j", args => {
  const dir = join(temporaryDirectory(), "must-not-create"), result = run(["--json", "--data-dir", dir, ...args]);
  const envelope = jsonError(result); expect(existsSync(dir)).toBe(false); expect(result.stderr).not.toMatch(/FICTITIOUS_|SQLite/);
  expect(envelope).toMatchObject({ schema: "agentprof.cli/v1", ok: false, error: { code: args.length === 1 ? "INSIGHTS_SELECTION_REQUIRED" : "INVALID_ARGUMENT" } });
  if (args.length === 1) { expect(envelope.error.message).toContain("agentprof stats --list-sources"); expect(envelope.error.message).toContain("agentprof insights --help"); }
});
it.each(["", " ", "\nINVALID_PRIVATE", "\rINVALID_PRIVATE"])("rejects invalid data directory before I/O: %j", data => {
  const r = run(["insights", "--source", full, "--data-dir", data, "--json"]); expect(jsonError(r).error.code).toBe("INVALID_ARGUMENT"); expect(r.stderr).not.toContain("INVALID_PRIVATE");
});
it("help/version remain storage-free and SQLite-free", () => {
  const data = join(temporaryDirectory(), "absent");
  for (const args of [["--version"], ["--help"], ["insights", "--help"]]) {
    const r = run(["--data-dir", data, ...args]); expect(r.status).toBe(0); expect(r.stderr).toBe(""); expect(existsSync(data)).toBe(false);
    if (args[0] === "insights") { expect(r.stdout).toContain("--source"); expect(r.stdout).toContain("DELETE"); expect(r.stdout).not.toContain("not implemented"); }
  }
});
it("missing store is never created", () => {
  const dir = join(temporaryDirectory(), "absent"), r = run(["insights", "--source", full, "--json", "--data-dir", dir]);
  expect(jsonError(r).error.code).toBe("STORE_NOT_FOUND"); expect(existsSync(dir)).toBe(false);
});
it.each(["codex", "claude"] as const)("%s scan -> close -> insights equals exact independent analysis after roots are removed", async provider => {
  const f = await fixture(provider), before = bytes(f.data);
  expect(f.expected.candidates).toHaveLength(1);
  expect(f.expected.candidates![0]).toMatchObject({ n: 5, sumMs: 20, denominatorN: 6, denominatorSumMs: 100, observedEligibleNativeToolDurationShare: 0.2, measurementBasis: provider === "codex" ? "direct" : "observed" });
  for (const args of [["--json", "--data-dir", f.data, "insights", "--source", f.id], ["insights", "--source", f.id, "--data-dir", f.data, "--json"]]) {
    const r = run(args); expect(r.status).toBe(0);
    expect(r.stdout).toBe(JSON.stringify({ schema: "agentprof.cli/v1", ok: true, command: "insights", result: { mode: "selected_source", analysis: f.expected } }) + "\n");
    expect(r.stdout).not.toMatch(/FICTITIOUS_|synthetic\.jsonl|boundaryFingerprint|sourceRef|operationKey|cacheEvidence|secret/);
  }
  const result = await runInsights({ dataDir: f.data, source: f.id }); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.analysis)).toBe(true);
  const human = run(["insights", "--source", f.id, "--data-dir", f.data]); expect(human.status).toBe(0); expect(human.stdout).toBe(formatInsightsResult(result, false));
  expect(bytes(f.data)).toEqual(before);
});
it("reads and analyzes exactly one selected generation in a pinned transaction", async () => {
  const f = await fixture(), originalStore = sourceStoreModule.createSourceStore, originalAnalysis = analysisModule.analyzeSourceSlowTool;
  let reads = 0, analyses = 0;
  const storeSpy = vi.spyOn(sourceStoreModule, "createSourceStore").mockImplementation((db, key) => {
    const s = originalStore(db, key); return { ...s, listSources() { throw Error("unexpected inventory"); }, readSource(id) { reads++; expect(db.isTransaction).toBe(true); expect(id).toBe(f.id); return s.readSource(id); } };
  });
  const ruleSpy = vi.spyOn(analysisModule, "analyzeSourceSlowTool").mockImplementation(s => { analyses++; expect(s.revision).toBe(f.saved.revision); return originalAnalysis(s); });
  try { expect((await runInsights({ dataDir: f.data, source: f.id })).analysis).toEqual(f.expected); expect([reads, analyses]).toEqual([1, 1]); }
  finally { storeSpy.mockRestore(); ruleSpy.mockRestore(); }
});
it("wrong key and missing source fail safely with no mutation, followed by a successful read", async () => {
  const f = await fixture(), before = bytes(f.data);
  for (const [source, code] of [[full, "INVALID_IDENTITY_KEY"], [f.context.fingerprint("source", ["absent"]), "SOURCE_NOT_FOUND"]]) {
    const r = run(["insights", "--source", source!, "--data-dir", f.data, "--json"]); expect(jsonError(r).error.code).toBe(code); expect(r.stderr).not.toContain(source!); expect(bytes(f.data)).toEqual(before);
  }
  expect((await runInsights({ dataDir: f.data, source: f.id })).analysis).toEqual(f.expected); expect(bytes(f.data)).toEqual(before);
});
it("event-only and unavailable generations succeed without claiming a healthy zero", async () => {
  const f = await fixture(); const db = await openDatabase(f.data), store = createSourceStore(db, f.context.keyId);
  const { revision, availability, persistedScope, aggregationReady, parserResumeReady, evidence, cacheEvidence, relationshipEvidence, ...input } = f.saved;
  expect(store.replaceSource(input, revision)).toMatchObject({ status: "committed", revision: 2 }); db.close();
  let before = bytes(f.data), r = await runInsights({ dataDir: f.data, source: f.id });
  expect(r.analysis).toMatchObject({ revision: 2, candidates: null, suppressionReason: "evidence_absent" }); expect(bytes(f.data)).toEqual(before);
  const writer = await openDatabase(f.data); createSourceStore(writer, f.context.keyId).markUnavailable(f.id, 2); writer.close();
  before = bytes(f.data); r = await runInsights({ dataDir: f.data, source: f.id });
  expect(r.analysis).toMatchObject({ revision: 3, candidates: null, suppressionReason: "source_unavailable" }); expect(bytes(f.data)).toEqual(before);
});
it.each([0, 3, 4, 5, 7])("schema %s preserves exact safe code/message and bytes", async version => {
  const f = await fixture(), db = new DatabaseSync(join(f.data, "agentprof.sqlite")); db.exec(`PRAGMA user_version=${version}`); db.close();
  const before = bytes(f.data), r = run(["insights", "--source", f.id, "--data-dir", f.data, "--json"]);
  expect(jsonError(r).error).toEqual({ code: "DATABASE_SCHEMA_INCOMPATIBLE", message: MESSAGES.DATABASE_SCHEMA_INCOMPATIBLE });
  expect(MESSAGES.DATABASE_SCHEMA_INCOMPATIBLE).toBe("Read-only source commands require a compatible existing database. No migration was attempted."); expect(bytes(f.data)).toEqual(before);
});
it.each(["-journal", "-wal", "-shm", "WAL"])("rejects %s without repair", async mode => {
  const f = await fixture();
  if (mode === "WAL") { const db = new DatabaseSync(join(f.data, "agentprof.sqlite")); db.exec("PRAGMA journal_mode=WAL"); db.close(); }
  else await writeFile(join(f.data, "agentprof.sqlite" + mode), privateSentinel);
  const before = bytes(f.data), r = run(["insights", "--source", f.id, "--data-dir", f.data, "--json"]);
  expect(jsonError(r).error).toEqual({ code: "DATABASE_MODE_UNSUPPORTED", message: MESSAGES.DATABASE_MODE_UNSUPPORTED }); expect(MESSAGES.DATABASE_MODE_UNSUPPORTED).toBe("Read-only source commands require a DELETE-mode store without journal, WAL or SHM sidecars."); expect(bytes(f.data)).toEqual(before);
});
it.each(["identity-key.json", "agentprof.sqlite"])("rejects unsafe %s permissions without chmod", async name => {
  const f = await fixture(); await chmod(join(f.data, name), 0o644); const before = bytes(f.data);
  const r = run(["insights", "--source", f.id, "--data-dir", f.data, "--json"]); expect(jsonError(r).error.code).toBe("UNSAFE_PRIVATE_FILE"); expect(bytes(f.data)).toEqual(before);
});
it("rejects a symlink directory and corrupt stored evidence without reading raw paths into errors", async () => {
  const f = await fixture(), alias = join(f.root, privateSentinel); await symlink(f.data, alias); let before = bytes(f.data);
  expect(jsonError(run(["insights", "--source", f.id, "--data-dir", alias, "--json"])).error.code).toBe("UNSAFE_DATA_PATH"); expect(bytes(f.data)).toEqual(before);
  // The storage module's existing adversarial suite covers corrupt payload details; a corrupt database header must also stay intact.
  await writeFile(join(f.data, "agentprof.sqlite"), privateSentinel); before = bytes(f.data);
  const r = run(["insights", "--source", f.id, "--data-dir", f.data, "--json"]); expect(jsonError(r).error.code).toBe("DATABASE_SCHEMA_INCOMPATIBLE"); expect(r.stderr).not.toContain(privateSentinel); expect(bytes(f.data)).toEqual(before);
});
it("keeps the selected revision coherent while a normal DELETE writer is pending, then observes replacement", async () => {
  const f = await fixture(), original = sourceStoreModule.createSourceStore, peer = new DatabaseSync(join(f.data, "agentprof.sqlite"), { timeout: 1 });
  let returnedGeneration: ReturnType<ReturnType<typeof createSourceStore>["readSource"]>;
  const spy = vi.spyOn(sourceStoreModule, "createSourceStore").mockImplementation((db, key) => {
    const store = original(db, key); return { ...store, readSource(id) {
      const saved = store.readSource(id); returnedGeneration = saved;
      peer.exec("BEGIN IMMEDIATE; UPDATE source_event_headers SET revision=2");
      expect(() => peer.exec("COMMIT")).toThrow(); peer.exec("ROLLBACK");
      return saved;
    } };
  });
  try { const r = await runInsights({ dataDir: f.data, source: f.id }); expect(r.analysis.revision).toBe(1); expect(r.analysis).toEqual(analysisModule.analyzeSourceSlowTool(returnedGeneration!)); }
  finally { spy.mockRestore(); peer.close(); }
  const writer = await openDatabase(f.data), store = original(writer, f.context.keyId);
  const { revision, availability, persistedScope, aggregationReady, parserResumeReady, ...input } = f.saved;
  expect(store.replaceSourceSnapshot(input, revision)).toMatchObject({ status: "committed", revision: 2 }); writer.close();
  const next = await runInsights({ dataDir: f.data, source: f.id }); expect(next.analysis.revision).toBe(2); expect({ ...next.analysis, revision: 1 }).toEqual(f.expected);
});
it("maps unexpected private callback errors safely and cleans up so a subsequent read succeeds", async () => {
  const f = await fixture(), before = bytes(f.data), original = sourceStoreModule.createSourceStore;
  const spy = vi.spyOn(sourceStoreModule, "createSourceStore").mockImplementation((db, key) => ({ ...original(db, key), readSource() { throw Error(privateSentinel); } }));
  try { await expect(runInsights({ dataDir: f.data, source: f.id })).rejects.toMatchObject({ code: "DATABASE_ACCESS_FAILED", message: MESSAGES.DATABASE_ACCESS_FAILED }); }
  finally { spy.mockRestore(); }
  expect(bytes(f.data)).toEqual(before); expect((await runInsights({ dataDir: f.data, source: f.id })).analysis).toEqual(f.expected); expect(bytes(f.data)).toEqual(before);
});

it.each(["event", "metric"])("rejects corrupt %s payload without mutation or private error leakage", async kind => {
  const f = await fixture(), db = new DatabaseSync(join(f.data, "agentprof.sqlite"));
  if (kind === "event") db.prepare("UPDATE source_event_contributions SET event_json=?").run(privateSentinel);
  else db.prepare("UPDATE source_metric_contributions SET row_json=?").run(privateSentinel);
  db.close(); const before = bytes(f.data), r = run(["insights", "--source", f.id, "--data-dir", f.data, "--json"]);
  expect(jsonError(r).error.code).toBe("DATABASE_ACCESS_FAILED"); expect(r.stderr).not.toContain(privateSentinel); expect(bytes(f.data)).toEqual(before);
});
