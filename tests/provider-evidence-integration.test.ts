import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { runScan } from "../src/cli/scan.js";
import { runReconcileScan } from "../src/cli/reconcile-scan.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import { CodexAdapter } from "../src/parsers/codex/index.js";
import { ClaudeAdapter } from "../src/parsers/claude/index.js";
import { runPatterns } from "../src/cli/patterns.js";
import { runHistory } from "../src/cli/history.js";
import { disk, bytes, encode, codexRows, claudeRows, claudePair, context, keyId } from "./provider-evidence-fixture.js";
import { records as usageRows, window } from "./usage-timing-fixture.js";
const providers = ["codex", "claude"] as const;
afterEach(() => vi.restoreAllMocks());
async function read(data: string, id: string) { return withReadOnlyStore(data, (db, key) => createSourceStore(db, key).readSource(id)!); }

it.each(providers)("%s mode switch, unchanged reuse, append checkpoint and deleted-input analysis", async provider => {
  const rows = provider === "codex" ? codexRows() : claudeRows(), x = await disk(provider, rows as never);
  expect((await runScan(x.options)).counts.committed).toBe(1);
  const old = await read(x.data, x.sourceId); expect(old.events.every(e => e.errorFingerprint === null)).toBe(true);
  const scan = await runScan({ ...x.options, patternEvidence: true }); expect(scan.counts.committed).toBe(1);
  const captured = await read(x.data, x.sourceId);
  expect(captured.parserVersion).toBe(provider === "codex" ? 3 : 4); expect(captured.revision).toBe(2);
  expect(captured.events.some(e => e.errorFingerprint !== null)).toBe(true);
  const before = await bytes(x.data);
  const reused = await runScan({ ...x.options, patternEvidence: true }); expect(reused.counts.unchanged).toBe(1);
  expect(await bytes(x.data)).toEqual(before);
  const db = await openDatabase(x.data);
  try { expect(createSourceStore(db, keyId).readSourceForIngestion(x.sourceId, context).checkpoint).not.toBeNull(); } finally { db.close(); }
  const addition = provider === "codex" ? codexRows().slice(2).map((r: any) => ({ ...r,
    timestamp: new Date(Date.parse(r.timestamp) + 30_000).toISOString(), payload: { ...r.payload, call_id: "append-" + r.payload.call_id } })) : claudePair("last");
  await appendFile(x.path, encode(addition));
  const Type = provider === "codex" ? CodexAdapter : ClaudeAdapter, spy = vi.spyOn(Type.prototype, "ingest");
  const appended = await runScan({ ...x.options, patternEvidence: true }); expect(appended.counts.committed).toBe(1);
  expect(spy).toHaveBeenCalledTimes(addition.length); spy.mockRestore();
  const s = await read(x.data, x.sourceId); expect(s.revision).toBe(3);
  const snap = await bytes(x.data); await rm(x.inputRoot, { recursive: true });
  const analysis = await runPatterns({ source: x.sourceId, dataDir: x.data });
  expect(analysis.suppressionReason).toBeNull(); expect(analysis.parserVersion).toBe(s.parserVersion);
  if (provider === "codex") expect(analysis.candidates.some(c => c.ruleId === "retry-loop")).toBe(true);
  expect(JSON.stringify(analysis)).not.toContain("FICTITIOUS_");
  expect(await bytes(x.data)).toEqual(snap);
});
it.each(providers)("%s switching back restores legacy event interpretation rather than retaining enriched fields", async provider => {
  const rows = provider === "codex" ? codexRows() : claudeRows(), x = await disk(provider, rows as never);
  await runScan(x.options); const legacy = await read(x.data, x.sourceId);
  await runScan({ ...x.options, patternEvidence: true });
  expect((await runScan(x.options)).counts.committed).toBe(1);
  const restored = await read(x.data, x.sourceId);
  expect(restored.events).toEqual(legacy.events); expect(restored.evidence).toEqual(legacy.evidence);
  expect(restored.parserVersion).toBe(legacy.parserVersion);
});
it.each(providers)("%s explicit lifecycle supports evidence capture, deletion and restoration without losing payloads", async provider => {
  const x = await disk(provider, (provider === "codex" ? codexRows() : claudeRows()) as never);
  const options = { ...x.options, patternEvidence: true, reconcile: true };
  const first = await runReconcileScan(options); expect(first.counts.collected).toBe(1);
  const saved = await read(x.data, x.sourceId), raw = await readFile(x.path, "utf8");
  await rm(x.path); const absent = await runReconcileScan(options); expect(absent.counts.markedUnavailable).toBe(1);
  expect((await read(x.data, x.sourceId)).events).toEqual(saved.events);
  await writeFile(x.path, raw); expect((await runReconcileScan(options)).counts.collected).toBe(1);
  const restored = await read(x.data, x.sourceId);
  expect(restored.availability).toBe("available"); expect(restored.events).toEqual(saved.events); expect(restored.parserVersion).toBe(saved.parserVersion);
});
it.each(providers)("%s richer mode retains daily token counts/finality and timestamps", async provider => {
  const x = await disk(provider, usageRows(provider));
  await runScan({ ...x.options, usageTiming: true });
  const a = await runHistory({ source: [x.sourceId], dataDir: x.data, ...window, tokens: true });
  await runScan({ ...x.options, patternEvidence: true });
  const b = await runHistory({ source: [x.sourceId], dataDir: x.data, ...window, tokens: true });
  expect(b.days).toEqual(a.days); expect(b.inventory).toEqual(a.inventory);
});
it.each(providers)("%s real CLI validates new flags before bootstrap and provides raw-free output", async provider => {
  const x = await disk(provider, (provider === "codex" ? codexRows() : claudeRows()) as never), bin = resolve("dist/agentprof.cjs"), missing = join(x.root, "absent");
  const invoke = (args: string[]) => spawnSync(process.execPath, [bin, ...args], { env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf8", timeout: 15000 });
  for (const args of [["scan", "--pattern-evidence", "--pattern-evidence"], ["stats", "--pattern-evidence"], ["scan", "--pattern-evidence=true"]]) {
    const r = invoke([...args, "--data-dir", missing, "--json"]); expect(r.status).toBe(2); expect(r.stdout).toBe(""); expect(existsSync(missing)).toBe(false);
  }
  const scan = invoke(["scan", "--pattern-evidence", "--usage-timing", `--${provider}-root`, x.path, "--data-dir", x.data, "--json"]);
  expect([0, 1]).toContain(scan.status); expect(JSON.parse(scan.stdout).result.counts.committed).toBe(1);
  expect((await read(x.data, x.sourceId)).parserVersion).toBe(provider === "codex" ? 3 : 4);
  expect(scan.stdout).not.toContain("FICTITIOUS_");
});
it.each([null, "true", 1, {}, []])("invalid pattern-evidence SDK flag %j is refused before private I/O", async value => {
  const x = await disk("codex", codexRows() as never), before = await bytes(x.data);
  await expect(runScan({ ...x.options, patternEvidence: value as never })).rejects.toBeDefined();
  expect(await bytes(x.data)).toEqual(before);
});
