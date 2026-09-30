import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { codexEventId, codexStreamId, createCodexAdapter } from "../src/parsers/codex/index.js";
import { readJsonLines } from "../src/scanner/jsonl.js";
import type { CodexAdapter } from "../src/parsers/codex/index.js";
import type { TrustedFixtureContext } from "../src/parsers/types.js";

const directory = fileURLToPath(new URL("./fixtures/providers/", import.meta.url));
const context = createIdentityContext(new Uint8Array(32).fill(17), "1".repeat(32));
const oracle = JSON.parse(await readFile(`${directory}/expected.json`, "utf8"));
const realOracle = JSON.parse(await readFile(`${directory}/codex-p2-expected.json`, "utf8"));
const caseById = (id: string) => oracle.cases.find((item: { id: string }) => item.id === id);
const mainStream = codexStreamId(context, "synthetic-codex-main");
const legacyStream = codexStreamId(context, "synthetic-codex-legacy");
const mainContext: TrustedFixtureContext = { wrapperRelations: [{ wrapperCallId: "wrap1", childItemIds: ["c1", "c2"] }] };

async function feed(adapter: CodexAdapter, filename: string, fileIdentity = filename, offset = 0, ordinal = 0, trustedFixtureContext?: TrustedFixtureContext) {
  const path = `${directory}/${filename}`;
  const before = createHash("sha256").update(await readFile(path)).digest("hex");
  let size = offset;
  let nextOrdinal = ordinal;
  for await (const entry of readJsonLines(path)) {
    expect(entry.kind === "diagnostic").toBe(false);
    if (entry.kind === "record") {
      adapter.ingest(entry.value, { fileIdentity, byteOffset: offset + entry.byteOffset, ordinal: nextOrdinal++, sourceAlias: "source-1", ...(trustedFixtureContext ? { trustedFixtureContext } : {}) });
      size = offset + entry.nextOffset;
    }
  }
  expect(createHash("sha256").update(await readFile(path)).digest("hex")).toBe(before);
  return { size, ordinal: nextOrdinal };
}
const event = (adapter: CodexAdapter, stream: string, id: string) => adapter.snapshot().events.find((value) => value.id === codexEventId(context, stream, id))!;

describe("independent P0 Codex provider oracles", () => {
  test("structured same-ID priority preserves runtime/lifecycle and wrapper representations", async () => {
    const adapter = createCodexAdapter(context);
    await feed(adapter, "codex-structured.jsonl", undefined, 0, 0, mainContext);
    const expected = caseById("codex-structured");
    const snapshot = adapter.snapshot();
    expect(snapshot.events).toHaveLength(expected.executionCount);
    expect(snapshot.events.map((e) => e.id).sort()).toEqual(expected.canonicalEventAliases.map((alias: string) => codexEventId(context, mainStream, alias.split(":")[1]!)).sort());
    const shell = event(adapter, mainStream, "c1");
    expect(shell.durationMs).toBe(expected.timing[0].sourceRuntimeMs);
    expect(Date.parse(shell.endAt!) - Date.parse(shell.startAt!)).toBe(expected.timing[0].observedLifecycleMs);
    expect(shell).toMatchObject({ durationScope: expected.timing[0].durationScope, intervalScope: expected.timing[0].intervalScope, timingEvidence: "source_reported", intervalTimingEvidence: "source_reported", status: "completed", kind: "shell" });
    expect(event(adapter, mainStream, "c2")).toMatchObject({ kind: "mcp", category: "mcp", durationMs: expected.timing[1].sourceRuntimeMs, durationScope: "invocation_latency", intervalScope: "item_lifecycle" });
    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0]!.durationMs).toBe(expected.activeTimeMs);
    expect(Date.parse(snapshot.turns[0]!.endAt!) - Date.parse(snapshot.turns[0]!.startAt!)).toBe(expected.activeTimeMs);
    const response = snapshot.usage.filter((value) => value.source === "response_usage");
    expect(response).toHaveLength(1);
    expect(response[0]!.counts).toMatchObject({ input: expected.tokenUsage.input, output: expected.tokenUsage.output, cachedInput: expected.tokenUsage.cachedIncludedInput });
    expect(snapshot.usage.filter((value) => value.source === "token_count_total")).toHaveLength(1);
    expect(snapshot.wrappers).toHaveLength(1);
    expect(snapshot.wrappers[0]).toMatchObject({ callSeen: true, resultSeen: true, relationship: "trusted_fixture" });
    expect(snapshot.wrappers[0]!.childEventIds).toEqual([shell.id, event(adapter, mainStream, "c2").id]);
    expect(snapshot.diagnostics.some((d) => d.code === "TIMING_CONFLICT")).toBe(false);
  });
  test("legacy launches, empty polls and later append update the original identities", async () => {
    const adapter = createCodexAdapter(context);
    const cursor = await feed(adapter, "codex-legacy.jsonl");
    const expected = caseById("codex-legacy");
    expect(adapter.snapshot().events).toHaveLength(expected.executionCount);
    expect(adapter.snapshot().events.filter((e) => e.status === "completed")).toHaveLength(expected.completedCount);
    expect(adapter.snapshot().events.filter((e) => e.status === "pending")).toHaveLength(expected.pendingCount);
    expect(adapter.snapshot().events.filter((e) => e.toolName === "write_stdin")).toHaveLength(expected.pollExecutionCount);
    expect(event(adapter, legacyStream, "l1")).toMatchObject({ status: "completed", executionOutcome: "no_match" });
    expect(event(adapter, legacyStream, "process1")).toMatchObject({ durationMs: expected.processObservedLatencyMs, durationScope: "invocation_latency", timingEvidence: "paired_timestamps", intervalScope: "invocation_latency" });
    expect(event(adapter, legacyStream, "process1").durationMs).not.toBe(expected.pollWallTimeSumForbidden * 1000);
    expect(adapter.snapshot().events.some((e) => e.durationScope === "process_runtime")).toBe(false);
    const pendingId = event(adapter, legacyStream, "pending1").id;
    await feed(adapter, "codex-pending-append.jsonl", "codex-legacy.jsonl", cursor.size, cursor.ordinal);
    const append = caseById("codex-pending-update");
    expect(adapter.snapshot().events).toHaveLength(append.executionCount);
    expect(adapter.snapshot().events.filter((e) => e.status === "pending")).toHaveLength(append.pendingCount);
    expect(event(adapter, legacyStream, "pending1")).toMatchObject({ id: pendingId, status: "completed", durationMs: append.pendingObservedLatencyMs, durationScope: "invocation_latency" });
  });
  test("archive and exact source replay keep counts, timing and identities stable", async () => {
    const adapter = createCodexAdapter(context);
    await feed(adapter, "codex-structured.jsonl", undefined, 0, 0, mainContext);
    const first = adapter.snapshot();
    await feed(adapter, "codex-archive.jsonl", undefined, 0, 0, mainContext);
    const archived = adapter.snapshot();
    const expected = caseById("codex-archive");
    expect(archived.events).toHaveLength(expected.executionCount);
    expect(archived.stateCounts.sources).toBe(expected.sourceCount);
    expect(archived.events.map((e) => ({ id: e.id, status: e.status, durationMs: e.durationMs }))).toEqual(first.events.map((e) => ({ id: e.id, status: e.status, durationMs: e.durationMs })));
    expect(archived.usage.filter((u) => u.source === "response_usage")).toHaveLength(1);
    expect(archived.diagnostics.some((d) => d.code === "INCONSISTENT_REPLAY")).toBe(false);
    await feed(adapter, "codex-archive.jsonl", undefined, 0, 0, mainContext);
    expect(adapter.snapshot().stateCounts).toEqual(archived.stateCounts);
    expect(adapter.snapshot().capabilities).toEqual(archived.capabilities);
  });
  test("only external trusted copied ordinals suppress fork history", async () => {
    const expected = caseById("codex-fork");
    const adapter = createCodexAdapter(context);
    await feed(adapter, "codex-structured.jsonl", undefined, 0, 0, mainContext);
    await feed(adapter, "codex-fork.jsonl", undefined, 0, 0, { knownCopiedOrdinals: expected.explicitFixtureKnownCopiedOrdinals });
    expect(adapter.snapshot().events).toHaveLength(expected.executionCount);
    const fork = codexStreamId(context, "synthetic-codex-fork");
    expect(adapter.snapshot().events.filter((e) => e.sessionId === fork)).toHaveLength(expected.newForkExecutionCount);
    const segments = adapter.snapshot().metadata.filter((value) => value.ownerSessionId === fork);
    expect(segments.map((value) => value.versionFingerprint)).toEqual(expected.metadataSegments.map((version: string) => context.fingerprint("source", ["codex_version", version])));
    expect(segments.every((value) => value.ownerSessionId === fork)).toBe(true);
    const unannotated = createCodexAdapter(context);
    await feed(unannotated, "codex-fork.jsonl");
    expect(unannotated.snapshot().diagnostics.some((d) => d.code === "AMBIGUOUS_ORIGIN")).toBe(true);
    // A raw ordinal name does not discard this completed item.
    expect(unannotated.snapshot().events.some((e) => e.id === codexEventId(context, mainStream, "c1"))).toBe(true);
    const before = unannotated.snapshot();
    await feed(unannotated, "codex-fork.jsonl");
    expect(unannotated.snapshot().capabilities).toEqual(before.capabilities);
  });
});

test("independently invented actual-shape fixture covers argv, native usage and disjoint wrapper IDs", async () => {
  const adapter = createCodexAdapter(context);
  await feed(adapter, realOracle.file);
  const snapshot = adapter.snapshot();
  const stream = codexStreamId(context, "synthetic-real-shape-stream");
  expect(snapshot.events).toHaveLength(realOracle.executions);
  expect(snapshot.wrappers).toHaveLength(realOracle.wrappers);
  const shell = event(adapter, stream, "synthetic-command-item");
  expect(shell).toMatchObject({ status: realOracle.command.status, executionOutcome: realOracle.command.outcome, durationMs: realOracle.command.durationMs, durationScope: realOracle.command.durationScope, intervalScope: realOracle.command.intervalScope });
  expect(Date.parse(shell.endAt!) - Date.parse(shell.startAt!)).toBe(realOracle.command.lifecycleMs);
  expect(shell.exitCode).toBe(1);
  expect(shell.fileFingerprint).not.toBeNull();
  expect(shell.lookupKey).toBeNull();
  expect(shell.contentFingerprint).toBeNull();
  expect(event(adapter, stream, "synthetic-mcp-item")).toMatchObject({ durationMs: realOracle.mcp.durationMs, durationScope: "invocation_latency", status: realOracle.mcp.status });
  expect(snapshot.turns[0]).toMatchObject({ startAt: realOracle.turn.startAt, endAt: realOracle.turn.endAt, durationMs: realOracle.turn.durationMs, intervalScope: "turn_wall", durationScope: "turn_elapsed" });
  expect(snapshot.usage.find((value) => value.source === "response_usage")!.counts).toEqual(realOracle.responseUsage);
  expect(snapshot.usage.find((value) => value.source === "turn_snapshot")!.counts!.total).toBe(realOracle.separateSnapshots.turnTotal);
  expect(snapshot.usage.find((value) => value.source === "thread_snapshot")!.counts!.total).toBe(realOracle.separateSnapshots.threadTotal);
  expect(snapshot.stateCounts.processLinks).toBe(1);
  expect(snapshot.diagnostics.filter((d) => d.code === "UNSUPPORTED_RECORD")).toHaveLength(realOracle.unsupportedDynamicItems);
  const retained = JSON.stringify(adapter.inspectRetainedState());
  expect(retained).not.toContain("FICTITIOUS_AGENTPROF_");
  expect(retained).not.toContain("synthetic-real-shape-stream");
  expect(retained).not.toContain("synthetic-process-id");
  expect(retained).not.toContain("0.159.0");
  expect(retained).not.toContain("fixture.invalid");
  expect(retained).not.toContain("rg absent");
});
