import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db/database.js';

function directoryBytes(path: string) {
  return { mode: statSync(path).mode, files: readdirSync(path).sort().map(name => ({ name, mode: statSync(join(path, name)).mode, bytes: readFileSync(join(path, name)) })) };
}
function historicalRows(db: DatabaseSync) {
  const names = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT IN ('schema_migrations','source_parser_checkpoints','directory_membership_roots','directory_membership_members','directory_batch_resume') ORDER BY name").all().map(row => row['name'] as string);
  for (const name of names) ok(/^[a-z_]+$/.test(name));
  return Object.fromEntries(names.map(name => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
}

/** Explicit test-only write-open migration of a fresh copy; never a read helper. */
export async function migrateHistoricalSchema5Copy(original: string, copied: string): Promise<void> {
  strictEqual(existsSync(copied), false, 'historical copy destination must be absent');
  const originalBytes = directoryBytes(original);
  const old = new DatabaseSync(join(original, 'agentprof.sqlite'), { readOnly: true });
  let rows: ReturnType<typeof historicalRows>;
  try {
    strictEqual(old.prepare('PRAGMA user_version').get()?.['user_version'], 5);
    deepStrictEqual(old.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row['version']), [1, 2, 3, 4, 5]);
    deepStrictEqual(old.prepare("SELECT name FROM sqlite_schema WHERE name='source_parser_checkpoints'").all(), []);
    const headers = old.prepare('SELECT parser_version FROM source_event_headers').all();
    ok(headers.length > 0); ok(headers.every(row => row['parser_version'] === 1));
    rows = historicalRows(old);
  } finally { old.close(); }
  deepStrictEqual(directoryBytes(original), originalBytes);
  mkdirSync(copied, { mode: originalBytes.mode & 0o777 });
  cpSync(original, copied, { recursive: true, errorOnExist: true, force: false });
  deepStrictEqual(directoryBytes(copied), originalBytes);
  // Migration is an explicit authorized test write to the copied fixture only.
  const migrated = await openDatabase(copied);
  try {
    strictEqual(migrated.prepare('PRAGMA user_version').get()?.['user_version'], 8);
    deepStrictEqual(migrated.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row['version']), [1, 2, 3, 4, 5, 6, 7, 8]);
    deepStrictEqual(historicalRows(migrated), rows);
    deepStrictEqual(migrated.prepare('SELECT * FROM source_parser_checkpoints').all(), []);
    deepStrictEqual(migrated.prepare('SELECT * FROM directory_membership_roots').all(), []);
    deepStrictEqual(migrated.prepare('SELECT * FROM directory_membership_members').all(), []);
    deepStrictEqual(migrated.prepare('SELECT * FROM directory_batch_resume').all(), []);
  } finally { migrated.close(); }
  deepStrictEqual(directoryBytes(original), originalBytes);
}
