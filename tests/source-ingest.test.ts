import { createHash } from "node:crypto";
import { appendFileSync, renameSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import fileSystem from "node:fs/promises";
import { appendFile, readFile, readdir, rename, truncate, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate, openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import type { SourceInput, SourceSnapshotInput, StoredSource } from "../src/db/source-store.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { ClaudeAdapter, createClaudeAdapter } from "../src/parsers/claude/index.js";
import { CodexAdapter, createCodexAdapter } from "../src/parsers/codex/index.js";
import { safeErrorEnvelope } from "../src/privacy/diagnostics.js";
import { ingestSourceFile } from "../src/scanner/source-ingest.js";
import type { SourceIngestInput } from "../src/scanner/source-ingest.js";
import { temporaryDirectory } from "./helpers.js";

const context = createIdentityContext(new Uint8Array(32).fill(37), "4".repeat(32));
const fixtures = fileURLToPath(new URL("fixtures/providers/", import.meta.url));
const providerFixtures = (await readdir(fixtures)).filter((name) => /^(codex|claude)-.*\.jsonl$/.test(name)).sort();
const databases: DatabaseSync[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const db of databases.splice(0)) db.close(); });
function memory() { const db = new DatabaseSync(":memory:"); migrate(db); databases.push(db); return db; }
function rows(db: DatabaseSync) {
  return { headers: db.prepare("SELECT * FROM source_event_headers ORDER BY source_id").all(), events: db.prepare("SELECT * FROM source_event_contributions ORDER BY source_id,event_id").all(), identity: db.prepare("SELECT * FROM source_store_identity").all(), metricHeaders: db.prepare("SELECT * FROM source_metric_headers ORDER BY source_id").all(), metrics: db.prepare("SELECT * FROM source_metric_contributions ORDER BY source_id,kind,ordinal").all() };
}
function asInput(source: StoredSource): SourceInput {
  const { relationshipEvidence: _relationships, cacheEvidence: _cache, revision: _revision, availability: _availability, aggregationReady: _aggregationReady, parserResumeReady: _parserResumeReady, evidence: _evidence, persistedScope: _persistedScope, ...input } = source;
  return input;
}
const metadata = { type: "session_meta", payload: { id: "FICTITIOUS_SESSION", cli_version: "0.159.0", cwd: "/FICTITIOUS_PROJECT" } };
const call = (id: string) => ({ timestamp: "2026-09-01T00:00:00.000Z", type: "response_item", payload: { type: "function_call", call_id: id, name: "exec_command", arguments: JSON.stringify({ cmd: "rg FICTITIOUS_SEARCH src" }) } });
const terminal = (id: string) => ({ timestamp: "2026-09-01T00:00:01.000Z", type: "response_item", payload: { type: "function_call_output", call_id: id, output: { exit_code: 0, text: "FICTITIOUS_OUTPUT" } } });
const lines = (...records: unknown[]) => records.map((record) => JSON.stringify(record) + "\n").join("");
async function source(bytes = lines(metadata, call("one"))) {
  const path = join(temporaryDirectory(), "FICTITIOUS_SOURCE.jsonl"); await writeFile(path, bytes); return path;
}
function expectedBoundary(bytes: Buffer, completedOffset: number) {
  return completedOffset === 0 ? null : context.fingerprint("content", ["source_boundary_v1", completedOffset, bytes.subarray(Math.max(0, completedOffset - 4096), completedOffset).toString("base64")]);
}
// This oracle feeds the actual adapter independently of either JSONL reader or ingestion code.
function independentAdapter(bytes: Buffer, path: string, provider: "codex" | "claude") {
  const adapter = provider === "codex" ? createCodexAdapter(context) : createClaudeAdapter(context);
  let offset = 0, ordinal = 0;
  while (offset < bytes.length) {
    const lf = bytes.indexOf(0x0a, offset); if (lf < 0) break;
    let text = bytes.subarray(offset, lf).toString("utf8");
    if (offset === 0 && text.startsWith("\uFEFF")) text = text.slice(1);
    adapter.ingest(JSON.parse(text), { fileIdentity: resolve(path), sourceAlias: "source-1", byteOffset: offset, ordinal: ordinal++ });
    offset = lf + 1;
  }
  return { snapshot: adapter.snapshot(), completedOffset: offset };
}
async function seed(db: DatabaseSync, path: string) {
  const store = createSourceStore(db, context.keyId);
  const result = await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: null });
  expect(result).toMatchObject({ status: "committed", revision: 1 });
  return { store, result, saved: store.readSource(result.sourceId)! };
}

describe("actual provider adapters through durable event and metric-evidence ingestion", () => {
  it("keeps the ten fixture oracle cases in the exercised set", () => { expect(providerFixtures).toHaveLength(10); });

  it.each(providerFixtures)("stores exactly the final independent adapter snapshot for %s and reopens", async (name) => {
    const provider = name.startsWith("codex") ? "codex" : "claude";
    const bytes = await readFile(join(fixtures, name)), path = await source(bytes.toString("utf8"));
    const directory = join(temporaryDirectory(), "store");
    let db = await openDatabase(directory);
    try {
      const expected = independentAdapter(bytes, path, provider), store = createSourceStore(db, context.keyId);
      expect(expected.snapshot.capabilities.stateLimited).toBe(false);
      const result = await ingestSourceFile(store, context, { path, provider, expectedRevision: null, chunkBytes: 17 });
      expect(result).toEqual({ status: "committed", revision: 1, sourceId: context.fingerprint("source", [provider, resolve(path)]),
        persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false,
        capabilities: expected.snapshot.capabilities, diagnostics: expected.snapshot.diagnostics, readerDiagnostics: [] });
      const stored = store.readSource(result.sourceId)!;
      expect(stored).toMatchObject({ completedOffset: expected.completedOffset, observedSize: bytes.length, boundaryFingerprint: expectedBoundary(bytes, expected.completedOffset),
        aggregationReady: false, parserResumeReady: false, events: [...expected.snapshot.events].sort((a, b) => a.id.localeCompare(b.id)) });
      expect(stored.evidence).toEqual({ turns: expected.snapshot.turns, usage: expected.snapshot.usage, observations: expected.snapshot.observations, diagnostics: expected.snapshot.diagnostics, capabilities: expected.snapshot.capabilities });
      const exposed = JSON.stringify({ result, stored, rows: rows(db) });
      expect(exposed).not.toContain("FICTITIOUS_"); expect(exposed).not.toContain(path);
      expect(exposed).not.toContain(createHash("sha256").update(bytes).digest("hex"));
      db.close(); db = await openDatabase(directory);
      expect(createSourceStore(db, context.keyId).readSource(result.sourceId)).toEqual(stored);
    } finally { db.close(); }
  });

  it("reparses an append from pending to terminal once, with real LF/tail boundaries", async () => {
    const prefix = Buffer.from("\uFEFF" + lines(metadata, call("one")).replaceAll("\n", "\r\n"));
    const output = Buffer.from(lines(terminal("one")));
    const path = await source(); await writeFile(path, Buffer.concat([prefix, output.subarray(0, output.length - 1)]));
    const db = memory(), { store, result, saved } = await seed(db, path);
    expect(saved.events).toHaveLength(1); expect(saved.events[0]!.status).toBe("pending");
    expect(saved.completedOffset).toBe(prefix.length); expect(saved.observedSize).toBe(prefix.length + output.length - 1);
    expect(saved.boundaryFingerprint).toBe(expectedBoundary(prefix, prefix.length));
    await appendFile(path, "\n");
    const completed = await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: 1, chunkBytes: 1 });
    expect(completed).toMatchObject({ status: "committed", revision: 2, sourceId: result.sourceId });
    const final = store.readSource(result.sourceId)!;
    expect(final.events).toHaveLength(1); expect(final.events[0]).toMatchObject({ id: saved.events[0]!.id, status: "completed", exitCode: 0 });
    expect(final.completedOffset).toBe(prefix.length + output.length);
    const oracle = independentAdapter(Buffer.concat([prefix, output]), path, "codex");
    expect(final.events).toEqual(oracle.snapshot.events);
    expect(await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: 2 })).toMatchObject({ status: "committed", revision: 3 });
    expect(store.readSource(result.sourceId)!.events).toEqual(final.events);
  });

  it("retains path identity across atomic replacement and truncation, removing obsolete events", async () => {
    const db = memory(), path = await source(lines(metadata, call("one"), call("two")));
    const { store, result, saved } = await seed(db, path);
    expect(saved.events).toHaveLength(2);
    const replacement = `${path}.replacement`; await writeFile(replacement, lines(metadata, call("three"), terminal("three"))); await rename(replacement, path);
    const rewritten = await ingestSourceFile(store, context, { path: join(path, "..", "FICTITIOUS_SOURCE.jsonl"), provider: "codex", expectedRevision: 1 });
    expect(rewritten).toMatchObject({ status: "committed", sourceId: result.sourceId, revision: 2 });
    const fresh = store.readSource(result.sourceId)!;
    expect(fresh.events).toHaveLength(1); expect(saved.events.map((event) => event.id)).not.toContain(fresh.events[0]!.id);
    await truncate(path, 0);
    expect(await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: 2 })).toMatchObject({ status: "committed", sourceId: result.sourceId, revision: 3 });
    expect(store.readSource(result.sourceId)).toMatchObject({ events: [], completedOffset: 0, observedSize: 0, boundaryFingerprint: null });
    expect(db.prepare("SELECT count(*) AS count FROM source_event_headers").get()).toEqual({ count: 1 });
  });

  it.each(["codex", "claude"] as const)("returns %s partial coverage and diagnostics without inventing fixture evidence", async (provider) => {
    const name = provider === "codex" ? "codex-fork.jsonl" : "claude-fork.jsonl";
    const bytes = await readFile(join(fixtures, name)), path = await source(bytes.toString("utf8"));
    const oracle = independentAdapter(bytes, path, provider).snapshot;
    expect(oracle.capabilities.coverage).toBe("partial"); expect(oracle.diagnostics.length).toBeGreaterThan(0);
    const store = createSourceStore(memory(), context.keyId);
    const result = await ingestSourceFile(store, context, { path, provider, expectedRevision: null });
    expect(result).toMatchObject({ status: "committed", capabilities: oracle.capabilities, diagnostics: oracle.diagnostics, aggregationReady: false, parserResumeReady: false, persistedScope: "events_and_metric_evidence" });
    expect(store.readSource(result.sourceId)!.events).toEqual([...oracle.events].sort((a, b) => a.id.localeCompare(b.id)));
  });
});

describe("rejected observations preserve the entire prior generation", () => {
  it.each(["json", "utf8", "line", "file", "records", "missing"] as const)("preserves header, events, checkpoint and key binding on %s rejection", async (failure) => {
    const db = memory(), path = await source(), { store } = await seed(db, path), before = rows(db);
    const options: Partial<SourceIngestInput> = {};
    if (failure === "json") await appendFile(path, "FICTITIOUS_INVALID_JSON\n");
    if (failure === "utf8") await appendFile(path, Buffer.from([0xc3, 0x28, 0x0a]));
    if (failure === "line") Object.assign(options, { maxLineBytes: 8 });
    if (failure === "file") Object.assign(options, { maxFileBytes: 1 });
    if (failure === "records") Object.assign(options, { maxRecords: 1 });
    if (failure === "missing") unlinkSync(path);
    const result = await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: 1, ...options });
    expect(result).toMatchObject({ status: "rejected" }); expect(rows(db)).toEqual(before);
    expect(JSON.stringify(result)).not.toContain("FICTITIOUS_"); expect(JSON.stringify(result)).not.toContain(path);
    if (failure === "json" || failure === "utf8") expect(result.readerDiagnostics).toContainEqual(expect.objectContaining({ code: failure === "json" ? "INVALID_JSON" : "INVALID_UTF8" }));
  });

  it.each(["append", "truncate", "replace", "unlink"] as const)("rejects a real %s during adapter ingestion without writing", async (mutation) => {
    const db = memory(), path = await source(), { store } = await seed(db, path), before = rows(db);
    const original = CodexAdapter.prototype.ingest; let changed = false;
    vi.spyOn(CodexAdapter.prototype, "ingest").mockImplementation(function (record, source) {
      const batch = original.call(this, record, source);
      if (!changed) {
        changed = true;
        if (mutation === "append") appendFileSync(path, lines(terminal("one")));
        else if (mutation === "truncate") truncateSync(path, 0);
        else if (mutation === "unlink") unlinkSync(path);
        else { writeFileSync(`${path}.new`, lines(metadata, call("replacement"))); renameSync(`${path}.new`, path); }
      }
      return batch;
    });
    const result = await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: 1, chunkBytes: 8 });
    expect(changed).toBe(true); expect(result).toMatchObject({ status: "rejected" }); expect(rows(db)).toEqual(before);
  });

  it.each(["metadata", "diagnostics"] as const)("rejects real non-event %s overflow, including a dropped limit diagnostic", async (overflow) => {
    const db = memory(), path = await source(), { store } = await seed(db, path), before = rows(db);
    const record = overflow === "metadata" ? metadata : { type: "FICTITIOUS_UNSUPPORTED", payload: {} };
    const bytes = Buffer.from(lines(record).repeat(8193)); await writeFile(path, bytes);
    const oracle = independentAdapter(bytes, path, "codex").snapshot;
    expect(oracle.events).toEqual([]); expect(oracle.capabilities.stateLimited).toBe(true);
    if (overflow === "diagnostics") {
      expect(oracle.capabilities.diagnosticsDropped).toBeGreaterThan(0);
      expect(oracle.diagnostics.some((diagnostic) => diagnostic.code === "STATE_LIMIT")).toBe(false);
    }
    const result = await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: 1 });
    expect(result).toMatchObject({ status: "rejected", reason: "state_limit", capabilities: oracle.capabilities, diagnostics: oracle.diagnostics });
    expect(rows(db)).toEqual(before);
  });

  it("rejects untrusted options, unknown fields and accessors without evaluating them or binding a fresh store", async () => {
    const db = memory(), store = createSourceStore(db, context.keyId), path = await source();
    const valid = { path, provider: "codex", expectedRevision: null }; let invoked = 0;
    const getter = Object.defineProperty({ ...valid }, "path", { get() { invoked++; return path; } });
    const inputs = [
      { ...valid, trustedFixtureContext: { knownCopiedOrdinals: [1] } }, { ...valid, sourceAlias: "FICTITIOUS_ALIAS" },
      { ...valid, provider: "FICTITIOUS_PROVIDER" }, { ...valid, expectedRevision: 0 }, { ...valid, expectedRevision: NaN },
      { ...valid, path: "FICTITIOUS_PATH\n" }, { ...valid, signal: {} }, getter,
      Object.assign(Object.create({ trustedFixtureContext: {} }), valid),
    ];
    for (const input of inputs) {
      let failure: unknown;
      try { await ingestSourceFile(store, context, input as SourceIngestInput); } catch (error) { failure = error; }
      expect(safeErrorEnvelope(failure).error.code).toBe("INVALID_ARGUMENT");
      expect(JSON.stringify(safeErrorEnvelope(failure))).not.toContain("FICTITIOUS_");
    }
    expect(invoked).toBe(0); expect(rows(db)).toEqual({ headers: [], events: [], identity: [], metricHeaders: [], metrics: [] });
    await writeFile(path, "FICTITIOUS_INVALID\n");
    expect(await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: null })).toMatchObject({ status: "rejected" });
    expect(rows(db)).toEqual({ headers: [], events: [], identity: [], metricHeaders: [], metrics: [] });
  });
});

describe("cancellation and the original optimistic revision", () => {
  it("observes cancellation delivered by awaited descriptor cleanup before any store write", async () => {
    const db = memory(), path = await source(), { store } = await seed(db, path), before = rows(db);
    const controller = new AbortController(), opening = fileSystem.open;
    let closed = false;
    vi.spyOn(fileSystem, "open").mockImplementation(async (...args) => {
      const handle = await opening(...args), close = handle.close.bind(handle);
      handle.close = async () => { await close(); closed = true; controller.abort(); };
      return handle;
    });
    syncBuiltinESMExports();
    expect(await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: 1, signal: controller.signal })).toMatchObject({ status: "aborted" });
    expect(closed).toBe(true); expect(rows(db)).toEqual(before);
  });

  it.each(["codex", "claude"] as const)("observes cancellation before reading and during the real %s adapter", async (provider) => {
    const db = memory(), path = await source(), { store } = await seed(db, path), before = rows(db);
    const controller = new AbortController(); controller.abort();
    expect(await ingestSourceFile(store, context, { path, provider, expectedRevision: 1, signal: controller.signal })).toMatchObject({ status: "aborted" });
    expect(rows(db)).toEqual(before);
    const during = new AbortController();
    if (provider === "codex") {
      const original = CodexAdapter.prototype.ingest;
      vi.spyOn(CodexAdapter.prototype, "ingest").mockImplementation(function (record, source) { const result = original.call(this, record, source); during.abort(); return result; });
    } else {
      await writeFile(path, await readFile(join(fixtures, "claude-message.jsonl")));
      const original = ClaudeAdapter.prototype.ingest;
      vi.spyOn(ClaudeAdapter.prototype, "ingest").mockImplementation(function (record, source) { const result = original.call(this, record, source); during.abort(); return result; });
    }
    expect(await ingestSourceFile(store, context, { path, provider, expectedRevision: 1, signal: during.signal })).toMatchObject({ status: "aborted" });
    expect(rows(db)).toEqual(before);
  });

  it("rolls back cancellation raised inside SQLite and never relabels an already committed write", async () => {
    const db = memory(), path = await source(), { store } = await seed(db, path), before = rows(db);
    await appendFile(path, lines(terminal("one")));
    const during = new AbortController();
    db.function("ingest_abort", () => { during.abort(); return 0; });
    db.exec("CREATE TRIGGER abort_ingest AFTER INSERT ON source_event_contributions BEGIN SELECT ingest_abort(); END");
    expect(await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: 1, signal: during.signal })).toMatchObject({ status: "aborted" });
    expect(rows(db)).toEqual(before); db.exec("DROP TRIGGER abort_ingest");
    const after = new AbortController();
    const wrapped = { ...store, replaceSourceSnapshot(input: SourceSnapshotInput, revision: number | null, signal?: AbortSignal) {
      const result = store.replaceSourceSnapshot(input, revision, signal); after.abort(); return result;
    } };
    expect(await ingestSourceFile(wrapped, context, { path, provider: "codex", expectedRevision: 1, signal: after.signal })).toMatchObject({ status: "committed", revision: 2 });
    expect(store.readSource(context.fingerprint("source", ["codex", path]))!.events[0]!.status).toBe("completed");
  });

  it("retains the caller revision when a second real connection wins during parsing", async () => {
    const directory = join(temporaryDirectory(), "store"), a = await openDatabase(directory), b = await openDatabase(directory);
    try {
      const path = await source(), { store, result, saved } = await seed(a, path), peer = createSourceStore(b, context.keyId);
      await appendFile(path, lines(terminal("one")));
      const original = CodexAdapter.prototype.ingest; let won = false;
      vi.spyOn(CodexAdapter.prototype, "ingest").mockImplementation(function (record, source) {
        const batch = original.call(this, record, source);
        if (!won) { won = true; expect(peer.replaceSource({ ...asInput(saved), events: [] }, 1)).toEqual({ status: "committed", revision: 2 }); }
        return batch;
      });
      const stale = await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: 1 });
      expect(won).toBe(true); expect(stale).toMatchObject({ status: "stale", actualRevision: 2 });
      expect(store.readSource(result.sourceId)).toMatchObject({ revision: 2, completedOffset: saved.completedOffset, observedSize: saved.observedSize, events: [], evidence: null, persistedScope: "events_only" });
      const before = rows(a);
      expect(await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: null })).toMatchObject({ status: "stale", actualRevision: 2 });
      expect(rows(a)).toEqual(before);
    } finally { a.close(); b.close(); }
  });

  it.each([false, true])("rolls back SQL failure after real adapter output (prior generation: %s)", async (existing) => {
    const db = memory(), path = await source(), store = createSourceStore(db, context.keyId);
    if (existing) await seed(db, path);
    const before = rows(db); await writeFile(path, lines(metadata, call("two"), terminal("two"), call("three"), terminal("three")));
    db.exec("CREATE TRIGGER fail_ingest BEFORE INSERT ON source_event_contributions WHEN (SELECT count(*) FROM source_event_contributions WHERE source_id=NEW.source_id)=1 BEGIN SELECT RAISE(ABORT, 'FICTITIOUS_SQL_SECRET'); END");
    let failure: unknown;
    try { await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: existing ? 1 : null }); } catch (error) { failure = error; }
    expect(safeErrorEnvelope(failure).error.code).toBe("DATABASE_TRANSACTION_FAILED");
    expect(JSON.stringify(safeErrorEnvelope(failure))).not.toContain("FICTITIOUS_"); expect(rows(db)).toEqual(before);
  });
});
