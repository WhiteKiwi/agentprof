import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { CodexAdapter, createCodexAdapter } from "../src/parsers/codex/index.js";
import type { CodexInputSource, CodexLimits } from "../src/parsers/types.js";

// Pre-implementation acceptance tests. Independent tests never invoke the codec.
// Source freeze and actual baseline/missing-API receipts are recorded separately.
const secret = Buffer.alloc(32, 37), keyId = "7".repeat(32);
const context = createIdentityContext(secret, keyId);
const fileIdentity = "/FICTITIOUS_CODEX_CHECKPOINT_SOURCE";
const rawSession = "FICTITIOUS_CODEX_CHECKPOINT_SESSION";
const hmac = (domain: string, ...parts: unknown[]) => `h1:${keyId}:${domain}:${createHmac("sha256", secret).update(JSON.stringify([1, 1, domain, ...parts])).digest("hex")}`;
const sourceId = hmac("source", "codex", fileIdentity), streamId = hmac("session", "codex", rawSession);
const eventId = hmac("event", "codex", streamId, "call");
const at = (seconds: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, seconds)).toISOString();
const counts = (input = 100, output = 10) => ({ input_tokens: input, output_tokens: output, cached_input_tokens: 20, cache_write_input_tokens: 5, reasoning_output_tokens: 2, total_tokens: input + output });
const meta = (extra: Record<string, unknown> = {}) => ({ type: "session_meta", payload: { id: rawSession, cli_version: "0.159.0", cwd: "/FICTITIOUS_PROJECT", ...extra } });
const call = (name = "exec_command", id = "call", args: unknown = { cmd: "rg target FICTITIOUS_COMMAND", workdir: "/FICTITIOUS_PROJECT" }) => ({ type: "response_item", timestamp: at(0), payload: { type: "function_call", call_id: id, name, arguments: JSON.stringify(args) } });
const result = (id = "call", second = 4, output: unknown = { exit_code: 1, output: "FICTITIOUS_OUTPUT" }) => ({ type: "response_item", timestamp: at(second), payload: { type: "function_call_output", call_id: id, output } });
const usage = (response = "r1", input = 100, output = 10, second = 5, cumulative?: unknown) => ({ type: "token_usage_record", timestamp: at(second), payload: { thread_id: rawSession, turn_id: "t1", response_id: response, usage: counts(input, output), ...(cumulative === undefined ? {} : { thread_token_usage: cumulative }) } });
const turn = (id: string, completed = false, extra: Record<string, unknown> = {}) => ({ type: "event_msg", timestamp: at(completed ? 4 : 0), payload: { type: completed ? "task_complete" : "task_started", turn_id: id, ...(completed ? { started_at: 1788220800, completed_at: 1788220804, duration_ms: 3500 } : {}), ...extra } });
const structured = (id = "call", extra: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) => ({ type: "event_msg", timestamp: at(5), payload: { type: "item_completed", started_at_ms: Date.parse(at(0)), completed_at_ms: Date.parse(at(5)), item: { type: "CommandExecution", id, command: "rg target", source: "unified_exec_startup", status: "completed", exit_code: 0, duration: { secs: 2, nanos: 250000000 }, output: "FICTITIOUS_OUTPUT", ...extra }, ...payload } });
const tokenSnapshot = (second: number, input: number, output: number, last = false) => ({ type: "event_msg", timestamp: at(second), payload: { type: "token_count", info: { [last ? "last_token_usage" : "total_token_usage"]: counts(input, output) } } });
type Row = { record: unknown; source: CodexInputSource; end: number };
function rows(records: readonly unknown[], ordinalBase = 0, startOffset = 0): Row[] {
  let offset = startOffset;
  return records.map((record, i) => { const start = offset; offset += Buffer.byteLength(JSON.stringify(record) + "\n"); return { record, source: { fileIdentity, sourceAlias: "source-1", byteOffset: start, ordinal: ordinalBase + i }, end: offset }; });
}
const boundary = (input: readonly Row[], split: number, ordinalBase = 0) => ({ sourceId, completedOffset: split ? input[split - 1]!.end : 0, nextOrdinal: ordinalBase + split });
const ingest = (adapter: CodexAdapter, input: readonly Row[]) => input.map(row => adapter.ingest(row.record, row.source));
function capture(adapter: CodexAdapter, binding: ReturnType<typeof boundary>) {
  const value = adapter.exportCheckpoint(binding);
  expect(value.status).toBe("captured");
  if (value.status !== "captured") throw Error("capture failed");
  return value.checkpoint;
}
function restore(token: string, binding: ReturnType<typeof boundary>, limits: Partial<CodexLimits>) {
  const value = CodexAdapter.restoreCheckpoint(context, token, binding, limits);
  expect(value.status).toBe("restored");
  if (value.status !== "restored") throw Error("restore failed");
  return value.adapter;
}
function everySplit(input: readonly Row[], limits: Partial<CodexLimits> = {}, ordinalBase = 0) {
  const baseline = createCodexAdapter(context, limits), batches = ingest(baseline, input);
  const post = rows([call("exec_command", "second-cycle", { cmd: "rg second" }), result("second-cycle", 9)], ordinalBase + input.length, input.at(-1)?.end ?? 0);
  const postReference = createCodexAdapter(context, limits); ingest(postReference, input);
  const postBatches = ingest(postReference, post);
  for (let split = 0; split <= input.length; split++) {
    const prefix = createCodexAdapter(context, limits); ingest(prefix, input.slice(0, split));
    const binding = boundary(input, split, ordinalBase), token = capture(prefix, binding);
    expect(Buffer.byteLength(token)).toBeLessThanOrEqual(4 * 1024 * 1024);
    for (const sentinel of [fileIdentity, rawSession, "FICTITIOUS_COMMAND", "FICTITIOUS_OUTPUT", "FICTITIOUS_PROJECT"]) expect(token).not.toContain(sentinel);
    const suffix = restore(token, binding, limits);
    expect(suffix.snapshot()).toEqual(prefix.snapshot());
    expect(suffix.inspectRetainedState()).toEqual(prefix.inspectRetainedState());
    expect(ingest(suffix, input.slice(split))).toEqual(batches.slice(split));
    expect(suffix.snapshot()).toEqual(baseline.snapshot());
    expect(suffix.inspectRetainedState()).toEqual(baseline.inspectRetainedState());
    const finalBinding = boundary(input, input.length, ordinalBase);
    const twice = restore(capture(suffix, finalBinding), finalBinding, limits);
    expect(twice.snapshot()).toEqual(baseline.snapshot());
    expect(twice.inspectRetainedState()).toEqual(baseline.inspectRetainedState());
    expect(ingest(twice, post)).toEqual(postBatches);
    expect(twice.snapshot()).toEqual(postReference.snapshot());
    expect(twice.inspectRetainedState()).toEqual(postReference.inspectRetainedState());
  }
  return baseline;
}


const capCases: Array<{ name: string; records: unknown[]; limits: Partial<CodexLimits>; counter: keyof ReturnType<CodexAdapter["snapshot"]>["stateCounts"] }> = [
  { name: "events", records: [meta(), call(), call("exec_command", "B")], limits: { events: 1 }, counter: "events" },
  { name: "wrappers", records: [meta(), call("exec", "A"), call("exec", "B")], limits: { events: 1 }, counter: "wrappers" },
  { name: "unsupported calls", records: [meta(), call("unknown", "A"), call("unknown", "B")], limits: { events: 1 }, counter: "unsupportedCalls" },
  { name: "deferred results", records: [meta(), result("A"), result("B")], limits: { events: 1 }, counter: "pendingResults" },
  { name: "turns", records: [meta(), turn("A"), turn("B")], limits: { turns: 1 }, counter: "turns" },
  { name: "usage", records: [meta(), usage("A"), usage("B")], limits: { usage: 1 }, counter: "usage" },
  { name: "streams", records: [meta(), { ...usage(), payload: { ...usage().payload, thread_id: "other-stream" } }], limits: { streams: 1 }, counter: "streams" },
  { name: "poll links", records: [meta(), call("write_stdin", "A", { session_id: 1, chars: "" }), call("write_stdin", "B", { session_id: 2, chars: "" })], limits: { links: 1 }, counter: "pollLinks" },
  { name: "process links", records: [meta(), call(), result("call", 1, { running: true, session_id: 1 }), call("exec_command", "B"), result("B", 2, { running: true, session_id: 2 })], limits: { links: 1 }, counter: "processLinks" },
  { name: "observations", records: [meta(), call()], limits: { observations: 1 }, counter: "observations" },
  { name: "result replays", records: [meta(), result("A"), result("B")], limits: { observations: 1 }, counter: "resultReplays" },
  { name: "metadata", records: [meta(), meta()], limits: { metadata: 1 }, counter: "metadata" },
  { name: "diagnostics and drops", records: [meta(), { type: "unknown", payload: {} }, { type: "other", payload: {} }], limits: { diagnostics: 1 }, counter: "diagnostics" },
];

describe("independent ordinary Codex oracle on unchanged main", () => {
  it("uses native terminal evidence once without adding cumulative observations", () => {
    const adapter = createCodexAdapter(context); ingest(adapter, rows([meta(), call(), result(), usage("r1", 100, 10, 5, counts(200, 20))]));
    const snapshot = adapter.snapshot();
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]).toMatchObject({ id: eventId, sessionId: streamId, status: "completed", executionOutcome: "no_match", exitCode: 1, durationMs: 4000, durationScope: "invocation_latency", timingEvidence: "paired_timestamps", contentFingerprint: null });
    const responseId = hmac("event", "codex", streamId, "response", "r1");
    expect(snapshot.usage).toHaveLength(2);
    expect(snapshot.usage[0]).toMatchObject({ id: hmac("event", "codex_usage", streamId, "response_usage", null, responseId), responseId, scope: "response_increment", finality: "source_terminal", selection: "eligible", counts: { input: 100, output: 10, total: 110, cachedInput: 20, cacheWriteInput: 5, reasoningOutput: 2 } });
    expect(snapshot.usage[1]).toMatchObject({ scope: "thread_cumulative", finality: "unknown", selection: "snapshot_only", counts: { total: 220 } });
    expect(snapshot.stateCounts.usageOrders).toBe(0);
    expect(snapshot.stateCounts.snapshotSeries).toBe(1);
  });
  it("diagnoses cumulative reset and timestamp reorder but not last-response decrease", () => {
    const adapter = createCodexAdapter(context); ingest(adapter, rows([meta(), tokenSnapshot(1, 100, 10), tokenSnapshot(2, 150, 15), tokenSnapshot(3, 80, 8), tokenSnapshot(2, 70, 7), tokenSnapshot(4, 100, 10, true), tokenSnapshot(5, 50, 5, true)]));
    expect(adapter.snapshot().diagnostics.map(d => d.code)).toEqual(["USAGE_RESET", "REORDERED_RECORD"]);
    expect(adapter.snapshot().stateCounts.snapshotSeries).toBe(1);
    expect(adapter.snapshot().usage.every(u => u.selection === "snapshot_only")).toBe(true);
    expect(adapter.snapshot().usage.map(u => u.counts!.total)).toEqual([110, 165, 88, 77, 110, 55]);
  });
  it("has all claimed ordinary cap witnesses before checkpoint implementation", () => {
    for (const { records, limits, counter } of capCases) {
      const adapter = createCodexAdapter(context, limits); ingest(adapter, rows(records));
      expect(adapter.snapshot().capabilities.stateLimited).toBe(true);
      expect(adapter.snapshot().stateCounts[counter]).toBe(1);
    }
  });
  it("retains structured scopes and turn elapsed separately from wall intervals", () => {
    const adapter = createCodexAdapter(context); ingest(adapter, rows([meta(), call(), result(), structured(), turn("t", true)]));
    expect(adapter.snapshot().events[0]).toMatchObject({ id: eventId, status: "completed", durationMs: 2250, durationScope: "process_runtime", timingEvidence: "source_reported", startAt: at(0), endAt: at(5), intervalScope: "item_lifecycle", intervalTimingEvidence: "source_reported" });
    expect(adapter.snapshot().turns[0]).toMatchObject({ durationMs: 3500, durationScope: "turn_elapsed", intervalScope: "turn_wall", startAt: at(0), endAt: at(4) });
  });
  it("proves three non-disjoint reachable maps and later process resolution", () => {
    const adapter = createCodexAdapter(context); ingest(adapter, rows([meta(), call(), call("write_stdin", "call", { session_id: 321, chars: "" }), result()]));
    expect(adapter.snapshot().stateCounts).toMatchObject({ events: 1, pollLinks: 1, pendingResults: 1 });
    const before = adapter.snapshot().events[0];
    const suffix = rows([call("exec_command", "launch", { cmd: "rg other" }), result("launch", 1, { running: true, session_id: 321 })], 4, 5000); ingest(adapter, suffix);
    expect(adapter.snapshot().stateCounts.pendingResults).toBe(0);
    expect(adapter.snapshot().events.find(e => e.id === before!.id)).toEqual(before);
    expect(adapter.snapshot().events.find(e => e.id !== before!.id)).toMatchObject({ status: "completed", executionOutcome: "no_match", durationMs: 4000 });
    for (const [name, counter] of [["unknown", "unsupportedCalls"], ["exec", "wrappers"]] as const) {
      const other = createCodexAdapter(context); ingest(other, rows([meta(), call(), call(name)]));
      expect(other.snapshot().stateCounts.events).toBe(1); expect(other.snapshot().stateCounts[counter]).toBe(1);
    }
  });
  it("emits expanded-year UTC and retains positive and negative numeric zero distinctly", () => {
    const adapter = createCodexAdapter(context); const time = Date.parse("+010000-01-01T00:00:00.000Z");
    ingest(adapter, rows([meta(), structured("wide", {}, { started_at_ms: time, completed_at_ms: time + 5000 }), turn("zero", true, { duration_ms: -0 })]));
    expect(adapter.snapshot().events[0]!.startAt).toBe("+010000-01-01T00:00:00.000Z");
    expect(Object.is(adapter.snapshot().turns[0]!.durationMs, -0)).toBe(true);
  });
  it("retains large safe repeated-flag patterns used by positive budget tests", () => {
    const adapter = createCodexAdapter(context); ingest(adapter, rows([meta(), call("exec_command", "large", { cmd: "rg " + "-n ".repeat(18000) })]));
    expect(adapter.snapshot().events[0]!.commandPattern).toBe("rg " + "-n ".repeat(18000).trimEnd());
    expect(adapter.snapshot().capabilities.stateLimited).toBe(false);
  });
});

describe("ordinary Codex checkpoint continuation", () => {
  it.each([0, 1, 7])("preserves all split positions with ordinal origin %i", origin => { everySplit(rows([meta(), call(), result(), usage()], origin), {}, origin); });
  it("preserves replay, native response conflict and historical ordinary finality", () => {
    const adapter = everySplit(rows([meta(), usage(), usage(), usage("r1", 100, 11), meta({ forked_from_id: "parent" }), usage("r2")]));
    expect(adapter.snapshot().usage[0]).toMatchObject({ selection: "conflicted", counts: null, finality: "source_terminal" });
    expect(adapter.snapshot().usage[1]).toMatchObject({ selection: "provisional", finality: "unknown" });
  });
  it("preserves cumulative reset, reorder and null-time boundaries", () => {
    everySplit(rows([meta(), tokenSnapshot(1, 100, 10), tokenSnapshot(2, 150, 15), tokenSnapshot(3, 80, 8), tokenSnapshot(2, 70, 7), { ...tokenSnapshot(4, 50, 5), timestamp: null }, tokenSnapshot(5, 40, 4)]));
  });
  it("preserves output-before-call and poll-before-process private links", () => {
    everySplit(rows([meta(), result(), call(), result("poll", 6, { exit_code: 0, output: "FICTITIOUS_OUTPUT" }), call("write_stdin", "poll", { session_id: 123, chars: "" }), call("exec_command", "launch", { cmd: "npm test" }), result("launch", 1, { session_id: 123, running: true, output: "FICTITIOUS_OUTPUT" })]));
  });
  it("preserves process ambiguity, unsupported calls and ordinary wrapper representations", () => {
    everySplit(rows([meta(), call(), result("call", 1, { session_id: 123, running: true }), call("exec_command", "other", { cmd: "npm test" }), result("other", 2, { session_id: 123, running: true }), call("write_stdin", "poll", { session_id: 123, chars: "" }), result("poll"), call("unknown", "unsupported", {}), result("unsupported"), call("exec", "wrapper", {}), result("wrapper")]));
  });
  it("preserves overlapping execution, poll and pending maps then resolves the missing process", () => {
    everySplit(rows([meta(), call(), call("write_stdin", "call", { session_id: 321, chars: "" }), result(), call("exec_command", "launch", { cmd: "rg other" }), result("launch", 1, { running: true, session_id: 321 })]));
  });
  it.each(["unknown", "exec"])("preserves existing event overlap after %s representation", name => {
    everySplit(rows([meta(), call(), call(name), result(), structured()]));
  });
  it("preserves structured priority and conflicts without merging timing scopes", () => {
    everySplit(rows([meta(), call(), result(), structured(), structured("call", { duration: { secs: 3, nanos: 0 } }), call(), result()]));
  });
  it("preserves turn direct and mixed-boundary evidence including replay conflicts", () => {
    everySplit(rows([meta(), turn("a"), turn("a", true), turn("a", true, { duration_ms: 3600 }), turn("b", true, { started_at: undefined }), turn("c", true, { completed_at: -1 }), { type: "turn_context", payload: { turn_id: "no-turn-row" } }]));
  });
  it("preserves expanded-year explicit timestamps and positive zero", () => {
    const time = Date.parse("+010000-01-01T00:00:00.000Z");
    everySplit(rows([meta(), structured("wide", {}, { started_at_ms: time, completed_at_ms: time + 5000 }), turn("zero", true, { duration_ms: 0 })]));
  });
  it("preserves earlier ordinary native finality after later ambiguous metadata", () => {
    const adapter = everySplit(rows([meta(), usage("ordinary"), meta({ forked_from_id: "parent" }), usage("later")]));
    expect(adapter.snapshot().usage[0]).toMatchObject({ finality: "source_terminal", selection: "eligible" });
    expect(adapter.snapshot().usage[1]).toMatchObject({ finality: "unknown", selection: "provisional" });
  });
  it("preserves unknown mapping, partial and invalid token components", () => {
    everySplit(rows([meta({ cli_version: "unverified" }), usage(), { ...usage("missing"), payload: { ...usage("missing").payload, usage: { output_tokens: 10 } } }, { ...usage("bad"), payload: { ...usage("bad").payload, usage: { input_tokens: -1, output_tokens: 10 } } }, { ...usage("other"), type: "event_msg", payload: { ...usage("other").payload, type: "token_usage_record" } }]));
  });
  it("preserves legitimate dangling owner/active-turn/observation links under limits", () => {
    everySplit(rows([{ ...usage(), payload: { ...usage().payload, thread_id: "early-other-stream" } }, meta(), turn("owner-turn")]), { streams: 1 });
    everySplit(rows([meta(), { type: "turn_context", payload: { turn_id: "context-only" } }, call(), call("unknown", "missing-event"), result("missing-event")]), { events: 1, turns: 1 });
  });
  it("tracks valid source positions even for records rejected before source admission", () => { everySplit(rows([null, [], 7, {}, meta(), call(), result()])); });
  it.each(capCases)("preserves a witnessed cap hit: $name", ({ records, limits, counter }) => {
    const adapter = everySplit(rows(records), limits);
    expect(adapter.snapshot().capabilities.stateLimited).toBe(true);
    expect(adapter.snapshot().stateCounts[counter]).toBe(1);
  });
  it("preserves live source-cap behavior while disabling capture for a second physical source", () => {
    const limits = { sources: 1 }, initial = rows([meta()]);
    const baseline = createCodexAdapter(context, limits); ingest(baseline, initial);
    const checkpointed = restore(capture(baseline, boundary(initial, 1)), boundary(initial, 1), limits);
    expect(checkpointed.inspectRetainedState()).toEqual(baseline.inspectRetainedState());
    const other = { fileIdentity: "other-physical-source", ordinal: 0, byteOffset: 0 };
    expect(checkpointed.ingest(meta(), other)).toEqual(baseline.ingest(meta(), other));
    expect(checkpointed.snapshot().capabilities.stateLimited).toBe(true);
    expect(checkpointed.exportCheckpoint(boundary(initial, 1))).toEqual({ status: "unavailable", reason: "unsupported_state" });
    expect(checkpointed.inspectRetainedState()).toEqual(baseline.inspectRetainedState());
  });
  it.each(["codex-archive", "codex-fork", "codex-legacy", "codex-pending-append", "codex-real-shapes", "codex-structured", "codex-usage-replay"])("continues every ordinary immutable fixture split: %s", async name => {
    const text = await readFile(new URL(`./fixtures/providers/${name}.jsonl`, import.meta.url), "utf8");
    const input: Row[] = []; let offset = 0, ordinal = 0;
    for (const line of text.split(/(?<=\n)/)) { const start = offset; offset += Buffer.byteLength(line); if (!line.trim()) continue; input.push({ record: JSON.parse(line), source: { fileIdentity, sourceAlias: "source-1", byteOffset: start, ordinal: ordinal++ }, end: offset }); }
    everySplit(input);
  });
  it("restores genuine near-4-MiB state and keeps parsing after aggregate budget refusal", () => {
    const records: unknown[] = [meta(), ...Array.from({ length: 65 }, (_, i) => call("exec_command", `budget-${i}`, { cmd: "rg " + "-n ".repeat(18000) }))];
    let input = rows(records), adapter = createCodexAdapter(context); ingest(adapter, input);
    let previousToken = capture(adapter, boundary(input, input.length)), previousInput = input;
    let crossed = false;
    for (let i = 65; i < 90; i++) {
      const next = rows([call("exec_command", `budget-${i}`, { cmd: "rg " + "-n ".repeat(18000) })], input.length, input.at(-1)!.end);
      ingest(adapter, next); input = [...input, ...next];
      const exported = adapter.exportCheckpoint(boundary(input, input.length));
      if (exported.status === "captured") { previousToken = exported.checkpoint; previousInput = input; continue; }
      expect(exported).toEqual({ status: "unavailable", reason: "checkpoint_budget" }); crossed = true;
      const bytes = Buffer.byteLength(previousToken); expect(bytes).toBeGreaterThan(4 * 1024 * 1024 - 65536);
      const restored = restore(previousToken, boundary(previousInput, previousInput.length), {});
      expect(restored.exportCheckpoint(boundary(previousInput, previousInput.length), { maxBytes: bytes }).status).toBe("captured");
      expect(restored.exportCheckpoint(boundary(previousInput, previousInput.length), { maxBytes: bytes - 1 })).toEqual({ status: "unavailable", reason: "checkpoint_budget" });
      ingest(restored, next); expect(restored.inspectRetainedState()).toEqual(adapter.inspectRetainedState());
      const terminal = rows([result("budget-0")], input.length, input.at(-1)!.end);
      expect(ingest(adapter, terminal)).toEqual(ingest(restored, terminal));
      expect(adapter.snapshot().events[0]).toMatchObject({ status: "completed", executionOutcome: "no_match", durationMs: 4000 });
      expect(adapter.snapshot().capabilities.stateLimited).toBe(false); break;
    }
    expect(crossed).toBe(true);
  }, 120000);
  it("distinguishes a per-row budget refusal and preserves live parsing", () => {
    const input = rows([meta(), call("exec_command", "row-budget", { cmd: "rg " + "-n ".repeat(24000) })]);
    const adapter = createCodexAdapter(context), baseline = createCodexAdapter(context); ingest(adapter, input); ingest(baseline, input);
    expect(adapter.snapshot().events[0]!.commandPattern!.length).toBeGreaterThan(65536);
    expect(adapter.exportCheckpoint(boundary(input, input.length))).toEqual({ status: "unavailable", reason: "checkpoint_budget" });
    const tail = rows([result("row-budget")], input.length, input.at(-1)!.end);
    expect(ingest(adapter, tail)).toEqual(ingest(baseline, tail)); expect(adapter.inspectRetainedState()).toEqual(baseline.inspectRetainedState());
  });
});
