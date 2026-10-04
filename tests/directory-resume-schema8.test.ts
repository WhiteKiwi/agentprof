import { DatabaseSync } from "node:sqlite";
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { migrate, openDatabase } from "../src/db/database.js";
import { createDirectoryResumeStore } from "../src/db/directory-resume.js";
import { createDirectoryMembershipStore } from "../src/db/directory-membership.js";
import { createIdentityContext, loadOrCreateIdentityContext } from "../src/normalize/identity.js";
import { createSourceStore } from "../src/db/source-store.js";
import { scanSources } from "../src/scanner/scan-run.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { temporaryDirectory } from "./helpers.js";
const schema7 = readFileSync(new URL("./fixtures/directory-resume-schema7.sql", import.meta.url), "utf8");
const handles = new Set<DatabaseSync>();
afterEach(() => { for (const db of handles) db.close(); handles.clear(); });
function original(path = ":memory:") {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true }); handles.add(db); db.exec(schema7); return db;
}
function rows(db: DatabaseSync) {
  return db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT IN ('schema_migrations','directory_batch_resume') ORDER BY name").all()
    .map(row => ({ name: row.name, sql: row.sql, rows: db.prepare(`SELECT * FROM "${row.name}" ORDER BY rowid`).all() }));
}
const key = "b".repeat(32), context = createIdentityContext(Buffer.alloc(32, 29), key);
const value = { rootId: context.fingerprint("source", ["root"]), provider: "codex" as const,
  rootFingerprint: context.fingerprint("content", ["physical"]), membershipRevision: null,
  captureMode: "default" as const, censusCount: 32, nextOffset: 16,
  censusFingerprint: context.fingerprint("content", ["census"]), prefixFingerprint: context.fingerprint("content", ["prefix"]) };

it.each(["codex", "claude"] as const)("genuine schema7 DDL preserves every populated %s table, checkpoint and key through8", async provider => {
  const directory = temporaryDirectory(), data = join(directory, "data"), path = join(data, "agentprof.sqlite");
  const c = await loadOrCreateIdentityContext(data), db = original(path); chmodSync(path, 0o600);
  const logs = join(directory, "logs"); mkdirSync(logs);
  copyFileSync(fileURLToPath(new URL(`./fixtures/providers/${provider}-real-shapes.jsonl`, import.meta.url)), join(logs, "synthetic.jsonl"));
  const scan = await scanSources(createSourceStore(db, c.keyId), c, [{ provider, path: logs }]);
  expect(scan.counts.committed).toBe(1); expect(scan.counts.failed).toBe(0);
  const sourceId = scan.sources[0]!.sourceId, source = createSourceStore(db, c.keyId).readSource(sourceId)!;
  const rootId = c.fingerprint("source", ["root"]), rootFingerprint = c.fingerprint("content", ["physical"]);
  createDirectoryMembershipStore(db, c).capture({ rootId, provider, rootFingerprint, observed: [{ sourceId, sourceRevision: source.revision }] }, null);
  const before = rows(db); expect(db.prepare("PRAGMA user_version").get()!.user_version).toBe(7);
  expect(before.some(row => row.name === "source_event_contributions" && row.rows.length > 0)).toBe(true);
  expect(before.some(row => row.name === "source_parser_checkpoints" && row.rows.length > 0)).toBe(true);
  db.close(); handles.delete(db); const bytes = readFileSync(path), privateKey = readFileSync(join(data, "identity-key.json"));
  await expect(withReadOnlyStore(data, () => 1)).rejects.toMatchObject({ code: "DATABASE_SCHEMA_INCOMPATIBLE" });
  expect(readFileSync(path)).toEqual(bytes); expect(readFileSync(join(data, "identity-key.json"))).toEqual(privateKey);
  const migrated = await openDatabase(data); handles.add(migrated);
  expect(migrated.prepare("PRAGMA user_version").get()).toEqual({ user_version: 8 });
  expect(migrated.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([1,2,3,4,5,6,7,8].map(version => ({ version })));
  expect(rows(migrated)).toEqual(before); expect(createSourceStore(migrated, c.keyId).readSource(sourceId)).toEqual(source);
  expect(migrated.prepare("SELECT * FROM directory_batch_resume").all()).toEqual([]);
  expect(migrated.prepare("PRAGMA table_list").all().find(row => row.name === "directory_batch_resume")?.strict).toBe(1);
  migrate(migrated); expect(rows(migrated)).toEqual(before);
  migrated.close(); handles.delete(migrated);
  const after = readFileSync(path);
  expect(await withReadOnlyStore(data, (d, k) => createSourceStore(d, k).readSource(sourceId))).toEqual(source);
  expect(readFileSync(path)).toEqual(after); expect(readFileSync(join(data, "identity-key.json"))).toEqual(privateKey);
});

it("rolls back a schema7-to8 DDL conflict without changing the original7 schema or rows", () => {
  const db = original(); db.exec("CREATE TABLE directory_batch_resume(sentinel); INSERT INTO directory_batch_resume VALUES('preserve')");
  const before = db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all(), prior = rows(db);
  expect(() => migrate(db)).toThrowError(expect.objectContaining({ code: "DATABASE_MIGRATION_FAILED" }));
  expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 7 });
  expect(db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all()).toEqual(before); expect(rows(db)).toEqual(prior);
  expect(db.prepare("SELECT * FROM directory_batch_resume").all()).toEqual([{ sentinel: "preserve" }]);
  expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toHaveLength(7);
});

it.each(["missing", "extra", "wrong-order", "future"])("rejects %s migration markers and leaves them intact", kind => {
  const db = original(); migrate(db);
  if (kind === "missing") db.exec("DELETE FROM schema_migrations WHERE version=3");
  if (kind === "extra") db.exec("INSERT INTO schema_migrations VALUES(9)");
  if (kind === "wrong-order") db.exec("UPDATE schema_migrations SET version=9 WHERE version=8");
  if (kind === "future") db.exec("PRAGMA user_version=9");
  const before = db.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
  expect(() => migrate(db)).toThrow(); expect(() => createDirectoryResumeStore(db, context).read(value.rootId)).toThrowError(expect.objectContaining({ code: "DATABASE_SCHEMA_INCOMPATIBLE" }));
  expect(db.prepare("SELECT * FROM schema_migrations ORDER BY version").all()).toEqual(before);
});

it("read-only validation does not hide a ninth marker beyond the new schema8 version", async () => {
  const data = join(temporaryDirectory(), "data"); await loadOrCreateIdentityContext(data);
  const db = await openDatabase(data); db.exec("INSERT INTO schema_migrations VALUES(9)"); db.close();
  const before = readFileSync(join(data, "agentprof.sqlite"));
  await expect(withReadOnlyStore(data, () => 1)).rejects.toMatchObject({ code: "DATABASE_SCHEMA_INCOMPATIBLE" });
  expect(readFileSync(join(data, "agentprof.sqlite"))).toEqual(before);
});

it.each([
  "root_id=NULL", "provider='other'", "contract_version=2", "key_id='wrong'", "root_fingerprint=NULL",
  "membership_revision=0", "membership_revision=9007199254740992", "capture_mode='raw'", "census_count=0", "census_count=4097",
  "next_offset=0", "next_offset=17", "next_offset=48", "prefix_fingerprint=NULL", "seal=NULL",
  "census_fingerprint=printf('%129s','x')", "membership_revision='not an integer'",
])("STRICT schema and CHECK constraints reject %s", assignment => {
  const db = original(); migrate(db); createDirectoryResumeStore(db, context).save(value, null);
  const before = db.prepare("SELECT * FROM directory_batch_resume").all();
  expect(() => db.exec(`UPDATE directory_batch_resume SET ${assignment}`)).toThrow();
  expect(db.prepare("SELECT * FROM directory_batch_resume").all()).toEqual(before);
});

it("new store refuses historical schema7 without making a table or binding", () => {
  const db = original(), before = db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all(), store = createDirectoryResumeStore(db, context);
  for (const call of [() => store.read(value.rootId), () => store.save(value, null), () => store.remove(value.rootId, null)]) {
    expect(call).toThrowError(expect.objectContaining({ code: "DATABASE_SCHEMA_INCOMPATIBLE" }));
  }
  expect(db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all()).toEqual(before); expect(db.prepare("SELECT * FROM source_store_identity").all()).toEqual([]);
});
