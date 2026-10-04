import { lstat, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { migrate, openDatabase, transaction } from "../src/db/database.js";
import { ensurePrivateDirectory } from "../src/privacy/paths.js";
import { safeErrorEnvelope } from "../src/privacy/diagnostics.js";
import { temporaryDirectory } from "./helpers.js";

it("imports SQLite, binds integers/null/text, commits/rolls back, migrates idempotently and reopens", async () => {
  const directory = join(temporaryDirectory(), "data");
  const db = await openDatabase(directory);
  try {
    expect(db.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(8);
    expect(db.prepare("PRAGMA journal_mode").get()?.["journal_mode"]).toBe("delete");
    expect(db.prepare("PRAGMA busy_timeout").get()?.["timeout"]).toBe(1000);
    expect(db.prepare("PRAGMA foreign_keys").get()?.["foreign_keys"]).toBe(1);
    expect(db.prepare("PRAGMA trusted_schema").get()?.["trusted_schema"]).toBe(0);
    migrate(db);
    db.exec("CREATE TABLE binding_check (id INTEGER PRIMARY KEY, value TEXT, count INTEGER) STRICT");
    transaction(db, () => db.prepare("INSERT INTO binding_check VALUES (?, ?, ?)").run(1, "synthetic '); DROP TABLE binding_check; --", null));
    expect(db.prepare("SELECT count FROM binding_check WHERE id = ?").get(1)?.["count"]).toBeNull();
    expect(db.prepare("SELECT value FROM binding_check WHERE id = ?").get(1)?.["value"]).toBe("synthetic '); DROP TABLE binding_check; --");
    expect(() => transaction(db, () => {
      db.prepare("INSERT INTO binding_check VALUES (?, ?, ?)").run(2, "rolled back", 123);
      throw new Error("FICTITIOUS_AGENTPROF_ERROR_SENTINEL");
    })).toThrow("could not be completed");
    expect(db.prepare("SELECT id FROM binding_check WHERE id = ?").get(2)).toBeUndefined();
    transaction(db, () => db.prepare("INSERT INTO binding_check VALUES (?, ?, ?)").run(3, null, 2147483647));
  } finally { db.close(); }
  const reopened = await openDatabase(directory);
  try { expect(reopened.prepare("SELECT count FROM binding_check WHERE id = ?").get(3)?.["count"]).toBe(2147483647); }
  finally { reopened.close(); }
  expect((await lstat(join(directory, "agentprof.sqlite"))).mode & 0o777).toBe(0o600);
});

it("does not roll back a caller-owned transaction when nested BEGIN is rejected", async () => {
  const db = await openDatabase(join(temporaryDirectory(), "data"));
  try {
    db.exec("CREATE TABLE nested_check (id INTEGER) STRICT; BEGIN IMMEDIATE; INSERT INTO nested_check VALUES (1)");
    expect(() => transaction(db, () => db.exec("INSERT INTO nested_check VALUES (2)"))).toThrow("could not be completed");
    db.exec("COMMIT");
    expect(db.prepare("SELECT id FROM nested_check").all()).toEqual([{ id: 1 }]);
  } finally { db.close(); }
});

it("rejects native async callbacks before executing them", async () => {
  const db = await openDatabase(join(temporaryDirectory(), "data"));
  let called = false;
  try {
    expect(() => transaction(db, (async () => { called = true; }) as never)).toThrow("could not be completed");
    expect(called).toBe(false);
  } finally { db.close(); }
});

it("rejects future schemas, unsafe DB paths, and corruption without echoing database errors", async () => {
  const root = temporaryDirectory();
  const future = join(root, "future");
  const db = await openDatabase(future);
  db.exec("PRAGMA user_version = 99"); db.close();
  await expect(openDatabase(future)).rejects.toMatchObject({ code: "DATABASE_SCHEMA_TOO_NEW" });
  const data = join(root, "unsafe"); await ensurePrivateDirectory(data);
  const outside = join(root, "outside"); await writeFile(outside, "FICTITIOUS_DATABASE_SENTINEL", { mode: 0o600 });
  await symlink(outside, join(data, "agentprof.sqlite"));
  await expect(openDatabase(data)).rejects.toMatchObject({ code: "DATABASE_ACCESS_FAILED" });
  expect(await readFile(outside, "utf8")).toBe("FICTITIOUS_DATABASE_SENTINEL");
  const corrupt = join(root, "corrupt"); await ensurePrivateDirectory(corrupt);
  await writeFile(join(corrupt, "agentprof.sqlite"), "FICTITIOUS_DATABASE_SENTINEL", { mode: 0o600 });
  const opening = openDatabase(corrupt);
  await expect(opening).rejects.toMatchObject({ code: "DATABASE_ACCESS_FAILED" });
  const rejected = await opening.catch((error: unknown) => error);
  expect(JSON.stringify(safeErrorEnvelope(rejected))).not.toContain("FICTITIOUS_DATABASE_SENTINEL");
});

it("migrates a real schema4 only once without replaying cache DDL and preserves generations", async () => {
  const db = await openDatabase(join(temporaryDirectory(), "v4"));
  try {
    db.exec("DROP TABLE directory_batch_resume; DROP TABLE directory_membership_members; DROP TABLE directory_membership_roots; DROP TABLE source_parser_checkpoints; DROP TABLE source_relationship_contributions; DROP TABLE source_relationship_headers; DELETE FROM schema_migrations WHERE version>=5; PRAGMA user_version=4");
    const before = db.prepare("SELECT * FROM settings ORDER BY key").all();
    migrate(db); migrate(db);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 8 });
    expect(db.prepare("SELECT * FROM settings ORDER BY key").all()).toEqual(before);
    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(version => ({ version })));
    expect(db.prepare("SELECT * FROM source_relationship_headers").all()).toEqual([]);
  } finally { db.close(); }
});
it("rolls schema4 DDL conflicts back without touching cache/settings", async () => {
  const db = await openDatabase(join(temporaryDirectory(), "v4-conflict"));
  try {
    db.exec("DROP TABLE directory_batch_resume; DROP TABLE directory_membership_members; DROP TABLE directory_membership_roots; DROP TABLE source_parser_checkpoints; DROP TABLE source_relationship_contributions; DROP TABLE source_relationship_headers; DELETE FROM schema_migrations WHERE version>=5; PRAGMA user_version=4; CREATE TABLE source_relationship_contributions(sentinel); INSERT INTO source_relationship_contributions VALUES(7)");
    const before = db.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all();
    expect(() => migrate(db)).toThrowError(expect.objectContaining({ code: "DATABASE_MIGRATION_FAILED" }));
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 4 });
    expect(db.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all()).toEqual(before);
    expect(db.prepare("SELECT * FROM source_relationship_contributions").all()).toEqual([{ sentinel: 7 }]);
  } finally { db.close(); }
});
