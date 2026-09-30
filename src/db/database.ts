import { DatabaseSync } from "node:sqlite";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { types } from "node:util";
import { SafeError } from "../privacy/diagnostics.js";
import { ensurePrivateDirectory, fileCode, openPrivateFile } from "../privacy/paths.js";

export const DATABASE_SCHEMA_VERSION = 1;

export function transaction<T>(database: DatabaseSync, operation: (() => T) & (T extends PromiseLike<unknown> ? never : unknown)): T {
  if (types.isAsyncFunction(operation)) throw new SafeError("DATABASE_TRANSACTION_FAILED");
  let began = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    began = true;
    const value = operation();
    if (value && typeof value === "object" && "then" in value) throw new SafeError("DATABASE_TRANSACTION_FAILED");
    database.exec("COMMIT");
    return value;
  } catch {
    if (began) try { database.exec("ROLLBACK"); } catch { /* The transaction may already have ended. */ }
    throw new SafeError("DATABASE_TRANSACTION_FAILED");
  }
}

export function migrate(database: DatabaseSync): void {
  const current = database.prepare("PRAGMA user_version").get()?.["user_version"];
  if (typeof current !== "number" || current > DATABASE_SCHEMA_VERSION) throw new SafeError("DATABASE_SCHEMA_TOO_NEW");
  if (current === DATABASE_SCHEMA_VERSION) return;
  try {
    transaction(database, () => {
      database.exec(`
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY) STRICT;
        CREATE TABLE settings (key TEXT PRIMARY KEY CHECK(key IN ('normalization_version', 'key_version')), value INTEGER NOT NULL) STRICT;
        INSERT INTO schema_migrations(version) VALUES (1);
        INSERT INTO settings(key, value) VALUES ('normalization_version', 1), ('key_version', 1);
        PRAGMA user_version = 1;
      `);
    });
  } catch { throw new SafeError("DATABASE_MIGRATION_FAILED"); }
}

export async function openDatabase(dataDir: string): Promise<DatabaseSync> {
  const directory = await ensurePrivateDirectory(dataDir);
  const path = join(directory, "agentprof.sqlite");
  try {
    try {
      const created = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await created.close();
    } catch (error) { if (fileCode(error) !== "EEXIST") throw error; }
    const verified = await openPrivateFile(path);
    await verified.close();
  } catch { throw new SafeError("DATABASE_ACCESS_FAILED"); }
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(path, { timeout: 1_000, enableForeignKeyConstraints: true, allowExtension: false });
    database.exec("PRAGMA journal_mode = DELETE; PRAGMA trusted_schema = OFF;");
    migrate(database);
    return database;
  } catch (error) {
    database?.close();
    if (error instanceof SafeError) throw error;
    throw new SafeError("DATABASE_ACCESS_FAILED");
  }
}
