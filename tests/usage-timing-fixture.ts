import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterEach } from "vitest";
import { migrate } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import type { SourceSnapshotInput } from "../src/db/source-store.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createCodexAdapter } from "../src/parsers/codex/index.js";
import { createClaudeAdapter } from "../src/parsers/claude/index.js";
import { temporaryDirectory } from "./helpers.js";

export const secret = new Uint8Array(32).fill(97), keyId = "9".repeat(32), context = createIdentityContext(secret, keyId);
export type Provider = "codex" | "claude";
export const at = "2026-10-03T14:59:59.000Z", afterMidnight = "2026-10-03T15:00:00.000Z";
export const window = { from: "2026-10-03T00:00:00Z", to: "2026-10-05T00:00:00Z", offset: "+09:00" };
export const codexMeta = { type: "session_meta", payload: { id: "FICTITIOUS_USAGE_SESSION", cli_version: "0.159.0" } };
export function record(provider: Provider, name = "response-one", timestamp: unknown = at, output = 10, extraCounts: Record<string, unknown> = {}) {
  const usage = provider === "codex"
    ? { input_tokens: 100, output_tokens: output, total_tokens: 100 + output, cached_input_tokens: 30, cache_write_input_tokens: 0, reasoning_output_tokens: 2, ...extraCounts }
    : { input_tokens: 100, output_tokens: output, cache_read_input_tokens: 30, cache_creation_input_tokens: 20, ...extraCounts };
  return provider === "codex" ? { type: "token_usage_record", ...(timestamp === undefined ? {} : { timestamp }), payload: { thread_id: "FICTITIOUS_USAGE_SESSION", turn_id: "FICTITIOUS_TURN", response_id: name, usage } }
    : { type: "assistant", uuid: `FICTITIOUS_UUID_${name}_${String(timestamp)}`, sessionId: "FICTITIOUS_USAGE_SESSION", isSidechain: false, ...(timestamp === undefined ? {} : { timestamp }),
      message: { id: name, role: "assistant", content: [], usage, stop_reason: "end_turn" } };
}
export function records(provider: Provider) { return [...(provider === "codex" ? [codexMeta] : []), record(provider), record(provider, "response-two", afterMidnight, 20)]; }
export function adapter(provider: Provider, timed = true) { return provider === "codex" ? createCodexAdapter(context, {}, { usageTiming: timed }) : createClaudeAdapter(context, {}, { usageTiming: timed }); }
export function encode(rows: readonly unknown[]) { return rows.map(r => JSON.stringify(r) + "\n").join(""); }
export function feed(a: ReturnType<typeof adapter>, rows: readonly unknown[], fileIdentity = "FICTITIOUS_USAGE_FILE", start = 0, ordinal = 0): number {
  let offset = start;
  for (const r of rows) { a.ingest(r, { fileIdentity, byteOffset: offset, ordinal: ordinal++, sourceAlias: "source-1" }); offset += Buffer.byteLength(JSON.stringify(r) + "\n"); }
  return offset;
}
export function input(provider: Provider = "codex", rows = records(provider), fileIdentity = "FICTITIOUS_USAGE_FILE", timed = true): SourceSnapshotInput {
  const a = adapter(provider, timed), offset = feed(a, rows, fileIdentity), snapshot = a.snapshot();
  return { sourceId: context.fingerprint("source", [provider, fileIdentity]), provider, parserVersion: snapshot.capabilities.parserVersion,
    normalizationVersion: 1, keyVersion: 1, keyId, completedOffset: offset, observedSize: offset,
    boundaryFingerprint: offset ? context.fingerprint("content", ["FICTITIOUS_BOUNDARY", offset]) : null, events: snapshot.events,
    evidence: { turns: snapshot.turns, usage: snapshot.usage, observations: snapshot.observations, diagnostics: snapshot.diagnostics, capabilities: snapshot.capabilities } };
}
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
export function memory() { const db = new DatabaseSync(":memory:"); migrate(db); databases.push(db); return { db, store: createSourceStore(db, keyId) }; }
export function stored(value: SourceSnapshotInput = input()) { const { store } = memory(); store.replaceSourceSnapshot(value, null); return store.readSource(value.sourceId)!; }
export async function disk(provider: Provider = "codex", rows = records(provider)) {
  const root = temporaryDirectory(), data = join(root, "data"), inputRoot = join(root, "inputs"), path = join(inputRoot, "FICTITIOUS_SESSION.jsonl");
  await mkdir(data, { mode: 0o700 }); await mkdir(inputRoot);
  await writeFile(join(data, "identity-key.json"), JSON.stringify({ keyVersion: 1, keyId, secret: Buffer.from(secret).toString("hex") }) + "\n", { mode: 0o600 });
  await writeFile(path, encode(rows));
  return { root, data, inputRoot, path, sourceId: context.fingerprint("source", [provider, path]), options: { dataDir: data, codexRoot: provider === "codex" ? [path] : [], claudeRoot: provider === "claude" ? [path] : [] } };
}
export async function bytes(data: string) { return Promise.all((await readdir(data)).sort().map(async name => ({ name, mode: (await stat(join(data, name))).mode,
  hash: createHash("sha256").update(await readFile(join(data, name))).digest("hex") }))); }
