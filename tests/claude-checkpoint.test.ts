import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { ClaudeAdapter, createClaudeAdapter } from "../src/parsers/claude/index.js";
import type { ClaudeInputSource, ClaudeLimits } from "../src/parsers/claude/types.js";

// Frozen before codec implementation. The reference path never calls export/restore.
const secret = Buffer.alloc(32, 23), keyId = "2".repeat(32);
const context = createIdentityContext(secret, keyId);
const fileIdentity = "/FICTITIOUS_CHECKPOINT_SOURCE_SENTINEL";
const session = "FICTITIOUS_CHECKPOINT_SESSION_SENTINEL";
const rawCall = "FICTITIOUS_CHECKPOINT_CALL_SENTINEL";
const rawResponse = "FICTITIOUS_CHECKPOINT_RESPONSE_SENTINEL";
const hmac = (domain: string, ...parts: unknown[]) => `h1:${keyId}:${domain}:${createHmac("sha256", secret).update(JSON.stringify([1, 1, domain, ...parts])).digest("hex")}`;
const sourceId = hmac("source", "claude", fileIdentity);
const streamId = hmac("session", "claude", session, null);
const eventId = hmac("event", "claude", streamId, rawCall);
const usageId = hmac("event", "claude", streamId, "usage", rawResponse);
const at = (second: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, second)).toISOString();
const counts = (output: number) => ({ input_tokens: 100, output_tokens: output, cache_read_input_tokens: 30, cache_creation_input_tokens: 20 });
const call = (uuid = "u0", second = 0, id = rawCall, extra: Record<string, unknown> = {}) => ({
  type: "assistant", uuid, sessionId: session, isSidechain: false, timestamp: at(second),
  message: { id: rawResponse, role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command: "npm test FICTITIOUS_CHECKPOINT_COMMAND_SENTINEL" } }] }, ...extra,
});
const result = (uuid = "u1", second = 4, id = rawCall, extra: Record<string, unknown> = {}) => ({
  type: "user", uuid, sessionId: session, isSidechain: false, timestamp: at(second), parentUuid: "u0",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: "FICTITIOUS_CHECKPOINT_RESULT_SENTINEL" }] }, ...extra,
});
const usage = (uuid: string, output: number, second = 0) => ({
  type: "assistant", uuid, sessionId: session, isSidechain: false, timestamp: at(second),
  message: { id: rawResponse, role: "assistant", content: [], usage: counts(output) },
});
type Row = { record: unknown; source: ClaudeInputSource; end: number };
function rows(records: readonly unknown[], ordinalBase = 0): Row[] {
  let offset = 0;
  return records.map((record, index) => {
    const start = offset;
    offset += Buffer.byteLength(JSON.stringify(record) + "\n");
    return { record, source: { fileIdentity, sourceAlias: "source-1", byteOffset: start, ordinal: ordinalBase + index }, end: offset };
  });
}
function binding(input: readonly Row[], split: number, ordinalBase = 0) {
  return { sourceId, completedOffset: split === 0 ? 0 : input[split - 1]!.end, nextOrdinal: ordinalBase + split };
}
function ingest(adapter: ClaudeAdapter, input: readonly Row[]) {
  return input.map(({ record, source }) => adapter.ingest(record, source));
}
function capture(adapter: ClaudeAdapter, boundary: ReturnType<typeof binding>) {
  const exported = adapter.exportCheckpoint(boundary);
  expect(exported.status).toBe("captured");
  if (exported.status !== "captured") throw new Error("capture failed");
  expect(Buffer.byteLength(exported.checkpoint)).toBeLessThanOrEqual(4 * 1024 * 1024);
  return exported.checkpoint;
}
function restored(checkpoint: string, boundary: ReturnType<typeof binding>, limits: Partial<ClaudeLimits>) {
  const result = ClaudeAdapter.restoreCheckpoint(context, checkpoint, boundary, limits);
  expect(result.status).toBe("restored");
  if (result.status !== "restored") throw new Error("restore failed");
  return result.adapter;
}
function everySplit(input: readonly Row[], limits: Partial<ClaudeLimits> = {}, ordinalBase = 0) {
  const baseline = createClaudeAdapter(context, limits);
  const batches = ingest(baseline, input);
  for (let split = 0; split <= input.length; split++) {
    const before = createClaudeAdapter(context, limits);
    ingest(before, input.slice(0, split));
    const boundary = binding(input, split, ordinalBase);
    const checkpoint = capture(before, boundary);
    const after = restored(checkpoint, boundary, limits);
    expect(after.snapshot()).toEqual(before.snapshot());
    expect(after.inspectRetainedState()).toEqual(before.inspectRetainedState());
    expect(ingest(after, input.slice(split))).toEqual(batches.slice(split));
    expect(after.snapshot()).toEqual(baseline.snapshot());
    expect(after.inspectRetainedState()).toEqual(baseline.inspectRetainedState());
    // A second cycle is compared against the still-unserialized independent baseline.
    const end = binding(input, input.length, ordinalBase);
    const twice = restored(capture(after, end), end, limits);
    expect(twice.snapshot()).toEqual(baseline.snapshot());
    expect(twice.inspectRetainedState()).toEqual(baseline.inspectRetainedState());
  }
  return baseline;
}

describe("ordinary single-source Claude checkpoint", () => {
  it("keeps independent identities, paired duration and provisional token arithmetic at every split", () => {
    const input = rows([call(), usage("usage-6", 6, 1), usage("usage-10", 10, 2), result()]);
    const adapter = everySplit(input);
    expect(adapter.snapshot().events).toHaveLength(1);
    expect(adapter.snapshot().events[0]).toMatchObject({
      id: eventId, sessionId: streamId, status: "completed", startAt: at(0), endAt: at(4),
      durationMs: 4000, timingEvidence: "paired_timestamps", durationScope: "invocation_latency",
      intervalScope: "invocation_latency", intervalTimingEvidence: "paired_timestamps",
      contentFingerprint: null, errorFingerprint: null,
    });
    expect(adapter.snapshot().usage).toHaveLength(1);
    expect(adapter.snapshot().usage[0]).toMatchObject({
      id: usageId, finality: "unknown", selection: "provisional",
      counts: { input: 150, uncachedInput: 100, cachedInput: 30, cacheWriteInput: 20, output: 10, total: 160, reasoningOutput: null },
    });
  });

  it.each([0, 1, 7])("preserves explicit first ordinal %i, including split zero", (base) => {
    everySplit(rows([call(), result()], base), {}, base);
  });

  it("restores empty state and accepts leading physical bytes without claiming a boundary proof", () => {
    const adapter = createClaudeAdapter(context);
    const boundary = { sourceId, completedOffset: 0, nextOrdinal: 0 };
    const clone = restored(capture(adapter, boundary), boundary, {});
    const descriptor = { fileIdentity, ordinal: 0, byteOffset: 9, sourceAlias: "source-1" };
    expect(clone.ingest(call(), descriptor)).toEqual(adapter.ingest(call(), descriptor));
    expect(clone.snapshot()).toEqual(adapter.snapshot());
  });

  it("retains deferred result-before-call and semantic result replay at fresh physical positions", () => {
    const input = rows([result(), result("same-result"), call()]);
    const adapter = everySplit(input);
    expect(adapter.snapshot().events[0]).toMatchObject({ id: eventId, durationMs: 4000, status: "completed" });
    expect(adapter.snapshot().stateCounts.deferredResults).toBe(0);
    expect(adapter.snapshot().stateCounts.resultReplays).toBe(1);
  });

  it("retains a pending call and still-unmatched deferred result without invented references", () => {
    everySplit(rows([call(), result("unmatched", 4, "future-call")]));
  });

  it("keeps usage UUID replay sets, latest ordering and conflict evidence", () => {
    const six = usage("six", 6, 1), ten = usage("ten", 10, 2);
    const adapter = everySplit(rows([six, ten, six, call(), call(), result(), result()]));
    expect(adapter.snapshot().usage[0]).toMatchObject({ selection: "provisional", counts: { output: 10, total: 160 } });
    expect(adapter.snapshot().stateCounts.uuidReplays).toBe(4);
  });

  it("retains background acknowledgement pending semantics and ordinary duration-only turns", () => {
    const backgroundCall = call("bg", 0, rawCall, { message: { id: rawResponse, role: "assistant", content: [{ type: "tool_use", id: rawCall, name: "Bash", input: { command: "npm test", run_in_background: true } }] } });
    const ack = result("ack", 4, rawCall, { toolUseResult: { backgroundTaskId: "FICTITIOUS_BACKGROUND_ID" } });
    const turn = { type: "system", subtype: "turn_duration", uuid: "turn", sessionId: session, timestamp: at(9), durationMs: 9000 };
    const adapter = everySplit(rows([backgroundCall, ack, turn]));
    expect(adapter.snapshot().events[0]).toMatchObject({ status: "pending", endAt: null, durationMs: null });
    expect(adapter.snapshot().turns[0]).toMatchObject({ durationMs: 9000, timingEvidence: "source_reported", durationScope: "unknown", startAt: null, endAt: null });
  });

  it("keeps contradictory result/message, ambiguous stream and invalid timing state", () => {
    const bad = result("bad", 4, rawCall, { message: { role: "user", content: [{ type: "tool_result", tool_use_id: rawCall, is_error: true, content: "different" }] } });
    everySplit(rows([call(), result(), bad, call("u0", 2, rawCall, { cwd: "/FICTITIOUS_NEW_PROJECT" }), call("foreign", 9, "foreign", { sessionId: "different-session" })]));
    everySplit(rows([call("late", 9), result("early", 2)]));
  });

  it("counts valid descriptors for primitive/null/array malformed records even with no source map", () => {
    const adapter = everySplit(rows([null, 7, [], call(), result()]));
    expect(adapter.snapshot().diagnostics.some(value => value.code === "INVALID_RECORD")).toBe(true);
    everySplit(rows([null, 7, []]));
  });

  it("preserves sidechains, missing IDs, truncated result state and unsupported observations", () => {
    const side = { sessionId: session, isSidechain: true, agentId: "side-agent" };
    everySplit(rows([
      { type: "unsupported", sessionId: session },
      { type: "assistant", message: { content: [] } },
      call("side", 0, rawCall, side),
      result("side-result", 4, rawCall, { ...side, message: { role: "user", content: [{ type: "tool_result", tool_use_id: rawCall, is_error: false, truncated: true, content: "truncated" }] } }),
    ]));
  });

  it.each([
    { events: 1 }, { streams: 1 }, { messageLinks: 1 }, { deferredResults: 1 },
    { resultReplays: 1 }, { usage: 1, usageOrders: 1 }, { observations: 1 },
    { metadata: 1 }, { diagnostics: 1 }, { turns: 1 },
  ] satisfies Partial<ClaudeLimits>[])("preserves exact bounded state and dropped diagnostics under %j", (limits) => {
    everySplit(rows([
      null, call(), call("second", 1, "second"), usage("six", 6), usage("ten", 10),
      result("future-1", 4, "future-1"), result("future-2", 5, "future-2"), result(),
      call("other-session", 6, "other", { sessionId: "other-session" }),
      { type: "system", subtype: "turn_duration", uuid: "turn-a", sessionId: session, durationMs: 1 },
      { type: "system", subtype: "turn_duration", uuid: "turn-b", sessionId: session, durationMs: 2 },
    ]), limits);
  });

  it.each(["claude-fork.jsonl", "claude-message.jsonl", "claude-real-shapes.jsonl"])("matches every ordinary fixture split of %s", async filename => {
    const bytes = await readFile(new URL(`./fixtures/providers/${filename}`, import.meta.url));
    const records = bytes.toString("utf8").trimEnd().split("\n").map(line => JSON.parse(line));
    const input = rows(records);
    // The original immutable fixture bytes are tested separately; no trusted annotations are supplied.
    everySplit(input);
    expect(await readFile(new URL(`./fixtures/providers/${filename}`, import.meta.url))).toEqual(bytes);
  });

  it("contains none of the raw synthetic path/command/body/identifier sentinels", () => {
    const input = rows([call(), usage("usage", 10), result()]);
    const adapter = createClaudeAdapter(context);
    ingest(adapter, input);
    const checkpoint = capture(adapter, binding(input, input.length));
    for (const sentinel of [fileIdentity, session, rawCall, rawResponse, "FICTITIOUS_CHECKPOINT_COMMAND_SENTINEL", "FICTITIOUS_CHECKPOINT_RESULT_SENTINEL"]) expect(checkpoint).not.toContain(sentinel);
  });

  it("does not modify parsing on export budget failure", () => {
    const input = rows([call(), result()]);
    const adapter = createClaudeAdapter(context), baseline = createClaudeAdapter(context);
    ingest(adapter, input.slice(0, 1)); ingest(baseline, input.slice(0, 1));
    const before = adapter.inspectRetainedState();
    expect(adapter.exportCheckpoint(binding(input, 1), { maxBytes: 1 })).toEqual({ status: "unavailable", reason: "checkpoint_budget" });
    expect(adapter.inspectRetainedState()).toEqual(before);
    expect(ingest(adapter, input.slice(1))).toEqual(ingest(baseline, input.slice(1)));
    expect(adapter.snapshot()).toEqual(baseline.snapshot());
  });

  it.each(["turn", "usage"] as const)("truthfully refuses non-round-trippable negative zero in %s", kind => {
    const record = kind === "turn"
      ? { type: "system", subtype: "turn_duration", uuid: "negative-zero", sessionId: session, durationMs: -0 }
      : usage("negative-zero", -0);
    const input = rows([record]), adapter = createClaudeAdapter(context);
    ingest(adapter, input);
    const value = kind === "turn" ? adapter.snapshot().turns[0]!.durationMs : adapter.snapshot().usage[0]!.counts!.output;
    expect(Object.is(value, -0)).toBe(true);
    const before = adapter.inspectRetainedState(), end = binding(input, 1), exported = adapter.exportCheckpoint(end);
    if (exported.status === "captured") {
      const clone = restored(exported.checkpoint, end, {});
      const roundTrip = kind === "turn" ? clone.snapshot().turns[0]!.durationMs : clone.snapshot().usage[0]!.counts!.output;
      // This fails on the pre-fix candidate: its captured token silently changes -0 to +0.
      expect(Object.is(roundTrip, -0)).toBe(true);
    }
    expect(exported).toEqual({ status: "unavailable", reason: "unsupported_state" });
    expect(adapter.inspectRetainedState()).toEqual(before);
    expect(Object.is(kind === "turn" ? adapter.snapshot().turns[0]!.durationMs : adapter.snapshot().usage[0]!.counts!.output, -0)).toBe(true);
  });

  it("captures ordinary positive-zero turn and usage values losslessly", () => {
    const adapter = everySplit(rows([{ type: "system", subtype: "turn_duration", uuid: "zero-turn", sessionId: session, durationMs: 0 }, usage("zero-usage", 0)]));
    expect(Object.is(adapter.snapshot().turns[0]!.durationMs, 0)).toBe(true);
    expect(Object.is(adapter.snapshot().usage[0]!.counts!.output, 0)).toBe(true);
  });

  it("captures a legitimate state just below 4MiB and preserves parsing above the ceiling", () => {
    const maximum = 4 * 1024 * 1024, input: Row[] = [];
    const adapter = createClaudeAdapter(context);
    let offset = 0, lastGood: { checkpoint: string; count: number } | null = null;
    for (let i = 0; i < 2048; i++) {
      const record = call(`large-uuid-${i}`, 0, `large-call-${i}`), start = offset;
      offset += Buffer.byteLength(JSON.stringify(record) + "\n");
      const row = { record, source: { fileIdentity, ordinal: i, byteOffset: start, sourceAlias: "source-1" }, end: offset };
      input.push(row); adapter.ingest(row.record, row.source);
      if ((i + 1) % 32 !== 0) continue;
      const exported = adapter.exportCheckpoint(binding(input, input.length));
      if (exported.status === "captured") lastGood = { checkpoint: exported.checkpoint, count: input.length };
      else { expect(exported.reason).toBe("checkpoint_budget"); break; }
    }
    expect(lastGood).not.toBeNull();
    if (!lastGood) throw new Error("missing valid large state");
    expect(adapter.snapshot().capabilities.stateLimited).toBe(false);
    expect(lastGood.count).toBeLessThan(input.length);
    const growing = restored(lastGood.checkpoint, binding(input, lastGood.count), {});
    let justBelow = lastGood, nextCount = lastGood.count;
    for (const row of input.slice(lastGood.count)) {
      growing.ingest(row.record, row.source); nextCount++;
      const exported = growing.exportCheckpoint(binding(input, nextCount));
      if (exported.status === "captured") justBelow = { checkpoint: exported.checkpoint, count: nextCount };
      else { expect(exported.reason).toBe("checkpoint_budget"); break; }
    }
    const bytes = Buffer.byteLength(justBelow.checkpoint);
    expect(bytes).toBeLessThanOrEqual(maximum);
    expect(bytes).toBeGreaterThan(maximum - 65536);
    const boundary = binding(input, justBelow.count), below = restored(justBelow.checkpoint, boundary, {});
    expect(below.exportCheckpoint(boundary, { maxBytes: bytes }).status).toBe("captured");
    expect(below.exportCheckpoint(boundary, { maxBytes: bytes - 1 })).toEqual({ status: "unavailable", reason: "checkpoint_budget" });
    const before = growing.inspectRetainedState();
    expect(growing.exportCheckpoint(binding(input, nextCount))).toEqual({ status: "unavailable", reason: "checkpoint_budget" });
    expect(growing.inspectRetainedState()).toEqual(before);
    const end = input[nextCount - 1]!.end;
    growing.ingest(result("large-terminal", 4, "large-call-0"), { fileIdentity, ordinal: nextCount, byteOffset: end });
    expect(growing.snapshot().events[0]).toMatchObject({ status: "completed", durationMs: 4000 });
    expect(growing.snapshot().capabilities.stateLimited).toBe(false);
  }, 120000);
});
