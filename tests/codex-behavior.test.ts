import { describe, expect, test } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { codexEventId, codexStreamId, createCodexAdapter } from "../src/parsers/codex/index.js";
import type { CodexLimits, TrustedFixtureContext } from "../src/parsers/types.js";

const context = createIdentityContext(new Uint8Array(32).fill(23), "2".repeat(32));
const epoch = 1788307200000;
const timestamp = (seconds: number) => new Date(epoch + seconds * 1000).toISOString();
const stream = codexStreamId(context, "synthetic-behavior-stream");
const id = (value: string) => codexEventId(context, stream, value);
function harness(limits: Partial<CodexLimits> = {}, version = "0.159.0", extraMetadata: Record<string, unknown> = {}) {
  const adapter = createCodexAdapter(context, limits);
  let ordinal = 0;
  let offset = 0;
  const push = (payload: unknown, type = "event_msg", seconds = ordinal, trustedFixtureContext?: TrustedFixtureContext) => {
    const record = { timestamp: timestamp(seconds), type, payload };
    const value = adapter.ingest(record, { fileIdentity: "synthetic-source", sourceAlias: "source-1", byteOffset: offset, ordinal, ...(trustedFixtureContext ? { trustedFixtureContext } : {}) });
    offset += Buffer.byteLength(JSON.stringify(record)) + 1;
    ordinal++;
    return value;
  };
  push({ id: "synthetic-behavior-stream", cli_version: version, cwd: "/FICTITIOUS_AGENTPROF_BEHAVIOR_PROJECT", ...extraMetadata }, "session_meta", 0);
  const call = (call_id: string, cmd: unknown, seconds: number, extra: Record<string, unknown> = {}) => push({ type: "function_call", call_id, name: "exec_command", arguments: JSON.stringify({ cmd, ...extra }) }, "response_item", seconds);
  const result = (call_id: string, output: unknown, seconds: number, trusted?: TrustedFixtureContext) => push({ type: "function_call_output", call_id, output }, "response_item", seconds, trusted);
  const item = (rawId: string, command: unknown, seconds: number, overrides: Record<string, unknown> = {}, boundaries: Record<string, unknown> = {}) => push({ type: "item_completed", thread_id: "synthetic-behavior-stream", turn_id: "synthetic-turn", started_at_ms: epoch, completed_at_ms: epoch + seconds * 1000, item: { type: "CommandExecution", id: rawId, source: "unified_exec_startup", command, status: "completed", exit_code: 0, duration: { secs: seconds, nanos: 0 }, ...overrides }, ...boundaries }, "event_msg", seconds);
  const event = (rawId: string) => adapter.snapshot().events.find((event) => event.id === id(rawId))!;
  return { adapter, push, call, result, item, event, nextOrdinal: () => ordinal };
}

describe("Codex execution identity, inert commands and status evidence", () => {
  test("same commands with independent IDs remain distinct; same-ID structured output wins", () => {
    const h = harness();
    h.call("one", "npm test target", 0);
    h.result("one", { exit_code: 0, output: "FICTITIOUS_AGENTPROF_OUTPUT" }, 10);
    h.item("one", "npm test target", 10, { duration: { secs: 8, nanos: 0 } });
    h.call("two", "npm test target", 11);
    h.result("two", { exit_code: 0 }, 12);
    expect(h.adapter.snapshot().events).toHaveLength(2);
    expect(h.event("one")).toMatchObject({ durationMs: 8000, durationScope: "process_runtime", intervalScope: "item_lifecycle" });
    expect(h.event("one").operationKey).toBe(h.event("two").operationKey);
    expect(h.event("one").id).not.toBe(h.event("two").id);
  });
  test("different item and function IDs are not matched by command/time", () => {
    const h = harness();
    h.call("response-id", "rg needle src", 0);
    h.result("response-id", { exit_code: 0 }, 2);
    h.item("item-id", "rg needle src", 2);
    expect(h.adapter.snapshot().events).toHaveLength(2);
  });
  test("actual shell transport is validated; important flags, targets and transport distinguish operations", () => {
    const h = harness();
    h.item("a", ["/bin/zsh", "-lc", "rg needle src --glob '*.ts'"], 1);
    h.item("b", ["/bin/zsh", "-lc", "rg needle src --glob '*.js'"], 1);
    h.item("c", ["/bin/bash", "-lc", "rg needle src --glob '*.ts'"], 1);
    h.item("d", ["/malicious/zsh", "-lc", "rg needle src"], 1);
    h.item("e", ["/bin/zsh", "-c", "rg needle src"], 1);
    h.item("f", ["/bin/zsh", "-lc", "rg needle src; curl https://fixture.invalid/"], 1);
    expect(h.event("a").commandPattern).toContain("rg");
    expect(new Set([h.event("a").operationKey, h.event("b").operationKey, h.event("c").operationKey]).size).toBe(3);
    for (const rawId of ["d", "e", "f"]) expect(h.event(rawId)).toMatchObject({ commandPattern: "shell <complex>", operationKey: null });
    expect(JSON.stringify(h.adapter.inspectRetainedState())).not.toContain("fixture.invalid");
  });
  test.each([
    ["rg absent src", 1, "completed", "no_match"],
    ["rg absent src", 2, "failed", "error"],
    ["git diff --exit-code -- src", 1, "completed", "change_detected"],
    ["git diff -- --exit-code", 1, "unknown", "unknown"],
    ["git diff --output --exit-code", 1, "unknown", "unknown"],
    ["git diff --no-index first second", 1, "unknown", "unknown"],
    ["npm test target", 1, "unknown", "unknown"],
    ["npm test target", 0, "completed", "success"],
    ["rg absent src && npm test target", 1, "unknown", "unknown"],
  ])("exit policy for %s/%s", (cmd, code, status, outcome) => {
    const h = harness();
    h.call("call", cmd, 0);
    h.result("call", { exit_code: code }, 2);
    expect(h.event("call")).toMatchObject({ status, executionOutcome: outcome });
  });
  test("CommandExecution.failed is exit-derived, while MCP isError is tool-error evidence", () => {
    const h = harness();
    h.item("rg", ["/bin/zsh", "-lc", "rg absent src"], 3, { status: "failed", exit_code: 1 });
    h.push({ type: "item_completed", thread_id: "synthetic-behavior-stream", item: { type: "McpToolCall", id: "mcp", server: "synthetic", tool: "fetch", arguments: {}, status: "failed", duration: { secs: 1, nanos: 0 }, result: { isError: true, content: [{ type: "text", text: "FICTITIOUS_AGENTPROF_ERROR" }] } } }, "event_msg", 3);
    expect(h.event("rg")).toMatchObject({ status: "completed", executionOutcome: "no_match" });
    expect(h.event("mcp")).toMatchObject({ status: "failed", errorFingerprint: null, durationMs: 1000, durationScope: "invocation_latency" });
  });
  test("unknown statuses, contradictory exit status and rejection zero stay conservative", () => {
    const h = harness();
    h.item("unknown", "rg needle", 1, { status: "FICTITIOUS_AGENTPROF_UNKNOWN_STATUS" });
    h.item("conflict", "rg needle", 1, { status: "failed", exit_code: 0 });
    h.item("cancel", "npm test target", 1, { status: "cancelled", exit_code: null });
    h.push({ type: "item_completed", item: { type: "McpToolCall", id: "rejected", server: "synthetic", tool: "read", status: "failed", duration: { secs: 0, nanos: 0 } } });
    expect(h.event("unknown").status).toBe("unknown");
    expect(h.event("conflict").status).toBe("unknown");
    expect(h.event("cancel").status).toBe("cancelled");
    expect(h.event("rejected")).toMatchObject({ status: "unknown", durationMs: null, durationScope: "unknown" });
    expect(h.adapter.snapshot().diagnostics.some((d) => d.code === "STATUS_CONFLICT")).toBe(true);
  });
  test("source-reported duration requires a verified command source and never places an interval", () => {
    const h = harness();
    h.item("duration-only", ["/bin/zsh", "-lc", "npm test"], 2, {}, { started_at_ms: undefined, completed_at_ms: undefined });
    h.item("unverified-source", ["/bin/zsh", "-lc", "npm test"], 2, { source: "FICTITIOUS_AGENTPROF_UNKNOWN_SOURCE" });
    h.item("fraction", ["/bin/zsh", "-lc", "npm test"], 2, { duration: { secs: 1, nanos: 999_250_000 } });
    expect(h.event("duration-only")).toMatchObject({ durationMs: 2000, startAt: null, endAt: null, intervalScope: "unknown" });
    expect(h.event("unverified-source")).toMatchObject({ durationMs: null, durationScope: "unknown" });
    expect(h.event("fraction")).toMatchObject({ durationMs: 1999.25, durationScope: "process_runtime", intervalScope: "item_lifecycle" });
    expect(h.adapter.snapshot().diagnostics.some((d) => d.code === "TIMING_CONFLICT")).toBe(false);
  });
  test("conflicting completion replay disables aggregation instead of choosing either value", () => {
    const h = harness();
    h.item("same", "npm test", 2);
    h.item("same", "npm test", 2, { duration: { secs: 3, nanos: 0 } });
    expect(h.event("same")).toMatchObject({ status: "unknown", durationMs: null, timingEvidence: "unknown", intervalTimingEvidence: "unknown" });
    expect(h.adapter.snapshot().diagnostics.some((d) => d.code === "INCONSISTENT_REPLAY")).toBe(true);
  });
  test("structured start remains pending, then completion and replay converge without a conflict", () => {
    const h = harness();
    const started = { type: "item_started", thread_id: "synthetic-behavior-stream", turn_id: "synthetic-turn", started_at_ms: epoch, completed_at_ms: epoch + 10_000, item: { type: "CommandExecution", id: "lifecycle", source: "unified_exec_startup", command: ["/bin/zsh", "-lc", "npm test target"], status: "completed", exit_code: 0, duration: { secs: 8, nanos: 0 } } };
    h.push(started, "event_msg", 0);
    expect(h.event("lifecycle")).toMatchObject({ status: "pending", executionOutcome: "unknown", exitCode: null, endAt: null, durationMs: null, durationScope: "unknown", intervalScope: "unknown" });
    h.item("lifecycle", ["/bin/zsh", "-lc", "npm test target"], 10, { duration: { secs: 8, nanos: 0 } });
    expect(h.event("lifecycle")).toMatchObject({ status: "completed", executionOutcome: "success", endAt: timestamp(10), durationMs: 8000, durationScope: "process_runtime", intervalScope: "item_lifecycle" });
    h.push(started, "event_msg", 0);
    h.item("lifecycle", ["/bin/zsh", "-lc", "npm test target"], 10, { duration: { secs: 8, nanos: 0 } });
    expect(h.adapter.snapshot().events).toHaveLength(1);
    expect(h.event("lifecycle")).toMatchObject({ status: "completed", executionOutcome: "success", durationMs: 8000 });
    expect(h.adapter.snapshot().diagnostics.some((d) => d.code === "INCONSISTENT_REPLAY" || d.code === "STATUS_CONFLICT")).toBe(false);
  });
  test("namespaces are part of classification and operation identity", () => {
    const h = harness();
    h.push({ type: "function_call", name: "exec_command", namespace: "unverified", call_id: "wrong", arguments: '{"cmd":"rg needle"}' }, "response_item");
    h.push({ type: "function_call", name: "lookup", namespace: "mcp.alpha", call_id: "a", arguments: '{"target":"same"}' }, "response_item");
    h.push({ type: "function_call", name: "lookup", namespace: "mcp.beta", call_id: "b", arguments: '{"target":"same"}' }, "response_item");
    expect(h.adapter.snapshot().events).toHaveLength(2);
    expect(h.event("a").operationKey).not.toBe(h.event("b").operationKey);
    expect(h.adapter.snapshot().diagnostics.some((d) => d.code === "UNSUPPORTED_RECORD")).toBe(true);
    expect(JSON.stringify(h.adapter.inspectRetainedState())).not.toContain("mcp.alpha");
  });
});

describe("results, polling and bounded safe pairing", () => {
  test("an unsupported call followed by its same-ID result is not a reordered orphan", () => {
    const h = harness({ events: 2 });
    h.push({ type: "function_call", call_id: "unsupported", name: "FICTITIOUS_AGENTPROF_UNSUPPORTED_NAME", arguments: '{"secret":"FICTITIOUS_AGENTPROF_UNSUPPORTED_ARGUMENT"}' }, "response_item", 1);
    h.result("unsupported", { output: "FICTITIOUS_AGENTPROF_UNSUPPORTED_RESULT", exit_code: 0 }, 2);
    const snapshot = h.adapter.snapshot();
    expect(snapshot.events).toHaveLength(0);
    expect(snapshot.stateCounts).toMatchObject({ unsupportedCalls: 1, pendingResults: 0, resultReplays: 0 });
    expect(snapshot.diagnostics.some((d) => d.code === "UNSUPPORTED_RELATION")).toBe(true);
    expect(snapshot.diagnostics.some((d) => d.code === "REORDERED_RECORD")).toBe(false);
    expect(JSON.stringify(h.adapter.inspectRetainedState())).not.toContain("FICTITIOUS_AGENTPROF_");
    for (const call_id of ["second", "over-limit"]) h.push({ type: "function_call", call_id, name: "unverified", arguments: "{}" }, "response_item", 3);
    expect(h.adapter.snapshot().stateCounts.unsupportedCalls).toBe(2);
    expect(h.adapter.snapshot().capabilities.stateLimited).toBe(true);
  });
  test("result-before-call pairs from safe retained fields and uses the same event ID", () => {
    const h = harness();
    h.result("late-call", '{"exit_code":1,"output":"FICTITIOUS_AGENTPROF_REORDER_OUTPUT"}', 3);
    expect(h.adapter.snapshot().events).toHaveLength(0);
    expect(JSON.stringify(h.adapter.inspectRetainedState())).not.toContain("FICTITIOUS_AGENTPROF_");
    h.call("late-call", "rg missing src", 1);
    expect(h.event("late-call")).toMatchObject({ id: id("late-call"), status: "completed", executionOutcome: "no_match", durationMs: 2000 });
    expect(h.adapter.snapshot().stateCounts.pendingResults).toBe(0);
    expect(h.adapter.snapshot().diagnostics.some((d) => d.code === "REORDERED_RECORD")).toBe(true);
  });
  test("a terminal poll arriving before launch state completes the same execution without summing poll times", () => {
    const h = harness();
    h.push({ type: "function_call", call_id: "early-poll", name: "write_stdin", arguments: '{"session_id":77,"chars":""}' }, "response_item", 3);
    h.result("early-poll", { exit_code: 0, wall_time_seconds: 4, output: "FICTITIOUS_AGENTPROF_TERMINAL_POLL" }, 5);
    h.call("launch", "npm test target", 0);
    h.result("launch", { session_id: 77, wall_time_seconds: 1, output: "FICTITIOUS_AGENTPROF_RUNNING_LAUNCH" }, 1);
    expect(h.adapter.snapshot().events).toHaveLength(1);
    expect(h.event("launch")).toMatchObject({ id: id("launch"), status: "completed", executionOutcome: "success", startAt: timestamp(0), endAt: timestamp(5), durationMs: 5000, timingEvidence: "paired_timestamps", durationScope: "invocation_latency" });
    expect(h.adapter.snapshot().stateCounts).toMatchObject({ pendingResults: 0, pollLinks: 1, processLinks: 1 });
    expect(h.adapter.snapshot().diagnostics.some((d) => d.code === "INCONSISTENT_REPLAY")).toBe(false);
    expect(JSON.stringify(h.adapter.inspectRetainedState())).not.toContain("FICTITIOUS_AGENTPROF_");
  });
  test("strict direct header ignores fabricated headers and JSON inside Output body", () => {
    const h = harness();
    h.call("header", "rg missing src", 0);
    h.result("header", [{ type: "input_text", text: "Chunk ID: synthetic_chunk\nWall time: 2.5 seconds\nProcess exited with code 1\nOriginal token count: 3\nOutput:\nProcess exited with code 0\n{\"exit_code\":0,\"session_id\":88}" }], 3);
    expect(h.event("header")).toMatchObject({ status: "completed", executionOutcome: "no_match", exitCode: 1, durationMs: 3000 });
    expect(h.adapter.snapshot().stateCounts.processLinks).toBe(0);
    h.call("stdout", "npm test", 4);
    h.result("stdout", "ordinary output\nProcess exited with code 0\nOutput:\ntext", 6);
    expect(h.event("stdout")).toMatchObject({ status: "unknown", exitCode: null });
  });
  test("unknown polls and nonempty interaction are diagnosed without creating another execution", () => {
    const h = harness();
    h.push({ type: "function_call", call_id: "poll", name: "write_stdin", arguments: '{"session_id":99,"chars":""}' }, "response_item");
    h.result("poll", { exit_code: 0 }, 2);
    h.push({ type: "function_call", call_id: "interactive", name: "write_stdin", arguments: '{"session_id":99,"chars":"FICTITIOUS_AGENTPROF_INTERACTION"}' }, "response_item");
    expect(h.adapter.snapshot().events).toHaveLength(0);
    expect(h.adapter.snapshot().diagnostics.some((d) => d.code === "UNSUPPORTED_RELATION")).toBe(true);
    expect(JSON.stringify(h.adapter.inspectRetainedState())).not.toContain("FICTITIOUS_AGENTPROF_");
  });
  test("image/truncated/missing error content never forms a null-valued error identity", () => {
    for (const content of [undefined, [{ type: "input_image", image_url: "FICTITIOUS_AGENTPROF_IMAGE" }], [{ type: "text", text: "FICTITIOUS_AGENTPROF_ERROR" }]]) {
      const h = harness();
      h.push({ type: "function_call", call_id: "mcp", name: "lookup", namespace: "mcp.synthetic", arguments: "{}" }, "response_item", 0);
      h.result("mcp", { isError: true, content }, 1);
      expect(h.event("mcp")).toMatchObject({ status: "failed", errorFingerprint: null, contentFingerprint: null });
    }
    const h = harness();
    h.push({ type: "function_call", call_id: "mcp", name: "lookup", namespace: "mcp.synthetic", arguments: "{}" }, "response_item", 0);
    const ordinal = h.nextOrdinal();
    h.result("mcp", { isError: true, content: [{ type: "text", text: "FICTITIOUS_AGENTPROF_COMPLETE_ERROR" }] }, 1, { knownCompleteOutputOrdinals: [ordinal] });
    expect(h.event("mcp").errorFingerprint).not.toBeNull();
    expect(JSON.stringify(h.adapter.inspectRetainedState())).not.toContain("FICTITIOUS_AGENTPROF_");
    const truncated = harness();
    truncated.call("cmd", "rg missing", 0);
    truncated.result("cmd", { exit_code: 2, output: "FICTITIOUS_AGENTPROF_TRUNCATED_ERROR", truncated: true }, 1, { knownCompleteOutputOrdinals: [truncated.nextOrdinal()] });
    expect(truncated.event("cmd")).toMatchObject({ contentFingerprint: null, contentState: "truncated", errorFingerprint: null });
  });
  test("state and diagnostic bounds produce partial coverage; source replay does not change counters", () => {
    const h = harness({ events: 2, links: 1, turns: 1, usage: 2, sources: 1, streams: 1, observations: 6, metadata: 1, diagnostics: 3 });
    h.call("a", "npm test first", 0);
    h.call("b", "npm test second", 0);
    h.call("c", "npm test third", 0);
    h.result("orphan-1", { exit_code: 0 }, 1);
    h.result("orphan-2", { exit_code: 0 }, 1);
    for (let i = 0; i < 20; i++) h.result(`orphan-${i + 3}`, { exit_code: 0 }, 1);
    const snapshot = h.adapter.snapshot();
    expect(snapshot.stateCounts.events).toBeLessThanOrEqual(2);
    expect(snapshot.stateCounts.pendingResults).toBeLessThanOrEqual(2);
    expect(snapshot.stateCounts.observations).toBeLessThanOrEqual(6);
    expect(snapshot.stateCounts.diagnostics).toBeLessThanOrEqual(3);
    expect(snapshot.capabilities).toMatchObject({ coverage: "partial", stateLimited: true });
    expect(snapshot.capabilities.diagnosticsDropped).toBeGreaterThan(0);
    const raw = { timestamp: timestamp(1), type: "event_msg", payload: { type: "FICTITIOUS_AGENTPROF_UNKNOWN_EVENT" } };
    const source = { fileIdentity: "synthetic-source", byteOffset: 99999, ordinal: 999, sourceAlias: "source-1" };
    const separate = harness();
    separate.adapter.ingest(raw, source);
    const first = separate.adapter.snapshot();
    separate.adapter.ingest(raw, source);
    expect(separate.adapter.snapshot().capabilities).toEqual(first.capabilities);
    expect(separate.adapter.snapshot().stateCounts).toEqual(first.stateCounts);
  });
  test("wrapper child links share a bounded aggregate budget and source replay does not reserve twice", () => {
    const h = harness({ links: 2 });
    const add = (call_id: string, children: readonly string[], ordinal: number) => {
      const raw = { timestamp: timestamp(ordinal), type: "response_item", payload: { type: "custom_tool_call", call_id, name: "exec", input: "FICTITIOUS_AGENTPROF_WRAPPER_CODE" } };
      const source = { fileIdentity: "synthetic-source", sourceAlias: "source-1", byteOffset: ordinal * 1000, ordinal, trustedFixtureContext: { wrapperRelations: [{ wrapperCallId: call_id, childItemIds: children }] } };
      h.adapter.ingest(raw, source);
      const beforeReplay = h.adapter.snapshot();
      h.adapter.ingest(raw, source);
      expect(h.adapter.snapshot().stateCounts).toEqual(beforeReplay.stateCounts);
      expect(h.adapter.snapshot().capabilities).toEqual(beforeReplay.capabilities);
    };
    add("wrapper-one", ["FICTITIOUS_AGENTPROF_CHILD_ONE", "FICTITIOUS_AGENTPROF_CHILD_TWO"], 1);
    expect(h.adapter.snapshot().stateCounts.wrapperChildLinks).toBe(2);
    add("wrapper-two", ["FICTITIOUS_AGENTPROF_CHILD_THREE"], 2);
    const snapshot = h.adapter.snapshot();
    expect(snapshot.stateCounts).toMatchObject({ wrappers: 2, wrapperChildLinks: 2, processLinks: 0, pollLinks: 0 });
    expect(snapshot.wrappers[0]).toMatchObject({ relationship: "trusted_fixture", childEventIds: [id("FICTITIOUS_AGENTPROF_CHILD_ONE"), id("FICTITIOUS_AGENTPROF_CHILD_TWO")] });
    expect(snapshot.wrappers[1]).toMatchObject({ relationship: "unknown", childEventIds: [] });
    expect(snapshot.capabilities).toMatchObject({ coverage: "partial", stateLimited: true });
    expect(snapshot.diagnostics.some((d) => d.code === "STATE_LIMIT")).toBe(true);
    expect(JSON.stringify(h.adapter.inspectRetainedState())).not.toContain("FICTITIOUS_AGENTPROF_");
  });
});

describe("turn timing evidence", () => {
  test("seconds source endpoints and monotonic milliseconds coexist despite coarse wall discrepancy", () => {
    const h = harness();
    h.push({ type: "task_started", turn_id: "t", started_at: epoch / 1000 }, "event_msg", 100);
    h.push({ type: "task_complete", turn_id: "t", started_at: epoch / 1000, completed_at: epoch / 1000 + 10, duration_ms: 8150 }, "event_msg", 200);
    expect(h.adapter.snapshot().turns[0]).toMatchObject({ startAt: timestamp(0), endAt: timestamp(10), durationMs: 8150, intervalScope: "turn_wall", durationScope: "turn_elapsed", intervalTimingEvidence: "source_reported" });
    expect(h.adapter.snapshot().diagnostics.some((d) => d.code === "TIMING_CONFLICT")).toBe(false);
  });
  test("mixed source and log boundaries are preserved separately with unknown interval", () => {
    const h = harness();
    h.push({ type: "task_started", turn_id: "mixed", started_at: epoch / 1000 }, "event_msg", 100);
    h.push({ type: "task_complete", turn_id: "mixed", duration_ms: 2000 }, "event_msg", 200);
    expect(h.adapter.snapshot().turns[0]).toMatchObject({ startAt: timestamp(0), endAt: timestamp(200), startTimingEvidence: "source_reported", endTimingEvidence: "paired_timestamps", intervalScope: "unknown", intervalTimingEvidence: "unknown", durationMs: 2000 });
  });
  test("missing start, invalid source units, abort and pending do not invent intervals", () => {
    const h = harness();
    h.push({ type: "task_complete", turn_id: "missing", completed_at: epoch / 1000 + 2, duration_ms: 2000 }, "event_msg", 200);
    h.push({ type: "task_started", turn_id: "pending" }, "event_msg", 3);
    h.push({ type: "task_started", turn_id: "abort", started_at: epoch / 1000 + 4 }, "event_msg", 4);
    h.push({ type: "turn_aborted", turn_id: "abort", started_at: epoch / 1000 + 4, completed_at: epoch / 1000 + 5, duration_ms: 1000 }, "event_msg", 5);
    h.push({ type: "task_complete", turn_id: "invalid", started_at: Number.MAX_SAFE_INTEGER, completed_at: -1, duration_ms: -2 }, "event_msg", 6);
    const turns = h.adapter.snapshot().turns;
    expect(turns[0]).toMatchObject({ startAt: null, endAt: timestamp(2), intervalScope: "unknown", durationMs: 2000 });
    expect(turns[1]).toMatchObject({ status: "pending", endAt: null, durationMs: null });
    expect(turns[2]).toMatchObject({ status: "cancelled", durationMs: 1000 });
    expect(turns[3]).toMatchObject({ startAt: null, endAt: null, durationMs: null });
  });
});
