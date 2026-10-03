import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { createSourceStore } from "../src/db/source-store.js";
import type { MetricEvidence, SourceInput, SourceSnapshotInput, StoredSource } from "../src/db/source-store.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createCodexAdapter } from "../src/parsers/codex/index.js";
import { createClaudeAdapter } from "../src/parsers/claude/index.js";
import type { ClaudeTrustedFixtureContext } from "../src/parsers/claude/types.js";
import type { UsageObservation } from "../src/parsers/types.js";
import { temporaryDirectory } from "./helpers.js";

export const binary = fileURLToPath(new URL("../dist/agentprof.cjs", import.meta.url));
export const keyId = "6".repeat(32), secret = Buffer.alloc(32, 61), context = createIdentityContext(secret, keyId);
export const id = (domain: Parameters<typeof context.fingerprint>[0], name: string) => context.fingerprint(domain, [name]);
export const sourceId = id("source", "tokens-control"), sessionId = id("session", "tokens-control");
export const reasons = ["source_suppressed", "cumulative_snapshot", "unverified_snapshot", "non_response_usage", "duplicate_response_conflict", "invalid", "conflicted", "provisional", "snapshot_only", "unverified_finality", "missing_response_id", "incomplete_components", "unverified_mapping"] as const;
export const capabilities: MetricEvidence["capabilities"] = { provider: "codex", parserVersion: 1, support: "shape_verified_only", coverage: "recognized_shapes", observedShapes: ["response_usage"], unsupportedRecords: 0, ambiguousRecords: 0, stateLimited: false, diagnosticsDropped: 0 };
export function usage(name = "ordinary", extra: Partial<UsageObservation> = {}): UsageObservation {
  return { id: id("event", `usage-${name}`), sessionId, responseId: id("event", `response-${name}`), turnId: null, provider: "codex", source: "response_usage", scope: "response_increment", counts: { input: 80, output: 12, total: 92, cachedInput: 20, cacheWriteInput: 5, reasoningOutput: 4 }, mapping: "openai_responses", finality: "source_terminal", selection: "eligible", countStatus: "complete", limitations: [], toolEventId: null, phase: "unknown", sourceRef: { fileId: sourceId, byteOffset: 1 }, ...extra };
}
export function input(rows: MetricEvidence["usage"] = [usage()], caps = capabilities): SourceSnapshotInput {
  return { sourceId, provider: "codex", parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId, completedOffset: 100, observedSize: 105, boundaryFingerprint: id("content", "tokens-boundary"), events: [], evidence: { turns: [], usage: rows, observations: [], diagnostics: [], capabilities: caps } };
}
export function source(rows: MetricEvidence["usage"] = [usage()], caps = capabilities): StoredSource {
  return { ...input(rows, caps), revision: 3, availability: "available", cacheEvidence: null, persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false };
}
export function invoke(file: string, data: string, args: readonly string[]) {
  const r = spawnSync(process.execPath, [file, "--data-dir", data, ...args], { encoding: "utf8", timeout: 20000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_NO_WARNINGS: "1", CLAUDE_CONFIG_DIR: "\nINVALID_UNRELATED" } });
  expect(r.error).toBeUndefined(); expect(r.signal).toBeNull(); return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
async function key(data: string) {
  await writeFile(join(data, "identity-key.json"), JSON.stringify({ keyVersion: 1, keyId, secret: secret.toString("hex") }) + "\n", { mode: 0o600 });
}
export async function bytes(data: string) {
  return Promise.all((await readdir(data)).sort().map(async name => ({ name, mode: (await stat(join(data, name))).mode, sha256: createHash("sha256").update(await readFile(join(data, name))).digest("hex") })));
}
export const read = (data: string, selected: string) => withReadOnlyStore(data, (db, key) => createSourceStore(db, key).readSource(selected)!);
export async function persisted(snapshot: SourceSnapshotInput | SourceInput = input(), unavailable = false) {
  const root = temporaryDirectory(), data = join(root, "data"); await mkdir(data, { mode: 0o700 }); await key(data);
  const db = await openDatabase(data);
  try { const store = createSourceStore(db, keyId); expect(("evidence" in snapshot ? store.replaceSourceSnapshot(snapshot, null) : store.replaceSource(snapshot, null)).status).toBe("committed"); if (unavailable) expect(store.markUnavailable(snapshot.sourceId, 1).status).toBe("committed"); }
  finally { db.close(); }
  return { root, data, sourceId: snapshot.sourceId, source: await read(data, snapshot.sourceId) };
}
export async function scanned(file = binary, fixture = "codex-real-shapes.jsonl") {
  const root = temporaryDirectory(), data = join(root, "data"), rawRoot = join(root, "input"); await mkdir(data, { mode: 0o700 }); await key(data); await mkdir(rawRoot);
  const raw = await readFile(new URL(`fixtures/providers/${fixture}`, import.meta.url)); await writeFile(join(rawRoot, "synthetic.jsonl"), raw);
  const scan = invoke(file, data, ["scan", "--codex-root", rawRoot, "--json"]); expect([0, 1]).toContain(scan.status); expect(JSON.parse(scan.stdout).result.counts.committed).toBe(1);
  const selected = JSON.parse(invoke(file, data, ["stats", "--list-sources", "--json"]).stdout).result.catalogue.items[0].sourceId as string;
  const saved = await read(data, selected); await rm(rawRoot, { recursive: true }); expect(await read(data, selected)).toEqual(saved);
  return { root, data, sourceId: selected, source: saved, rawRoot, raw, scanStatus: scan.status };
}
export async function parsedFixture(name: "codex-real-shapes.jsonl" | "claude-real-shapes.jsonl", trusted = false): Promise<SourceSnapshotInput> {
  const provider = name.startsWith("codex") ? "codex" : "claude", fileIdentity = "FICTITIOUS_TOKENS_FIXTURE", raw = await readFile(new URL(`fixtures/providers/${name}`, import.meta.url));
  const adapter = provider === "codex" ? createCodexAdapter(context) : createClaudeAdapter(context);
  const proof: ClaudeTrustedFixtureContext = { usageEvidence: [0, 1, 2].map(ordinal => ({ ordinal, messageId: "synthetic-p3-response", finality: ordinal === 2 ? "final" : "partial", order: ordinal, orderingGroup: "synthetic-summary-proof", mapping: "anthropic_messages" })) };
  let start = 0, ordinal = 0;
  while (start < raw.length) { const end = raw.indexOf(10, start); if (end < 0) break; const point = { fileIdentity, byteOffset: start, ordinal: ordinal++, sourceAlias: "source-1" }; if (provider === "claude") (adapter as ReturnType<typeof createClaudeAdapter>).ingest(JSON.parse(raw.subarray(start, end).toString()), { ...point, ...(trusted ? { trustedFixtureContext: proof } : {}) }); else (adapter as ReturnType<typeof createCodexAdapter>).ingest(JSON.parse(raw.subarray(start, end).toString()), point); start = end + 1; }
  const snapshot = adapter.snapshot();
  return { sourceId: context.fingerprint("source", [provider, fileIdentity]), provider, parserVersion: snapshot.capabilities.parserVersion, normalizationVersion: 1, keyVersion: 1, keyId, completedOffset: start, observedSize: raw.length, boundaryFingerprint: id("content", "fixture-boundary"), events: snapshot.events, evidence: { turns: snapshot.turns, usage: snapshot.usage, observations: snapshot.observations, diagnostics: snapshot.diagnostics, capabilities: snapshot.capabilities } };
}
