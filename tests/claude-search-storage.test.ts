import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import type { SourceSnapshotInput } from "../src/db/source-store.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { ClaudeAdapter, createClaudeAdapter } from "../src/parsers/claude/index.js";
import { createCodexAdapter } from "../src/parsers/codex/index.js";
import { ingestSourceFile } from "../src/scanner/source-ingest.js";
import { readJsonLines } from "../src/scanner/jsonl.js";
import { readSourcePrefixWithProof } from "../src/scanner/source-prefix.js";
import { scanSources } from "../src/scanner/scan-run.js";
import { formatStatsResult, runStats } from "../src/cli/stats.js";
import { formatInsightsResult, runInsights } from "../src/cli/insights.js";
import { analyzeSourceFailures } from "../src/analysis/source-failures.js";
import { analyzeSourceSlowTool } from "../src/analysis/source-slow-tool.js";
import { analyzeSourceReadRevisits } from "../src/analysis/source-read-revisits.js";
import { analyzeSourceInvocationOverlap } from "../src/analysis/source-invocation-overlap.js";
import { safeErrorEnvelope } from "../src/privacy/diagnostics.js";
import { temporaryDirectory } from "./helpers.js";

const secret = Buffer.alloc(32, 41), keyId = "4".repeat(32), context = createIdentityContext(secret, keyId);
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const expectedKey = `h1:${keyId}:lookup:c92b499ca84056568193bb51e225959fe4a2a5d8f8fe9723348c13d53decd28e`;
// Immutable raw bytes and actual baseline-v1 safe output were captured before source edits.
// This is our separately specified 699-byte oracle, not the reviewer's 750-byte fixture.
const rawBytes = "{\"type\":\"assistant\",\"uuid\":\"uuid-call\",\"sessionId\":\"FICTITIOUS_SEARCH_SESSION\",\"isSidechain\":false,\"cwd\":\"/FICTITIOUS_SEARCH_ROOT\",\"version\":\"2.1.241\",\"timestamp\":\"2026-09-01T00:00:00.000Z\",\"message\":{\"id\":\"response-call\",\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"call\",\"name\":\"Grep\",\"input\":{\"pattern\":\"FICTITIOUS_QUERY_A\",\"path\":\"src\"}}]}}\n{\"type\":\"user\",\"uuid\":\"result-call\",\"sessionId\":\"FICTITIOUS_SEARCH_SESSION\",\"isSidechain\":false,\"timestamp\":\"2026-09-01T00:00:04.000Z\",\"parentUuid\":\"uuid-call\",\"sourceToolAssistantUUID\":\"uuid-call\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"call\",\"is_error\":false,\"content\":\"FICTITIOUS_SEARCH_RESULT_SENTINEL\"}]}}\n";
const legacyJson = "{\"sourceId\":\"h1:44444444444444444444444444444444:source:6cfcf23393cfc1757c3cb5e234eb379dfd8febe67bfaa7a6c3c5db990a3719a8\",\"provider\":\"claude\",\"parserVersion\":1,\"normalizationVersion\":1,\"keyVersion\":1,\"keyId\":\"44444444444444444444444444444444\",\"completedOffset\":699,\"observedSize\":699,\"boundaryFingerprint\":\"h1:44444444444444444444444444444444:content:ad003b0d4bf4dcdece550985978f34a0b07eb78aeb99224cb41a87383c6464fa\",\"events\":[{\"normalizationVersion\":1,\"keyVersion\":1,\"keyId\":\"44444444444444444444444444444444\",\"id\":\"h1:44444444444444444444444444444444:event:bf0256d0dc79c3f47aa0099bde8c34f3cd82d52f3a791b74dd6a719097376960\",\"sessionId\":\"h1:44444444444444444444444444444444:session:e77e21fcba1be78f4fe05313ca3520efbdfe8d85eb9c13480e124c30b8125665\",\"turnId\":null,\"parentEventId\":null,\"provider\":\"claude\",\"kind\":\"search\",\"category\":\"search\",\"toolName\":\"Grep\",\"commandPattern\":null,\"operationKey\":\"h1:44444444444444444444444444444444:operation:cb0c4105966e5714ba64125079d6ea4f531d8ff622ad2b7e575d8ff97f612d31\",\"fileFingerprint\":null,\"lookupKey\":null,\"lookupRange\":null,\"contentFingerprint\":null,\"contentState\":\"unknown\",\"changeState\":\"unknown\",\"validationScope\":\"unknown\",\"startAt\":\"2026-09-01T00:00:00.000Z\",\"endAt\":\"2026-09-01T00:00:04.000Z\",\"intervalTimingEvidence\":\"paired_timestamps\",\"intervalScope\":\"invocation_latency\",\"durationMs\":4000,\"timingEvidence\":\"paired_timestamps\",\"durationScope\":\"invocation_latency\",\"status\":\"completed\",\"executionOutcome\":\"success\",\"exitCode\":null,\"errorFingerprint\":null,\"errorClass\":null,\"sourceRef\":{\"fileId\":\"h1:44444444444444444444444444444444:source:6cfcf23393cfc1757c3cb5e234eb379dfd8febe67bfaa7a6c3c5db990a3719a8\",\"byteOffset\":355,\"recordType\":\"user\"}}],\"evidence\":{\"turns\":[],\"usage\":[],\"observations\":[{\"id\":\"h1:44444444444444444444444444444444:source:57b81568201c255c4ee3ac00988aa9982dcaee1c91b89857472030c33068cc20\",\"sessionId\":\"h1:44444444444444444444444444444444:session:e77e21fcba1be78f4fe05313ca3520efbdfe8d85eb9c13480e124c30b8125665\",\"messageId\":null,\"eventId\":null,\"usageId\":null,\"turnId\":null,\"representation\":\"metadata\",\"origin\":\"ordinary\",\"observedUsage\":null,\"observedResult\":null,\"sourceRef\":{\"fileId\":\"h1:44444444444444444444444444444444:source:6cfcf23393cfc1757c3cb5e234eb379dfd8febe67bfaa7a6c3c5db990a3719a8\",\"byteOffset\":0}},{\"id\":\"h1:44444444444444444444444444444444:source:7d00ff8524d4b990db85a00521886848f1b98add5468ec7c981e8c0ec2def49e\",\"sessionId\":\"h1:44444444444444444444444444444444:session:e77e21fcba1be78f4fe05313ca3520efbdfe8d85eb9c13480e124c30b8125665\",\"messageId\":\"h1:44444444444444444444444444444444:event:aab2c9313a247f56aa70316bf33a9b33af2aa5b535675d766a22f31c0ee10cae\",\"eventId\":null,\"usageId\":null,\"turnId\":null,\"representation\":\"message\",\"origin\":\"ordinary\",\"observedUsage\":null,\"observedResult\":null,\"sourceRef\":{\"fileId\":\"h1:44444444444444444444444444444444:source:6cfcf23393cfc1757c3cb5e234eb379dfd8febe67bfaa7a6c3c5db990a3719a8\",\"byteOffset\":0}},{\"id\":\"h1:44444444444444444444444444444444:source:a020cd58cc26b9745d01427397b77871931f86e6893980ffc9730ea816aaeacf\",\"sessionId\":\"h1:44444444444444444444444444444444:session:e77e21fcba1be78f4fe05313ca3520efbdfe8d85eb9c13480e124c30b8125665\",\"messageId\":\"h1:44444444444444444444444444444444:event:aab2c9313a247f56aa70316bf33a9b33af2aa5b535675d766a22f31c0ee10cae\",\"eventId\":\"h1:44444444444444444444444444444444:event:bf0256d0dc79c3f47aa0099bde8c34f3cd82d52f3a791b74dd6a719097376960\",\"usageId\":null,\"turnId\":null,\"representation\":\"call\",\"origin\":\"ordinary\",\"observedUsage\":null,\"observedResult\":null,\"sourceRef\":{\"fileId\":\"h1:44444444444444444444444444444444:source:6cfcf23393cfc1757c3cb5e234eb379dfd8febe67bfaa7a6c3c5db990a3719a8\",\"byteOffset\":0}},{\"id\":\"h1:44444444444444444444444444444444:source:4ddfe22e0bafac3e207a05020cba20ec085d0c51f9560f3b4e06452ac5e4ff7b\",\"sessionId\":\"h1:44444444444444444444444444444444:session:e77e21fcba1be78f4fe05313ca3520efbdfe8d85eb9c13480e124c30b8125665\",\"messageId\":null,\"eventId\":null,\"usageId\":null,\"turnId\":null,\"representation\":\"metadata\",\"origin\":\"ordinary\",\"observedUsage\":null,\"observedResult\":null,\"sourceRef\":{\"fileId\":\"h1:44444444444444444444444444444444:source:6cfcf23393cfc1757c3cb5e234eb379dfd8febe67bfaa7a6c3c5db990a3719a8\",\"byteOffset\":355}},{\"id\":\"h1:44444444444444444444444444444444:source:3f670f70a6ef7d0da7572cb4dc61bf0d8163329ce2b1d7a065928f4866a77098\",\"sessionId\":\"h1:44444444444444444444444444444444:session:e77e21fcba1be78f4fe05313ca3520efbdfe8d85eb9c13480e124c30b8125665\",\"messageId\":\"h1:44444444444444444444444444444444:event:f538a8155aa32bae2411aa333e9e995535b86c8d9386dcdafc52ffa064a3d507\",\"eventId\":null,\"usageId\":null,\"turnId\":null,\"representation\":\"message\",\"origin\":\"ordinary\",\"observedUsage\":null,\"observedResult\":null,\"sourceRef\":{\"fileId\":\"h1:44444444444444444444444444444444:source:6cfcf23393cfc1757c3cb5e234eb379dfd8febe67bfaa7a6c3c5db990a3719a8\",\"byteOffset\":355}},{\"id\":\"h1:44444444444444444444444444444444:source:a67cb37bf920d8add802f346668a17d1ccbe0337a20f010eb9dd73ebdb465bb3\",\"sessionId\":\"h1:44444444444444444444444444444444:session:e77e21fcba1be78f4fe05313ca3520efbdfe8d85eb9c13480e124c30b8125665\",\"messageId\":\"h1:44444444444444444444444444444444:event:f538a8155aa32bae2411aa333e9e995535b86c8d9386dcdafc52ffa064a3d507\",\"eventId\":\"h1:44444444444444444444444444444444:event:bf0256d0dc79c3f47aa0099bde8c34f3cd82d52f3a791b74dd6a719097376960\",\"usageId\":null,\"turnId\":null,\"representation\":\"result\",\"origin\":\"ordinary\",\"observedUsage\":null,\"observedResult\":{\"isError\":false,\"completionKind\":\"invocation_result\",\"unassignedAcknowledgement\":false,\"observedAt\":\"2026-09-01T00:00:04.000Z\",\"acknowledgementLatencyMs\":null,\"durationMs\":null,\"durationScope\":\"unknown\"},\"sourceRef\":{\"fileId\":\"h1:44444444444444444444444444444444:source:6cfcf23393cfc1757c3cb5e234eb379dfd8febe67bfaa7a6c3c5db990a3719a8\",\"byteOffset\":355}}],\"diagnostics\":[{\"code\":\"INSUFFICIENT_LOOKUP_EVIDENCE\",\"severity\":\"warning\",\"sourceAlias\":\"source-1\",\"byteOffset\":0}],\"capabilities\":{\"provider\":\"claude\",\"parserVersion\":1,\"support\":\"shape_verified_only\",\"coverage\":\"partial\",\"observedShapes\":[\"message_link\",\"tool_result\",\"tool_use\"],\"unsupportedRecords\":0,\"ambiguousRecords\":0,\"stateLimited\":false,\"diagnosticsDropped\":0}},\"relationshipEvidence\":{\"contractVersion\":1,\"capturePolicyVersion\":1,\"status\":\"captured\",\"provider\":\"claude\",\"metadata\":[{\"id\":\"h1:44444444444444444444444444444444:source:9c6a365b530108779ba0f1d60d6fff106a77c7aaef0eaeede4cfa76d4695c2ed\",\"ownerRootSessionId\":\"h1:44444444444444444444444444444444:session:e77e21fcba1be78f4fe05313ca3520efbdfe8d85eb9c13480e124c30b8125665\",\"declaredRootSessionId\":\"h1:44444444444444444444444444444444:session:e77e21fcba1be78f4fe05313ca3520efbdfe8d85eb9c13480e124c30b8125665\",\"sessionId\":\"h1:44444444444444444444444444444444:session:e77e21fcba1be78f4fe05313ca3520efbdfe8d85eb9c13480e124c30b8125665\",\"agentId\":null,\"isSidechain\":false,\"versionFingerprint\":\"h1:44444444444444444444444444444444:source:93061d2d02f2ba2977bfe9ae6f227da0e59afe9c5e4bf99e4a7db55a790362a7\",\"declarationFingerprint\":\"h1:44444444444444444444444444444444:session:ee849cb11c978ca83c1a481ab8423d797b938366d2dc708ee71edcd6c1fb9431\",\"origin\":\"ordinary\",\"sourceRef\":{\"fileId\":\"h1:44444444444444444444444444444444:source:6cfcf23393cfc1757c3cb5e234eb379dfd8febe67bfaa7a6c3c5db990a3719a8\",\"byteOffset\":0}},{\"id\":\"h1:44444444444444444444444444444444:source:f84746d388f37fa63f440ea829f082ec5475b5a3a293ad6af9e697d2c4f3b9ae\",\"ownerRootSessionId\":\"h1:44444444444444444444444444444444:session:e77e21fcba1be78f4fe05313ca3520efbdfe8d85eb9c13480e124c30b8125665\",\"declaredRootSessionId\":\"h1:44444444444444444444444444444444:session:e77e21fcba1be78f4fe05313ca3520efbdfe8d85eb9c13480e124c30b8125665\",\"sessionId\":\"h1:44444444444444444444444444444444:session:e77e21fcba1be78f4fe05313ca3520efbdfe8d85eb9c13480e124c30b8125665\",\"agentId\":null,\"isSidechain\":false,\"versionFingerprint\":null,\"declarationFingerprint\":\"h1:44444444444444444444444444444444:session:ee849cb11c978ca83c1a481ab8423d797b938366d2dc708ee71edcd6c1fb9431\",\"origin\":\"ordinary\",\"sourceRef\":{\"fileId\":\"h1:44444444444444444444444444444444:source:6cfcf23393cfc1757c3cb5e234eb379dfd8febe67bfaa7a6c3c5db990a3719a8\",\"byteOffset\":355}}],\"messages\":[{\"id\":\"h1:44444444444444444444444444444444:event:aab2c9313a247f56aa70316bf33a9b33af2aa5b535675d766a22f31c0ee10cae\",\"sessionId\":\"h1:44444444444444444444444444444444:session:e77e21fcba1be78f4fe05313ca3520efbdfe8d85eb9c13480e124c30b8125665\",\"kind\":\"assistant\",\"parentMessageId\":null,\"sourceToolAssistantMessageId\":null,\"responseId\":\"h1:44444444444444444444444444444444:event:6dde3f4b8748094e067cdab6c85c6179b28c940a0c33b968b17778dd8fbd861e\",\"conflicted\":false,\"sourceRef\":{\"fileId\":\"h1:44444444444444444444444444444444:source:6cfcf23393cfc1757c3cb5e234eb379dfd8febe67bfaa7a6c3c5db990a3719a8\",\"byteOffset\":0}},{\"id\":\"h1:44444444444444444444444444444444:event:f538a8155aa32bae2411aa333e9e995535b86c8d9386dcdafc52ffa064a3d507\",\"sessionId\":\"h1:44444444444444444444444444444444:session:e77e21fcba1be78f4fe05313ca3520efbdfe8d85eb9c13480e124c30b8125665\",\"kind\":\"user\",\"parentMessageId\":\"h1:44444444444444444444444444444444:event:aab2c9313a247f56aa70316bf33a9b33af2aa5b535675d766a22f31c0ee10cae\",\"sourceToolAssistantMessageId\":\"h1:44444444444444444444444444444444:event:aab2c9313a247f56aa70316bf33a9b33af2aa5b535675d766a22f31c0ee10cae\",\"responseId\":null,\"conflicted\":false,\"sourceRef\":{\"fileId\":\"h1:44444444444444444444444444444444:source:6cfcf23393cfc1757c3cb5e234eb379dfd8febe67bfaa7a6c3c5db990a3719a8\",\"byteOffset\":355}}]}}";
const historicalHashes = {
  "statsHuman": "5e1656439896d589d4ef7c3266c17ad41c6e2eb9077d079136727200b75ad710",
  "statsJson": "d5b7856fb72a54121e26312ae0ee0ee50dc620aecce56bbad227e9e6bb5c908e",
  "failures": "702cadd48f95bae3f8123796b5abfb8947967733dca28e956051c767e64f0b34",
  "insightsHuman": "56f2e2b153c8a638afad0307b46388c9bdceade99c7bb5266985b061d489ee64",
  "insightsJson": "c19e7d50a4143996942d07e34edb24176d8af9a00db9bf36c3956d698555fa72",
  "readRevisits": "558f509c32c7f1d2f51c6b7547a55e30f00b0447d3280b55b7d595a2eacc57be",
  "overlap": "724c105d51b14bb2cdc9c50f7a72e15469e0d3506fdee0be5e0c43f70105666e"
};
const legacy = (): SourceSnapshotInput => JSON.parse(legacyJson);
afterEach(() => vi.restoreAllMocks());
async function inputFile() { const root = temporaryDirectory(), path = join(root, "synthetic.jsonl"); await writeFile(path, rawBytes, { mode: 0o600 }); return { root, path }; }
async function privateState(dir: string) { return Promise.all((await readdir(dir)).sort().map(async name => ({ name, bytes: sha(await readFile(join(dir, name))), mode: (await stat(join(dir, name))).mode }))); }
function rows(db: Awaited<ReturnType<typeof openDatabase>>) { return Object.fromEntries(["source_event_headers", "source_event_contributions", "source_metric_headers", "source_metric_contributions", "source_relationship_headers", "source_relationship_contributions", "source_cache_evidence"].map(name => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()])); }
function rebind(input: SourceSnapshotInput, sourceId: string): SourceSnapshotInput {
  // Rebind only this synthetic source's opaque file identity; no interpretation/reparse.
  return JSON.parse(JSON.stringify(input).replaceAll(input.sourceId, sourceId));
}
async function seedHistorical(store: ReturnType<typeof createSourceStore>, path: string) {
  const sourceId = context.fingerprint("source", ["claude", path]);
  const proof = await readSourcePrefixWithProof(path, context, { sourceId, provider: "claude", parserVersion: 1 }, () => true, { maxFileBytes: 16 * 1024 * 1024, maxRecords: 32768 });
  expect(proof.status).toBe("observed"); if (proof.status !== "observed") throw Error("proof failed");
  const input = { ...rebind(legacy(), sourceId), cacheEvidence: { contractVersion: 1 as const, contentFingerprint: proof.contentFingerprint } };
  expect(store.replaceSourceSnapshot(input, null)).toMatchObject({ status: "committed", revision: 1 }); return { input, sourceId };
}

describe("ordinary Claude native search source storage and transition", () => {
  it("freezes source bytes, physical offsets and historical safe output independently", async () => {
    expect(Buffer.byteLength(rawBytes)).toBe(699); expect(sha(rawBytes)).toBe("73f1f8dcbc5b041093965e233ad439b1f2bc39541db8fff1079cebb561523091");
    expect(sha(legacyJson)).toBe("1a58560bc16523e52942d5a60e79e8f8e381a98d11890eeb174d8a01af4b8f37");
    expect(legacy().events[0]).toMatchObject({ lookupKey: null, status: "completed", durationMs: 4000 });
    const { path } = await inputFile(), points = [];
    for await (const entry of readJsonLines(path, { chunkBytes: 1 })) if (entry.kind === "record") points.push([entry.byteOffset, entry.nextOffset]);
    expect(points).toEqual([[0, 355], [355, 699]]); expect(await readFile(path, "utf8")).toBe(rawBytes);
  });
  it("ingests ordinary raw reader records, closes/reopens private SQLite and retains exact key only", async () => {
    const { path } = await inputFile(), dir = temporaryDirectory(), sourceBefore = await stat(path); let db = await openDatabase(dir);
    try {
      const output = await ingestSourceFile(createSourceStore(db, keyId), context, { path, provider: "claude", expectedRevision: null, chunkBytes: 1 });
      expect(output).toMatchObject({ status: "committed", revision: 1, capabilities: { parserVersion: 2 } });
      const saved = createSourceStore(db, keyId).readSource(output.sourceId)!;
      expect(saved).toMatchObject({ parserVersion: 2, completedOffset: 699, observedSize: 699, evidence: { capabilities: { parserVersion: 2 } } });
      expect(saved.events[0]).toMatchObject({ lookupKey: expectedKey, status: "completed", durationMs: 4000, contentState: "unknown", contentFingerprint: null, changeState: "unknown", lookupRange: null });
      const exposed = JSON.stringify({ saved, output, rows: rows(db) });
      for (const sentinel of ["FICTITIOUS_", path, "2.1.241"]) expect(exposed).not.toContain(sentinel);
      db.close(); db = await openDatabase(dir); expect(createSourceStore(db, keyId).readSource(output.sourceId)).toEqual(saved);
      expect((await stat(path)).mode).toBe(sourceBefore.mode); expect(await readFile(path, "utf8")).toBe(rawBytes);
    } finally { db.close(); }
  });
  it("preserves historical v1 read-only output bytes, null keys, files and modes", async () => {
    const dir = temporaryDirectory(), old = legacy(), db = await openDatabase(dir); createSourceStore(db, keyId).replaceSourceSnapshot(old, null); db.close();
    await writeFile(join(dir, "identity-key.json"), JSON.stringify({ keyVersion: 1, keyId, secret: secret.toString("hex") }) + "\n", { mode: 0o600 });
    const before = await privateState(dir), stats = await runStats({ dataDir: dir, source: old.sourceId }), insights = await runInsights({ dataDir: dir, source: old.sourceId });
    expect(sha(formatStatsResult(stats, false))).toBe(historicalHashes.statsHuman); expect(sha(formatStatsResult(stats, true))).toBe(historicalHashes.statsJson);
    expect(sha(formatInsightsResult(insights, false))).toBe(historicalHashes.insightsHuman); expect(sha(formatInsightsResult(insights, true))).toBe(historicalHashes.insightsJson);
    const reopened = await openDatabase(dir);
    try { const stored = createSourceStore(reopened, keyId).readSource(old.sourceId)!;
      expect(stored.parserVersion).toBe(1); expect(stored.events[0]!.lookupKey).toBeNull();
      expect(sha(JSON.stringify(analyzeSourceFailures(stored)))).toBe(historicalHashes.failures);
      expect(sha(JSON.stringify(analyzeSourceReadRevisits(stored)))).toBe(historicalHashes.readRevisits);
      expect(sha(JSON.stringify(analyzeSourceInvocationOverlap(stored)))).toBe(historicalHashes.overlap);
    } finally { reopened.close(); }
    expect(await privateState(dir)).toEqual(before);
  });
  it("invalidates a genuine old interpretation once, reparses under original CAS, then reuses v2", async () => {
    const { root, path } = await inputFile(), db = await openDatabase(temporaryDirectory()), store = { ...createSourceStore(db, keyId) };
    try {
      const { sourceId } = await seedHistorical(store, path), ingest = vi.spyOn(ClaudeAdapter.prototype, "ingest"), replace = vi.spyOn(store, "replaceSourceSnapshotWithCheckpoint");
      expect((await scanSources(store, context, [{ provider: "claude", path: root }])).sources[0]).toMatchObject({ status: "committed", expectedRevision: 1, committedRevision: 2 });
      expect(ingest).toHaveBeenCalledTimes(2); expect(replace.mock.calls[0]?.[3]).toBe(1);
      expect(store.readSource(sourceId)).toMatchObject({ revision: 2, parserVersion: 2 }); expect(store.readSource(sourceId)!.events[0]!.lookupKey).toBe(expectedKey);
      const before = rows(db); ingest.mockClear(); replace.mockClear();
      expect((await scanSources(store, context, [{ provider: "claude", path: root }])).sources[0]).toMatchObject({ status: "unchanged", expectedRevision: 2, reusedRevision: 2 });
      expect(ingest).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(rows(db)).toEqual(before); expect(await readFile(path, "utf8")).toBe(rawBytes);
    } finally { db.close(); }
  });
  it("keeps the old generation on bounded rejection and stale replacement", async () => {
    const { root, path } = await inputFile(), db = await openDatabase(temporaryDirectory()), store = { ...createSourceStore(db, keyId) };
    try {
      const { input } = await seedHistorical(store, path), before = rows(db);
      const rejected = await scanSources(store, context, [{ provider: "claude", path: root }], { maxRecords: 1 });
      expect(rejected.sources[0]).toMatchObject({ status: "rejected", expectedRevision: 1 }); expect(rows(db)).toEqual(before);
      expect(store.replaceSourceSnapshot(input, null)).toMatchObject({ status: "stale", actualRevision: 1 }); expect(rows(db)).toEqual(before);
      const rejectedInput = { ...input, parserVersion: 3, evidence: { ...input.evidence, capabilities: { ...input.evidence.capabilities, parserVersion: 3 } } };
      expect(() => store.replaceSourceSnapshot(rejectedInput as never, 1)).toThrow(); expect(rows(db)).toEqual(before);
    } finally { db.close(); }
  });
  it.each([["claude", 5], ["codex", 4]] as const)("rejects future metric-bearing %s %i without altering the events-only API", async (provider, version) => {
    const db = await openDatabase(temporaryDirectory()), store = createSourceStore(db, keyId);
    try {
      const adapter = provider === "claude" ? createClaudeAdapter(context) : createCodexAdapter(context), snap = adapter.snapshot();
      const input = { ...legacy(), sourceId: context.fingerprint("source", [provider, "empty"]), provider, parserVersion: version, events: [], completedOffset: 0, observedSize: 0, boundaryFingerprint: null,
        evidence: { turns: [], usage: [], observations: [], diagnostics: [], capabilities: { ...snap.capabilities, parserVersion: version } } };
      delete (input as { relationshipEvidence?: unknown }).relationshipEvidence;
      let error: unknown; try { store.replaceSourceSnapshot(input as never, null); } catch (e) { error = e; }
      expect(error).toBeDefined(); expect(JSON.stringify(safeErrorEnvelope(error))).not.toContain("FICTITIOUS_");
      const { evidence: _evidence, ...eventsOnly } = input; expect(store.replaceSource(eventsOnly as never, null)).toMatchObject({ status: "committed" });
      expect(store.readSource(input.sourceId)).toMatchObject({ parserVersion: version, evidence: null });
    } finally { db.close(); }
  });
  it.each([[1, 2], [2, 1]])("rejects mismatched Claude header %i/capability %i and suppresses analyzer candidates", async (header, capability) => {
    const db = await openDatabase(temporaryDirectory()), store = createSourceStore(db, keyId), old = legacy();
    try {
      store.replaceSourceSnapshot(old, null); const stored = store.readSource(old.sourceId)!, before = rows(db);
      const evidence = { ...old.evidence, capabilities: { ...old.evidence.capabilities, parserVersion: capability } };
      expect(() => store.replaceSourceSnapshot({ ...old, parserVersion: header, evidence } as never, 1)).toThrow(); expect(rows(db)).toEqual(before);
      const malformed = { ...stored, parserVersion: header, evidence } as never;
      expect(analyzeSourceFailures(malformed).suppressionReason).toBe("unsupported_contract"); expect(analyzeSourceSlowTool(malformed).suppressionReason).toBe("unsupported_contract");
    } finally { db.close(); }
  });
  it("suppresses unsupported matching future versions in both closed analyzer gates", async () => {
    const db = await openDatabase(temporaryDirectory()), store = createSourceStore(db, keyId), old = legacy();
    try { store.replaceSourceSnapshot(old, null); const saved = store.readSource(old.sourceId)!;
      for (const [provider, parserVersion] of [["claude", 5], ["codex", 4]] as const) {
        const malformed = { ...saved, provider, parserVersion, evidence: { ...saved.evidence!, capabilities: { ...saved.evidence!.capabilities, provider, parserVersion } } } as never;
        expect(analyzeSourceFailures(malformed).suppressionReason).toBe("unsupported_contract"); expect(analyzeSourceSlowTool(malformed).suppressionReason).toBe("unsupported_contract");
      }
    } finally { db.close(); }
  });
});
