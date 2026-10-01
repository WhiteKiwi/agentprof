import { DatabaseSync } from "node:sqlite";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { types } from "node:util";
import { SafeError } from "../privacy/diagnostics.js";
import { ensurePrivateDirectory, fileCode, openPrivateFile } from "../privacy/paths.js";

export const DATABASE_SCHEMA_VERSION = 2;

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
  if (typeof current !== "number" || !Number.isSafeInteger(current) || current < 0) throw new SafeError("DATABASE_MIGRATION_FAILED");
  if (current > DATABASE_SCHEMA_VERSION) throw new SafeError("DATABASE_SCHEMA_TOO_NEW");
  if (current === DATABASE_SCHEMA_VERSION) return;
  try {
    transaction(database, () => {
      if (current === 0) database.exec(`
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY) STRICT;
        CREATE TABLE settings (key TEXT PRIMARY KEY CHECK(key IN ('normalization_version', 'key_version')), value INTEGER NOT NULL) STRICT;
        INSERT INTO schema_migrations(version) VALUES (1);
        INSERT INTO settings(key, value) VALUES ('normalization_version', 1), ('key_version', 1);
        PRAGMA user_version = 1;
      `);
      const settings = database.prepare("SELECT key, value FROM settings ORDER BY key").all();
      if (settings.length !== 2 || settings[0]?.["key"] !== "key_version" || settings[1]?.["key"] !== "normalization_version"
        || settings.some((row) => row["value"] !== 1) || database.prepare("SELECT version FROM schema_migrations WHERE version = 1").get() === undefined) {
        throw new SafeError("DATABASE_MIGRATION_FAILED");
      }
      database.exec(`
        CREATE TABLE source_store_identity (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          key_id TEXT NOT NULL UNIQUE CHECK(length(key_id) = 32)
        ) STRICT;
        CREATE TABLE source_event_headers (
          source_id TEXT PRIMARY KEY,
          provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude')),
          parser_version INTEGER NOT NULL CHECK(parser_version BETWEEN 1 AND 9007199254740991),
          normalization_version INTEGER NOT NULL CHECK(normalization_version = 1),
          key_version INTEGER NOT NULL CHECK(key_version = 1),
          key_id TEXT NOT NULL REFERENCES source_store_identity(key_id),
          completed_offset INTEGER NOT NULL CHECK(completed_offset BETWEEN 0 AND 9007199254740991),
          observed_size INTEGER NOT NULL CHECK(observed_size BETWEEN completed_offset AND 9007199254740991),
          boundary_fingerprint TEXT,
          revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
          availability TEXT NOT NULL CHECK(availability IN ('available', 'unavailable')),
          event_count INTEGER NOT NULL CHECK(event_count BETWEEN 0 AND 4096),
          event_bytes INTEGER NOT NULL CHECK(event_bytes BETWEEN 0 AND 16777216)
        ) STRICT;
        CREATE TABLE source_event_contributions (
          source_id TEXT NOT NULL REFERENCES source_event_headers(source_id),
          event_id TEXT NOT NULL,
          event_json TEXT NOT NULL CHECK(length(CAST(event_json AS BLOB)) <= 65536),
          PRIMARY KEY(source_id, event_id)
        ) STRICT;
        INSERT INTO schema_migrations(version) VALUES (2);
        PRAGMA user_version = 2;
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
