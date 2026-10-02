import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate, openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import type { SourceSnapshotInput, StoredSource } from "../src/db/source-store.js";
import { HEADER_FIELDS } from "../src/db/source-validation.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { ClaudeAdapter, createClaudeAdapter } from "../src/parsers/claude/index.js";
import { CodexAdapter, createCodexAdapter } from "../src/parsers/codex/index.js";
import { SCAN_LIMITS, scanSources } from "../src/scanner/scan-run.js";
import { ingestSourceFile } from "../src/scanner/source-ingest.js";
import { temporaryDirectory } from "./helpers.js";

type Provider = "codex" | "claude";
const secret = Buffer.alloc(32, 37), keyId = "4".repeat(32);
const context = createIdentityContext(secret, keyId);
const root = fileURLToPath(new URL("../", import.meta.url));
const fixtures = join(root, "tests/fixtures/providers");
const fixtureNames = (await readdir(fixtures)).filter(name => /^(codex|claude)-.*\.jsonl$/.test(name)).sort();
afterEach(() => { vi.restoreAllMocks(); });

// Frozen before relationship implementation: these raw records and exact offsets are
// independent of adapters, storage validators and production identity helpers.
const codexLines = [
  '{"type":"session_meta","payload":{"id":"rel-root","cli_version":"0.159.0"}}\n',
  '{"type":"response_item","payload":{"type":"custom_tool_call","name":"exec","call_id":"rel-wrapper","input":"FICTITIOUS_WRAPPER"}}\n',
  '{"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"rel-wrapper","output":"FICTITIOUS_OUTPUT"}}\n',
] as const;
const codexOffsets = [0, 76, 206] as const;
const claudeLines = [
  '{"type":"assistant","uuid":"rel-a","sessionId":"rel-root","isSidechain":false,"message":{"id":"rel-response","role":"assistant","content":[]}}\n',
  '{"type":"user","uuid":"rel-u","sessionId":"rel-root","isSidechain":false,"parentUuid":"rel-a","sourceToolAssistantUUID":"rel-absent","message":{"role":"user","content":[]}}\n',
  '{"type":"system","uuid":"rel-s","sessionId":"rel-root","isSidechain":true,"agentId":"rel-agent"}\n',
] as const;
const claudeOffsets = [0, 143, 316] as const;
function keyed(domain: string, ...parts: unknown[]): string {
  return `h1:${keyId}:${domain}:${createHmac("sha256", secret).update(JSON.stringify([1, 1, domain, ...parts])).digest("hex")}`;
}
function overBudgetBytes() {
  const tail = [
    { timestamp: "2026-09-01T00:00:00.000Z", type: "response_item", payload: { type: "function_call", call_id: "rel-execution", name: "exec_command", arguments: '{"cmd":"rg FICTITIOUS_SEARCH src"}' } },
    { timestamp: "2026-09-01T00:00:01.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "rel-execution", output: { exit_code: 0, text: "FICTITIOUS_OUTPUT" } } },
  ];
  return Buffer.from(codexLines[0].repeat(7000) + tail.map(record => JSON.stringify(record) + "\n").join(""));
}
function expectedCodex(path: string, trusted = false) {
  const fileId = keyed("source", "codex", resolve(path)), sessionId = keyed("session", "codex", "rel-root");
  return { contractVersion: 1, capturePolicyVersion: 1, status: "captured", provider: "codex",
    metadata: [{ id: keyed("source", "codex_metadata", fileId, 0), ownerSessionId: sessionId, declaredSessionId: sessionId,
      versionFingerprint: keyed("source", "codex_version", "0.159.0"), forkParentId: null, origin: "ordinary", sourceRef: { fileId, byteOffset: 0 } }],
    wrappers: [{ id: keyed("event", "codex", sessionId, "rel-wrapper"), sessionId, kind: "code_wrapper", callSeen: true, resultSeen: true,
      relationship: trusted ? "trusted_fixture" : "unknown", childEventIds: trusted ? [keyed("event", "codex", sessionId, "rel-absent-child")] : [],
      sourceRef: { fileId, byteOffset: 206 } }],
  };
}
function expectedClaude(path: string) {
  const fileId = keyed("source", "claude", resolve(path)), rootId = keyed("session", "claude", "rel-root", null);
  const sideId = keyed("session", "claude", "rel-root", "rel-agent"), agentId = keyed("session", "claude_agent", "rel-root", "rel-agent");
  const rootDeclaration = '{"agentId":[false,null],"isSidechain":[true,false],"sessionId":[true,"rel-root"]}';
  const sideDeclaration = '{"agentId":[true,"rel-agent"],"isSidechain":[true,true],"sessionId":[true,"rel-root"]}';
  return { contractVersion: 1, capturePolicyVersion: 1, status: "captured", provider: "claude",
    metadata: claudeOffsets.map((byteOffset, i) => ({ id: keyed("source", "claude_metadata", fileId, byteOffset), ownerRootSessionId: rootId,
      declaredRootSessionId: rootId, sessionId: i === 2 ? sideId : rootId, agentId: i === 2 ? agentId : null, isSidechain: i === 2,
      versionFingerprint: null, declarationFingerprint: keyed("session", "claude_declaration", i === 2 ? sideDeclaration : rootDeclaration),
      origin: "ordinary", sourceRef: { fileId, byteOffset } })),
    messages: [
      { id: keyed("event", "claude", rootId, "uuid", "rel-a"), sessionId: rootId, kind: "assistant", parentMessageId: null,
        sourceToolAssistantMessageId: null, responseId: keyed("event", "claude", rootId, "response", "rel-response"), conflicted: false, sourceRef: { fileId, byteOffset: 0 } },
      { id: keyed("event", "claude", rootId, "uuid", "rel-u"), sessionId: rootId, kind: "user", parentMessageId: keyed("event", "claude", rootId, "uuid", "rel-a"),
        sourceToolAssistantMessageId: keyed("event", "claude", rootId, "uuid", "rel-absent"), responseId: null, conflicted: false, sourceRef: { fileId, byteOffset: 143 } },
      { id: keyed("event", "claude", sideId, "uuid", "rel-s"), sessionId: sideId, kind: "system", parentMessageId: null,
        sourceToolAssistantMessageId: null, responseId: null, conflicted: false, sourceRef: { fileId, byteOffset: 316 } },
    ],
  };
}
async function source(bytes: string | Buffer) {
  const path = join(temporaryDirectory(), "FICTITIOUS_SOURCE.jsonl"); await writeFile(path, bytes); return path;
}
function adapterSnapshot(bytes: Buffer, path: string, provider: Provider) {
  const adapter = provider === "codex" ? createCodexAdapter(context) : createClaudeAdapter(context);
  let offset = 0, ordinal = 0;
  while (offset < bytes.length) {
    const lf = bytes.indexOf(10, offset); if (lf < 0) break;
    let text = bytes.subarray(offset, lf).toString("utf8");
    if (offset === 0 && text.startsWith("\uFEFF")) text = text.slice(1);
    adapter.ingest(JSON.parse(text), { fileIdentity: resolve(path), sourceAlias: "source-1", byteOffset: offset, ordinal: ordinal++ }); offset = lf + 1;
  }
  return adapter.snapshot();
}
function relationships(snapshot: ReturnType<typeof adapterSnapshot>) {
  const common = { contractVersion: 1, capturePolicyVersion: 1, status: "captured", provider: snapshot.capabilities.provider, metadata: snapshot.metadata };
  return "wrappers" in snapshot ? { ...common, wrappers: snapshot.wrappers } : { ...common, messages: snapshot.messages };
}
function metrics(snapshot: ReturnType<typeof adapterSnapshot>) {
  return { turns: snapshot.turns, usage: snapshot.usage, observations: snapshot.observations, diagnostics: snapshot.diagnostics, capabilities: snapshot.capabilities };
}
function snapshotInput(stored: StoredSource): SourceSnapshotInput {
  return { ...Object.fromEntries(HEADER_FIELDS.map(key => [key, stored[key]])), events: stored.events, evidence: stored.evidence!, cacheEvidence: stored.cacheEvidence } as SourceSnapshotInput;
}
function oldRows(db: DatabaseSync) {
  return Object.fromEntries(["source_store_identity", "source_event_headers", "source_event_contributions", "source_metric_headers", "source_metric_contributions", "source_cache_evidence"]
    .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
function files(directory: string) {
  // Lossless bytes as a string avoid deep assertion libraries enumerating every
  // Buffer byte on multi-MiB databases; this is exact equality, not a digest.
  return readdirSync(directory).sort().map(name => ({ name, mode: statSync(join(directory, name)).mode, bytes: readFileSync(join(directory, name)).toString("base64") }));
}

describe("independent tiny relationship oracle", () => {
  it("freezes hand-enumerated UTF-8 LF boundaries", () => {
    expect(codexLines.map(line => Buffer.byteLength(line))).toEqual([76, 130, 123]);
    expect(claudeLines.map(line => Buffer.byteLength(line))).toEqual([143, 173, 97]);
    expect(Buffer.byteLength(codexLines.join(""))).toBe(329); expect(Buffer.byteLength(claudeLines.join(""))).toBe(413);
  });
  it.each(["codex", "claude"] as const)("persists exact independent %s identities, ownership and dangling references through reopen", async provider => {
    const path = await source((provider === "codex" ? codexLines : claudeLines).join(""));
    const expected = provider === "codex" ? expectedCodex(path) : expectedClaude(path);
    const directory = join(temporaryDirectory(), "store"); let db = await openDatabase(directory);
    try {
      const store = createSourceStore(db, keyId), result = await ingestSourceFile(store, context, { path, provider, expectedRevision: null, chunkBytes: 1 });
      expect(result).toMatchObject({ status: "committed", revision: 1, aggregationReady: false, parserResumeReady: false });
      const saved = store.readSource(result.sourceId)!;
      expect(result.sourceId).toBe(keyed("source", provider, resolve(path))); expect(saved.relationshipEvidence).toEqual(expected);
      expect(saved.events).toEqual([]); expect(saved.evidence!.turns).toEqual([]); expect(saved.evidence!.usage).toEqual([]);
      expect(JSON.stringify(saved)).not.toMatch(/rel-root|rel-wrapper|rel-absent|rel-agent|FICTITIOUS_/);
      expect(Object.isFrozen(saved.relationshipEvidence)).toBe(true);
      db.close(); db = await openDatabase(directory);
      expect(createSourceStore(db, keyId).readSource(result.sourceId)).toEqual(saved);
    } finally { db.close(); }
  });
  it("retains a trusted test-only dangling child without inventing an execution", () => {
    const path = "/FICTITIOUS_TRUSTED_SOURCE.jsonl", adapter = createCodexAdapter(context);
    codexLines.forEach((line, ordinal) => adapter.ingest(JSON.parse(line), { fileIdentity: path, byteOffset: codexOffsets[ordinal]!, ordinal,
      trustedFixtureContext: { wrapperRelations: [{ wrapperCallId: "rel-wrapper", childItemIds: ["rel-absent-child"] }] } }));
    const snapshot = adapter.snapshot(), db = new DatabaseSync(":memory:"); migrate(db);
    try {
      const store = createSourceStore(db, keyId), sourceId = keyed("source", "codex", path);
      expect(relationships(snapshot)).toEqual(expectedCodex(path, true));
      expect(store.replaceSourceSnapshot({ sourceId, provider: "codex", parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId,
        completedOffset: 329, observedSize: 329, boundaryFingerprint: keyed("content", "source_boundary_v1", 329, Buffer.from(codexLines.join("")).toString("base64")), events: snapshot.events, evidence: metrics(snapshot),
        relationshipEvidence: relationships(snapshot) } as SourceSnapshotInput, null)).toEqual({ status: "committed", revision: 1 });
      const saved = store.readSource(sourceId)!; expect(saved.relationshipEvidence).toEqual(expectedCodex(path, true)); expect(saved.events).toEqual([]);
    } finally { db.close(); }
  });
});

describe("final adapter relationships and inherited payload parity", () => {
  it("retains the complete ten-fixture inherited exercise set", () => { expect(fixtureNames).toHaveLength(10); });
  it.each(fixtureNames)("round-trips final %s relationships without changing events or metrics", async name => {
    const provider: Provider = name.startsWith("codex") ? "codex" : "claude", bytes = await readFile(join(fixtures, name)), path = await source(bytes);
    const expected = adapterSnapshot(bytes, path, provider), directory = join(temporaryDirectory(), "store"); let db = await openDatabase(directory);
    try {
      const store = createSourceStore(db, keyId), result = await ingestSourceFile(store, context, { path, provider, expectedRevision: null, chunkBytes: 17 });
      expect(result).toMatchObject({ status: "committed", revision: 1, persistedScope: "events_and_metric_evidence", capabilities: expected.capabilities, diagnostics: expected.diagnostics });
      const saved = store.readSource(result.sourceId)!;
      expect(saved.relationshipEvidence).toEqual(relationships(expected));
      expect(saved.events).toEqual([...expected.events].sort((a, b) => a.id.localeCompare(b.id))); expect(saved.evidence).toEqual(metrics(expected));
      const priorRows = oldRows(db);
      db.close(); db = await openDatabase(directory);
      expect(createSourceStore(db, keyId).readSource(result.sourceId)).toEqual(saved); expect(oldRows(db)).toEqual(priorRows);
      expect(JSON.stringify(saved)).not.toContain(path); expect(JSON.stringify(saved)).not.toContain("FICTITIOUS_");
    } finally { db.close(); }
  });
});

describe("relationship capture and unchanged source lifecycle", () => {
  it.each([false, true])("recaptures historical null once and then reuses captured evidence (migrated=%s)", async migrated => {
    const path = await source(claudeLines.join("")), directory = join(temporaryDirectory(), "store"); let db = await openDatabase(directory);
    try {
      let store = createSourceStore(db, keyId);
      const initial = await ingestSourceFile(store, context, { path, provider: "claude", expectedRevision: null, maxFileBytes: SCAN_LIMITS.fileBytes });
      const first = store.readSource(initial.sourceId)!;
      if (migrated) {
        db.exec("DROP TABLE source_parser_checkpoints; DROP TABLE source_relationship_contributions; DROP TABLE source_relationship_headers; DELETE FROM schema_migrations WHERE version>=5; PRAGMA user_version=4");
        db.close(); db = await openDatabase(directory); store = createSourceStore(db, keyId);
      } else {
        expect(store.replaceSourceSnapshot(snapshotInput(first), 1)).toEqual({ status: "committed", revision: 2 });
      }
      const historical = store.readSource(initial.sourceId)!; expect(historical.relationshipEvidence).toBeNull();
      expect(historical.cacheEvidence).toEqual(first.cacheEvidence); expect(historical.evidence).toEqual(first.evidence); expect(historical.events).toEqual(first.events);
      const ingest = vi.spyOn(ClaudeAdapter.prototype, "ingest"), replace = vi.fn(store.replaceSourceSnapshotWithCheckpoint), watched = { ...store, replaceSourceSnapshotWithCheckpoint: replace };
      const run = await scanSources(watched, context, [{ provider: "claude", path }]);
      expect(run.counts).toMatchObject({ committed: 1, unchanged: 0, failed: 0 }); expect(ingest).toHaveBeenCalledTimes(3); expect(replace).toHaveBeenCalledTimes(1);
      const captured = store.readSource(initial.sourceId)!;
      expect(captured.revision).toBe(historical.revision + 1); expect(captured.relationshipEvidence).toEqual(expectedClaude(path));
      expect(captured.events).toEqual(first.events); expect(captured.evidence).toEqual(first.evidence);
      ingest.mockClear(); replace.mockClear(); const before = files(directory);
      for (let i = 0; i < 2; i++) expect((await scanSources(watched, context, [{ provider: "claude", path }])).sources[0]).toMatchObject({ status: "unchanged", reusedRevision: captured.revision });
      expect(ingest).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(files(directory)).toEqual(before);
      expect(store.readSource(initial.sourceId)).toEqual(captured);
    } finally { db.close(); }
  });
  it("keeps empty captured evidence distinct from missing and unavailable", async () => {
    const path = await source(""), db = new DatabaseSync(":memory:"); migrate(db);
    try {
      const store = createSourceStore(db, keyId), initial = await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: null, maxFileBytes: SCAN_LIMITS.fileBytes });
      const captured = store.readSource(initial.sourceId)!;
      expect(captured.relationshipEvidence).toEqual({ contractVersion: 1, capturePolicyVersion: 1, status: "captured", provider: "codex", metadata: [], wrappers: [] });
      expect(store.replaceSourceSnapshot(snapshotInput(captured), 1)).toEqual({ status: "committed", revision: 2 });
      expect(store.readSource(initial.sourceId)!.relationshipEvidence).toBeNull();
      const unavailable = { contractVersion: 1, capturePolicyVersion: 1, status: "unavailable", provider: "codex", reason: "relationship_budget_exceeded" };
      expect(store.replaceSourceSnapshot({ ...snapshotInput(captured), relationshipEvidence: unavailable } as SourceSnapshotInput, 2)).toEqual({ status: "committed", revision: 3 });
      expect(store.readSource(initial.sourceId)!.relationshipEvidence).toEqual(unavailable);
      const ingest = vi.spyOn(CodexAdapter.prototype, "ingest"), replace = vi.fn(store.replaceSourceSnapshot), watched = { ...store, replaceSourceSnapshot: replace };
      expect((await scanSources(watched, context, [{ provider: "codex", path }])).sources[0]).toMatchObject({ status: "unchanged", reusedRevision: 3 });
      expect(ingest).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
    } finally { db.close(); }
  });
  it("commits old accepted events and metrics when actual relationship bytes exceed the capture budget, then reuses", async () => {
    // 7000 metadata rows fit the old 8192 observation ceiling but exceed the new
    // 4 MiB relationship budget. No adapter limits, snapshots or validators are mocked.
    const bytes = overBudgetBytes();
    const path = await source(bytes), expected = adapterSnapshot(bytes, path, "codex"), directory = join(temporaryDirectory(), "store"); let db = await openDatabase(directory);
    try {
      expect(expected.capabilities.stateLimited).toBe(false); expect(expected.events).toHaveLength(1);
      expect(expected.metadata.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row)), 0)).toBeGreaterThan(4 * 1024 * 1024);
      const store = createSourceStore(db, keyId), result = await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: null, maxFileBytes: SCAN_LIMITS.fileBytes });
      expect(result).toMatchObject({ status: "committed", revision: 1, capabilities: expected.capabilities, diagnostics: expected.diagnostics });
      const saved = store.readSource(result.sourceId)!;
      expect(saved.relationshipEvidence).toEqual({ contractVersion: 1, capturePolicyVersion: 1, status: "unavailable", provider: "codex", reason: "relationship_budget_exceeded" });
      expect(saved.events).toEqual(expected.events); expect(saved.evidence).toEqual(metrics(expected));
      expect(db.prepare("SELECT count(*) AS count FROM source_relationship_contributions").get()).toEqual({ count: 0 });
      db.close(); db = await openDatabase(directory); const reopened = createSourceStore(db, keyId);
      expect(reopened.readSource(result.sourceId)).toEqual(saved);
      const before = files(directory), ingest = vi.spyOn(CodexAdapter.prototype, "ingest"), replace = vi.fn(reopened.replaceSourceSnapshot), watched = { ...reopened, replaceSourceSnapshot: replace };
      expect((await scanSources(watched, context, [{ provider: "codex", path }])).sources[0]).toMatchObject({ status: "unchanged", reusedRevision: 1 });
      expect(ingest).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(files(directory)).toEqual(before);
    } finally { db.close(); }
  }, 30_000);
  it.each(["captured", "unavailable"] as const)("recaptures policy-mismatched %s evidence exactly once under otherwise matching file proof", async status => {
    const path = await source(codexLines.join("")), directory = join(temporaryDirectory(), "store"), db = await openDatabase(directory);
    try {
      const store = createSourceStore(db, keyId);
      const initial = await ingestSourceFile(store, context, { path, provider: "codex", expectedRevision: null, maxFileBytes: SCAN_LIMITS.fileBytes });
      const original = store.readSource(initial.sourceId)!;
      if (status === "unavailable") store.replaceSourceSnapshot({ ...snapshotInput(original),
        relationshipEvidence: { contractVersion: 1, capturePolicyVersion: 1, status, provider: "codex", reason: "relationship_budget_exceeded" } }, 1);
      db.exec("UPDATE source_relationship_headers SET capture_policy_version=2");
      const obsolete = store.readSource(initial.sourceId)!;
      expect(obsolete.relationshipEvidence).toMatchObject({ contractVersion: 1, capturePolicyVersion: 2, status });
      expect(obsolete.cacheEvidence).toEqual(original.cacheEvidence);
      const ingest = vi.spyOn(CodexAdapter.prototype, "ingest"), replace = vi.fn(store.replaceSourceSnapshot), watched = { ...store, replaceSourceSnapshot: replace };
      expect((await scanSources(watched, context, [{ provider: "codex", path }])).sources[0]).toMatchObject({ status: "committed", committedRevision: obsolete.revision + 1 });
      expect(ingest).toHaveBeenCalledTimes(3); expect(replace).toHaveBeenCalledTimes(1);
      const refreshed = store.readSource(initial.sourceId)!;
      expect(refreshed.relationshipEvidence).toEqual(expectedCodex(path)); expect(refreshed.cacheEvidence).toEqual(original.cacheEvidence);
      expect(refreshed.events).toEqual(original.events); expect(refreshed.evidence).toEqual(original.evidence);
      const before = files(directory); ingest.mockClear(); replace.mockClear();
      expect((await scanSources(watched, context, [{ provider: "codex", path }])).sources[0]).toMatchObject({ status: "unchanged", reusedRevision: refreshed.revision });
      expect(ingest).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(files(directory)).toEqual(before);
    } finally { db.close(); }
  });
});

function privateData(parent: string, name: string) {
  const directory = join(parent, name); mkdirSync(directory, { mode: 0o700 }); chmodSync(directory, 0o700);
  writeFileSync(join(directory, "identity-key.json"), JSON.stringify({ keyVersion: 1, keyId, secret: secret.toString("hex") }) + "\n", { mode: 0o600 });
  return directory;
}
function invoke(binary: string, directory: string, args: string[]) {
  const result = spawnSync(process.execPath, [binary, "--data-dir", directory, ...args], { encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" } });
  expect(result.error).toBeUndefined(); expect(result.signal).toBeNull();
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
const currentBinary = join(root, "dist/agentprof.cjs"), baselineBinary = process.env["AGENTPROF_BASELINE_BINARY"];
const installedBinary = process.env["AGENTPROF_INSTALLED_BINARY"];

describe.skipIf(!baselineBinary)("frozen pre-change CLI byte parity", () => {
  it.each(fixtureNames)("preserves status/stdout/stderr for fresh and reused %s", name => {
    const directory = temporaryDirectory(), provider: Provider = name.startsWith("codex") ? "codex" : "claude", input = join(directory, "input"); mkdirSync(input);
    const path = join(input, name); copyFileSync(join(fixtures, name), path);
    const before = privateData(directory, "baseline"), after = privateData(directory, "current");
    const scan = ["scan", `--${provider}-root`, input];
    const first = invoke(currentBinary, after, [...scan, "--json"]);
    expect(first).toEqual(invoke(baselineBinary!, before, [...scan, "--json"]));
    expect(JSON.parse(first.stdout).result.counts.committed).toBe(1);
    const sourceId = keyed("source", provider, path), frozen = files(after), frozenBaseline = files(before);
    for (const args of [scan, ["stats", "--list-sources"], ["stats", "--source", sourceId],
      ["insights", "--source", sourceId], ["stats", "--failures", "--source", sourceId]]) {
      for (const json of [[], ["--json"]]) expect(invoke(currentBinary, after, [...args, ...json])).toEqual(invoke(baselineBinary!, before, [...args, ...json]));
    }
    expect(files(after)).toEqual(frozen); expect(files(before)).toEqual(frozenBaseline);
  }, 30_000);
});

describe.skipIf(!installedBinary)("script-disabled installed tarball relationship supplement", () => {
  it.each(["codex", "claude"] as const)("persists and reuses %s relationships through the installed CLI", async provider => {
    const directory = temporaryDirectory(), input = join(directory, "input"); mkdirSync(input);
    const path = join(input, "synthetic.jsonl"); writeFileSync(path, (provider === "codex" ? codexLines : claudeLines).join(""));
    const data = privateData(directory, "data"), scan = ["scan", `--${provider}-root`, input, "--json"];
    const first = invoke(installedBinary!, data, scan); expect([0, 1]).toContain(first.status);
    expect(JSON.parse(first.stdout).result.counts.committed).toBe(1);
    const db = await openDatabase(data);
    try { expect(createSourceStore(db, keyId).readSource(keyed("source", provider, path))!.relationshipEvidence).toEqual(provider === "codex" ? expectedCodex(path) : expectedClaude(path)); }
    finally { db.close(); }
    const before = files(data), second = invoke(installedBinary!, data, scan);
    expect(JSON.parse(second.stdout).result.sources[0]).toMatchObject({ status: "unchanged", reusedRevision: 1 });
    expect(files(data)).toEqual(before);
    const sourceId = keyed("source", provider, path);
    for (const args of [["stats", "--list-sources"], ["stats", "--source", sourceId], ["stats", "--failures", "--source", sourceId], ["insights", "--source", sourceId]]) {
      for (const json of [[], ["--json"]]) expect(invoke(installedBinary!, data, [...args, ...json])).toEqual(invoke(currentBinary, data, [...args, ...json]));
    }
    expect(files(data)).toEqual(before);
  }, 30_000);
  it("retains accepted metrics and reuses actual budget-unavailable evidence through the installed CLI", async () => {
    const directory = temporaryDirectory(), input = join(directory, "input"); mkdirSync(input);
    const path = join(input, "synthetic.jsonl"); writeFileSync(path, overBudgetBytes());
    const data = privateData(directory, "data"), scan = ["scan", "--codex-root", input, "--json"];
    const first = invoke(installedBinary!, data, scan);
    // Frozen pre-change CLI returns partial/exit1 for missing operation context in this synthetic source.
    expect(first.status).toBe(1); expect(JSON.parse(first.stdout).result.counts).toMatchObject({ committed: 1, rejected: 0, failed: 0 });
    expect(JSON.parse(first.stdout).result.diagnostics.samples).toEqual([{ code: "INSUFFICIENT_OPERATION_CONTEXT", severity: "warning", sourceAlias: "source-1", byteOffset: 532000 }]);
    const db = await openDatabase(data);
    try {
      const saved = createSourceStore(db, keyId).readSource(keyed("source", "codex", path))!;
      expect(saved.relationshipEvidence).toEqual({ contractVersion: 1, capturePolicyVersion: 1, status: "unavailable", provider: "codex", reason: "relationship_budget_exceeded" });
      expect(saved.events).toHaveLength(1); expect(saved.evidence!.observations).toHaveLength(7002);
      expect(saved.evidence!.capabilities.stateLimited).toBe(false);
      expect(db.prepare("SELECT count(*) AS count FROM source_relationship_contributions").get()).toEqual({ count: 0 });
    } finally { db.close(); }
    const before = files(data), second = invoke(installedBinary!, data, scan);
    expect(second.status).toBe(1); expect(JSON.parse(second.stdout).result.sources[0]).toMatchObject({ status: "unchanged", reusedRevision: 1 });
    expect(JSON.parse(second.stdout).result.diagnostics).toEqual(JSON.parse(first.stdout).result.diagnostics);
    expect(files(data)).toEqual(before);
  }, 30_000);
});
