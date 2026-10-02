import { DatabaseSync } from "node:sqlite";
import { constants, lstatSync } from "node:fs";
import type { Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { types } from "node:util";
import { parseIdentityKey } from "../normalize/identity.js";
import { SafeError } from "../privacy/diagnostics.js";
import { assertNoSymlink, fileCode, validateExistingPrivateDirectory } from "../privacy/paths.js";
import { DATABASE_SCHEMA_VERSION } from "./database.js";
import { keyId as validateKeyId } from "./source-validation.js";

function same(a: Stats, b: Stats): boolean { return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid; }
function privateRegular(stat: Stats): void {
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || (process.getuid && stat.uid !== process.getuid())) throw new SafeError("UNSAFE_PRIVATE_FILE");
}
async function existingFile(path: string): Promise<{ file: FileHandle; stat: Stats }> {
  let file: FileHandle | undefined;
  try {
    // Nonblocking prevents a regular-file -> FIFO swap from hanging validation.
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat(); privateRegular(stat);
    const named = await lstat(path);
    if (!same(stat, named) || named.isSymbolicLink()) throw new SafeError("UNSAFE_PRIVATE_FILE");
    return { file, stat };
  } catch (error) {
    await file?.close();
    if (fileCode(error) === "ENOENT") throw new SafeError("STORE_NOT_FOUND");
    if (error instanceof SafeError) throw error;
    throw new SafeError("UNSAFE_PRIVATE_FILE");
  }
}
function rejectSidecars(path: string): void {
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    try { lstatSync(path + suffix); } catch (error) {
      if (fileCode(error) === "ENOENT") continue;
      throw new SafeError("DATABASE_ACCESS_FAILED");
    }
    throw new SafeError("DATABASE_MODE_UNSUPPORTED");
  }
}
function verifySchema(database: DatabaseSync, key: string): void {
  if (database.prepare("PRAGMA journal_mode").get()?.["journal_mode"] !== "delete") throw new SafeError("DATABASE_MODE_UNSUPPORTED");
  if (database.prepare("PRAGMA user_version").get()?.["user_version"] !== DATABASE_SCHEMA_VERSION) throw new SafeError("DATABASE_SCHEMA_INCOMPATIBLE");
  const markers = database.prepare("SELECT CASE WHEN typeof(version)='integer' THEN version ELSE NULL END AS version FROM schema_migrations ORDER BY version LIMIT 7").all();
  if (markers.length !== 6 || markers.some((r, i) => r["version"] !== i + 1)) throw new SafeError("DATABASE_SCHEMA_INCOMPATIBLE");
  const settings = database.prepare("SELECT substr(key,1,32) AS key, length(CAST(key AS BLOB)) AS n, CASE WHEN typeof(value)='integer' THEN value ELSE NULL END AS value FROM settings ORDER BY key LIMIT 3").all();
  if (settings.length !== 2 || settings[0]?.["key"] !== "key_version" || settings[1]?.["key"] !== "normalization_version"
    || settings.some(r => r["value"] !== 1 || typeof r["n"] !== "number" || r["n"] > 32)) throw new SafeError("DATABASE_SCHEMA_INCOMPATIBLE");
  const identities = database.prepare("SELECT CASE WHEN typeof(singleton)='integer' THEN singleton ELSE NULL END AS singleton, substr(key_id,1,33) AS key_id, length(CAST(key_id AS BLOB)) AS n FROM source_store_identity LIMIT 2").all();
  if (identities.length > 1) throw new SafeError("INVALID_IDENTITY_KEY");
  if (identities.length === 0) {
    if (database.prepare("SELECT 1 FROM source_event_headers LIMIT 1").get() !== undefined) throw new SafeError("INVALID_IDENTITY_KEY");
  } else {
    const row = identities[0]!;
    if (row["singleton"] !== 1 || row["n"] !== 32 || validateKeyId(row["key_id"]) !== key) throw new SafeError("INVALID_IDENTITY_KEY");
  }
}

/** One pinned request against an existing product DELETE store. No bootstrap or recovery. */
export async function withReadOnlyStore<T>(dataDir: string, operation: (database: DatabaseSync, keyId: string) => T): Promise<T> {
  if (types.isAsyncFunction(operation)) throw new SafeError("INVALID_ARGUMENT");
  const directory = await validateExistingPrivateDirectory(dataDir);
  const directoryStat = await lstat(directory);
  const keyPath = join(directory, "identity-key.json"), path = join(directory, "agentprof.sqlite");
  let keyFile: FileHandle | undefined, dbFile: FileHandle | undefined, database: DatabaseSync | undefined;
  let began = false;
  try {
    const key = await existingFile(keyPath); keyFile = key.file;
    const bytes = Buffer.alloc(1025);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const part = await keyFile.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
      if (part.bytesRead === 0) break;
      bytesRead += part.bytesRead;
    }
    if (bytesRead > 1024) throw new SafeError("INVALID_IDENTITY_KEY");
    const keyId = parseIdentityKey(bytes.subarray(0, bytesRead).toString("utf8")).keyId;
    bytes.fill(0);
    const db = await existingFile(path); dbFile = db.file;
    const header = Buffer.alloc(100);
    const read = await dbFile.read(header, 0, 100, 0);
    if (read.bytesRead !== 100 || header.subarray(0, 16).toString("binary") !== "SQLite format 3\0") throw new SafeError("DATABASE_SCHEMA_INCOMPATIBLE");
    if (header[18] !== 1 || header[19] !== 1) throw new SafeError("DATABASE_MODE_UNSUPPORTED");
    rejectSidecars(path);
    // SQLite opens by name. External path/mode substitution is outside supported concurrency.
    database = new DatabaseSync(path, { readOnly: true, timeout: 1000, allowExtension: false, enableForeignKeyConstraints: true });
    database.exec("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA temp_store=MEMORY; BEGIN;"); began = true;
    verifySchema(database, keyId);
    const result = operation(database, keyId);
    if (result && typeof result === "object" && "then" in result) throw new SafeError("INVALID_ARGUMENT");
    // Keep snapshot held through path checks. Product writers may create a journal themselves.
    await assertNoSymlink(directory);
    if (!same(directoryStat, await lstat(directory)) || !same(db.stat, await dbFile.stat()) || !same(db.stat, await lstat(path))
      || !same(key.stat, await keyFile.stat()) || !same(key.stat, await lstat(keyPath))) throw new SafeError("UNSAFE_PRIVATE_FILE");
    database.exec("COMMIT"); began = false;
    return result;
  } catch (error) {
    if (began) try { database?.exec("ROLLBACK"); } catch { /* Owned transaction only. */ }
    if (error instanceof SafeError) throw error;
    throw new SafeError("DATABASE_ACCESS_FAILED");
  } finally {
    try { database?.close(); } finally { try { await dbFile?.close(); } finally { await keyFile?.close(); } }
  }
}
