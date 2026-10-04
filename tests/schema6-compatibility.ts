import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { openDatabase } from "../src/db/database.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { createSourceStore } from "../src/db/source-store.js";
import { createIdentityContext, parseIdentityKey } from "../src/normalize/identity.js";

const inheritedTables = [
  "settings", "source_store_identity", "source_event_headers", "source_event_contributions",
  "source_metric_headers", "source_metric_contributions", "source_cache_evidence",
  "source_relationship_headers", "source_relationship_contributions", "source_parser_checkpoints",
] as const;
const addedTables = ["directory_membership_roots", "directory_membership_members", "directory_batch_resume"] as const;

function directoryBytes(path: string) {
  return { mode: statSync(path).mode, files: readdirSync(path).sort().map(name => ({
    name, mode: statSync(join(path, name)).mode, bytes: readFileSync(join(path, name)),
  })) };
}
function rows(database: DatabaseSync, version: 6 | 8) {
  strictEqual(database.prepare("PRAGMA user_version").get()?.["user_version"], version);
  deepStrictEqual(database.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map(row => row["version"]),
    version === 6 ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7, 8]);
  deepStrictEqual(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row => row["name"]),
    [...inheritedTables, "schema_migrations", ...(version === 8 ? addedTables : [])].sort());
  if (version === 8) for (const table of addedTables) deepStrictEqual(database.prepare(`SELECT * FROM ${table}`).all(), []);
  return Object.fromEntries(inheritedTables.map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
type Runtime = {
  withReadOnlyStore: typeof withReadOnlyStore;
  createSourceStore: typeof createSourceStore;
  createIdentityContext: typeof createIdentityContext;
  parseIdentityKey: typeof parseIdentityKey;
};
async function historicalRuntime(binary: string): Promise<Runtime> {
  const dist = dirname(resolve(binary));
  const [reader, store, identity] = await Promise.all([
    import(pathToFileURL(join(dist, "db/read-only.js")).href),
    import(pathToFileURL(join(dist, "db/source-store.js")).href),
    import(pathToFileURL(join(dist, "normalize/identity.js")).href),
  ]);
  return { withReadOnlyStore: reader.withReadOnlyStore, createSourceStore: store.createSourceStore,
    createIdentityContext: identity.createIdentityContext, parseIdentityKey: identity.parseIdentityKey };
}
async function generations(runtime: Runtime, data: string) {
  const sources = await runtime.withReadOnlyStore(data, (database, keyId) => {
    const store = runtime.createSourceStore(database, keyId);
    return store.listSources().items.map(item => store.readSource(item.sourceId));
  });
  const key = runtime.parseIdentityKey(readFileSync(join(data, "identity-key.json"), "utf8"));
  const context = runtime.createIdentityContext(Buffer.from(key.secret, "hex"), key.keyId);
  const database = new DatabaseSync(join(data, "agentprof.sqlite"), { readOnly: true });
  try {
    // Authentication owns each transaction; it cannot run inside withReadOnlyStore.
    const store = runtime.createSourceStore(database, key.keyId);
    const candidates = sources.map(source => {
      strictEqual(source === null, false);
      return store.readSourceForIngestion(source!.sourceId, context);
    });
    deepStrictEqual(candidates.map(candidate => candidate.source), sources);
    return { sources, candidates };
  } finally { database.close(); }
}

/** Change only the explicit data-directory argument, preserving every other CLI byte. */
export function routeDataDirectory(args: readonly string[], data: string): string[] {
  const positions = args.flatMap((arg, index) => arg === "--data-dir" ? [index] : []);
  strictEqual(positions.length, 1);
  const index = positions[0]!;
  strictEqual(typeof args[index + 1], "string");
  const routed = [...args]; routed[index + 1] = data;
  return routed;
}

/** Keep the genuine schema6 original; explicitly write-open only its fresh copy. */
export async function migrateHistoricalSchema6Copy(binary: string, original: string, copied: string) {
  strictEqual(resolve(original) === resolve(copied), false);
  strictEqual(existsSync(copied), false, "historical copy destination must be absent");
  const originalBytes = directoryBytes(original), runtime = await historicalRuntime(binary);
  const old = new DatabaseSync(join(original, "agentprof.sqlite"), { readOnly: true });
  let inherited: ReturnType<typeof rows>;
  try { inherited = rows(old, 6); } finally { old.close(); }
  const originalGenerations = await generations(runtime, original);
  deepStrictEqual(directoryBytes(original), originalBytes);
  await rejects(withReadOnlyStore(original, () => undefined), { code: "DATABASE_SCHEMA_INCOMPATIBLE" });
  deepStrictEqual(directoryBytes(original), originalBytes);

  mkdirSync(copied, { mode: originalBytes.mode & 0o777 });
  cpSync(original, copied, { recursive: true, errorOnExist: true, force: false });
  deepStrictEqual(directoryBytes(copied), originalBytes);
  const migrated = await openDatabase(copied);
  try { deepStrictEqual(rows(migrated, 8), inherited); } finally { migrated.close(); }
  const copiedBytes = directoryBytes(copied);
  deepStrictEqual(await generations({ withReadOnlyStore, createSourceStore, createIdentityContext, parseIdentityKey }, copied), originalGenerations);
  deepStrictEqual(directoryBytes(copied), copiedBytes);
  await rejects(runtime.withReadOnlyStore(copied, () => undefined), { code: "DATABASE_SCHEMA_INCOMPATIBLE" });
  deepStrictEqual(directoryBytes(copied), copiedBytes);
  deepStrictEqual(directoryBytes(original), originalBytes);

  return { original, copied,
    assertOriginalUnchanged: () => deepStrictEqual(directoryBytes(original), originalBytes),
    assertUnchanged: () => {
      deepStrictEqual(directoryBytes(original), originalBytes);
      deepStrictEqual(directoryBytes(copied), copiedBytes);
    },
  };
}
