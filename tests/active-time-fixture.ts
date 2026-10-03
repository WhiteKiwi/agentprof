import { mkdir, writeFile, rm, readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import type { MetricEvidence, StoredSource } from "../src/db/source-store.js";
import type { NormalizedTurn, SourceObservation } from "../src/parsers/types.js";
import { runScan } from "../src/cli/scan.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { createSourceStore } from "../src/db/source-store.js";
import { temporaryDirectory } from "./helpers.js";

export const keyId = "8".repeat(32), secret = Buffer.alloc(32, 59), identity = createIdentityContext(secret, keyId);
export const id = (domain: Parameters<typeof identity.fingerprint>[0], name: string) => identity.fingerprint(domain, [name]);
export const sourceId = id("source", "active-unit"), epoch = Date.UTC(2026, 9, 3), at = (n: number) => new Date(epoch + n).toISOString();
export function turn(name: string, start: number, end: number, extra: Partial<NormalizedTurn> = {}): NormalizedTurn {
  return { id: id("turn", name), sessionId: id("session", "active-unit"), provider: "codex", startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(),
    startTimingEvidence: "source_reported", endTimingEvidence: "source_reported", intervalTimingEvidence: "source_reported", intervalScope: "turn_wall",
    durationMs: 8150, timingEvidence: "source_reported", durationScope: "turn_elapsed", status: "completed", sourceRef: { fileId: sourceId, byteOffset: 100 }, ...extra };
}
export const paired = (t: NormalizedTurn): NormalizedTurn => ({ ...t, startTimingEvidence: "paired_timestamps", endTimingEvidence: "paired_timestamps", intervalTimingEvidence: "paired_timestamps", intervalScope: "observed_turn" });
export function observation(t: NormalizedTurn, extra: Partial<SourceObservation> = {}): SourceObservation {
  return { id: id("source", `proof-${t.id}`), eventId: null, turnId: t.id, usageId: null, representation: "turn", origin: "ordinary", transportStatus: t.status, observedUsage: null, sourceRef: { ...t.sourceRef }, ...extra };
}
export function proofs(t: NormalizedTurn): SourceObservation[] {
  return [...(t.intervalScope === "observed_turn" ? [observation(t, { id: id("source", `pending-${t.id}`), transportStatus: "pending", sourceRef: { ...t.sourceRef, byteOffset: t.sourceRef.byteOffset - 1 } })] : []), observation(t)];
}
export function source(turns: readonly NormalizedTurn[] = [], observations: readonly SourceObservation[] = turns.flatMap(proofs)): StoredSource {
  return { sourceId, provider: "codex", parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId, revision: 2, availability: "available", completedOffset: 1_000_000, observedSize: 1_000_005,
    boundaryFingerprint: id("content", "boundary"), cacheEvidence: null, events: [], persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false,
    evidence: { turns, usage: [], observations, diagnostics: [], capabilities: { provider: "codex", parserVersion: 1, support: "shape_verified_only", coverage: "recognized_shapes", observedShapes: ["turn"], unsupportedRecords: 0, ambiguousRecords: 0, stateLimited: false, diagnosticsDropped: 0 } } };
}
export function capability(s: StoredSource, extra: Partial<MetricEvidence["capabilities"]>): StoredSource { return { ...s, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, ...extra } as MetricEvidence["capabilities"] } }; }
export const record = (payload: unknown, n = 0, type = "event_msg") => ({ timestamp: at(n), type, payload });
export const meta = () => record({ id: "FICTITIOUS_ACTIVE_SESSION", cwd: "/FICTITIOUS_ACTIVE_ROOT" }, 0, "session_meta");
export const wall = (name: string, start: number, end: number, status = "task_complete") => record({ type: status, turn_id: name, started_at: (epoch + start) / 1000, completed_at: (epoch + end) / 1000, duration_ms: 8150 }, end);
export const start = (name: string, n: number) => record({ type: "task_started", turn_id: name }, n);
export const end = (name: string, n: number, status = "task_complete") => record({ type: status, turn_id: name, duration_ms: 8150 }, n);
export const positive = [meta(), wall("a", 0, 10000), wall("b", 5000, 15000)];
export const pairedPositive = [meta(), start("a", 0), start("b", 5000), end("a", 10000), end("b", 15000), start("c", 100000), end("c", 110000, "turn_aborted")];
export async function stored(records: readonly unknown[] = positive) {
  const root = temporaryDirectory(), input = join(root, "input"), data = join(root, "data");
  await mkdir(input); await mkdir(data, { mode: 0o700 });
  await writeFile(join(data, "identity-key.json"), JSON.stringify({ keyVersion: 1, keyId, secret: secret.toString("hex") }) + "\n", { mode: 0o600 });
  const raw = records.map(r => JSON.stringify(r) + "\n").join(""); await writeFile(join(input, "synthetic.jsonl"), raw);
  const scan = await runScan({ dataDir: data, codexRoot: [input], claudeRoot: [] }); expect(scan.counts.committed).toBe(1);
  const read = () => withReadOnlyStore(data, (db, key) => { const store = createSourceStore(db, key); return store.readSource(store.listSources().items[0]!.sourceId)!; });
  const snapshot = await read(); await rm(input, { recursive: true }); expect(await read()).toEqual(snapshot);
  return { root, input, data, source: snapshot, raw, sourceId: snapshot.sourceId };
}
export async function bytes(data: string) {
  return Promise.all((await readdir(data)).sort().map(async name => ({ name, mode: (await stat(join(data, name))).mode, sha256: createHash("sha256").update(await readFile(join(data, name))).digest("hex") })));
}
export function maximumSource(): StoredSource {
  const turns = Array.from({ length: 4096 }, (_, i) => paired(turn(`maximum-${i}`, -8_000_000_000_000_000 + i * 2000, -8_000_000_000_000_000 + i * 2000 + 1000,
    { sessionId: id("session", `maximum-${i}`), sourceRef: { fileId: sourceId, byteOffset: i * 2 + 1 } })));
  return { ...source(turns), revision: Number.MAX_SAFE_INTEGER, completedOffset: Number.MAX_SAFE_INTEGER, observedSize: Number.MAX_SAFE_INTEGER };
}
export async function persisted(s: StoredSource) {
  const data = temporaryDirectory();
  await writeFile(join(data, "identity-key.json"), JSON.stringify({ keyVersion: 1, keyId, secret: secret.toString("hex") }) + "\n", { mode: 0o600 });
  const { openDatabase } = await import("../src/db/database.js"), db = await openDatabase(data);
  try { expect(createSourceStore(db, keyId).replaceSourceSnapshot(snapshotInput(s), null).status).toBe("committed"); } finally { db.close(); }
  const reopened = await withReadOnlyStore(data, (db, key) => createSourceStore(db, key).readSource(s.sourceId)!);
  return { data, source: reopened, sourceId: reopened.sourceId };
}
export function snapshotInput(s: StoredSource) {
  return { sourceId: s.sourceId, provider: s.provider, parserVersion: s.parserVersion, normalizationVersion: s.normalizationVersion, keyVersion: s.keyVersion, keyId: s.keyId,
    completedOffset: s.completedOffset, observedSize: s.observedSize, boundaryFingerprint: s.boundaryFingerprint, events: s.events, evidence: s.evidence! };
}
