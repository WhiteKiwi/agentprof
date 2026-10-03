import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile, appendFile, rename, unlink, symlink, stat, utimes, truncate, readdir } from "node:fs/promises";
import fileSystem from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate, openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { ClaudeAdapter } from "../src/parsers/claude/index.js";
import { CodexAdapter } from "../src/parsers/codex/index.js";
import { SafeError, safeErrorEnvelope } from "../src/privacy/diagnostics.js";
import type { InputRoot } from "../src/privacy/paths.js";
import { ingestSourceFile } from "../src/scanner/source-ingest.js";
import { SCAN_LIMITS, scanSources } from "../src/scanner/scan-run.js";
import type { ScanOptions } from "../src/scanner/scan-run.js";
import { temporaryDirectory } from "./helpers.js";

const context = createIdentityContext(new Uint8Array(32).fill(59), "7".repeat(32));
const fixtures = fileURLToPath(new URL("fixtures/providers/", import.meta.url));
const databases: DatabaseSync[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const db of databases.splice(0)) db.close(); });
function memory() { const db = new DatabaseSync(":memory:"); migrate(db); databases.push(db); return { db, store: createSourceStore(db, context.keyId) }; }
async function file(root: string, name: string, fixture = "codex-legacy.jsonl") {
  await mkdir(root, { recursive: true }); const path = join(root, name); await writeFile(path, await readFile(join(fixtures, fixture))); return path;
}
const roots = (path: string): InputRoot[] => [{ provider: "codex", path }];
const id = (path: string, provider = "codex") => context.fingerprint("source", [provider, resolve(path)]);
function headers(db: DatabaseSync) { return db.prepare("SELECT * FROM source_event_headers ORDER BY source_id").all(); }

function sourceRows(db: DatabaseSync) { return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'source_%' ORDER BY name").all().map(row=>{const name=String(row.name);return [name,db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()];})); }
function mutateCacheFixture(db:DatabaseSync,store:ReturnType<typeof createSourceStore>,path:string,condition:string) {
    if (condition === "absent") db.exec("DELETE FROM source_cache_evidence");
    if (condition === "event_only") db.exec("DELETE FROM source_relationship_contributions; DELETE FROM source_relationship_headers; DELETE FROM source_cache_evidence; DELETE FROM source_metric_contributions; DELETE FROM source_metric_headers");
    if (condition === "unavailable") store.markUnavailable(id(path), 1);
    if (condition === "limited" || condition === "dropped") {
      const row = db.prepare("SELECT row_json FROM source_metric_contributions WHERE kind='capabilities'").get()!, original = row["row_json"] as string, caps = JSON.parse(original);
      if (condition === "limited") caps.stateLimited = true; else caps.diagnosticsDropped = 1;
      const changed = JSON.stringify(caps); db.prepare("UPDATE source_metric_contributions SET row_json=? WHERE kind='capabilities'").run(changed);
      db.prepare("UPDATE source_metric_headers SET metric_bytes=metric_bytes+?").run(Buffer.byteLength(changed) - Buffer.byteLength(original));
    }
 }

describe("real bounded directory integration", () => {
  it("stores both providers and preserves actual capability/scope without paths or inferred totals", async () => {
    const root = temporaryDirectory(), codex = join(root, "codex"), claude = join(root, "claude"), { db, store } = memory();
    const c = await file(codex, "a.jsonl"), h = await file(claude, "b.jsonl", "claude-real-shapes.jsonl");
    const result = await scanSources(store, context, [{ provider: "codex", path: codex }, { provider: "claude", path: claude }]);
    expect(result.counts).toMatchObject({ discovered: 2, attempted: 2, committed: 2, failed: 0 });
    expect(result.status).toBe("partial"); expect(result.aggregationReady).toBe(false); expect(result.parserResumeReady).toBe(false);
    expect(result.sources.map((s) => s.sourceId).sort()).toEqual([id(c), id(h, "claude")].sort());
    for (const source of result.sources) {
      expect(source).toMatchObject({ revisionRead: true, expectedRevision: null, committedRevision: 1 });
      const direct = await ingestSourceFile(store, context, { path: source.provider === "codex" ? c : h, provider: source.provider, expectedRevision: 1 });
      expect(source.capabilities).toEqual(direct.capabilities); expect(source.ingestionScope).toBe(direct.persistedScope);
    }
    expect(headers(db)).toHaveLength(2); expect(result.diagnostics.observedCount).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(root); expect(JSON.stringify(result)).not.toContain("FICTITIOUS_");
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.sources)).toBe(true); expect(Object.isFrozen(result.counts)).toBe(true);
  });
  it("deduplicates normalized and nested roots before a source is ingested twice", async () => {
    const root = temporaryDirectory(), nested = join(root, "nested"), { store } = memory();
    const a = await file(root, "a.jsonl"), b = await file(nested, "b.jsonl"); let reads = 0;
    const wrapped = { ...store, readSourceForIngestion(sourceId: string, suppliedContext: typeof context) { reads++; return store.readSourceForIngestion(sourceId, suppliedContext); } };
    const result = await scanSources(wrapped, context, [...roots(root), ...roots(join(root, ".")), ...roots(nested)]);
    expect(result.counts).toMatchObject({ discovered: 2, attempted: 2, committed: 2 }); expect(reads).toBe(2);
    expect(store.readSource(id(a))!.revision).toBe(1); expect(store.readSource(id(b))!.revision).toBe(1);
    expect(new Set(result.sources.map((s) => s.sourceId)).size).toBe(2);
  });
  it("reuses repeats and reparses append/stable-path replacement with exactly one original revision", async () => {
    const root = temporaryDirectory(), { store } = memory(), path = await file(root, "a.jsonl");
    expect((await scanSources(store, context, roots(root))).status).toBe("completed");
    const first = store.readSource(id(path))!;
    const repeat = await scanSources(store, context, roots(root)); expect(repeat.sources[0]).toMatchObject({ status: "unchanged", expectedRevision: 1, committedRevision: null, reusedRevision: 1 });
    expect(store.readSource(id(path))!.events).toEqual(first.events);
    await appendFile(path, JSON.stringify({ type: "response_item", timestamp: "2026-09-01T00:00:12.000Z", payload: { type: "function_call_output", call_id: "pending1", output: { exit_code: 0, text: "FICTITIOUS_OUTPUT" } } }) + "\n");
    expect((await scanSources(store, context, roots(root))).sources[0]).toMatchObject({ expectedRevision: 1, committedRevision: 2 });
    const pending = first.events.find((e) => e.status === "pending")!;
    expect(store.readSource(id(path))!.events.find((e) => e.id === pending.id)?.status).toBe("completed");
    const replacement = join(root, "replacement.tmp"); await writeFile(replacement, ""); await rename(replacement, path);
    expect((await scanSources(store, context, roots(root))).sources[0]).toMatchObject({ sourceId: id(path), expectedRevision: 2, committedRevision: 3 });
    expect(store.readSource(id(path))!.events).toEqual([]);
  });
  it("commits valid files while a rejected file preserves its old generation", async () => {
    const root = temporaryDirectory(), { store } = memory(), good = await file(root, "good.jsonl"), bad = await file(root, "bad.jsonl");
    await scanSources(store, context, roots(root)); const previous = store.readSource(id(bad)); await writeFile(bad, '{"FICTITIOUS_SECRET":\n');
    const result = await scanSources(store, context, roots(root));
    expect(result.status).toBe("partial"); expect(result.counts).toMatchObject({ attempted: 2, committed: 0, unchanged: 1, rejected: 1 });
    expect(store.readSource(id(bad))).toEqual(previous); expect(store.readSource(id(good))!.revision).toBe(1);
    expect(result.sources.find((s) => s.sourceId === id(bad))).toMatchObject({ status: "rejected", rejectionReason: "reader_error" });
    expect(JSON.stringify(result)).not.toContain("FICTITIOUS_");
  });
  it("does not mark vanished or undiscovered sources unavailable", async () => {
    const root = temporaryDirectory(), { store } = memory(), path = await file(root, "gone.jsonl"); await scanSources(store, context, roots(root));
    const before = store.readSource(id(path)); await unlink(path);
    const result = await scanSources(store, context, [...roots(root), ...roots(join(root, "missing"))]);
    expect(result.status).toBe("partial"); expect(result.sources).toEqual([]); expect(store.readSource(id(path))).toEqual(before);
  });
  it("fails closed for conflicting providers, compression and symlinks without importing them", async () => {
    const root = temporaryDirectory(), { db, store } = memory(); await file(root, "ambiguous.jsonl");
    await writeFile(join(root, "archive.jsonl.gz"), "FICTITIOUS_COMPRESSED"); await symlink(root, join(root, "link"));
    const result = await scanSources(store, context, [...roots(root), { provider: "claude", path: root }]);
    expect(result.sources).toEqual([]); expect(headers(db)).toEqual([]); expect(result.status).toBe("partial");
    expect(result.diagnostics.samples.map((d) => d.code)).toEqual(expect.arrayContaining(["AMBIGUOUS_INPUT_PROVIDER", "UNSUPPORTED_COMPRESSION", "SYMLINK_SKIPPED"]));
    expect(JSON.stringify(result)).not.toContain(root);
  });
});

describe("original revisions, failures and cancellation", () => {
  it("does not retry a stale revision when a real peer writes during parsing", async () => {
    const root = temporaryDirectory(), dir = join(temporaryDirectory(), "db"), path = await file(root, "a.jsonl"), db = await openDatabase(dir), peer = await openDatabase(dir);
    try {
      const store = createSourceStore(db, context.keyId), other = createSourceStore(peer, context.keyId); await scanSources(store, context, roots(root));
      await appendFile(path, "{}\n"); // A complete suffix record actually reaches the parsing race hook.
      const original = CodexAdapter.prototype.ingest; let wrote = false, reads = 0, ingestHits = 0;
      vi.spyOn(CodexAdapter.prototype, "ingest").mockImplementation(function (record, source) { ingestHits++; const value = original.call(this, record, source); if (!wrote) { wrote = true; other.markUnavailable(id(path), 1); } return value; });
      const result = await scanSources({ ...store, readSourceForIngestion(key: string, suppliedContext: typeof context) { reads++; return store.readSourceForIngestion(key, suppliedContext); } }, context, roots(root));
      expect(result.counts).toMatchObject({ attempted: 1, stale: 1, committed: 0 }); expect(reads).toBe(1); expect(wrote).toBe(true); expect(ingestHits).toBe(1);
      expect(result.sources[0]).toMatchObject({ expectedRevision: 1, staleActualRevision: 2 });
      expect(other.readSource(id(path))).toMatchObject({ revision: 2, availability: "unavailable" });
    } finally { db.close(); peer.close(); }
  });
  it("stops after a fatal read failure with only safe error information", async () => {
    const root = temporaryDirectory(), { db, store } = memory(); await file(root, "a.jsonl"); await file(root, "b.jsonl"); let reads = 0;
    const result = await scanSources({ ...store, readSourceForIngestion() { reads++; throw new Error("FICTITIOUS_DB_PATH_SECRET"); } }, context, roots(root));
    expect(reads).toBe(1); expect(headers(db)).toEqual([]); expect(result).toMatchObject({ status: "partial", stopReason: "storage_failure" });
    expect(result.sources[0]).toMatchObject({ status: "failed", errorCode: "INTERNAL_ERROR", revisionRead: false, ingestionScope: null, capabilities: null });
    expect(JSON.stringify(result)).not.toContain("FICTITIOUS_");
    expect((await scanSources(store, context, roots(root))).counts).toMatchObject({committed:2,failed:0});
  });
  it("stops after a real SQLite insertion failure, preserving previous source data", async () => {
    const root = temporaryDirectory(), { db, store } = memory(); await file(root, "a.jsonl"); await file(root, "b.jsonl"); await scanSources(store, context, roots(root)); const before = headers(db);
    await appendFile(join(root, "a.jsonl"), " "); await appendFile(join(root, "b.jsonl"), " ");
    db.exec("CREATE TRIGGER fail_scan BEFORE INSERT ON source_event_contributions BEGIN SELECT RAISE(ABORT, 'FICTITIOUS_SQL_SECRET'); END");
    const result = await scanSources(store, context, roots(root));
    expect(result).toMatchObject({ status: "partial", stopReason: "storage_failure", counts: { attempted: 1, failed: 1, committed: 0 } });
    expect(result.sources[0]!.errorCode).toBe("DATABASE_TRANSACTION_FAILED"); expect(headers(db)).toEqual(before);
  });
  it("stops globally on an actual installation-key mismatch without mixing or changing any source", async () => {
    const root = temporaryDirectory(), { db, store } = memory(); await file(root, "a.jsonl"); await file(root, "b.jsonl");
    const seeded = await scanSources(store, context, roots(root));
    const before = seeded.sources.map((s) => store.readSource(s.sourceId)), binding = db.prepare("SELECT * FROM source_store_identity").all();
    const otherContext = createIdentityContext(new Uint8Array(32).fill(61), "8".repeat(32));
    const result = await scanSources(createSourceStore(db, otherContext.keyId), otherContext, roots(root));
    expect(result).toMatchObject({ status: "partial", stopReason: "storage_failure", counts: { attempted: 1, failed: 1, committed: 0 } });
    expect(result.sources[0]).toMatchObject({ revisionRead: false, expectedRevision: null, errorCode: "INVALID_IDENTITY_KEY" });
    expect(seeded.sources.map((s) => store.readSource(s.sourceId))).toEqual(before);
    expect(db.prepare("SELECT * FROM source_store_identity").all()).toEqual(binding); expect(headers(db)).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain(root); expect(JSON.stringify(result)).not.toContain("FICTITIOUS_");
  });
  it("does no discovery or source read for a pre-aborted valid run", async () => {
    const { store } = memory(), controller = new AbortController(); controller.abort(); let read = false;
    const directory = vi.spyOn(fileSystem, "opendir"); syncBuiltinESMExports();
    const result = await scanSources({ ...store, readSourceForIngestion() { read = true; throw Error("PREABORT_READ_HOOK"); } }, context, roots(join(temporaryDirectory(), "absent")), { signal: controller.signal });
    expect(result).toMatchObject({ status: "aborted", stopReason: "aborted", sources: [], counts: { attempted: 0 } }); expect(read).toBe(false); expect(directory).not.toHaveBeenCalled();
  });
  it("keeps earlier commits when cancelled during the next real adapter", async () => {
    const root = temporaryDirectory(), { db, store } = memory(); for (const n of ["a", "b", "c"]) await file(root, `${n}.jsonl`);
    const controller = new AbortController(), seen = new Set<string>(), original = CodexAdapter.prototype.ingest;
    vi.spyOn(CodexAdapter.prototype, "ingest").mockImplementation(function (record, source) { seen.add(source.fileIdentity); const value = original.call(this, record, source); if (seen.size === 2) controller.abort(); return value; });
    const result = await scanSources(store, context, roots(root), { signal: controller.signal });
    expect(result).toMatchObject({ status: "aborted", counts: { attempted: 2, committed: 1, aborted: 1 } }); expect(headers(db)).toHaveLength(1);
    expect(result.sources[0]!.status).toBe("committed"); expect(result.sources[1]!.status).toBe("aborted");
  });
  it("does not relabel a source after commit when cancellation arrives before starting another", async () => {
    const root = temporaryDirectory(), { db, store } = memory(); await file(root, "a.jsonl"); await file(root, "b.jsonl");
    const controller = new AbortController();
    // Pick the real API used by the current ingestion revision, including a later metric extension.
    let writerHits = 0; const original = store.replaceSourceSnapshotWithCheckpoint;
    const wrapped = { ...store, replaceSourceSnapshotWithCheckpoint(...args: Parameters<typeof original>) { writerHits++; const result = original(...args); controller.abort(); return result; } };
    const result = await scanSources(wrapped, context, roots(root), { signal: controller.signal });
    expect(result).toMatchObject({ status: "aborted", counts: { attempted: 1, committed: 1, aborted: 0 } }); expect(headers(db)).toHaveLength(1); expect(result.sources[0]!.status).toBe("committed"); expect(writerHits).toBe(1);
    expect((await scanSources(store,context,roots(root))).counts).toMatchObject({unchanged:1,committed:1,aborted:0});
  });
});

describe("bounds, resource closure and safe summaries", () => {
  it("bounds default source results to 64 without reading the 65th file", async () => {
    const root = temporaryDirectory(), { db, store } = memory();
    for (let i = 0; i < 65; i++) await writeFile(join(root, `${i}.jsonl`), "");
    const result = await scanSources(store, context, roots(root));
    expect(result).toMatchObject({ status: "partial", stopReason: "discovery_limit", counts: { attempted: SCAN_LIMITS.sources, committed: SCAN_LIMITS.sources } });
    expect(result.sources).toHaveLength(64); expect(headers(db)).toHaveLength(64); expect(result.diagnostics.samples.at(-1)?.code).toBe("DISCOVERY_LIMIT");
  });
  it.each([{ maxSources: 1 }, { maxEntries: 1 }, { maxDirectories: 1 }])("applies lowered discovery ceilings %j", async (options) => {
    const root = temporaryDirectory(), { store } = memory(); await file(root, "a.jsonl"); await file(join(root, "nested"), "b.jsonl");
    const result = await scanSources(store, context, roots(root), options);
    expect(result.status).toBe("partial"); expect(result.stopReason).toBe("discovery_limit"); expect(result.sources.length).toBeLessThanOrEqual(1);
  });
  it.each([{ maxFileBytes: 1 }, { maxRecords: 1 }, { maxLineBytes: 1 }])("passes lowered ingestion ceilings %j and retains prior source data", async (options) => {
    const root = temporaryDirectory(), { store } = memory(), path = await file(root, "a.jsonl"); await scanSources(store, context, roots(root)); const before = store.readSource(id(path));
    const result = await scanSources(store, context, roots(root), options);
    expect(result).toMatchObject({ status: "partial", counts: { rejected: 1, committed: 0 } }); expect(store.readSource(id(path))).toEqual(before);
  });
  it.each([0, 2])("bounds diagnostic samples to %i while retaining exact observed and dropped counts", async (maxDiagnostics) => {
    const root = temporaryDirectory(), { store } = memory(); await writeFile(join(root, "unknown.jsonl"), (JSON.stringify({ type: "FICTITIOUS_UNSUPPORTED" }) + "\n").repeat(10));
    const result = await scanSources(store, context, roots(root), { maxDiagnostics });
    expect(result.status).toBe("partial"); expect(result.diagnostics.observedCount).toBeGreaterThan(maxDiagnostics);
    expect(result.diagnostics.samples).toHaveLength(maxDiagnostics); expect(result.diagnostics.sampleDroppedCount).toBe(result.diagnostics.observedCount - maxDiagnostics);
    expect(result.diagnostics.samples.every((d) => d.sourceAlias === result.sources[0]!.sourceAlias)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("FICTITIOUS_");
  });
  it("closes a directory abandoned at an entry limit and files interrupted during ingestion", async () => {
    const root = temporaryDirectory(), { store } = memory(); await file(root, "a.jsonl");
    const dirs: Awaited<ReturnType<typeof fileSystem.opendir>>[] = [], handles: Awaited<ReturnType<typeof fileSystem.open>>[] = [];
    const opendir = fileSystem.opendir, open = fileSystem.open;
    vi.spyOn(fileSystem, "opendir").mockImplementation(async (...args) => { const dir = await opendir(...args); dirs.push(dir); return dir; });
    vi.spyOn(fileSystem, "open").mockImplementation(async (...args) => { const handle = await open(...args); handles.push(handle); return handle; }); syncBuiltinESMExports();
    await scanSources(store, context, roots(root), { maxEntries: 1 }); expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) await expect(dir.read()).rejects.toMatchObject({ code: "ERR_DIR_CLOSED" });
    const controller = new AbortController(), original = CodexAdapter.prototype.ingest;
    vi.spyOn(CodexAdapter.prototype, "ingest").mockImplementation(function (record, source) { const value = original.call(this, record, source); controller.abort(); return value; });
    await scanSources(store, context, roots(root), { signal: controller.signal }); expect(handles.length).toBeGreaterThan(0);
    for (const handle of handles) await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
  });
  it("bounds a symlink-diagnostic-only directory and closes its generator on yielded-entry overflow", async () => {
    const root = temporaryDirectory(), outside = temporaryDirectory(), { db, store } = memory();
    for (let i = 0; i < 8; i++) await symlink(outside, join(root, `link-${i}`));
    const opened: Awaited<ReturnType<typeof fileSystem.opendir>>[] = [], opendir = fileSystem.opendir;
    vi.spyOn(fileSystem, "opendir").mockImplementation(async (...args) => { const dir = await opendir(...args); opened.push(dir); return dir; }); syncBuiltinESMExports();
    const result = await scanSources(store, context, roots(root), { maxEntries: 2, maxDiagnostics: 1 });
    expect(result).toMatchObject({ status: "partial", stopReason: "discovery_limit", discoveryTruncated: true, counts: { discovered: 0, attempted: 0 },
      diagnostics: { observedCount: 4, sampleDroppedCount: 3, adapterDroppedCount: 0 } });
    // Two budgeted diagnostics, the observed overflow diagnostic and the limit diagnostic.
    expect(result.diagnostics.samples).toHaveLength(1); expect(result.sources).toEqual([]); expect(headers(db)).toEqual([]);
    expect(opened).toHaveLength(1); await expect(opened[0]!.read()).rejects.toMatchObject({ code: "ERR_DIR_CLOSED" });
    expect(JSON.stringify(result)).not.toContain(root); expect(JSON.stringify(result)).not.toContain(outside);
  });
  it("rejects raised/invalid ceilings and unknown fields without filesystem work", async () => {
    const { store } = memory(), root = temporaryDirectory(), opendir = vi.spyOn(fileSystem, "opendir"); syncBuiltinESMExports();
    const invalidOptions = [{ maxSources: 65 }, { maxDirectories: 257 }, { maxEntries: 4097 }, { maxFileBytes: SCAN_LIMITS.fileBytes + 1 }, { maxRecords: 32769 }, { maxDiagnostics: 257 }, { maxDiagnostics: -1 }, { maxSources: 0 }, { maxSources: NaN }, { maxSources: 1.5 }, { chunkBytes: 0 }, { maxLineBytes: Infinity }, { signal: {} }, { trustedFixtureContext: {} }];
    for (const options of invalidOptions) await expect(scanSources(store, context, roots(root), options as ScanOptions)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(opendir).not.toHaveBeenCalled();
  });
  it("rejects missing/extra/accessor roots and options without executing getters", async () => {
    const { store } = memory(), root = temporaryDirectory(); let invoked = 0;
    const badRoot = Object.defineProperty({ provider: "codex" }, "path", { enumerable: true, get() { invoked++; return root; } });
    const values = [[], Array(17).fill({ provider: "codex", path: root }), Array(1), [badRoot], [{ provider: "other", path: root }], [{ provider: "codex", path: "" }], [{ provider: "codex", path: root, raw: "FICTITIOUS" }]];
    for (const value of values) await expect(scanSources(store, context, value as InputRoot[])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    const options = Object.defineProperty({}, "maxSources", { enumerable: true, get() { invoked++; return 1; } });
    await expect(scanSources(store, context, roots(root), options)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" }); expect(invoked).toBe(0);
    expect(safeErrorEnvelope(new SafeError("INVALID_ARGUMENT")).error.message).not.toContain(root);
  });
});

describe("whole-byte unchanged generation reuse", () => {
  it("reopens and reuses all ten provider fixtures with no adapter ingestion or source writes", async () => {
    const root = temporaryDirectory(), data = join(temporaryDirectory(), "db"), codex = join(root, "codex"), claude = join(root, "claude");
    const files = (await readdir(fixtures)).filter(n => n.endsWith(".jsonl")); expect(files).toHaveLength(10);
    for (const name of files) await file(name.startsWith("codex") ? codex : claude, name, name);
    const selected = [{ provider: "codex" as const, path: codex }, { provider: "claude" as const, path: claude }];
    let db = await openDatabase(data); const original = createSourceStore(db, context.keyId); const cold = await scanSources(original, context, selected, { maxDiagnostics: 5 });
    expect(cold.counts.committed).toBe(10); const sources = cold.sources.map(s => original.readSource(s.sourceId)); db.close(); db = await openDatabase(data);
    try {
      const store = createSourceStore(db, context.keyId), codexIngest = vi.spyOn(CodexAdapter.prototype, "ingest"), claudeIngest = vi.spyOn(ClaudeAdapter.prototype, "ingest"), replace = vi.fn(store.replaceSourceSnapshotWithCheckpoint);
      const before = await readFile(join(data, "agentprof.sqlite"));
      const warm = await scanSources({ ...store, replaceSourceSnapshotWithCheckpoint: replace }, context, selected, { maxDiagnostics: 5, chunkBytes: 17 });
      expect(warm.counts).toMatchObject({ attempted: 10, unchanged: 10, committed: 0 }); expect(warm.status).toBe(cold.status);
      expect(warm.diagnostics).toEqual(cold.diagnostics); expect(warm.sources.map(s => s.capabilities)).toEqual(cold.sources.map(s => s.capabilities));
      expect(warm.sources.every(s => s.status === "unchanged" && s.reusedRevision === 1 && s.committedRevision === null)).toBe(true);
      expect(codexIngest).not.toHaveBeenCalled(); expect(claudeIngest).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
      expect(warm.sources.map(s => store.readSource(s.sourceId))).toEqual(sources); expect(await readFile(join(data, "agentprof.sqlite"))).toEqual(before);
      const json = JSON.stringify(warm); expect(json).not.toContain(root); expect(json).not.toContain("contentFingerprint"); expect(json).not.toContain("cacheEvidence");
    } finally { db.close(); }
  });
  it.each(["early", "middle", "tail", "lf", "append", "truncate", "replace"] as const)("reparses %s changes under the original revision even with restored mtime", async change => {
    const root = temporaryDirectory(), path = join(root, "a.jsonl"), { store } = memory();
    const bytes = JSON.stringify({ type: "unrecognized", padding: "1" + "a".repeat(10000) + "2" + "b".repeat(10000) }) + '\n{}\n{"pending":1}';
    await writeFile(path, bytes); const time = new Date("2026-09-01T00:00:00.000Z"); await utimes(path, time, time);
    await scanSources(store, context, roots(root)); const before = store.readSource(id(path))!, info = await stat(path, { bigint: true });
    if (change === "early") await writeFile(path, bytes.replace('"1a', '"9a'));
    if (change === "middle") await writeFile(path, bytes.replace('a2b', 'a9b'));
    if (change === "tail") await writeFile(path, bytes.replace('"pending":1', '"pending":9'));
    if (change === "lf") await appendFile(path, "\n");
    if (change === "append") await appendFile(path, " ");
    if (change === "truncate") await truncate(path, 0);
    if (change === "replace") { const replacement = path + ".tmp"; await writeFile(replacement, "{}\n"); await rename(replacement, path); }
    await utimes(path, time, time); expect((await stat(path, { bigint: true })).mtimeNs).toBe(info.mtimeNs);
    const ingest = vi.spyOn(CodexAdapter.prototype, "ingest"), result = await scanSources(store, context, roots(root));
    expect(result.sources[0]).toMatchObject({ status: "committed", expectedRevision: 1, committedRevision: 2, reusedRevision: null });
    if (change === "append" || change === "truncate") expect(ingest).not.toHaveBeenCalled(); else expect(ingest).toHaveBeenCalled();
    const after = store.readSource(id(path))!; expect(after.cacheEvidence).not.toEqual(before.cacheEvidence);
    if (["early", "middle", "tail"].includes(change)) { expect(after.observedSize).toBe(before.observedSize); expect(after.boundaryFingerprint).toBe(before.boundaryFingerprint); }
  });
  it.each(["file", "records", "line"] as const)("does not bypass a lowered semantic %s limit", async bound => {
    const root = temporaryDirectory(), path = await file(root, "a.jsonl"), { store } = memory(); await scanSources(store, context, roots(root)); const before = store.readSource(id(path));
    const options = bound === "file" ? { maxFileBytes: 1 } : bound === "records" ? { maxRecords: 1 } : { maxLineBytes: 1 };
    const result = await scanSources(store, context, roots(root), options);
    expect(result.counts).toMatchObject({ unchanged: 0, committed: 0, rejected: 1 }); expect(store.readSource(id(path))).toEqual(before);
  });
  it("forces a miss for changed effective limits even when content still fits", async () => {
    const root = temporaryDirectory(), { store } = memory(); await file(root, "a.jsonl"); await scanSources(store, context, roots(root));
    const result = await scanSources(store, context, roots(root), { maxRecords: SCAN_LIMITS.records - 1 }); expect(result.sources[0]).toMatchObject({ status: "committed", committedRevision: 2 });
    expect((await scanSources(store, context, roots(root), { maxRecords: SCAN_LIMITS.records - 1, chunkBytes: 1 })).sources[0]).toMatchObject({ status: "unchanged", reusedRevision: 2 });
  });
  it("reads current actual provider version so an adapter bump cannot reuse old proof", async () => {
    const root = temporaryDirectory(), path = await file(root, "a.jsonl"), { store } = memory(); await scanSources(store, context, roots(root)); const prior=store.readSourceForIngestion(id(path),context), snapshot = CodexAdapter.prototype.snapshot;
    vi.spyOn(CodexAdapter.prototype, "snapshot").mockImplementation(function () { const s = snapshot.call(this); return { ...s, capabilities: { ...s.capabilities, parserVersion: 2 } } as never; });
    const ingest = vi.spyOn(CodexAdapter.prototype, "ingest"), confirm = vi.fn(store.confirmUnchangedSourceWithCheckpoint), replace = vi.fn((..._args: Parameters<typeof store.replaceSourceSnapshotWithCheckpoint>) => ({ status: "committed" as const, revision: 2 }));
    const result = await scanSources({ ...store, confirmUnchangedSourceWithCheckpoint: confirm, replaceSourceSnapshotWithCheckpoint: replace }, context, roots(root));
    expect(confirm).not.toHaveBeenCalled(); expect(ingest).toHaveBeenCalled(); expect(replace).toHaveBeenCalledTimes(1); expect(replace.mock.calls[0]?.[0]).toMatchObject({ parserVersion: 2 }); expect(replace.mock.calls[0]?.[3]).toBe(1); expect(replace.mock.calls[0]?.[4]).toEqual(prior.predecessor);
    expect(result.sources[0]).toMatchObject({ status: "committed", expectedRevision: 1, committedRevision: 2 }); expect(store.readSource(id(path))!.revision).toBe(1); // Replacement is a test observer; schema support did not expand.
  });
  it.each(["absent", "event_only", "unavailable", "limited", "dropped"] as const)("reparses a legitimate %s cache ineligibility with explicitly absent optional checkpoint", async condition => {
    const root = temporaryDirectory(), path = await file(root, "a.jsonl"), { db, store } = memory(); await scanSources(store, context, roots(root));
    if(condition!=="unavailable"){expect(store.readSourceForIngestion(id(path),context).checkpoint).not.toBeNull();expect(db.prepare("DELETE FROM source_parser_checkpoints WHERE source_id=?").run(id(path)).changes).toBe(1);expect(store.readSourceForIngestion(id(path),context).checkpoint).toBeNull();}
    mutateCacheFixture(db,store,path,condition);
    const expectedRevision=store.readSource(id(path))!.revision, ingest = vi.spyOn(CodexAdapter.prototype, "ingest"), result = await scanSources(store, context, roots(root)); expect(result.sources[0]).toMatchObject({status:"committed",expectedRevision,committedRevision:expectedRevision+1}); expect(ingest).toHaveBeenCalled();
  });
  it.each(["replace", "unavailable"] as const)("detects real peer %s between probe and final confirmation", async operation => {
    const root = temporaryDirectory(), path = await file(root, "a.jsonl"), data = join(temporaryDirectory(), "store"), db = await openDatabase(data), peer = await openDatabase(data);
    try {
      const store = createSourceStore(db, context.keyId), other = createSourceStore(peer, context.keyId); await scanSources(store, context, roots(root)); const before = other.readSource(id(path))!;
      const { revision: _revision, availability: _availability, aggregationReady: _aggregationReady, parserResumeReady: _parserResumeReady, persistedScope: _scope, ...input } = before;
      let confirmations = 0; const replace = vi.fn(store.replaceSourceSnapshotWithCheckpoint), ingest = vi.spyOn(CodexAdapter.prototype, "ingest");
      const result = await scanSources({ ...store, replaceSourceSnapshotWithCheckpoint: replace, confirmUnchangedSourceWithCheckpoint(token, predecessor, suppliedContext, signal) {
        confirmations++; if (operation === "unavailable") other.markUnavailable(id(path), 1); else other.replaceSourceSnapshot(input as never, 1);
        return store.confirmUnchangedSourceWithCheckpoint(token, predecessor, suppliedContext, signal);
      } }, context, roots(root));
      expect(confirmations).toBe(1); expect(result.sources[0]).toMatchObject({ status: "stale", expectedRevision: 1, staleActualRevision: 2, committedRevision: null, reusedRevision: null });
      expect(replace).not.toHaveBeenCalled(); expect(ingest).not.toHaveBeenCalled(); expect(other.readSource(id(path))!.revision).toBe(2);
    } finally { db.close(); peer.close(); }
  });
  it("fails closed on initial or final cached payload corruption without reparsing/repair", async () => {
    for (const late of [false, true]) {
      const root = temporaryDirectory(), { db, store } = memory(); await file(root, "a.jsonl"); await scanSources(store, context, roots(root));
      let corruptions=0; const corrupt = () => {corruptions++; db.exec("UPDATE source_event_contributions SET event_json='{}'");}; if (!late) corrupt();
      const ingest = vi.spyOn(CodexAdapter.prototype, "ingest"), replace = vi.fn(store.replaceSourceSnapshotWithCheckpoint);
      let confirmations=0; const result = await scanSources({ ...store, replaceSourceSnapshotWithCheckpoint: replace, confirmUnchangedSourceWithCheckpoint(t, predecessor, suppliedContext, signal) { confirmations++; corrupt(); return store.confirmUnchangedSourceWithCheckpoint(t, predecessor, suppliedContext, signal); } }, context, roots(root));
      expect(result).toMatchObject({ stopReason: "storage_failure", counts: { failed: 1, unchanged: 0 } }); expect(result.sources[0]!.errorCode).toBe("DATABASE_ACCESS_FAILED");
      expect(ingest).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(confirmations).toBe(late?1:0); expect(corruptions).toBe(1); vi.restoreAllMocks();
    }
  });
  it("preserves earlier reuse on later cancellation and does not relabel terminal reuse", async () => {
    const root = temporaryDirectory(), { store } = memory(); await file(root, "a.jsonl"); await file(root, "b.jsonl"); await scanSources(store, context, roots(root));
    const controller = new AbortController(); let confirmations = 0;
    const result = await scanSources({ ...store, confirmUnchangedSourceWithCheckpoint(t, predecessor, suppliedContext, signal) { confirmations++; if (confirmations === 2) controller.abort(); return store.confirmUnchangedSourceWithCheckpoint(t, predecessor, suppliedContext, signal); } }, context, roots(root), { signal: controller.signal });
    expect(result).toMatchObject({ status: "aborted", counts: { attempted: 2, unchanged: 1, aborted: 1, committed: 0 } }); expect(result.sources[0]!.status).toBe("unchanged"); expect(result.sources[1]!.status).toBe("aborted"); expect(confirmations).toBe(2);
    let terminalHits=0; const later = new AbortController(); const terminal = await scanSources({ ...store, confirmUnchangedSourceWithCheckpoint(t, predecessor, suppliedContext, signal) { terminalHits++; const r = store.confirmUnchangedSourceWithCheckpoint(t, predecessor, suppliedContext, signal); later.abort(); return r; } }, context, roots(root), { signal: later.signal });
    expect(terminal).toMatchObject({ status: "aborted", counts: { attempted: 1, unchanged: 1, aborted: 0 } }); expect(terminal.sources[0]!.status).toBe("unchanged"); expect(terminalHits).toBe(1);
  });
});

it.each(["absent","event_only","limited","dropped"])("sealed %s public mutation fails closed without replay or repair",async condition=>{
 const root=temporaryDirectory(),path=await file(root,"a.jsonl"),{db,store}=memory();await scanSources(store,context,roots(root));expect(store.readSourceForIngestion(id(path),context).checkpoint).not.toBeNull();mutateCacheFixture(db,store,path,condition);const before=sourceRows(db),ingest=vi.spyOn(CodexAdapter.prototype,"ingest"),replace=vi.fn(store.replaceSourceSnapshotWithCheckpoint);const result=await scanSources({...store,replaceSourceSnapshotWithCheckpoint:replace},context,roots(root));expect(result).toMatchObject({stopReason:"storage_failure",counts:{failed:1,committed:0,unchanged:0}});expect(result.sources[0]).toMatchObject({errorCode:"DATABASE_ACCESS_FAILED"});expect(ingest).not.toHaveBeenCalled();expect(replace).not.toHaveBeenCalled();expect(sourceRows(db)).toEqual(before);
});
