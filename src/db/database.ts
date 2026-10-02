import { DatabaseSync } from "node:sqlite";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { types } from "node:util";
import { SafeError } from "../privacy/diagnostics.js";
import { ensurePrivateDirectory, fileCode, openPrivateFile } from "../privacy/paths.js";

export const DATABASE_SCHEMA_VERSION = 6;

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
  let began = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    began = true;
    // Observe the schema only after serializing with other openers.
    const current = database.prepare("PRAGMA user_version").get()?.["user_version"];
    if (typeof current !== "number" || !Number.isSafeInteger(current) || current < 0) throw new SafeError("DATABASE_MIGRATION_FAILED");
    if (current > DATABASE_SCHEMA_VERSION) throw new SafeError("DATABASE_SCHEMA_TOO_NEW");
    if (current === 0) database.exec(`
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY) STRICT;
        CREATE TABLE settings (key TEXT PRIMARY KEY CHECK(key IN ('normalization_version', 'key_version')), value INTEGER NOT NULL) STRICT;
        INSERT INTO schema_migrations(version) VALUES (1);
        INSERT INTO settings(key, value) VALUES ('normalization_version', 1), ('key_version', 1);
        PRAGMA user_version = 1;
      `);
    const settings = database.prepare("SELECT CASE WHEN typeof(key)='text' AND length(CAST(key AS BLOB))<=32 THEN key ELSE NULL END AS key, CASE WHEN typeof(value)='integer' THEN value ELSE NULL END AS value FROM settings ORDER BY key LIMIT 3").all();
    if (settings.length !== 2 || settings[0]?.["key"] !== "key_version" || settings[1]?.["key"] !== "normalization_version"
      || settings.some((row) => row["value"] !== 1) || database.prepare("SELECT version FROM schema_migrations WHERE version = 1").get() === undefined) {
      throw new SafeError("DATABASE_MIGRATION_FAILED");
    }
    const recordedVersion = Math.max(1, current);
    const markers = database.prepare("SELECT CASE WHEN typeof(version)='integer' THEN version ELSE NULL END AS version FROM schema_migrations ORDER BY version LIMIT 7").all();
    if (markers.length !== recordedVersion || markers.some((row, i) => row["version"] !== i + 1)) throw new SafeError("DATABASE_MIGRATION_FAILED");
    if (current < DATABASE_SCHEMA_VERSION) {
      if (current < 2) database.exec(`
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
      if (current < 3) database.exec(`
        CREATE TABLE source_metric_headers (
          source_id TEXT PRIMARY KEY REFERENCES source_event_headers(source_id),
          contract_version INTEGER NOT NULL CHECK(contract_version = 1),
          turn_count INTEGER NOT NULL CHECK(turn_count BETWEEN 0 AND 4096),
          usage_count INTEGER NOT NULL CHECK(usage_count BETWEEN 0 AND 4096),
          observation_count INTEGER NOT NULL CHECK(observation_count BETWEEN 0 AND 8192),
          diagnostic_count INTEGER NOT NULL CHECK(diagnostic_count BETWEEN 0 AND 8192),
          metric_bytes INTEGER NOT NULL CHECK(metric_bytes BETWEEN 0 AND 16777216)
        ) STRICT;
        CREATE TABLE source_metric_contributions (
          source_id TEXT NOT NULL REFERENCES source_metric_headers(source_id),
          kind TEXT NOT NULL CHECK(kind IN ('turn', 'usage', 'observation', 'diagnostic', 'capabilities')),
          ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 8191),
          row_id TEXT,
          row_json TEXT NOT NULL CHECK(length(CAST(row_json AS BLOB)) <= 65536),
          PRIMARY KEY(source_id, kind, ordinal),
          UNIQUE(source_id, kind, row_id)
        ) STRICT;
        INSERT INTO schema_migrations(version) VALUES (3);
        PRAGMA user_version = 3;
      `);
      if (current < 4) database.exec(`
        CREATE TABLE source_cache_evidence (
          source_id TEXT PRIMARY KEY REFERENCES source_event_headers(source_id),
          contract_version INTEGER NOT NULL CHECK(contract_version = 1),
          content_fingerprint TEXT NOT NULL CHECK(length(CAST(content_fingerprint AS BLOB)) <= 128)
        ) STRICT;
        INSERT INTO schema_migrations(version) VALUES (4);
        PRAGMA user_version = 4;
      `);
      if (current < 5) database.exec(`
        CREATE TABLE source_relationship_headers (
          source_id TEXT PRIMARY KEY REFERENCES source_event_headers(source_id),
          contract_version INTEGER NOT NULL CHECK(contract_version = 1),
          capture_policy_version INTEGER NOT NULL CHECK(capture_policy_version BETWEEN 1 AND 9007199254740991),
          status TEXT NOT NULL CHECK(status IN ('captured', 'unavailable')),
          reason TEXT CHECK(reason IS NULL OR reason = 'relationship_budget_exceeded'),
          metadata_count INTEGER NOT NULL CHECK(metadata_count BETWEEN 0 AND 8192),
          wrapper_count INTEGER NOT NULL CHECK(wrapper_count BETWEEN 0 AND 4096),
          message_count INTEGER NOT NULL CHECK(message_count BETWEEN 0 AND 8192),
          relationship_bytes INTEGER NOT NULL CHECK(relationship_bytes BETWEEN 0 AND 4194304),
          CHECK((status='captured' AND reason IS NULL) OR (status='unavailable' AND reason='relationship_budget_exceeded' AND metadata_count=0 AND wrapper_count=0 AND message_count=0 AND relationship_bytes=0))
        ) STRICT;
        CREATE TABLE source_relationship_contributions (
          source_id TEXT NOT NULL REFERENCES source_relationship_headers(source_id),
          kind TEXT NOT NULL CHECK(kind IN ('metadata', 'wrapper', 'message')),
          ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 8191),
          row_id TEXT NOT NULL,
          row_json TEXT NOT NULL CHECK(length(CAST(row_json AS BLOB)) <= 65536),
          PRIMARY KEY(source_id, kind, ordinal),
          UNIQUE(source_id, kind, row_id)
        ) STRICT;
        INSERT INTO schema_migrations(version) VALUES (5);
        PRAGMA user_version = 5;
      `);
      if (current < 6) database.exec(`
        CREATE TABLE source_parser_checkpoints (
          source_id TEXT PRIMARY KEY REFERENCES source_event_headers(source_id),
          contract_version INTEGER NOT NULL CHECK(contract_version = 1),
          next_ordinal INTEGER NOT NULL CHECK(next_ordinal BETWEEN 0 AND 32768),
          max_file_bytes INTEGER NOT NULL CHECK(max_file_bytes BETWEEN 1 AND 67108864),
          max_records INTEGER NOT NULL CHECK(max_records BETWEEN 1 AND 32768 AND next_ordinal <= max_records),
          max_line_bytes INTEGER NOT NULL CHECK(max_line_bytes BETWEEN 1 AND 1048576),
          checkpoint_bytes INTEGER NOT NULL CHECK(checkpoint_bytes BETWEEN 1 AND 4194304),
          checkpoint_json TEXT NOT NULL CHECK(length(CAST(checkpoint_json AS BLOB)) = checkpoint_bytes),
          adapter_limits_fingerprint TEXT NOT NULL CHECK(length(CAST(adapter_limits_fingerprint AS BLOB)) = 64),
          generation_seal TEXT NOT NULL CHECK(length(CAST(generation_seal AS BLOB)) <= 128)
        ) STRICT;
        INSERT INTO schema_migrations(version) VALUES (6);
        PRAGMA user_version = 6;
      `);
    }
    database.exec("COMMIT");
  } catch (error) {
    if (began) try { database.exec("ROLLBACK"); } catch { /* The transaction may already have ended. */ }
    if (error instanceof SafeError && error.code === "DATABASE_SCHEMA_TOO_NEW") throw error;
    throw new SafeError("DATABASE_MIGRATION_FAILED");
  }
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
