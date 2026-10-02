import { relationshipFingerprint } from "../src/db/source-relationship-validation.js";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import type { SourceCacheToken, SourceSnapshotInput, StoredSource } from "../src/db/source-store.js";
import { HEADER_FIELDS } from "../src/db/source-validation.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createCodexAdapter } from "../src/parsers/codex/index.js";
import { temporaryDirectory } from "./helpers.js";

const context = createIdentityContext(Buffer.alloc(32, 37), "a".repeat(32));
const dbs: DatabaseSync[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
function memory() { const db = new DatabaseSync(":memory:"); migrate(db); dbs.push(db); return db; }
function input(): SourceSnapshotInput {
  const snap = createCodexAdapter(context).snapshot();
  return { sourceId: context.fingerprint("source", ["codex", "synthetic"]), provider: "codex", parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: context.keyId,
    completedOffset: 0, observedSize: 0, boundaryFingerprint: null, events: [], evidence: { turns: snap.turns, usage: snap.usage, observations: snap.observations, diagnostics: snap.diagnostics, capabilities: snap.capabilities },
    relationshipEvidence: { contractVersion: 1, capturePolicyVersion: 1, status: "captured", provider: "codex", metadata: [], wrappers: [] },
    cacheEvidence: { contractVersion: 1, contentFingerprint: context.fingerprint("content", ["synthetic-proof"]) } };
}
function token(source: StoredSource): SourceCacheToken {
  const h = Object.fromEntries(HEADER_FIELDS.map(k => [k, source[k]]));
  return { ...h, revision: source.revision, cacheEvidence: source.cacheEvidence!, relationshipFingerprint: relationshipFingerprint(source.relationshipEvidence)! } as SourceCacheToken;
}
function rows(db: DatabaseSync) { return Object.fromEntries(["settings", "source_store_identity", "source_event_headers", "source_event_contributions", "source_metric_headers", "source_metric_contributions", "source_cache_evidence"].map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()])); }
function schemaThree(db: DatabaseSync) { db.exec("DROP TABLE source_relationship_contributions; DROP TABLE source_relationship_headers; DROP TABLE source_cache_evidence; DELETE FROM schema_migrations WHERE version>=4; PRAGMA user_version=3"); }

describe("schema 4 proof lifecycle", () => {
  it("preserves schema3 generations/settings and absent historical proof, including peer-completed migration", async () => {
    const dir = join(temporaryDirectory(), "cache"), db = await openDatabase(dir), peer = await openDatabase(dir); dbs.push(db, peer);
    const store = createSourceStore(db, context.keyId), v = input(); store.replaceSourceSnapshot({ ...v, cacheEvidence: null }, null);
    const before = rows(db); schemaThree(db); const exec = db.exec.bind(db); let interleaved = false;
    db.exec = sql => { if (sql === "BEGIN IMMEDIATE" && !interleaved) { interleaved = true; migrate(peer); } exec(sql); };
    migrate(db); db.exec = exec; migrate(db);
    expect(interleaved).toBe(true); expect(rows(db)).toEqual(before); expect(store.readSource(v.sourceId)!.cacheEvidence).toBeNull();
    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([1, 2, 3, 4, 5].map(version => ({ version })));
  });
  it.each([1, 2, 3])("rejects missing old schema marker %i and rolls back upgrade", marker => {
    const db = memory(); schemaThree(db); db.prepare("DELETE FROM schema_migrations WHERE version=?").run(marker);
    expect(() => migrate(db)).toThrowError(expect.objectContaining({ code: "DATABASE_MIGRATION_FAILED" }));
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 3 }); expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='source_cache_evidence'").get()).toBeUndefined();
  });
  it("rolls back failed DDL without altering prior data or settings", () => {
    const db = memory(), v = input(), store = createSourceStore(db, context.keyId); store.replaceSourceSnapshot(v, null); const before = rows(db); schemaThree(db);
    db.exec("CREATE TABLE source_cache_evidence(sentinel INTEGER); INSERT INTO source_cache_evidence VALUES(42)");
    expect(() => migrate(db)).toThrow(); expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 3 });
    expect(rows(db)).toEqual({ ...before, source_cache_evidence: [{ sentinel: 42 }] });
  });
  it("atomically replaces or clears proofs for full, legacy and unavailable generations", () => {
    const db = memory(), store = createSourceStore(db, context.keyId), v = input();
    store.replaceSourceSnapshot(v, null); const one = store.readSource(v.sourceId)!; expect(one.cacheEvidence).toEqual(v.cacheEvidence); expect(Object.isFrozen(one.cacheEvidence)).toBe(true);
    const { cacheEvidence: _cache, ...without } = v; store.replaceSourceSnapshot(without, 1); expect(store.readSource(v.sourceId)!.cacheEvidence).toBeNull();
    store.replaceSourceSnapshot(v, 2); const { evidence: _evidence, relationshipEvidence: _relationships, ...events } = without; store.replaceSource(events, 3); expect(store.readSource(v.sourceId)).toMatchObject({ cacheEvidence: null, evidence: null });
    store.replaceSourceSnapshot(v, 4); const before = store.readSource(v.sourceId)!; store.markUnavailable(v.sourceId, 5); expect(store.readSource(v.sourceId)).toEqual({ ...before, revision: 6, availability: "unavailable", cacheEvidence: null });
  });
  it("preserves all generation rows on stale, abort and SQL failure, including first key binding", () => {
    const db = memory(), store = createSourceStore(db, context.keyId), v = input(), abort = new AbortController();
    db.exec("CREATE TRIGGER fail_proof BEFORE INSERT ON source_cache_evidence BEGIN SELECT RAISE(ABORT,'FICTITIOUS_SECRET'); END"); const empty = rows(db);
    expect(() => store.replaceSourceSnapshot(v, null)).toThrowError(expect.objectContaining({ code: "DATABASE_TRANSACTION_FAILED" })); expect(rows(db)).toEqual(empty);
    db.exec("DROP TRIGGER fail_proof"); store.replaceSourceSnapshot(v, null); const before = rows(db);
    expect(store.replaceSourceSnapshot(v, null)).toEqual({ status: "stale", actualRevision: 1 }); abort.abort(); expect(store.replaceSourceSnapshot(v, 1, abort.signal)).toEqual({ status: "aborted" });
    db.exec("CREATE TRIGGER fail_proof BEFORE INSERT ON source_cache_evidence BEGIN SELECT RAISE(ABORT,'FICTITIOUS_SECRET'); END"); expect(() => store.replaceSourceSnapshot(v, 1)).toThrow(); expect(rows(db)).toEqual(before);
  });
  it.each([null, { contractVersion: 2, contentFingerprint: "x" }, { contractVersion: 1, contentFingerprint: `h1:${"b".repeat(32)}:content:${"c".repeat(64)}` }, { contractVersion: 1, contentFingerprint: "x".repeat(129) }])("rejects malformed present proof with fixed storage error", bad => {
    const db = memory(), store = createSourceStore(db, context.keyId), v = input(); store.replaceSourceSnapshot(v, null);
    db.exec("DROP TABLE source_cache_evidence; CREATE TABLE source_cache_evidence(source_id,contract_version,content_fingerprint)");
    db.prepare("INSERT INTO source_cache_evidence VALUES(?,?,?)").run(v.sourceId, bad?.contractVersion ?? 1, bad?.contentFingerprint ?? null);
    expect(() => store.readSource(v.sourceId)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
  });
  it("rejects extra proof rows and proofs attached to absent/event-only/unavailable data", () => {
    for (const type of ["duplicate", "missing", "events", "unavailable"]) {
      const db = memory(), store = createSourceStore(db, context.keyId), v = input(); store.replaceSourceSnapshot(v, null);
      db.exec("PRAGMA foreign_keys=OFF");
      if (type === "duplicate") { db.exec("ALTER TABLE source_cache_evidence RENAME TO old_proof; CREATE TABLE source_cache_evidence AS SELECT * FROM old_proof; INSERT INTO source_cache_evidence SELECT * FROM old_proof"); }
      else if (type === "missing") db.exec("DELETE FROM source_event_headers");
      else if (type === "events") db.exec("DELETE FROM source_metric_headers; DELETE FROM source_metric_contributions");
      else db.exec("UPDATE source_event_headers SET availability='unavailable'");
      expect(() => store.readSource(v.sourceId)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
    }
  });
});

describe("fresh synchronous unchanged confirmation", () => {
  it("revalidates fresh immutable evidence without writes or revision change", () => {
    const db = memory(), store = createSourceStore(db, context.keyId), v = input(); store.replaceSourceSnapshot(v, null);
    const source = store.readSource(v.sourceId)!, before = rows(db), result = store.confirmUnchangedSource(token(source));
    expect(result).toEqual({ status: "unchanged", reusedRevision: 1, capabilities: v.evidence.capabilities, diagnostics: [] }); expect(rows(db)).toEqual(before); expect(db.isTransaction).toBe(false);
    if (result.status === "unchanged") { expect(result.capabilities).not.toBe(source.evidence!.capabilities); expect(Object.isFrozen(result.capabilities)).toBe(true); }
  });
  it.each(["replace", "unavailable"])("observes real peer %s and returns stale without retry", async change => {
    const dir = join(temporaryDirectory(), "peer"), db = await openDatabase(dir), peer = await openDatabase(dir); dbs.push(db, peer);
    const store = createSourceStore(db, context.keyId), other = createSourceStore(peer, context.keyId), v = input(); store.replaceSourceSnapshot(v, null); const t = token(store.readSource(v.sourceId)!);
    if (change === "replace") other.replaceSourceSnapshot(v, 1); else other.markUnavailable(v.sourceId, 1);
    const before = rows(db); expect(store.confirmUnchangedSource(t)).toEqual({ status: "stale", actualRevision: 2 }); expect(rows(db)).toEqual(before);
  });
  it("rejects caller-owned transaction untouched and honors cancellation without database effects", () => {
    const db = memory(), store = createSourceStore(db, context.keyId), v = input(); store.replaceSourceSnapshot(v, null); const t = token(store.readSource(v.sourceId)!);
    db.exec("CREATE TABLE caller(value INTEGER); BEGIN; INSERT INTO caller VALUES(7)");
    expect(() => store.confirmUnchangedSource(t)).toThrowError(expect.objectContaining({ code: "DATABASE_TRANSACTION_FAILED" })); expect(db.isTransaction).toBe(true);
    const abort = new AbortController(); abort.abort(); expect(store.confirmUnchangedSource(t, abort.signal)).toEqual({ status: "aborted" }); expect(db.isTransaction).toBe(true); db.exec("COMMIT"); expect(db.prepare("SELECT * FROM caller").all()).toEqual([{ value: 7 }]);
    const exec = db.exec.bind(db), later = new AbortController(); db.exec = sql => { exec(sql); if (sql === "BEGIN") later.abort(); };
    expect(store.confirmUnchangedSource(t, later.signal)).toEqual({ status: "aborted" }); expect(db.isTransaction).toBe(false); db.exec = exec;
  });
  it.each(["header", "proof", "metrics", "capabilities", "identity", "missing_identity"])("fails closed for same-generation %s corruption", type => {
    const db = memory(), store = createSourceStore(db, context.keyId), v = input(); store.replaceSourceSnapshot(v, null); const t = token(store.readSource(v.sourceId)!);
    db.exec("PRAGMA foreign_keys=OFF");
    if (type === "header") db.exec("UPDATE source_event_headers SET observed_size=1");
    if (type === "proof") db.prepare("UPDATE source_cache_evidence SET content_fingerprint=?").run(context.fingerprint("content", ["changed"]));
    if (type === "metrics") db.exec("UPDATE source_metric_contributions SET row_json='{}'");
    if (type === "capabilities") { const capped = { ...v, evidence: { ...v.evidence, capabilities: { ...v.evidence.capabilities, stateLimited: true } } }; store.replaceSourceSnapshot(capped, 1); db.exec("UPDATE source_event_headers SET revision=1"); }
    if (type === "identity") db.prepare("UPDATE source_store_identity SET key_id=?").run("b".repeat(32));
    if (type === "missing_identity") db.exec("DELETE FROM source_store_identity");
    expect(() => store.confirmUnchangedSource(t)).toThrowError(expect.objectContaining({ code: type === "identity" ? "INVALID_IDENTITY_KEY" : "DATABASE_ACCESS_FAILED" })); expect(db.isTransaction).toBe(false);
  });
  it("rejects token accessors/extras without execution and reports a missing source stale", () => {
    const db = memory(), store = createSourceStore(db, context.keyId), v = input(); store.replaceSourceSnapshot(v, null); const t = token(store.readSource(v.sourceId)!); let calls = 0;
    expect(() => store.confirmUnchangedSource(Object.defineProperty({ ...t }, "revision", { get() { calls++; return 1; } }))).toThrow();
    expect(() => store.confirmUnchangedSource({ ...t, extra: "secret" } as never)).toThrow(); expect(calls).toBe(0);
    const empty = createSourceStore(memory(), context.keyId); expect(empty.confirmUnchangedSource(t)).toEqual({ status: "stale", actualRevision: null });
  });
});

it.each([3, 5])("rejects malformed/extra markers and settings on schema %i without mutation", version => {
  for (const corruption of ["missing", "extra", "text", "settings"]) {
    const db = memory(); if (version === 3) schemaThree(db);
    if (corruption === "missing") db.exec("DELETE FROM schema_migrations WHERE version=2");
    else if (corruption === "extra") db.exec("INSERT INTO schema_migrations VALUES(99)");
    else if (corruption === "text") db.exec("ALTER TABLE schema_migrations RENAME TO old_markers; CREATE TABLE schema_migrations(version); INSERT INTO schema_migrations SELECT version FROM old_markers; INSERT INTO schema_migrations VALUES('private')");
    else db.exec("UPDATE settings SET value=2");
    const before = db.prepare("SELECT * FROM schema_migrations").all(), settings = db.prepare("SELECT * FROM settings").all();
    expect(() => migrate(db)).toThrowError(expect.objectContaining({ code: "DATABASE_MIGRATION_FAILED" }));
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: version }); expect(db.prepare("SELECT * FROM schema_migrations").all()).toEqual(before); expect(db.prepare("SELECT * FROM settings").all()).toEqual(settings);
  }
});

it.each([false, true])("rolls back proof-trigger cancellation including original key binding (existing=%s)", existing => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = input(); if (existing) store.replaceSourceSnapshot(v, null);
  const before = rows(db), abort = new AbortController(); db.function("cancel_proof", () => { abort.abort(); return 0; });
  db.exec("CREATE TRIGGER cancel_proof AFTER INSERT ON source_cache_evidence BEGIN SELECT cancel_proof(); END");
  expect(store.replaceSourceSnapshot(v, existing ? 1 : null, abort.signal)).toEqual({ status: "aborted" }); expect(rows(db)).toEqual(before);
});
it("rolls back unavailable proof clearing when cancellation occurs inside SQLite", () => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = input(); store.replaceSourceSnapshot(v, null); const before = rows(db), abort = new AbortController();
  db.function("cancel_clear", () => { abort.abort(); return 0; }); db.exec("CREATE TRIGGER cancel_clear AFTER DELETE ON source_cache_evidence BEGIN SELECT cancel_clear(); END");
  expect(store.markUnavailable(v.sourceId, 1, abort.signal)).toEqual({ status: "aborted" }); expect(rows(db)).toEqual(before);
});
it.each(["text", "blob", "contract_blob"])("bounds malformed proof %s before it crosses SQLite into JS", kind => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = input(); store.replaceSourceSnapshot(v, null); const t = token(store.readSource(v.sourceId)!);
  db.exec("DROP TABLE source_cache_evidence; CREATE TABLE source_cache_evidence(source_id,contract_version,content_fingerprint)");
  db.prepare("INSERT INTO source_cache_evidence VALUES(?,?,?)").run(v.sourceId, kind === "contract_blob" ? Buffer.alloc(65536, 65) : 1,
    kind === "blob" ? Buffer.alloc(65536, 65) : "FICTITIOUS_SECRET".repeat(4096));
  const prepare = db.prepare.bind(db); let bounded = false;
  db.prepare = sql => { const statement = prepare(sql); if (sql.includes("FROM source_cache_evidence")) { const all = statement.all.bind(statement); statement.all = (...args) => { const result = all(...args); expect(result[0]!["content_fingerprint"]).toBeNull(); if (kind === "contract_blob") expect(result[0]!["contract_version"]).toBeNull(); bounded = true; return result; }; } return statement; };
  expect(() => store.confirmUnchangedSource(t)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" })); expect(bounded).toBe(true); expect(db.isTransaction).toBe(false); db.prepare = prepare;
});
it("rejects an old caller-owned snapshot without disturbing it, then observes the peer revision", async () => {
  const dir = join(temporaryDirectory(), "old_snapshot"), db = await openDatabase(dir), peer = await openDatabase(dir); dbs.push(db, peer);
  db.exec("PRAGMA journal_mode=WAL"); const store = createSourceStore(db, context.keyId), other = createSourceStore(peer, context.keyId), v = input(); store.replaceSourceSnapshot(v, null);
  db.exec("BEGIN"); const old = store.readSource(v.sourceId)!, t = token(old); other.replaceSourceSnapshot(v, 1);
  expect(() => store.confirmUnchangedSource(t)).toThrowError(expect.objectContaining({ code: "DATABASE_TRANSACTION_FAILED" })); expect(db.isTransaction).toBe(true); expect(store.readSource(v.sourceId)!.revision).toBe(1);
  db.exec("COMMIT"); expect(store.confirmUnchangedSource(t)).toEqual({ status: "stale", actualRevision: 2 });
});
it("rejects malformed proof input before writes without invoking accessors", () => {
  const db = memory(), store = createSourceStore(db, context.keyId), v = input(), before = rows(db); let calls = 0;
  const getter = Object.defineProperty({ ...v.cacheEvidence }, "contentFingerprint", { get() { calls++; return "secret"; } });
  for (const cacheEvidence of [getter, { ...v.cacheEvidence, extra: "secret" }, { ...v.cacheEvidence, contractVersion: 2 }, undefined]) expect(() => store.replaceSourceSnapshot({ ...v, cacheEvidence } as never, null)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
  expect(calls).toBe(0); expect(rows(db)).toEqual(before);
});
