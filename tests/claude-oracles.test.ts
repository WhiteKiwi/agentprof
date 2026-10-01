import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { claudeEventId, claudeStreamId, createClaudeAdapter } from "../src/parsers/claude/index.js";
import type { ClaudeTrustedFixtureContext } from "../src/parsers/claude/types.js";
import { codes, context, directory, feed } from "./claude-helpers.js";

const p0 = JSON.parse(await readFile(`${directory}/expected.json`, "utf8"));
const shapeOracle = JSON.parse(await readFile(`${directory}/claude-p3-expected.json`, "utf8"));
const oracle = (id: string) => p0.cases.find((entry: { id: string }) => entry.id === id);
const root = claudeStreamId(context, "synthetic-claude-main");
const side = claudeStreamId(context, "synthetic-claude-main", "agent-synthetic");
const trusted: ClaudeTrustedFixtureContext = {
  toolTimings: [{ ordinal: 6, toolUseId: "ct3", durationScope: "process_runtime", source: "tool_use_result_duration_ms" }],
  usageEvidence: [
    { ordinal: 1, messageId: "msg-a1", finality: "partial", order: 1, orderingGroup: "p0-order", mapping: "anthropic_messages" },
    { ordinal: 2, messageId: "msg-a1", finality: "partial", order: 1, orderingGroup: "p0-order", mapping: "anthropic_messages" },
    { ordinal: 7, messageId: "msg-a1", finality: "final", order: 2, orderingGroup: "p0-order", mapping: "anthropic_messages" },
  ],
};

describe("unchanged independent P0 Claude oracles", () => {
  test("multicall, replay and later usage preserve original call boundaries", async () => {
    const adapter = createClaudeAdapter(context);
    await feed(adapter, "claude-message.jsonl", undefined, trusted);
    const expected = oracle("claude-message");
    const snapshot = adapter.snapshot();
    expect(snapshot.events).toHaveLength(expected.executionCount);
    expect(snapshot.events.filter((value) => value.sessionId === root)).toHaveLength(expected.mainCount);
    expect(snapshot.events.filter((value) => value.sessionId === side)).toHaveLength(expected.sidechainCount);
    for (const [toolUseId, stream] of [["ct1", root], ["ct2", root], ["ct3", side]]) {
      const execution = snapshot.events.find((value) => value.id === claudeEventId(context, stream!, toolUseId!))!;
      expect(Date.parse(execution.endAt!) - Date.parse(execution.startAt!)).toBe(expected.observedLatencyMs[toolUseId!]);
      expect(execution.intervalScope).toBe("invocation_latency");
      expect(execution.intervalTimingEvidence).toBe("paired_timestamps");
      expect(execution.parentEventId).toBeNull(); expect(execution.turnId).toBeNull();
    }
    const ct3 = snapshot.events.find((value) => value.sessionId === side)!;
    expect(ct3).toMatchObject({ durationMs: expected.sourceDurationMs.ct3, timingEvidence: "source_reported", durationScope: "process_runtime", status: "failed", exitCode: null, errorFingerprint: null });
    expect(codes(adapter)).not.toContain("TIMING_CONFLICT");
    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0]).toMatchObject({ durationMs: expected.turnDurationOnlyMs, durationScope: "unknown", timingEvidence: "source_reported", startAt: null, endAt: null, intervalScope: "unknown" });
    expect(snapshot.turns[0]!.startAt).toBe(expected.activeTimeMs);
    expect(snapshot.usage).toHaveLength(1);
    expect(snapshot.usage[0]).toMatchObject({ finality: "trusted_final", selection: "eligible", counts: { uncachedInput: expected.tokenUsage.uncachedInput, cachedInput: expected.tokenUsage.cacheRead, cacheWriteInput: expected.tokenUsage.cacheCreate, input: expected.tokenUsage.allInput, output: expected.tokenUsage.output, total: 160 } });
    expect(snapshot.observations.filter((value) => value.representation === "usage").map((value) => value.observedUsage!.counts.output)).toEqual(expected.usageSnapshotValues);
    expect(snapshot.events.find((value) => value.id === claudeEventId(context, root, "ct1"))!.startAt).toBe("2026-09-01T00:00:00.000Z");
    expect(snapshot.events.find((value) => value.id === claudeEventId(context, root, "ct1"))!.operationKey).toBeNull();
    expect(snapshot.events.find((value) => value.id === claudeEventId(context, root, "ct2"))!.lookupRange).toBeNull();
  });
  test("ordinary raw duration and stop-shaped usage never supply trusted proof", async () => {
    const adapter = createClaudeAdapter(context);
    await feed(adapter, "claude-message.jsonl");
    const ct3 = adapter.snapshot().events.find((value) => value.sessionId === side)!;
    expect(ct3).toMatchObject({ durationMs: 3000, durationScope: "invocation_latency", timingEvidence: "paired_timestamps" });
    expect(adapter.snapshot().usage[0]).toMatchObject({ finality: "unknown", selection: "provisional", counts: { output: 10 } });
    expect(codes(adapter)).toContain("TIMING_SCOPE_UNKNOWN");
  });
  test("same-source replay and archive retain quantities without conflicting old snapshots", async () => {
    const adapter = createClaudeAdapter(context);
    await feed(adapter, "claude-message.jsonl", undefined, trusted);
    const before = adapter.snapshot();
    await feed(adapter, "claude-message.jsonl", undefined, trusted);
    expect(adapter.snapshot()).toEqual(before);
    await feed(adapter, "claude-message.jsonl", "fictitious-archive-file", trusted);
    const archived = adapter.snapshot();
    expect(archived.events).toEqual(before.events);
    expect(archived.turns).toEqual(before.turns);
    expect(archived.usage).toEqual(before.usage);
    expect(archived.stateCounts.sources).toBe(2);
    expect(archived.observations.length).toBe(before.observations.length * 2);
    expect(codes(adapter)).not.toContain("USAGE_CONFLICT");
  });
  test("only trusted copied ordinal context excludes synthetic fork contributions", async () => {
    const adapter = createClaudeAdapter(context);
    await feed(adapter, "claude-message.jsonl", undefined, trusted);
    await feed(adapter, "claude-fork.jsonl", undefined, { ownerSessionId: "synthetic-claude-fork", knownCopiedOrdinals: [2, 3] });
    const expected = oracle("claude-fork");
    expect(adapter.snapshot().events).toHaveLength(expected.executionCount);
    const fork = claudeStreamId(context, "synthetic-claude-fork");
    expect(adapter.snapshot().events.filter((value) => value.sessionId === fork)).toHaveLength(expected.newForkExecutionCount);
    expect(adapter.snapshot().observations.filter((value) => value.origin === "trusted_copied").every((value) => value.representation === "metadata" || value.representation === "provenance")).toBe(true);
    expect(adapter.snapshot().metadata.filter((value) => value.ownerRootSessionId === fork)).toHaveLength(5);
    expect(codes(adapter)).not.toContain("AMBIGUOUS_ORIGIN");
    const untrusted = createClaudeAdapter(context);
    await feed(untrusted, "claude-fork.jsonl");
    expect(codes(untrusted)).toContain("AMBIGUOUS_ORIGIN");
    expect(untrusted.snapshot().events).toHaveLength(3);
    const previous = untrusted.snapshot();
    await feed(untrusted, "claude-fork.jsonl");
    expect(untrusted.snapshot().capabilities).toEqual(previous.capabilities);
  });
});

test("invented actual-shape fixture validates multiple UUIDs, pending acknowledgements and token mapping", async () => {
  const adapter = createClaudeAdapter(context);
  await feed(adapter, shapeOracle.file);
  const snapshot = adapter.snapshot();
  const main = claudeStreamId(context, "synthetic-p3-main");
  const child = claudeStreamId(context, "synthetic-p3-main", "synthetic-side-agent");
  expect(snapshot.events).toHaveLength(shapeOracle.executions);
  expect(snapshot.events.filter((value) => value.sessionId === main)).toHaveLength(shapeOracle.rootExecutions);
  expect(snapshot.events.filter((value) => value.sessionId === child)).toHaveLength(shapeOracle.sidechainExecutions);
  for (const [status, count] of Object.entries(shapeOracle.statuses)) expect(snapshot.events.filter((value) => value.status === status)).toHaveLength(count as number);
  for (const [id, duration] of Object.entries(shapeOracle.pairedLatencyMs)) {
    const stream = id === "synthetic-p3-mcp" ? child : main;
    expect(snapshot.events.find((value) => value.id === claudeEventId(context, stream, id))).toMatchObject({ durationMs: duration, durationScope: "invocation_latency", timingEvidence: "paired_timestamps", intervalScope: "invocation_latency" });
  }
  expect(snapshot.events.filter((value) => value.status === "pending").every((value) => value.endAt === null && value.durationMs === null && value.intervalScope === "unknown")).toBe(true);
  expect(snapshot.observations.filter((value) => value.observedResult?.completionKind === "background_acknowledgement").map((value) => value.observedResult!.acknowledgementLatencyMs)).toEqual(shapeOracle.acknowledgementLatencyMs);
  expect(snapshot.turns.map((value) => value.durationMs)).toEqual(shapeOracle.turnDurationOnlyMs);
  expect(snapshot.turns.filter((value) => value.startAt !== null || value.endAt !== null)).toHaveLength(shapeOracle.turnIntervals);
  expect(snapshot.events.filter((value) => value.timingEvidence === "source_reported")).toHaveLength(shapeOracle.directToolDurations);
  expect(snapshot.usage).toHaveLength(shapeOracle.usageIds);
  expect(snapshot.observations.filter((value) => value.observedUsage !== null)).toHaveLength(shapeOracle.usageRecords);
  expect(snapshot.usage[0]).toMatchObject({ counts: shapeOracle.usage, finality: shapeOracle.finality, selection: shapeOracle.selection, terminalCandidate: true });
  expect(snapshot.messages.find((value) => value.id === snapshot.observations.find((value) => value.representation === "result")!.messageId)!.sourceToolAssistantMessageId).not.toBeNull();
  expect(snapshot.events.every((value) => value.exitCode === null && value.parentEventId === null && value.turnId === null && value.contentFingerprint === null && value.errorFingerprint === null)).toBe(true);
  expect(snapshot.capabilities.stateLimited).toBe(false);
  const retained = JSON.stringify(adapter.inspectRetainedState());
  expect(retained).not.toMatch(/FICTITIOUS_AGENTPROF_|synthetic-p3-|synthetic-block|synthetic-side-agent|synthetic-task|synthetic-2\.x|mcp__invented/);
});

test("external final proof validates the invented partial6→partial8→final10 oracle", async () => {
  const adapter = createClaudeAdapter(context);
  await feed(adapter, shapeOracle.file, undefined, shapeOracle.trustedFinalContext);
  expect(adapter.snapshot().usage[0]).toMatchObject({ counts: shapeOracle.usage, finality: "trusted_final", selection: "eligible" });
  expect(codes(adapter)).not.toContain("USAGE_CONFLICT");
});
