import { createHash, createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate, openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { ClaudeAdapter } from "../src/parsers/claude/index.js";
import * as ingestion from "../src/scanner/source-ingest.js";
import { scanSources } from "../src/scanner/scan-run.js";
import { temporaryDirectory } from "./helpers.js";

const secret = Buffer.alloc(32, 23), keyId = "2".repeat(32), context = createIdentityContext(secret, keyId);
const databases = new Set<DatabaseSync>();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const hmac = (domain: string, ...parts: unknown[]) => `h1:${keyId}:${domain}:${createHmac("sha256", secret).update(JSON.stringify([1, 1, domain, ...parts])).digest("hex")}`;
const raw = [
  { type: "assistant", uuid: "call", sessionId: "FICTITIOUS_STORE_SESSION", timestamp: "2026-09-01T00:00:00.000Z", message: { id: "FICTITIOUS_RESPONSE", role: "assistant", content: [{ type: "tool_use", id: "FICTITIOUS_CALL", name: "Bash", input: { command: "npm test FICTITIOUS_COMMAND" } }] } },
  { type: "user", uuid: "result", sessionId: "FICTITIOUS_STORE_SESSION", parentUuid: "call", timestamp: "2026-09-01T00:00:04.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "FICTITIOUS_CALL", is_error: false, content: "FICTITIOUS_OUTPUT" }] } },
];
const bytes = Buffer.from(raw.map(value => JSON.stringify(value) + "\n").join(""));
function own(db: DatabaseSync) { databases.add(db); return db; }
afterEach(() => { vi.restoreAllMocks(); for (const db of databases) { try { db.close(); } catch {} } databases.clear(); });
function assertApi(store: any) { for (const name of ["readSourceForIngestion", "replaceSourceSnapshotWithCheckpoint", "confirmUnchangedSourceWithCheckpoint"]) expect(typeof store[name], `missing API ${name}`).toBe("function"); }
async function fixture(maxFileBytes = 64 * 1024 * 1024) {
  const root = temporaryDirectory(), data = join(root, "data"), path = join(root, "source.jsonl"); await writeFile(path, bytes);
  const db = own(await openDatabase(data)), store: any = createSourceStore(db, keyId); expect(Object.isFrozen(store)).toBe(true); assertApi(store);
  const result = await ingestion.ingestSourceFile(store, context, { path, provider: "claude", expectedRevision: null, maxFileBytes });
  expect(result).toMatchObject({ status: "committed", revision: 1 });
  const candidate = store.readSourceForIngestion(result.sourceId, context); expect(candidate.checkpoint).not.toBeNull();
  return { root, data, path, db, store, id: result.sourceId, candidate };
}
function snapshotInput(source: any) { const { revision, availability, persistedScope, aggregationReady, parserResumeReady, ...input } = source; return input; }
function capture(db: DatabaseSync, id: string) {
  const r: any = db.prepare("SELECT * FROM source_parser_checkpoints WHERE source_id=?").get(id)!;
  return { checkpoint: r.checkpoint_json, nextOrdinal: r.next_ordinal, maxFileBytes: r.max_file_bytes, maxRecords: r.max_records, maxLineBytes: r.max_line_bytes };
}
function allRows(db: DatabaseSync) {
  const result: Record<string, unknown> = {};
  for (const table of ["settings", "schema_migrations", "source_store_identity", "source_event_headers", "source_event_contributions", "source_metric_headers", "source_metric_contributions", "source_cache_evidence", "source_relationship_headers", "source_relationship_contributions", "source_parser_checkpoints"]) result[table] = db.prepare(`SELECT * FROM ${table} ORDER BY ${table === "schema_migrations" ? "1" : "1,2"}`).all();
  return result;
}
// Independent generation framing oracle. Does not import the new validator.
function projection(db: DatabaseSync, id: string) {
  const digest = createHash("sha256").update("agentprof.source-projection/v1\n");
  const frame = (value: unknown) => digest.update(JSON.stringify(value) + "\n");
  for (const r of db.prepare("SELECT * FROM source_event_contributions WHERE source_id=? ORDER BY event_id").all(id)) frame(["event", r.event_id, r.event_id, r.event_json]);
  for (const r of db.prepare("SELECT * FROM source_metric_contributions WHERE source_id=? ORDER BY kind,ordinal").all(id)) frame([r.kind, r.ordinal, r.row_id, r.row_json]);
  const h: any = db.prepare("SELECT * FROM source_relationship_headers WHERE source_id=?").get(id);
  frame(["relationship_header", null, null, JSON.stringify(h ? [h.contract_version, h.capture_policy_version, h.status, h.reason, h.metadata_count, h.wrapper_count, h.message_count, h.relationship_bytes] : null)]);
  for (const r of db.prepare("SELECT * FROM source_relationship_contributions WHERE source_id=? ORDER BY kind,ordinal").all(id)) frame([r.kind, r.ordinal, r.row_id, r.row_json]);
  return digest.digest("hex");
}
function generationSeal(db: DatabaseSync, id: string) {
  const h: any = db.prepare("SELECT * FROM source_event_headers WHERE source_id=?").get(id), c: any = db.prepare("SELECT * FROM source_parser_checkpoints WHERE source_id=?").get(id), proof: any = db.prepare("SELECT * FROM source_cache_evidence WHERE source_id=?").get(id);
  const tuple = [1, id, "claude", h.parser_version, h.normalization_version, h.key_version, h.key_id, h.revision, h.completed_offset, h.observed_size, h.boundary_fingerprint, proof.contract_version, proof.content_fingerprint, c.next_ordinal, c.max_file_bytes, c.max_records, c.max_line_bytes, c.checkpoint_bytes, sha(c.checkpoint_json), c.adapter_limits_fingerprint, projection(db, id)];
  return hmac("source", "agentprof.claude-source-generation/v1", sha(JSON.stringify(tuple)));
}
function resignGeneration(db: DatabaseSync, id: string) { db.prepare("UPDATE source_parser_checkpoints SET generation_seal=? WHERE source_id=?").run(generationSeal(db, id), id); }
function resignAdapter(value: any) { const payload = JSON.stringify(value); return JSON.stringify({ schema: "agentprof.claude-checkpoint/v1", payload, tag: hmac("source", "agentprof.claude-checkpoint/v1", sha(payload)) }); }
function unchecked(db: DatabaseSync) {
  db.exec("ALTER TABLE source_parser_checkpoints RENAME TO constrained_checkpoint; CREATE TABLE source_parser_checkpoints AS SELECT * FROM constrained_checkpoint; DROP TABLE constrained_checkpoint");
}
function interceptInsert(db: DatabaseSync, table: string, action: () => void) {
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    const statement = prepare(sql);
    if (!new RegExp(`INSERT(?: OR [A-Z]+)? INTO ${table}\\b`, "i").test(sql)) return statement;
    return new Proxy(statement, { get(target, property) {
      if (property === "run") return (...args: any[]) => { const result = (target.run as any)(...args); action(); return result; };
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    } });
  }) as typeof db.prepare;
  return () => { db.prepare = prepare; };
}

describe("source-owned checkpoint atomic storage", () => {
  it("captures one raw-free row with an independently framed exact generation seal", async () => {
    const f = await fixture(), rows: any[] = f.db.prepare("SELECT * FROM source_parser_checkpoints").all();
    expect(rows).toHaveLength(1); expect(rows[0].generation_seal).toBe(generationSeal(f.db, f.id));
    expect(rows[0].checkpoint_bytes).toBe(Buffer.byteLength(rows[0].checkpoint_json)); expect(rows[0].checkpoint_bytes).toBeLessThanOrEqual(4 * 1024 * 1024); expect(rows[0].next_ordinal).toBe(2);
    expect(f.store.readSource(f.id)).toEqual(f.candidate.source); expect(f.store.readSource(f.id)).not.toHaveProperty("checkpoint");
    expect(JSON.stringify(allRows(f.db))).not.toMatch(/FICTITIOUS_|source\.jsonl/);
  });
  it.each(["snapshot", "events", "unavailable"])("%s lifecycle clears old checkpoint atomically", async kind => {
    const f = await fixture(), full = snapshotInput(f.candidate.source);
    if (kind === "snapshot") f.store.replaceSourceSnapshot(full, 1);
    else if (kind === "events") { const { evidence, cacheEvidence, relationshipEvidence, ...events } = full; f.store.replaceSource(events, 1); }
    else f.store.markUnavailable(f.id, 1);
    expect(f.db.prepare("SELECT * FROM source_parser_checkpoints").all()).toEqual([]); expect(f.store.readSource(f.id).revision).toBe(2);
  });
  it("checkpoint-budget unavailability leaves normal ingestion accepted with optional state absent", async () => {
    const f = await fixture(); vi.spyOn(ClaudeAdapter.prototype, "exportCheckpoint").mockReturnValue({ status: "unavailable", reason: "checkpoint_budget" });
    expect(await ingestion.ingestSourceFile(f.store, context, { path: f.path, provider: "claude", expectedRevision: 1 })).toMatchObject({ status: "committed", revision: 2 });
    expect(f.store.readSourceForIngestion(f.id, context).checkpoint).toBeNull(); expect(f.store.readSource(f.id).events).toEqual(f.candidate.source.events);
  });
  it.each(["source_event_headers", "source_event_contributions", "source_metric_headers", "source_metric_contributions", "source_relationship_headers", "source_relationship_contributions", "source_cache_evidence", "source_parser_checkpoints"])("SQL failure after %s insertion rolls back complete generation", async table => {
    const f = await fixture(), before = allRows(f.db), undo = interceptInsert(f.db, table, () => { throw Error("FICTITIOUS_SQL_ERROR"); });
    try { expect(() => f.store.replaceSourceSnapshotWithCheckpoint(snapshotInput(f.candidate.source), capture(f.db, f.id), context, 1, f.candidate.predecessor)).toThrow(); }
    finally { undo(); }
    expect(allRows(f.db)).toEqual(before); expect(f.db.isTransaction).toBe(false);
  });
  it.each([false, true])("abort during checkpoint insert rolls back every row/key binding existing=%s", async existing => {
    const f = await fixture(), target = existing ? f.db : own(new DatabaseSync(":memory:")); if (!existing) migrate(target);
    const store: any = createSourceStore(target, keyId), before = allRows(target), abort = new AbortController(), undo = interceptInsert(target, "source_parser_checkpoints", () => abort.abort());
    try { expect(store.replaceSourceSnapshotWithCheckpoint(snapshotInput(f.candidate.source), capture(f.db, f.id), context, existing ? 1 : null, existing ? f.candidate.predecessor : undefined, abort.signal)).toEqual({ status: "aborted" }); }
    finally { undo(); }
    expect(allRows(target)).toEqual(before); expect(target.isTransaction).toBe(false);
  });
  it("refuses a caller-owned read transaction without committing or rolling it back", async () => {
    const f = await fixture(); f.db.exec("BEGIN");
    try { expect(() => f.store.readSourceForIngestion(f.id, context)).toThrow(); expect(f.db.isTransaction).toBe(true); }
    finally { f.db.exec("ROLLBACK"); }
  });
});

describe("bounded corrupt checkpoint reads", () => {
  it.each(["bytes", "blob", "oversize", "negative", "duplicate", "orphan", "tag", "token"])("rejects %s without repair or private disclosure", async kind => {
    const f = await fixture(); unchecked(f.db);
    if (kind === "bytes") f.db.exec("UPDATE source_parser_checkpoints SET checkpoint_bytes=checkpoint_bytes+1");
    if (kind === "blob") f.db.exec("UPDATE source_parser_checkpoints SET checkpoint_json=CAST(checkpoint_json AS BLOB)");
    if (kind === "oversize") f.db.exec("UPDATE source_parser_checkpoints SET checkpoint_json=CAST(zeroblob(4194305) AS TEXT),checkpoint_bytes=4194305");
    if (kind === "negative") f.db.exec("UPDATE source_parser_checkpoints SET next_ordinal=-1");
    if (kind === "duplicate") f.db.exec("INSERT INTO source_parser_checkpoints SELECT * FROM source_parser_checkpoints");
    if (kind === "orphan") f.db.prepare("UPDATE source_parser_checkpoints SET source_id=?").run(context.fingerprint("source", ["absent"]));
    if (kind === "tag") f.db.prepare("UPDATE source_parser_checkpoints SET generation_seal=?").run(hmac("source", "wrong"));
    if (kind === "token") f.db.exec("UPDATE source_parser_checkpoints SET checkpoint_json='FICTITIOUS_CORRUPTION',checkpoint_bytes=20");
    const before = allRows(f.db), targetId = kind === "orphan" ? context.fingerprint("source", ["absent"]) : f.id;
    expect(() => f.store.readSourceForIngestion(targetId, context)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" }));
    expect(allRows(f.db)).toEqual(before); expect(f.db.isTransaction).toBe(false);
  });
  it.each(["extra", "wrong_source", "wrong_ordinal", "trusted_evidence"])("rejects re-signed current token %s even with valid independent generation seal", async mutation => {
    const f = await fixture(), c: any = f.db.prepare("SELECT * FROM source_parser_checkpoints").get(), inner = JSON.parse(JSON.parse(c.checkpoint_json).payload);
    if (mutation === "extra") inner.raw = "FICTITIOUS_RAW_SECRET";
    if (mutation === "wrong_source") inner.sourceId = hmac("source", "claude", "/other");
    if (mutation === "wrong_ordinal") inner.nextOrdinal++;
    if (mutation === "trusted_evidence") inner.state.events[0][1].result.contentState = "complete";
    const token = resignAdapter(inner); f.db.prepare("UPDATE source_parser_checkpoints SET checkpoint_json=?,checkpoint_bytes=?").run(token, Buffer.byteLength(token)); resignGeneration(f.db, f.id);
    const before = allRows(f.db); expect(() => f.store.readSourceForIngestion(f.id, context)).toThrow(); expect(allRows(f.db)).toEqual(before);
  });
  it("valid-shaped public-row substitution cannot match the restored checkpoint projection", async () => {
    const f = await fixture(), row: any = f.db.prepare("SELECT * FROM source_event_contributions LIMIT 1").get(), event = JSON.parse(row.event_json); event.durationMs = 5000; event.endAt = "2026-09-01T00:00:05.000Z";
    const next = JSON.stringify(event), delta = Buffer.byteLength(next) - Buffer.byteLength(row.event_json);
    f.db.prepare("UPDATE source_event_contributions SET event_json=? WHERE event_id=?").run(next, row.event_id); f.db.prepare("UPDATE source_event_headers SET event_bytes=event_bytes+?").run(delta); resignGeneration(f.db, f.id);
    expect(f.store.readSource(f.id).events[0]).toMatchObject({durationMs:5000,endAt:"2026-09-01T00:00:05.000Z"});
    const before = allRows(f.db); expect(() => f.store.readSourceForIngestion(f.id, context)).toThrow(); expect(allRows(f.db)).toEqual(before);
  });
});

describe("original predecessor is retained through all continuation and replay paths", () => {
  it.each(["resume", "limits", "file_mismatch"])("same-revision checkpoint deletion cannot be overwritten on %s", async pathKind => {
    const f = await fixture(), input: any = { path: f.path, provider: "claude", expectedRevision: 1 };
    if (pathKind === "limits") input.maxRecords = 99;
    if (pathKind === "file_mismatch") await writeFile(f.path, Buffer.from(raw.slice(0, 1).map(v => JSON.stringify(v) + "\n").join("")));
    const peer = own(new DatabaseSync(join(f.data, "agentprof.sqlite"))); peer.exec("DELETE FROM source_parser_checkpoints");
    const before = allRows(peer);
    await expect((ingestion as any).ingestSourceFileFromCheckpoint(f.store, context, input, f.candidate)).rejects.toMatchObject({ code: "DATABASE_ACCESS_FAILED" });
    expect(allRows(peer)).toEqual(before);
  });
  it("initial optional absence followed by same-revision insertion is not a historical miss", async () => {
    const f = await fixture(), c: any = f.db.prepare("SELECT * FROM source_parser_checkpoints").get(); f.db.exec("DELETE FROM source_parser_checkpoints");
    const absent = f.store.readSourceForIngestion(f.id, context); expect(absent.checkpoint).toBeNull();
    const names = Object.keys(c); f.db.prepare(`INSERT INTO source_parser_checkpoints(${names.join(",")}) VALUES(${names.map(() => "?").join(",")})`).run(...Object.values(c) as any[]);
    const before = allRows(f.db);
    await expect((ingestion as any).ingestSourceFileFromCheckpoint(f.store, context, { path: f.path, provider: "claude", expectedRevision: 1 }, absent)).rejects.toMatchObject({ code: "DATABASE_ACCESS_FAILED" }); expect(allRows(f.db)).toEqual(before);
  });
  it("real peer revision advance returns stale without a retry or refreshed expectation", async () => {
    const f = await fixture(), peer = own(new DatabaseSync(join(f.data, "agentprof.sqlite"))), other = createSourceStore(peer, keyId); other.markUnavailable(f.id, 1);
    const before = allRows(peer), spy = vi.fn(f.store.readSourceForIngestion), facade = { ...f.store, readSourceForIngestion: spy };
    const result = await (ingestion as any).ingestSourceFileFromCheckpoint(facade, context, { path: f.path, provider: "claude", expectedRevision: 1 }, f.candidate);
    expect(result).toMatchObject({ status: "stale", actualRevision: 2 }); expect(spy).not.toHaveBeenCalled(); expect(allRows(peer)).toEqual(before);
  });
  it("valid semantic-limit mismatch replays, while corrupt seal wins over that mismatch", async () => {
    const f = await fixture(), spy = vi.spyOn(ClaudeAdapter.prototype, "ingest");
    expect(await (ingestion as any).ingestSourceFileFromCheckpoint(f.store, context, { path: f.path, provider: "claude", expectedRevision: 1, maxRecords: 99 }, f.candidate)).toMatchObject({ status: "committed", revision: 2 }); expect(spy).toHaveBeenCalledTimes(2); spy.mockRestore();
    f.db.prepare("UPDATE source_parser_checkpoints SET generation_seal=?").run(hmac("source", "invalid")); const before = allRows(f.db);
    expect(() => f.store.readSourceForIngestion(f.id, context)).toThrowError(expect.objectContaining({ code: "DATABASE_ACCESS_FAILED" })); expect(allRows(f.db)).toEqual(before);
  });
});

it.each(["not_lf", "wrong_boundary"])("matching whole-byte proof with %s authenticated metadata is hard corruption", async kind => {
  const f = await fixture();
  if (kind === "not_lf") {
    const c: any = f.db.prepare("SELECT * FROM source_parser_checkpoints").get(), inner = JSON.parse(JSON.parse(c.checkpoint_json).payload); inner.completedOffset--;
    const token = resignAdapter(inner); f.db.prepare("UPDATE source_parser_checkpoints SET checkpoint_json=?,checkpoint_bytes=?").run(token, Buffer.byteLength(token)); f.db.exec("UPDATE source_event_headers SET completed_offset=completed_offset-1");
  } else f.db.prepare("UPDATE source_event_headers SET boundary_fingerprint=?").run(hmac("content", "wrong-boundary"));
  resignGeneration(f.db, f.id); const before = allRows(f.db), candidate = f.store.readSourceForIngestion(f.id, context);
  await expect((ingestion as any).ingestSourceFileFromCheckpoint(f.store, context, { path: f.path, provider: "claude", expectedRevision: 1 }, candidate)).rejects.toMatchObject({ code: "DATABASE_ACCESS_FAILED" });
  expect(allRows(f.db)).toEqual(before);
});


function historicalSchema(db: DatabaseSync, version: number) {
  if (version === 0) return;
  migrate(db); expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(8);
  if (version < 8) db.exec("DROP TABLE directory_batch_resume");
  if (version < 7) db.exec("DROP TABLE directory_membership_members; DROP TABLE directory_membership_roots");
  if (version < 6) db.exec("DROP TABLE source_parser_checkpoints");
  if (version < 5) db.exec("DROP TABLE source_relationship_contributions; DROP TABLE source_relationship_headers");
  if (version < 4) db.exec("DROP TABLE source_cache_evidence");
  if (version < 3) db.exec("DROP TABLE source_metric_contributions; DROP TABLE source_metric_headers");
  if (version < 2) db.exec("DROP TABLE source_event_contributions; DROP TABLE source_event_headers; DROP TABLE source_store_identity");
  db.exec(`DELETE FROM schema_migrations WHERE version>${version}; PRAGMA user_version=${version}`);
}
describe("atomic schema6 checkpoint lifecycle", () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])("migrates real schema%i once and preserves prior key/settings/source generation", version => {
    const db = own(new DatabaseSync(":memory:"));
    if (version === 0) historicalSchema(db, 0);
    else {
      migrate(db); expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(8);
      if (version >= 2) createSourceStore(db, keyId).replaceSource({ sourceId: hmac("source", "claude", "/migration"), provider: "claude", parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId, completedOffset: 0, observedSize: 0, boundaryFingerprint: null, events: [] }, null);
      if (version < 8) db.exec("DROP TABLE directory_batch_resume");
      if (version < 7) db.exec("DROP TABLE directory_membership_members; DROP TABLE directory_membership_roots");
  if (version < 6) db.exec("DROP TABLE source_parser_checkpoints");
      if (version < 5) db.exec("DROP TABLE source_relationship_contributions; DROP TABLE source_relationship_headers");
      if (version < 4) db.exec("DROP TABLE source_cache_evidence");
      if (version < 3) db.exec("DROP TABLE source_metric_contributions; DROP TABLE source_metric_headers");
      if (version < 2) db.exec("DROP TABLE source_event_contributions; DROP TABLE source_event_headers; DROP TABLE source_store_identity");
      db.exec(`DELETE FROM schema_migrations WHERE version>${version}; PRAGMA user_version=${version}`);
    }
    db.exec("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES('preserve')");
    const headers = version >= 2 ? db.prepare("SELECT * FROM source_event_headers").all() : [], keys = version >= 2 ? db.prepare("SELECT * FROM source_store_identity").all() : [];
    migrate(db); migrate(db);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 8 }); expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([1,2,3,4,5,6,7,8].map(version => ({ version })));
    expect(db.prepare("SELECT * FROM source_event_headers").all()).toEqual(headers); expect(db.prepare("SELECT * FROM source_store_identity").all()).toEqual(keys); expect(db.prepare("SELECT * FROM source_parser_checkpoints").all()).toEqual([]); expect(db.prepare("SELECT value FROM unrelated").get()).toEqual({ value: "preserve" });
    expect(db.prepare("SELECT * FROM settings ORDER BY key").all()).toEqual([{key:"key_version",value:1},{key:"normalization_version",value:1}]);
  });
  it("uses the version observed after a real peer has completed5-to7 under the write lock", () => {
    const path = join(temporaryDirectory(), "peer.sqlite"), first = own(new DatabaseSync(path)), peer = own(new DatabaseSync(path)); historicalSchema(first, 5);
    const exec = first.exec.bind(first); let interleaved = false;
    first.exec = ((sql: string) => { if (sql === "BEGIN IMMEDIATE" && !interleaved) { interleaved = true; migrate(peer); } return exec(sql); }) as typeof first.exec;
    try { migrate(first); } finally { first.exec = exec; }
    expect(interleaved).toBe(true); expect(first.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([1,2,3,4,5,6,7,8].map(version => ({ version })));
  });
  it.each(["conflict", "missing_marker", "extra_marker", "future"])("schema5 %s fails without any partial DDL/data change", kind => {
    const db = own(new DatabaseSync(":memory:")); historicalSchema(db, 5);
    if (kind === "conflict") db.exec("CREATE TABLE source_parser_checkpoints(sentinel); INSERT INTO source_parser_checkpoints VALUES(7)");
    if (kind === "missing_marker") db.exec("DELETE FROM schema_migrations WHERE version=3");
    if (kind === "extra_marker") db.exec("INSERT INTO schema_migrations VALUES(99)");
    if (kind === "future") db.exec("PRAGMA user_version=8");
    const before = db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all(), markers = db.prepare("SELECT * FROM schema_migrations ORDER BY version").all(), version = db.prepare("PRAGMA user_version").get();
    expect(() => migrate(db)).toThrow(); expect(db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all()).toEqual(before); expect(db.prepare("SELECT * FROM schema_migrations ORDER BY version").all()).toEqual(markers); expect(db.prepare("PRAGMA user_version").get()).toEqual(version); expect(db.isTransaction).toBe(false);
  });
});

it("checkpoint capture rejects accessors, proxies, raw extra fields and unsafe ordinals without execution",async()=>{
  const f=await fixture(),good=capture(f.db,f.id),before=allRows(f.db);let calls=0;
  const getter=Object.defineProperty({...good},"checkpoint",{get(){calls++;return good.checkpoint;}}),proxy=new Proxy({...good},{getPrototypeOf(){calls++;throw Error("private");},ownKeys(){calls++;throw Error("private");}});
  const variants=[getter,proxy,{...good,raw:"FICTITIOUS_SECRET"},...[NaN,Infinity,-0,-1,1.5].map(nextOrdinal=>({...good,nextOrdinal}))];
  for(const value of variants)expect(()=>f.store.replaceSourceSnapshotWithCheckpoint(snapshotInput(f.candidate.source),value,context,1,f.candidate.predecessor)).toThrow();
  expect(calls).toBe(0);expect(allRows(f.db)).toEqual(before);
});

it("valid signed old default-limit fingerprint is incompatible and safely reparses",async()=>{
  const f=await fixture(),c:any=f.db.prepare("SELECT * FROM source_parser_checkpoints").get(),inner=JSON.parse(JSON.parse(c.checkpoint_json).payload);inner.limits.events--;
  const token=resignAdapter(inner),limitFingerprint=sha(JSON.stringify(["agentprof.claude-limits/v1",Object.entries(inner.limits)]));
  expect(ClaudeAdapter.restoreCheckpoint(context,token,{sourceId:f.id,completedOffset:f.candidate.source.completedOffset,nextOrdinal:2},{events:inner.limits.events}).status).toBe("restored");
  f.db.prepare("UPDATE source_parser_checkpoints SET checkpoint_json=?,checkpoint_bytes=?,adapter_limits_fingerprint=?").run(token,Buffer.byteLength(token),limitFingerprint);resignGeneration(f.db,f.id);
  const restore=vi.spyOn(ClaudeAdapter,"restoreCheckpoint"),candidate=f.store.readSourceForIngestion(f.id,context);expect(restore).not.toHaveBeenCalled();restore.mockRestore();const spy=vi.spyOn(ClaudeAdapter.prototype,"ingest");
  expect(await (ingestion as any).ingestSourceFileFromCheckpoint(f.store,context,{path:f.path,provider:"claude",expectedRevision:1},candidate)).toMatchObject({status:"committed",revision:2});expect(spy).toHaveBeenCalledTimes(2);
});

it("actual current parser-version mismatch replays under unchanged predecessor/CAS without coercing old state",async()=>{
  const f=await fixture(),snapshot=ClaudeAdapter.prototype.snapshot,nextVersion=f.candidate.source.parserVersion+1;
  vi.spyOn(ClaudeAdapter.prototype,"snapshot").mockImplementation(function(){const s=snapshot.call(this);return {...s,capabilities:{...s.capabilities,parserVersion:nextVersion}} as never;});
  const restore=vi.spyOn(ClaudeAdapter,"restoreCheckpoint"),candidate=f.store.readSourceForIngestion(f.id,context);expect(restore).not.toHaveBeenCalled();
  // Observe the write boundary without pretending the current main's supported-version
  // metric validator already admits a synthetic future parser version.
  const write=vi.fn((..._args: any[])=>({status:"committed" as const,revision:2})),facade={...f.store,replaceSourceSnapshotWithCheckpoint:write},spy=vi.spyOn(ClaudeAdapter.prototype,"ingest");
  expect(await (ingestion as any).ingestSourceFileFromCheckpoint(facade,context,{path:f.path,provider:"claude",expectedRevision:1},candidate)).toMatchObject({status:"committed",revision:2});
  expect(spy).toHaveBeenCalledTimes(2);expect(write.mock.calls[0]?.[0]).toMatchObject({parserVersion:nextVersion});expect(write.mock.calls[0]?.[3]).toBe(1);expect(write.mock.calls[0]?.[4]).toEqual(candidate.predecessor);expect(f.store.readSource(f.id).revision).toBe(1);
});

it("read-only schema5 is refused without writes and explicit write-open migrates absent checkpoint",async()=>{
  const f=await fixture(),expected=f.store.readSource(f.id);await writeFile(join(f.data,"identity-key.json"),JSON.stringify({keyVersion:1,keyId,secret:secret.toString("hex")}),{mode:0o600});
  f.db.exec("DROP TABLE directory_batch_resume; DROP TABLE directory_membership_members; DROP TABLE directory_membership_roots; DROP TABLE source_parser_checkpoints; DELETE FROM schema_migrations WHERE version>=6; PRAGMA user_version=5");f.db.close();databases.delete(f.db);
  const {withReadOnlyStore}=await import("../src/db/read-only.js"),{readdir,stat}=await import("node:fs/promises");
  const state=async()=>{const entries=await readdir(f.data);return Promise.all(entries.sort().map(async name=>({name,bytes:await readFile(join(f.data,name)),mode:(await stat(join(f.data,name))).mode})));};
  const before=await state();await expect(withReadOnlyStore(f.data,()=>1)).rejects.toMatchObject({code:"DATABASE_SCHEMA_INCOMPATIBLE"});expect(await state()).toEqual(before);
  const upgraded=own(await openDatabase(f.data));expect(upgraded.prepare("PRAGMA user_version").get()).toEqual({user_version:8});expect(upgraded.prepare("SELECT * FROM source_parser_checkpoints").all()).toEqual([]);upgraded.close();databases.delete(upgraded);
  const after=await state();expect(await withReadOnlyStore(f.data,(db,key)=>createSourceStore(db,key).readSource(f.id))).toEqual(expected);expect(await state()).toEqual(after);
});

it("missing schema6 checkpoint table is corruption rather than an absent optional row",async()=>{
  const f=await fixture();f.db.exec("DROP TABLE source_parser_checkpoints");const schema=f.db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all();
  expect(()=>f.store.readSourceForIngestion(f.id,context)).toThrowError(expect.objectContaining({code:"DATABASE_ACCESS_FAILED"}));expect(f.db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all()).toEqual(schema);
});

it.each(["limits","file_mismatch"])("same-revision public-row mutation is preserved across %s fallback",async pathKind=>{
  const f=await fixture();if(pathKind==="file_mismatch")await writeFile(f.path,Buffer.from(raw.slice(0,1).map(v=>JSON.stringify(v)+"\n").join("")));
  const peer=own(new DatabaseSync(join(f.data,"agentprof.sqlite"))),r:any=peer.prepare("SELECT * FROM source_event_contributions LIMIT 1").get(),event=JSON.parse(r.event_json);event.durationMs=5000;event.endAt="2026-09-01T00:00:05.000Z";const changed=JSON.stringify(event);
  peer.prepare("UPDATE source_event_contributions SET event_json=? WHERE event_id=?").run(changed,r.event_id);peer.prepare("UPDATE source_event_headers SET event_bytes=event_bytes+?").run(Buffer.byteLength(changed)-Buffer.byteLength(r.event_json));resignGeneration(peer,f.id);expect(createSourceStore(peer,keyId).readSource(f.id)?.events[0]).toMatchObject({durationMs:5000,endAt:"2026-09-01T00:00:05.000Z"});const before=allRows(peer);
  await expect((ingestion as any).ingestSourceFileFromCheckpoint(f.store,context,{path:f.path,provider:"claude",expectedRevision:1,...(pathKind==="limits"?{maxRecords:99}:{})},f.candidate)).rejects.toMatchObject({code:"DATABASE_ACCESS_FAILED"});expect(allRows(peer)).toEqual(before);
});

it("oversized TEXT is rejected before any payload value crosses the SQL result boundary",async()=>{
  const f=await fixture();unchecked(f.db);f.db.exec("UPDATE source_parser_checkpoints SET checkpoint_json=CAST(zeroblob(4194305) AS TEXT),checkpoint_bytes=4194305");
  const before=f.db.prepare("SELECT checkpoint_bytes,length(CAST(checkpoint_json AS BLOB)) AS n FROM source_parser_checkpoints").get(),prepare=f.db.prepare.bind(f.db);let oversizedMaterialized=false;
  const inspect=(row:any)=>{if(row&&typeof row==="object")for(const value of Object.values(row))if(typeof value==="string"&&Buffer.byteLength(value)>4194304||ArrayBuffer.isView(value)&&value.byteLength>4194304)oversizedMaterialized=true;};
  f.db.prepare=((sql:string)=>{const stmt=prepare(sql);return new Proxy(stmt,{get(target,property){
    if(property==="get")return(...args:any[])=>{const row=(target.get as any)(...args);inspect(row);return row;};
    if(property==="all")return(...args:any[])=>{const rows=(target.all as any)(...args);for(const row of rows)inspect(row);return rows;};
    if(property==="iterate")return function*(...args:any[]){for(const row of (target.iterate as any)(...args)){inspect(row);yield row;}};
    const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
  }});}) as typeof f.db.prepare;
  try{expect(()=>f.store.readSourceForIngestion(f.id,context)).toThrowError(expect.objectContaining({code:"DATABASE_ACCESS_FAILED"}));expect(oversizedMaterialized).toBe(false);}finally{f.db.prepare=prepare;}
  expect(f.db.prepare("SELECT checkpoint_bytes,length(CAST(checkpoint_json AS BLOB)) AS n FROM source_parser_checkpoints").get()).toEqual(before);
});


it.each(["replay", "unchanged"])("absent checkpoint plus valid public-row race requires generationDigest on %s", async route => {
  const f = await fixture(route === "unchanged" ? 16 * 1024 * 1024 : 64 * 1024 * 1024); f.db.exec("DELETE FROM source_parser_checkpoints");
  const absent = f.store.readSourceForIngestion(f.id, context);
  expect(absent.checkpoint).toBeNull(); expect(absent.predecessor.checkpointSeal).toBeNull();
  expect(absent.predecessor.generationDigest).toMatch(/^[a-f0-9]{64}$/);
  let before: ReturnType<typeof allRows> | undefined, mutations = 0;
  const mutatePublicRow = () => {
    const row: any = f.db.prepare("SELECT * FROM source_event_contributions LIMIT 1").get(), event = JSON.parse(row.event_json);
    event.durationMs = 5000; event.endAt = "2026-09-01T00:00:05.000Z"; const changed = JSON.stringify(event);
    f.db.prepare("UPDATE source_event_contributions SET event_json=? WHERE event_id=?").run(changed, row.event_id);
    f.db.prepare("UPDATE source_event_headers SET event_bytes=event_bytes+?").run(Buffer.byteLength(changed) - Buffer.byteLength(row.event_json));
    expect(f.store.readSource(f.id).events[0].durationMs).toBe(5000); // Shape is valid; no seal exists to catch it.
    expect(f.store.readSource(f.id).revision).toBe(1); expect(f.db.prepare("SELECT * FROM source_parser_checkpoints").all()).toEqual([]);
    mutations++; before = allRows(f.db);
  };
  if (route === "replay") {
    mutatePublicRow();
    await expect((ingestion as any).ingestSourceFileFromCheckpoint(f.store, context, {path:f.path,provider:"claude",expectedRevision:1}, absent)).rejects.toMatchObject({code:"DATABASE_ACCESS_FAILED"});
  } else {
    const facade = {...f.store, confirmUnchangedSourceWithCheckpoint(token: any, predecessor: any, suppliedContext: any, signal?: AbortSignal) {
      expect(predecessor.checkpointSeal).toBeNull(); expect(predecessor.generationDigest).toBe(absent.predecessor.generationDigest);
      mutatePublicRow(); return f.store.confirmUnchangedSourceWithCheckpoint(token, predecessor, suppliedContext, signal);
    }};
    const result = await scanSources(facade, context, [{provider:"claude",path:f.root}]);
    expect(result).toMatchObject({stopReason:"storage_failure",counts:{failed:1,unchanged:0,committed:0}});
    expect(result.sources[0]).toMatchObject({status:"failed",errorCode:"DATABASE_ACCESS_FAILED"});
  }
  expect(mutations).toBe(1); expect(allRows(f.db)).toEqual(before); expect(Object.isFrozen(f.store)).toBe(true);
});


it("baseline public-row validator accepts coherent5000ms mutation before any checkpoint guard", async () => {
  const root=temporaryDirectory(),path=join(root,"source.jsonl"),data=join(root,"data");await writeFile(path,bytes);const db=own(await openDatabase(data)),store=createSourceStore(db,keyId);
  const first=await ingestion.ingestSourceFile(store,context,{path,provider:"claude",expectedRevision:null});expect(first.status).toBe("committed");
  const initial=store.readSource(first.sourceId)!;expect(initial.events[0]).toMatchObject({durationMs:4000,endAt:"2026-09-01T00:00:04.000Z"});
  const row:any=db.prepare("SELECT * FROM source_event_contributions LIMIT 1").get(),event=JSON.parse(row.event_json);event.durationMs=5000;event.endAt="2026-09-01T00:00:05.000Z";const changed=JSON.stringify(event);
  db.prepare("UPDATE source_event_contributions SET event_json=? WHERE event_id=?").run(changed,row.event_id);db.prepare("UPDATE source_event_headers SET event_bytes=event_bytes+?").run(Buffer.byteLength(changed)-Buffer.byteLength(row.event_json));
  expect(store.readSource(first.sourceId)?.events[0]).toMatchObject({durationMs:5000,startAt:"2026-09-01T00:00:00.000Z",endAt:"2026-09-01T00:00:05.000Z"});expect(store.readSource(first.sourceId)?.revision).toBe(1);
});

it.each([false, true])("unchanged scan replays a signed old adapter-limit checkpoint, but corrupt seal wins=%s", async corrupt => {
  const f = await fixture();
  // Match the scanner's semantic file limit so a cache miss cannot hide this guard.
  expect(await ingestion.ingestSourceFile(f.store, context, {path:f.path, provider:"claude", expectedRevision:1, maxFileBytes:16*1024*1024})).toMatchObject({status:"committed", revision:2});
  const row:any = f.db.prepare("SELECT * FROM source_parser_checkpoints").get(), inner = JSON.parse(JSON.parse(row.checkpoint_json).payload);
  inner.limits.events--;
  const token = resignAdapter(inner), oldLimits = sha(JSON.stringify(["agentprof.claude-limits/v1", Object.entries(inner.limits)]));
  expect(ClaudeAdapter.restoreCheckpoint(context, token, {sourceId:f.id, completedOffset:f.store.readSource(f.id).completedOffset, nextOrdinal:2}, {events:inner.limits.events}).status).toBe("restored");
  f.db.prepare("UPDATE source_parser_checkpoints SET checkpoint_json=?,checkpoint_bytes=?,adapter_limits_fingerprint=?").run(token, Buffer.byteLength(token), oldLimits);
  resignGeneration(f.db, f.id);
  const predecessor = f.store.readSourceForIngestion(f.id, context).predecessor;
  if (corrupt) f.db.prepare("UPDATE source_parser_checkpoints SET generation_seal=?").run(hmac("source", "invalid-limit-seal"));
  const before = allRows(f.db), ingest = vi.spyOn(ClaudeAdapter.prototype, "ingest"), write = vi.fn(f.store.replaceSourceSnapshotWithCheckpoint);
  const facade = {...f.store, replaceSourceSnapshotWithCheckpoint:write};
  const run = await scanSources(facade, context, [{provider:"claude", path:f.path}]);
  if (corrupt) {
    expect(run).toMatchObject({status:"partial", stopReason:"storage_failure", counts:{failed:1, unchanged:0, committed:0}});
    expect(run.sources[0]).toMatchObject({errorCode:"DATABASE_ACCESS_FAILED"}); expect(ingest).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(allRows(f.db)).toEqual(before);
  } else {
    expect(run.counts).toMatchObject({failed:0, unchanged:0, committed:1}); expect(ingest).toHaveBeenCalledTimes(2); expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[3]).toBe(2); expect(write.mock.calls[0]?.[4]).toEqual(predecessor);
    expect(f.store.readSource(f.id).revision).toBe(3); expect(f.store.readSourceForIngestion(f.id, context).checkpoint).not.toBeNull();
  }
});
