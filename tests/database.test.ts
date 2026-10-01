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
    expect(db.prepare("PRAGMA user_version").get()?.["user_version"]).toBe(2);
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
