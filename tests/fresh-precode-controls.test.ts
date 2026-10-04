/** Baseline-only controls against the immutable local report/open dependency.
 * No fresh orchestration or proposed expectedRevision/signal API is used here.
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { collectScan, formatScanResult, runScan } from "../src/cli/scan.js";
import { formatReportResult, runReport } from "../src/cli/report.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { createSourceStore } from "../src/db/source-store.js";
import { openDatabase } from "../src/db/database.js";
import { loadOrCreateIdentityContext } from "../src/normalize/identity.js";
import { safeErrorEnvelope, SafeError } from "../src/privacy/diagnostics.js";
import { SCAN_LIMITS } from "../src/scanner/scan-run.js";
import { summarizeSource } from "../src/analysis/source-summary.js";
import { temporaryDirectory } from "./helpers.js";
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/providers/${name}`, import.meta.url));
const snapshot = (data: string) => ["agentprof.sqlite", "identity-key.json"].map(name => ({
  name, bytes: readFileSync(join(data, name)), mode: statSync(join(data, name)).mode & 0o777,
}));
describe("fresh workflow precode baseline controls", () => {
  it("one real Claude evidence-warning source commits and reports honestly without private sentinels", async () => {
    const root = temporaryDirectory(), data = join(root, "private"), parent = join(root, "PRIVATE_INPUT_SENTINEL");
    mkdirSync(parent); const input = join(parent, "PRIVATE_FILENAME_SENTINEL.jsonl");
    copyFileSync(fixture("claude-real-shapes.jsonl"), input);
    const scan = await runScan({ dataDir: data, codexRoot: [], claudeRoot: [input] });
    expect(scan).toMatchObject({ status: "partial", stopReason: null, discoveryTruncated: false,
      counts: { discovered: 1, attempted: 1, committed: 1, unchanged: 0, rejected: 0, stale: 0, failed: 0, aborted: 0, duplicates: 0 } });
    expect(scan.sources).toHaveLength(1);
    expect(scan.sources[0]).toMatchObject({ status: "committed", provider: "claude", committedRevision: 1, reusedRevision: null });
    expect(scan.diagnostics.samples.map(value => value.code)).toContain("INSUFFICIENT_LOOKUP_EVIDENCE");
    const before = snapshot(data), source = scan.sources[0]!;
    const report = await runReport({ dataDir: data, source: source.sourceId, output: join(root, "report.html") });
    expect(report).toMatchObject({ revision: 1, sourceId: source.sourceId, published: true, targetVerification: "verified" });
    expect(snapshot(data)).toEqual(before);
    const html = readFileSync(report.output, "utf8");
    // Retained smoke assertion; the following hard-coded fixture oracle is the
    // real metric/unknown check, independent of unconditional explanatory text.
    expect(html).toMatch(/unknown|suppressed|unavailable/i);
    const selected = await withReadOnlyStore(data, (db, key) => createSourceStore(db, key).readSource(source.sourceId));
    // Raw fixture timestamps: rg 0->3s, Read 1->4s, side MCP 11->13s.
    // Its two 1s launch acknowledgements are not execution durations.
    expect(selected!.events.filter(event => event.status === "pending").map(event => event.durationMs)).toEqual([null, null]);
    expect(selected!.evidence!.usage).toHaveLength(1);
    // Last snapshot: 100 uncached + 30 cache-read + 20 cache-write = 150 input;
    // output 10; total 160. Untrusted thinking_tokens:99 is not reasoning usage.
    expect(selected!.evidence!.usage[0]).toMatchObject({ finality: "unknown", selection: "provisional",
      counts: { input: 150, uncachedInput: 100, cachedInput: 30, cacheWriteInput: 20, output: 10, total: 160, reasoningOutput: null } });
    const summary = summarizeSource(selected!);
    expect(summary.suppressionReason).toBeNull();
    expect(summary.durationEligibility).toMatchObject({ included: 3, terminalCandidates: 3, exclusions: { pending: 2 } });
    expect(summary.durations!.map(value => ({ n: value.n, sumMs: value.sumMs, durationScope: value.durationScope, timingEvidence: value.timingEvidence }))
      .sort((a, b) => a.sumMs! - b.sumMs!)).toEqual([
      { n: 1, sumMs: 2000, durationScope: "invocation_latency", timingEvidence: "paired_timestamps" },
      { n: 1, sumMs: 3000, durationScope: "invocation_latency", timingEvidence: "paired_timestamps" },
      { n: 1, sumMs: 3000, durationScope: "invocation_latency", timingEvidence: "paired_timestamps" },
    ]);
    // Provisional usage is excluded. The established summary contract represents
    // no admitted usage cohort as null, never observed zero token counts.
    expect(summary.usage).toBeNull();
    expect(summary.usageEligibility).toMatchObject({ observedResponses: 0, selectedRows: 0, excludedRows: 1, exclusions: { provisional: 1 } });
    expect(html).toContain('<h3>Summary observation eligibility</h3><p class="state">Suppression: none</p>');
    expect(html).toContain('Included duration observations: 3 / 3 terminal candidates');
    expect(html).toContain('<dt>duration exclusion / pending</dt><dd>2</dd>');
    expect(html).toContain('<dt>usage eligibility / exclusions / provisional</dt><dd>1</dd>');
    expect(html.split('<p>No eligible response-usage cohort in this displayed session.</p>')).toHaveLength(3);
    expect(html).not.toContain('<p class="state">Usage unavailable: none</p>');
    expect(html).not.toContain('<th scope="row">reasoningOutput</th>');
    for (const [ms, rows] of [[2000, 1], [3000, 2]]) {
      const cells = `<td>1</td><td>${ms}</td><td>${ms}</td><td>${ms}</td><td>${ms}</td><td>${ms}<p class="muted">low sample</p></td>`;
      expect(html.split(cells).length - 1).toBe(rows);
    }
    const visible = html + formatReportResult(report, true) + formatReportResult(report, false)
      + formatScanResult(scan, true) + formatScanResult(scan, false);
    for (const sentinel of ["FICTITIOUS_", "PRIVATE_INPUT_SENTINEL", "PRIVATE_FILENAME_SENTINEL"]) expect(visible).not.toContain(sentinel);
    expect(formatReportResult(report, true)).toContain(report.output);
    const reused = await runScan({ dataDir: data, codexRoot: [], claudeRoot: [input] });
    expect(reused).toMatchObject({ status: "partial", counts: { committed: 0, unchanged: 1, rejected: 0, failed: 0 } });
    expect(reused.sources[0]).toMatchObject({ sourceId: source.sourceId, status: "unchanged", committedRevision: null, reusedRevision: 1 });
  });
  it("real parser state limit rejects and retains the old generation instead of committing partial", async () => {
    const root = temporaryDirectory(), data = join(root, "private"), input = join(root, "synthetic.jsonl");
    copyFileSync(fixture("codex-legacy.jsonl"), input);
    const prior = await runScan({ dataDir: data, codexRoot: [input], claudeRoot: [] });
    expect(prior.sources[0]).toMatchObject({ status: "committed", committedRevision: 1 });
    const id = prior.sources[0]!.sourceId;
    const before = await withReadOnlyStore(data, (db, key) => createSourceStore(db, key).readSource(id));
    const row = JSON.stringify({ type: "session_meta", payload: { id: "synthetic-record-limit", cli_version: "synthetic" } }) + "\n";
    writeFileSync(input, row.repeat(SCAN_LIMITS.records + 1));
    const rejected = await runScan({ dataDir: data, codexRoot: [input], claudeRoot: [] });
    expect(rejected).toMatchObject({ status: "partial", counts: { committed: 0, unchanged: 0, rejected: 1, failed: 0 } });
    expect(rejected.sources[0]).toMatchObject({ sourceId: id, status: "rejected", rejectionReason: "state_limit", committedRevision: null, reusedRevision: null });
    expect(await withReadOnlyStore(data, (db, key) => createSourceStore(db, key).readSource(id))).toEqual(before);
  });
  it("already-aborted collection creates no private store", async () => {
    const root = temporaryDirectory(), data = join(root, "absent-private"), controller = new AbortController();
    controller.abort();
    const scan = await collectScan(data, [{ provider: "claude", path: join(root, "not-read.jsonl") }], controller.signal);
    expect(scan).toMatchObject({ status: "aborted", stopReason: "aborted", sources: [], counts: { discovered: 0, attempted: 0, committed: 0 } });
    expect(existsSync(data)).toBe(false);
  });
  it("stored-only report with absent store does not bootstrap", async () => {
    const root = temporaryDirectory(), data = join(root, "absent-private"), output = join(root, "report.html");
    const source = `h1:${"a".repeat(32)}:source:${"b".repeat(64)}`;
    await expect(runReport({ dataDir: data, source, output })).rejects.toMatchObject({ code: "STORE_NOT_FOUND" });
    expect(existsSync(data)).toBe(false); expect(existsSync(output)).toBe(false);
  });
  it("captured source remains exact after a writer commits following DELETE read release", async () => {
    const root = temporaryDirectory(), data = join(root, "private"), input = join(root, "synthetic.jsonl");
    copyFileSync(fixture("codex-legacy.jsonl"), input);
    const scan = await runScan({ dataDir: data, codexRoot: [input], claudeRoot: [] }), id = scan.sources[0]!.sourceId;
    const captured = await withReadOnlyStore(data, (db, key) => createSourceStore(db, key).readSource(id));
    expect(captured?.revision).toBe(1);
    // Await above releases the read lock. Do not block release on this writer.
    const context = await loadOrCreateIdentityContext(data), writer = await openDatabase(data);
    try { expect(createSourceStore(writer, context.keyId).markUnavailable(id, 1)).toEqual({ status: "committed", revision: 2 }); }
    finally { writer.close(); }
    expect(captured?.revision).toBe(1);
    expect(await withReadOnlyStore(data, (db, key) => createSourceStore(db, key).readSource(id)?.revision)).toBe(2);
  });
  it("unexpected and tampered error messages cannot leak private input/content", () => {
    const changed = new SafeError("REPORT_OUTPUT_FAILED"); changed.message = "PRIVATE_INPUT_SENTINEL FICTITIOUS_PROMPT";
    for (const error of [changed, new Error("PRIVATE_INPUT_SENTINEL FICTITIOUS_TOOL_OUTPUT"),
      { code: "REPORT_OUTPUT_FAILED", message: "PRIVATE_INPUT_SENTINEL FICTITIOUS_CODE" }]) {
      const text = JSON.stringify(safeErrorEnvelope(error));
      expect(text).not.toContain("PRIVATE_INPUT_SENTINEL"); expect(text).not.toContain("FICTITIOUS_");
    }
  });
});


import { runFreshReport, freshReportExitCode, formatFreshReportResult } from "../src/cli/report-fresh.js";
import * as scanModule from "../src/cli/scan.js";
import * as readOnlyModule from "../src/db/read-only.js";
describe("implemented fresh workflow real-store controls", () => {
  it.each(["claude", "codex"] as const)("%s commits R, reuses R, then reports appended R+1", async provider => {
    const root = temporaryDirectory(), data = join(root, "private"), input = join(root, "PRIVATE_FILENAME_SENTINEL.jsonl");
    copyFileSync(fixture(provider === "claude" ? "claude-real-shapes.jsonl" : "codex-legacy.jsonl"), input);
    const args = { provider, input, dataDir: data };
    const first = await runFreshReport({ ...args, output: join(root, "first.html") });
    expect(first.scan.sources[0]).toMatchObject({ status: "committed", committedRevision: 1 });
    expect(first.report).toMatchObject({ revision: 1, published: true });
    if (provider === "claude") { expect(first.scan.status).toBe("partial"); expect(freshReportExitCode(first)).toBe(1); }
    const before = snapshot(data);
    const second = await runFreshReport({ ...args, output: join(root, "second.html") });
    expect(second.scan.sources[0]).toMatchObject({ status: "unchanged", committedRevision: null, reusedRevision: 1 });
    expect(second.report).toMatchObject({ revision: 1, published: true }); expect(snapshot(data)).toEqual(before);
    expect(readFileSync(join(root, "second.html"))).toEqual(readFileSync(join(root, "first.html")));
    appendFileSync(input, JSON.stringify(provider === "codex" ? { timestamp: "2026-09-01T00:01:00.000Z", type: "session_meta", payload: { id: "synthetic-codex-legacy", cli_version: "synthetic" } } : { type: "assistant", uuid: "fresh-append", sessionId: "synthetic-p3-main", isSidechain: false, timestamp: "2026-09-01T00:01:00.000Z", message: { id: "fresh-response", role: "assistant", content: [{ type: "text", text: "FICTITIOUS_APPEND" }] } }) + "\n");
    const third = await runFreshReport({ ...args, output: join(root, "third.html") });
    expect(third.scan.sources[0]).toMatchObject({ status: "committed", committedRevision: 2 });
    expect(third.report).toMatchObject({ revision: 2, published: true });
    for (const result of [first, second, third]) {
      const visible = formatFreshReportResult(result, true) + formatFreshReportResult(result, false) + readFileSync((result.report as any).output, "utf8");
      expect(visible).not.toContain("PRIVATE_FILENAME_SENTINEL"); expect(visible).not.toContain("FICTITIOUS_");
    }
  });
  it("real writer commits between scan and pinned read: exact guard rejects without HTML", async () => {
    const root = temporaryDirectory(), data = join(root, "private"), input = join(root, "synthetic.jsonl"), output = join(root, "out.html");
    copyFileSync(fixture("codex-legacy.jsonl"), input);
    const original = scanModule.collectScan;
    const spy = vi.spyOn(scanModule, "collectScan").mockImplementation(async (...args) => {
      const receipt = await original(...args), context = await loadOrCreateIdentityContext(data), writer = await openDatabase(data);
      try { expect(createSourceStore(writer, context.keyId).markUnavailable(receipt.sources[0]!.sourceId, 1)).toEqual({ status: "committed", revision: 2 }); }
      finally { writer.close(); }
      return receipt;
    });
    try {
      const result = await runFreshReport({ provider: "codex", input, dataDir: data, output });
      expect(result.scan.sources[0]).toMatchObject({ committedRevision: 1 });
      expect(result.report).toMatchObject({ status: "failed", error: { code: "SOURCE_REVISION_CHANGED" } });
      expect(freshReportExitCode(result)).toBe(1); expect(existsSync(output)).toBe(false);
    } finally { spy.mockRestore(); }
  });
  it("writer after actual pinned read releases does not replace the report's captured generation", async () => {
    const root = temporaryDirectory(), data = join(root, "private"), input = join(root, "synthetic.jsonl"), output = join(root, "out.html");
    copyFileSync(fixture("codex-legacy.jsonl"), input);
    const original = readOnlyModule.withReadOnlyStore;
    const spy = vi.spyOn(readOnlyModule, "withReadOnlyStore").mockImplementation(async (directory, operation) => {
      const model = await original(directory, operation);
      const context = await loadOrCreateIdentityContext(data), writer = await openDatabase(data);
      try { const store = createSourceStore(writer, context.keyId), source = store.listSources().items[0]!;
        expect(store.markUnavailable(source.sourceId, 1)).toEqual({ status: "committed", revision: 2 }); }
      finally { writer.close(); }
      return model;
    });
    try {
      const result = await runFreshReport({ provider: "codex", input, dataDir: data, output });
      expect(result.report).toMatchObject({ revision: 1, published: true });
      expect(readFileSync(output, "utf8")).toContain("AgentProf");
    } finally { spy.mockRestore(); }
    expect(await withReadOnlyStore(data, (db, key) => createSourceStore(db, key).listSources().items[0]?.revision)).toBe(2);
  });
  it("existing target is preserved after collection commits and combined receipt records the retained generation", async () => {
    const root = temporaryDirectory(), data = join(root, "private"), input = join(root, "synthetic.jsonl"), output = join(root, "out.html");
    copyFileSync(fixture("codex-legacy.jsonl"), input); writeFileSync(output, "PRESERVED", { mode: 0o640 });
    const result = await runFreshReport({ provider: "codex", input, dataDir: data, output });
    expect(result.scan.sources[0]).toMatchObject({ committedRevision: 1 }); expect(result.report).toMatchObject({ status: "failed", error: { code: "REPORT_OUTPUT_UNSAFE" } });
    expect(readFileSync(output, "utf8")).toBe("PRESERVED"); expect(statSync(output).mode & 0o777).toBe(0o640);
  });
});

// Refreshed-main integration oracles. Historical bytes come from the independently
// verified PR38 5614a310 schema5/Claude1 binary, never a relabeled current adapter.
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { ClaudeAdapter } from "../src/parsers/claude/index.js";
import * as openModule from "../src/cli/open.js";
const historicalSchema5 = process.env["AGENTPROF_SCHEMA5_BASELINE_BINARY"];
function historicalSchema(directory: string) {
  const db = new DatabaseSync(join(directory, "agentprof.sqlite"), { readOnly: true });
  try { return { version: db.prepare("PRAGMA user_version").get()!["user_version"], migrations: db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map(row => row["version"]), headers: db.prepare("SELECT revision, parser_version FROM source_event_headers").all() }; }
  finally { db.close(); }
}
it.skipIf(!historicalSchema5)("fresh explicit Claude write migrates authentic schema5 copy, reuses then resumes exact suffix generations", async () => {
  const root = temporaryDirectory(), old = join(root, "historical"), data = join(root, "fresh-copy"), input = join(root, "PRIVATE_SCHEMA_INPUT.jsonl");
  const call = (id: string, at: string) => ({ type: "assistant", uuid: `call-${id}`, sessionId: "synthetic-schema-copy", isSidechain: false, cwd: "/SYNTHETIC_SCHEMA_ROOT", timestamp: at,
    message: { id: `response-${id}`, role: "assistant", content: [{ type: "tool_use", id, name: "Read", input: { file_path: "synthetic.ts" } }] } });
  const result = (id: string, at: string) => ({ type: "user", uuid: `result-${id}`, sessionId: "synthetic-schema-copy", isSidechain: false, timestamp: at,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: "SYNTHETIC_RESULT" }] } });
  const encode = (row: unknown) => JSON.stringify(row) + "\n";
  const prefix = encode(call("first", "2026-09-01T00:00:00.000Z")) + encode(result("first", "2026-09-01T00:00:04.000Z"));
  writeFileSync(input, prefix); mkdirSync(old, { mode: 0o700 });
  writeFileSync(join(old, "identity-key.json"), JSON.stringify({ keyVersion: 1, keyId: "9".repeat(32), secret: "ab".repeat(32) }) + "\n", { mode: 0o600 });
  const seeded = spawnSync(process.execPath, [historicalSchema5!, "scan", "--claude-root", input, "--data-dir", old, "--json"], { encoding: "utf8", timeout: 15000, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
  expect(seeded.error).toBeUndefined(); expect(seeded.status).toBe(1); expect(seeded.stderr).toBe("");
  const seed = JSON.parse(seeded.stdout).result;
  expect(seed).toMatchObject({ status: "partial", stopReason: null, counts: { committed: 1, unchanged: 0, rejected: 0, stale: 0, failed: 0 } });
  expect(seed.sources).toEqual([expect.objectContaining({ status: "committed", committedRevision: 1, capabilities: expect.objectContaining({ provider: "claude", parserVersion: 1, coverage: "partial" }) })]);
  expect(seed.diagnostics).toEqual({ observedCount: 1, adapterDroppedCount: 0, sampleDroppedCount: 0, samples: [{ code: "INSUFFICIENT_LOOKUP_EVIDENCE", severity: "warning", sourceAlias: "source-1", byteOffset: 0 }] });
  expect(historicalSchema(old)).toEqual({ version: 5, migrations: [1, 2, 3, 4, 5], headers: [{ revision: 1, parser_version: 1 }] });
  const oldBytes = snapshot(old), id = seed.sources[0].sourceId;
  await expect(runReport({ dataDir: old, source: id, output: join(root, "old-read.html") })).rejects.toMatchObject({ code: "DATABASE_SCHEMA_INCOMPATIBLE" });
  expect(existsSync(join(root, "old-read.html"))).toBe(false); expect(snapshot(old)).toEqual(oldBytes);
  mkdirSync(data, { mode: 0o700 }); for (const name of ["agentprof.sqlite", "identity-key.json"]) copyFileSync(join(old, name), join(data, name));
  const ingest = vi.spyOn(ClaudeAdapter.prototype, "ingest");
  try {
    const upgraded = await runFreshReport({ provider: "claude", input, dataDir: data, output: join(root, "upgraded.html") });
    expect(upgraded.scan).toMatchObject({ status: "partial", counts: { committed: 1, unchanged: 0, failed: 0 } });
    expect(upgraded.scan.sources[0]).toMatchObject({ sourceId: id, expectedRevision: 1, committedRevision: 2, capabilities: { parserVersion: 2 } });
    expect(upgraded.report).toMatchObject({ sourceId: id, revision: 2, published: true }); expect(freshReportExitCode(upgraded)).toBe(1); expect(ingest).toHaveBeenCalledTimes(2);
    expect(historicalSchema(data)).toEqual({ version: 8, migrations: [1, 2, 3, 4, 5, 6, 7, 8], headers: [{ revision: 2, parser_version: 2 }] });
    const context = await loadOrCreateIdentityContext(data);
    const checkpoint = async () => { const db = await openDatabase(data); try { return createSourceStore(db, context.keyId).readSourceForIngestion(id, context).checkpoint; } finally { db.close(); } };
    expect(await checkpoint()).toMatchObject({ nextOrdinal: 2 });
    ingest.mockClear(); const unchangedBytes = snapshot(data);
    const reused = await runFreshReport({ provider: "claude", input, dataDir: data, output: join(root, "reused.html") });
    expect(reused.scan.sources[0]).toMatchObject({ status: "unchanged", expectedRevision: 2, committedRevision: null, reusedRevision: 2 });
    expect(reused.report).toMatchObject({ revision: 2, published: true }); expect(ingest).not.toHaveBeenCalled(); expect(snapshot(data)).toEqual(unchangedBytes);
    let offset = Buffer.byteLength(prefix);
    for (const [index, row] of [call("second", "2026-09-01T00:00:10.000Z"), result("second", "2026-09-01T00:00:14.000Z")].entries()) {
      const suffix = encode(row); appendFileSync(input, suffix); ingest.mockClear();
      const next = await runFreshReport({ provider: "claude", input, dataDir: data, output: join(root, `suffix-${index}.html`) });
      expect(next.scan.sources[0]).toMatchObject({ status: "committed", expectedRevision: 2 + index, committedRevision: 3 + index, reusedRevision: null });
      expect(next.report).toMatchObject({ revision: 3 + index, published: true }); expect(ingest).toHaveBeenCalledTimes(1);
      expect(ingest.mock.calls[0]![1]).toMatchObject({ byteOffset: offset, ordinal: 2 + index }); expect(await checkpoint()).toMatchObject({ nextOrdinal: 3 + index }); offset += Buffer.byteLength(suffix);
    }
    const saved = await withReadOnlyStore(data, (db, key) => createSourceStore(db, key).readSource(id));
    expect(saved?.events.map(event => event.durationMs)).toEqual([4000, 4000]);
    expect(readFileSync(join(root, "suffix-1.html"), "utf8")).not.toMatch(/PRIVATE_SCHEMA_INPUT|SYNTHETIC_RESULT|SYNTHETIC_SCHEMA_ROOT|synthetic\.ts/);
  } finally { ingest.mockRestore(); }
  expect(snapshot(old)).toEqual(oldBytes); expect(historicalSchema(old).version).toBe(5);
}, 30000);
it("corrupt current Claude checkpoint fails before parsing, HTML or opening and preserves corrupted-generation bytes", async () => {
  const root = temporaryDirectory(), data = join(root, "private"), input = join(root, "PRIVATE_CHECKPOINT_INPUT.jsonl"), output = join(root, "must-not-exist.html");
  copyFileSync(fixture("claude-real-shapes.jsonl"), input);
  const first = await runFreshReport({ provider: "claude", input, dataDir: data, output: join(root, "initial.html") });
  expect(first.scan.sources[0]).toMatchObject({ committedRevision: 1, capabilities: { parserVersion: 2 } });
  const db = await openDatabase(data);
  try {
    expect(db.prepare("SELECT COUNT(*) AS n FROM source_parser_checkpoints").get()!["n"]).toBe(1);
    db.prepare("UPDATE source_parser_checkpoints SET generation_seal=?").run("corrupt-checkpoint-seal");
  } finally { db.close(); }
  const before = snapshot(data), ingest = vi.spyOn(ClaudeAdapter.prototype, "ingest"), opener = vi.spyOn(openModule, "runOpen").mockResolvedValue({ status: "accepted", opener: "xdg-open", browserVerified: false });
  try {
    const failed = await runFreshReport({ provider: "claude", input, dataDir: data, output, open: true });
    expect(failed.scan).toMatchObject({ status: "partial", counts: { committed: 0, unchanged: 0, failed: 1 } });
    expect(failed.scan.sources[0]).toMatchObject({ status: "failed", committedRevision: null, reusedRevision: null });
    expect(failed.report).toEqual({ status: "skipped", reason: "scan_ineligible" }); expect(freshReportExitCode(failed)).toBe(1);
    expect(ingest).not.toHaveBeenCalled(); expect(opener).not.toHaveBeenCalled(); expect(existsSync(output)).toBe(false); expect(snapshot(data)).toEqual(before);
  } finally { ingest.mockRestore(); opener.mockRestore(); }
});
