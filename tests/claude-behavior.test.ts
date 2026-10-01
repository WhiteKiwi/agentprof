import { describe, expect, test } from "vitest";
import { claudeEventId, claudeMessageId, claudeStreamId, createClaudeAdapter } from "../src/parsers/claude/index.js";
import type { ClaudeLimits, ClaudeTrustedFixtureContext } from "../src/parsers/claude/types.js";
import { safeErrorEnvelope } from "../src/privacy/diagnostics.js";
import { assistant, at, callBlock, codes, context, event, resultBlock, session, source, stream, usageRecord, user } from "./claude-helpers.js";

describe("Claude execution and relation behavior", () => {
  test("a pending call is updated by the direct result without creating another execution", () => {
    const adapter = createClaudeAdapter(context);
    const first = adapter.ingest(assistant(), source(1));
    expect(first.events).toHaveLength(1);
    expect(event(adapter)).toMatchObject({ status: "pending", executionOutcome: "unknown", durationMs: null, endAt: null, intervalScope: "unknown", exitCode: null });
    const id = event(adapter).id;
    adapter.ingest(user(), source(2));
    expect(adapter.snapshot().events).toHaveLength(1);
    expect(event(adapter)).toMatchObject({ id, status: "completed", executionOutcome: "success", durationMs: 4000, timingEvidence: "paired_timestamps", durationScope: "invocation_latency", intervalScope: "invocation_latency", intervalTimingEvidence: "paired_timestamps", exitCode: null });
    expect(codes(adapter)).not.toContain("INCONSISTENT_REPLAY");
  });
  test.each([[true, "failed", "error"], [false, "completed", "success"], [undefined, "unknown", "unknown"]] as const)("is_error=%s alone selects %s; exit/output text is inert", (isError, status, executionOutcome) => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(assistant("call-uuid", 0, [callBlock("call", "Bash", { command: "rg invented ./invented" })]), source(1));
    adapter.ingest(user("result-uuid", 4, [resultBlock("call", isError, "Process exited with code 1\ninterrupted\nfailed\nCancelled")], { toolUseResult: { exit_code: 0, interrupted: true, stderr: "private error" }, status: "cancelled" }), source(2));
    expect(event(adapter)).toMatchObject({ status, executionOutcome, exitCode: null, errorFingerprint: null });
    expect(event(adapter).executionOutcome).not.toBe("no_match");
  });
  test("invalid explicit status remains unknown", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(assistant(), source(1));
    adapter.ingest(user("result-uuid", 4, [{ ...resultBlock(), is_error: "FICTITIOUS_AGENTPROF_STATUS_SENTINEL" }]), source(2));
    expect(event(adapter).status).toBe("unknown");
    expect(codes(adapter)).toContain("INVALID_RECORD");
    expect(JSON.stringify(adapter.inspectRetainedState())).not.toContain("FICTITIOUS_AGENTPROF_STATUS_SENTINEL");
  });
  test("result before call uses bounded opaque pending state and later pairs correctly", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(user("result-uuid", 4, [resultBlock("call", false, "FICTITIOUS_AGENTPROF_PENDING_OUTPUT_SENTINEL")]), source(2));
    expect(adapter.snapshot().events).toHaveLength(0);
    expect(adapter.snapshot().stateCounts.deferredResults).toBe(1);
    expect(JSON.stringify(adapter.inspectRetainedState())).not.toContain("FICTITIOUS_AGENTPROF_PENDING_OUTPUT_SENTINEL");
    adapter.ingest(assistant(), source(1));
    expect(adapter.snapshot().stateCounts.deferredResults).toBe(0);
    expect(event(adapter)).toMatchObject({ status: "completed", durationMs: 4000, startAt: at(0), endAt: at(4) });
    expect(codes(adapter)).toContain("REORDERED_RECORD");
    expect(adapter.snapshot().observations.find((value) => value.representation === "result")!.observedResult!.completionKind).toBe("invocation_result");
  });
  test("sidechain and root tool IDs stay separate; missing agent and inconsistent relations are unattributed", () => {
    const adapter = createClaudeAdapter(context);
    const child = { isSidechain: true, agentId: "fictitious-agent" };
    adapter.ingest(assistant("side-call", 0, [callBlock()], child), source(1));
    adapter.ingest(user(), source(2));
    expect(adapter.snapshot().events).toHaveLength(1);
    expect(event(adapter, "call", claudeStreamId(context, session, "fictitious-agent")).status).toBe("pending");
    expect(adapter.snapshot().stateCounts.deferredResults).toBe(1);
    adapter.ingest(user("side-result", 4, [resultBlock()], child), source(3));
    expect(event(adapter, "call", claudeStreamId(context, session, "fictitious-agent")).status).toBe("completed");
    const invalid = createClaudeAdapter(context);
    const missingSidechain = assistant("missing-sidechain", 0, [callBlock()], { agentId: "unverified-agent" });
    delete (missingSidechain as { isSidechain?: boolean }).isSidechain;
    invalid.ingest(missingSidechain, source(1));
    invalid.ingest(assistant("false-sidechain", 0, [callBlock()], { agentId: "unverified-agent", isSidechain: false }), source(2));
    invalid.ingest(assistant("missing-agent", 0, [callBlock()], { isSidechain: true }), source(3));
    expect(invalid.snapshot().events).toHaveLength(0);
    expect(invalid.snapshot().stateCounts.streams).toBe(0);
    expect(invalid.snapshot().metadata.every((value) => value.sessionId === null && value.isSidechain === null)).toBe(true);
    expect(codes(invalid).filter((code) => code === "UNATTRIBUTED_RECORD")).toHaveLength(3);
  });
  test("missing root declaration never falls back to source owner", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(assistant(), source(1));
    const missing = user(); delete (missing as { sessionId?: string }).sessionId;
    adapter.ingest(missing, source(2));
    expect(event(adapter).status).toBe("pending");
    expect(adapter.snapshot().metadata[1]).toMatchObject({ ownerRootSessionId: stream, declaredRootSessionId: null, sessionId: null, agentId: null, isSidechain: null });
  });
  test("UUID links do not choose parent execution from a multicalled assistant", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(assistant("parent", 0, [callBlock("one"), callBlock("two")]), source(1));
    adapter.ingest(user("reply", 4, [resultBlock("two"), resultBlock("one")], { parentUuid: "parent", sourceToolAssistantUUID: "parent" }), source(2));
    expect(adapter.snapshot().events).toHaveLength(2);
    expect(adapter.snapshot().events.every((value) => value.parentEventId === null && value.turnId === null)).toBe(true);
    expect(adapter.snapshot().messages.find((value) => value.id === claudeMessageId(context, stream, "reply"))).toMatchObject({ parentMessageId: claudeMessageId(context, stream, "parent"), sourceToolAssistantMessageId: claudeMessageId(context, stream, "parent") });
  });
  test("same-file earlier call ordinal restores original boundary; cross-source clock minimum is not authority", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(assistant("later-uuid", 9), source(9));
    adapter.ingest(user(), source(4));
    expect(event(adapter).durationMs).toBeNull();
    adapter.ingest(assistant("call-uuid", 0), source(1));
    expect(event(adapter)).toMatchObject({ startAt: at(0), endAt: at(4), durationMs: 4000 });
    adapter.ingest(assistant("unverified-other-uuid", -10), source(1, "other-source"));
    expect(event(adapter).startAt).toBe(at(0));
    expect(event(adapter).durationMs).toBe(4000);
    expect(codes(adapter)).toContain("REORDERED_RECORD");
  });
  test("independent identical commands retain distinct tool-use identities", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(assistant("one-uuid", 0, [callBlock("one"), callBlock("two")], { cwd: "/fictitious-project" }), source(1));
    expect(adapter.snapshot().events).toHaveLength(2);
    expect(event(adapter, "one").operationKey).toBe(event(adapter, "two").operationKey);
    expect(event(adapter, "one").operationKey).not.toBeNull();
    expect(event(adapter, "one").id).not.toBe(event(adapter, "two").id);
  });
  test("different arguments under the same call identity become unknown and lose comparison keys", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(assistant(), source(1));
    adapter.ingest(user(), source(2));
    adapter.ingest(assistant("conflict-uuid", 0, [callBlock("call", "Bash", { command: "npm test different-target" })]), source(3));
    expect(adapter.snapshot().events).toHaveLength(1);
    expect(event(adapter)).toMatchObject({ status: "unknown", durationMs: null, timingEvidence: "unknown", intervalScope: "unknown", operationKey: null, lookupKey: null, commandPattern: null, kind: "other" });
    expect(codes(adapter)).toContain("INCONSISTENT_REPLAY");
    adapter.ingest(user(), source(2));
    expect(event(adapter).status).toBe("unknown");
  });
  test("conflicting result identity stays unknown, including result-before-call conflict", () => {
    for (const beforeCall of [false, true]) {
      const adapter = createClaudeAdapter(context);
      if (!beforeCall) adapter.ingest(assistant(), source(1));
      adapter.ingest(user(), source(2));
      adapter.ingest(user("conflict-result", 4, [resultBlock("call", true, "different private output")]), source(3));
      if (beforeCall) adapter.ingest(assistant(), source(1));
      expect(event(adapter)).toMatchObject({ status: "unknown", durationMs: null, durationScope: "unknown", intervalScope: "unknown", contentFingerprint: null, errorFingerprint: null });
      expect(codes(adapter)).toContain("INCONSISTENT_REPLAY");
    }
  });
  test("complex shell is inert and cannot use simple-program exit semantics", () => {
    const adapter = createClaudeAdapter(context);
    const command = "FICTITIOUS_AGENTPROF_ENV_SENTINEL=private rg secret target && touch /FICTITIOUS_AGENTPROF_MUST_NOT_EXIST";
    adapter.ingest(assistant("call-uuid", 0, [callBlock("call", "Bash", { command })]), source(1));
    adapter.ingest(user("result-uuid", 4, [resultBlock("call", false, "Process exited with code 1")]), source(2));
    expect(event(adapter)).toMatchObject({ commandPattern: "shell <complex>", operationKey: null, status: "completed", executionOutcome: "success", exitCode: null });
    expect(codes(adapter)).toContain("UNSUPPORTED_COMMAND");
    expect(JSON.stringify(adapter.inspectRetainedState())).not.toContain("FICTITIOUS_AGENTPROF_");
  });
});

describe("Claude acknowledgement, output and timing evidence", () => {
  test.each(["Bash", "Agent"])("%s background acknowledgement remains pending and preserves safe latency", (name) => {
    const adapter = createClaudeAdapter(context);
    const rootResult = name === "Bash" ? { backgroundTaskId: "private-task" } : { isAsync: true, status: "async_launched", agentId: "private-future-agent" };
    adapter.ingest(assistant("call-uuid", 0, [callBlock("call", name, { command: "npm test target", run_in_background: true, prompt: "private prompt" })]), source(1));
    adapter.ingest(user("result-uuid", 4, [resultBlock("call", name === "Bash" ? false : undefined)], { toolUseResult: rootResult }), source(2));
    expect(event(adapter)).toMatchObject({ status: "pending", executionOutcome: "unknown", endAt: null, durationMs: null, timingEvidence: "unknown", intervalScope: "unknown", exitCode: null });
    expect(adapter.snapshot().observations.find((value) => value.representation === "result")!.observedResult).toMatchObject({ completionKind: "background_acknowledgement", observedAt: at(4), acknowledgementLatencyMs: 4000, durationMs: null });
    adapter.ingest(user("task-mentioned", 10, [{ type: "text", text: "private-task completed with exit code 0" }]), source(3));
    expect(event(adapter).status).toBe("pending");
  });
  test.each(["Bash", "Agent"])("%s acknowledgement with is_error=true is a conflict, not successful launch", (name) => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(assistant("call-uuid", 0, [callBlock("call", name, { command: "npm test target", run_in_background: true })]), source(1));
    adapter.ingest(user("result-uuid", 4, [resultBlock("call", true)], { toolUseResult: name === "Bash" ? { backgroundTaskId: "unverified-task" } : { isAsync: true, status: "async_launched" } }), source(2));
    expect(event(adapter)).toMatchObject({ status: "unknown", endAt: null, durationMs: null, intervalScope: "unknown", errorFingerprint: null });
    expect(codes(adapter)).toContain("STATUS_CONFLICT");
    expect(adapter.snapshot().observations.find((value) => value.observedResult)!.observedResult!.completionKind).toBe("unknown");
  });
  test("acknowledgement before call updates its original source observation", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(user("result-uuid", 4, [resultBlock()], { toolUseResult: { backgroundTaskId: "private-task" } }), source(2));
    adapter.ingest(assistant("call-uuid", 0, [callBlock("call", "Bash", { command: "npm test target", run_in_background: true })]), source(1));
    expect(event(adapter).status).toBe("pending");
    const result = adapter.snapshot().observations.filter((value) => value.representation === "result");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceRef: { byteOffset: 200 }, observedResult: { completionKind: "background_acknowledgement", acknowledgementLatencyMs: 4000 } });
  });
  test("multi-result launch metadata cannot be assigned by tool kind or array order", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(assistant("call-uuid", 0, [callBlock("background", "Bash", { command: "npm test target", run_in_background: true }), callBlock("read", "Read", { file_path: "/invented/source.ts" })]), source(1));
    adapter.ingest(user("result-uuid", 4, [resultBlock("read"), resultBlock("background")], { toolUseResult: { backgroundTaskId: "unassigned-private-task" } }), source(2));
    expect(adapter.snapshot().events.every((value) => value.status === "unknown" && value.endAt === null && value.durationMs === null && value.intervalScope === "unknown")).toBe(true);
    expect(adapter.snapshot().observations.filter((value) => value.representation === "result").every((value) => value.observedResult?.unassignedAcknowledgement === true && value.observedResult.isError === false && value.observedResult.completionKind === "unknown")).toBe(true);
    expect(codes(adapter)).toContain("UNSUPPORTED_RELATION");
    expect(JSON.stringify(adapter.inspectRetainedState())).not.toContain("unassigned-private-task");
  });
  test.each(["", " \n\t", [], [{ type: "text", text: " " }]])("empty error content %j supplies no identical-error fingerprint", (body) => {
    const adapter = createClaudeAdapter(context);
    const trusted: ClaudeTrustedFixtureContext = { completeResults: [{ ordinal: 2, toolUseId: "call" }] };
    adapter.ingest(assistant(), source(1));
    adapter.ingest(user("result-uuid", 4, [resultBlock("call", true, body)]), source(2, undefined, trusted));
    expect(event(adapter)).toMatchObject({ status: "failed", errorFingerprint: null, contentState: "complete" });
    expect(event(adapter).contentFingerprint).not.toBeNull();
  });
  test.each([undefined, [{ type: "image", source: "private-image" }], "Warning: truncated output\nprivate error"])("missing/image/truncated output %j cannot establish content or error identity", (body) => {
    const adapter = createClaudeAdapter(context);
    const block = body === undefined ? { type: "tool_result", tool_use_id: "call", is_error: true } : resultBlock("call", true, body);
    adapter.ingest(assistant(), source(1));
    adapter.ingest(user("result-uuid", 4, [block]), source(2, undefined, { completeResults: [{ ordinal: 2, toolUseId: "call" }] }));
    expect(event(adapter)).toMatchObject({ status: "failed", contentFingerprint: null, errorFingerprint: null });
  });
  test("only exact trusted complete result can supply comparison identities", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(assistant("call-uuid", 0, [callBlock("one"), callBlock("two")]), source(1));
    adapter.ingest(user("result-uuid", 4, [resultBlock("one", true, "verified complete error"), resultBlock("two", true, "verified complete error")]), source(2, undefined, { completeResults: [{ ordinal: 2, toolUseId: "one" }] }));
    expect(event(adapter, "one").contentFingerprint).not.toBeNull(); expect(event(adapter, "one").errorFingerprint).not.toBeNull();
    expect(event(adapter, "two").contentFingerprint).toBeNull(); expect(event(adapter, "two").errorFingerprint).toBeNull();
  });
  test("direct duration is trusted only for its precise target and scope; differing scopes coexist", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(assistant(), source(1));
    adapter.ingest(user("result-uuid", 4, [resultBlock()], { toolUseResult: { durationMs: 2500 }, annotation: { durationScope: "process_runtime", complete: true } }), source(2));
    expect(event(adapter)).toMatchObject({ durationMs: 4000, durationScope: "invocation_latency", timingEvidence: "paired_timestamps", contentFingerprint: null });
    const precise = createClaudeAdapter(context);
    precise.ingest(assistant(), source(1));
    precise.ingest(user("result-uuid", 4, [resultBlock()], { toolUseResult: { durationMs: 2500 } }), source(2, undefined, { toolTimings: [{ ordinal: 2, toolUseId: "call", durationScope: "process_runtime", source: "tool_use_result_duration_ms" }] }));
    expect(event(precise)).toMatchObject({ durationMs: 2500, durationScope: "process_runtime", timingEvidence: "source_reported", startAt: at(0), endAt: at(4), intervalScope: "invocation_latency" });
    expect(codes(precise)).not.toContain("TIMING_CONFLICT");
  });
  test("authoritative same-scope duration conflict does not relabel a paired interval as runtime", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(assistant(), source(1));
    adapter.ingest(user("result-uuid", 4, [resultBlock()], { toolUseResult: { durationMs: 2500 } }), source(2, undefined, { toolTimings: [{ ordinal: 2, toolUseId: "call", durationScope: "invocation_latency", source: "tool_use_result_duration_ms" }] }));
    expect(event(adapter)).toMatchObject({ durationMs: 2500, timingEvidence: "source_reported", durationScope: "invocation_latency", intervalScope: "unknown", intervalTimingEvidence: "unknown" });
    expect(codes(adapter)).toContain("TIMING_CONFLICT");
  });
  test("unknown and backwards timestamps stay null; zero elapsed is valid", () => {
    const missing = createClaudeAdapter(context);
    const invalidCall = assistant(); delete (invalidCall as { timestamp?: string }).timestamp;
    missing.ingest(invalidCall, source(1)); missing.ingest(user(), source(2));
    expect(event(missing)).toMatchObject({ startAt: null, durationMs: null, intervalScope: "unknown" });
    const backwards = createClaudeAdapter(context);
    backwards.ingest(assistant("call-uuid", 5), source(1)); backwards.ingest(user(), source(2));
    expect(event(backwards)).toMatchObject({ endAt: null, durationMs: null, intervalScope: "unknown" }); expect(codes(backwards)).toContain("INVALID_TIMING");
    const zero = createClaudeAdapter(context);
    zero.ingest(assistant(), source(1)); zero.ingest(user("result-uuid", 0), source(2));
    expect(event(zero)).toMatchObject({ durationMs: 0, durationScope: "invocation_latency", intervalScope: "invocation_latency" });
  });
  test("turn durations are duration-only including zero, and conflicting/invalid values are excluded", () => {
    const adapter = createClaudeAdapter(context);
    const turn = { type: "system", subtype: "turn_duration", uuid: "turn", sessionId: session, timestamp: at(10), durationMs: 0 };
    adapter.ingest(turn, source(1));
    expect(adapter.snapshot().turns[0]).toMatchObject({ durationMs: 0, observedAt: at(10), startAt: null, endAt: null, timingEvidence: "source_reported", durationScope: "unknown", intervalScope: "unknown", selection: "duration_only" });
    adapter.ingest({ ...turn, durationMs: 1 }, source(2));
    expect(adapter.snapshot().turns[0]).toMatchObject({ durationMs: null, timingEvidence: "unknown", selection: "conflicted" });
    const invalid = createClaudeAdapter(context); invalid.ingest({ ...turn, durationMs: -1 }, source(1));
    expect(invalid.snapshot().turns[0]).toMatchObject({ durationMs: null, selection: "invalid" });
  });
});

describe("bounded safe Claude state", () => {
  test.each(["sources", "streams", "events", "turns", "usage", "deferredResults", "resultReplays", "usageOrders", "observations", "metadata", "diagnostics"] as const)("%s stays within its independent bound", (limit) => {
    const adapter = createClaudeAdapter(context, { [limit]: 1 });
    if (limit === "sources") { adapter.ingest(assistant(), source(1)); adapter.ingest(assistant("two"), source(1, "second-source")); }
    else if (limit === "streams") { adapter.ingest(assistant(), source(1)); adapter.ingest(assistant("two", 0, [callBlock("two")], { isSidechain: true, agentId: "agent" }), source(2)); }
    else if (limit === "turns") { for (let ordinal = 1; ordinal <= 2; ordinal++) adapter.ingest({ type: "system", subtype: "turn_duration", uuid: `turn-${ordinal}`, sessionId: session, durationMs: ordinal }, source(ordinal)); }
    else if (limit === "usage" || limit === "usageOrders") { for (let ordinal = 1; ordinal <= 2; ordinal++) adapter.ingest(usageRecord(`usage-${ordinal}`, ordinal, 0, { message: { id: `response-${ordinal}`, role: "assistant", content: [], usage: { input_tokens: 1, output_tokens: ordinal, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }), source(ordinal)); }
    else if (limit === "deferredResults" || limit === "resultReplays") { for (let ordinal = 1; ordinal <= 2; ordinal++) adapter.ingest(user(`result-${ordinal}`, 4, [resultBlock(`call-${ordinal}`)]), source(ordinal)); }
    else if (limit === "diagnostics") adapter.ingest({ type: "assistant", timestamp: "private-invalid-clock", sessionId: session }, source(1));
    else { adapter.ingest(assistant(), source(1)); adapter.ingest(assistant("second", 0, [callBlock("second")]), source(2)); }
    expect(adapter.snapshot().stateCounts[limit]).toBeLessThanOrEqual(1);
    expect(adapter.snapshot().capabilities).toMatchObject({ stateLimited: true, coverage: "partial" });
    expect(codes(adapter)).toContain(limit === "diagnostics" ? "INVALID_TIMING" : "STATE_LIMIT");
    expect(JSON.stringify(adapter.inspectRetainedState())).not.toContain("private-invalid-clock");
  });
  test("message nodes, UUID replay markers and aggregate adjacency each use messageLinks budget", () => {
    const edges = createClaudeAdapter(context, { messageLinks: 2 });
    edges.ingest(assistant("one", 0, [], { parentUuid: "parent-one", sourceToolAssistantUUID: "assistant-one" }), source(1));
    edges.ingest(assistant("two", 0, [], { parentUuid: "parent-two" }), source(2));
    expect(edges.snapshot().stateCounts).toMatchObject({ messageLinks: 2, messageEdges: 2, uuidReplays: 2 });
    expect(edges.snapshot().messages[1]!.parentMessageId).toBeNull();
    edges.ingest(assistant("three", 0, []), source(3));
    expect(edges.snapshot().stateCounts.messageLinks).toBe(2);
    expect(edges.snapshot().capabilities.stateLimited).toBe(true);
    const markers = createClaudeAdapter(context, { messageLinks: 2 });
    for (let ordinal = 1; ordinal <= 3; ordinal++) markers.ingest(usageRecord("same-uuid", ordinal), source(ordinal));
    expect(markers.snapshot().stateCounts).toMatchObject({ messageLinks: 1, uuidReplays: 2, messageEdges: 0 });
    expect(markers.snapshot().usage[0]!.counts!.output).toBe(2);
    expect(codes(markers)).toContain("STATE_LIMIT");
  });
  test("same-source unsupported replay leaves capability counters, state and diagnostics unchanged", () => {
    const adapter = createClaudeAdapter(context);
    const record = { type: "fictitious-unsupported", sessionId: session, arbitrary: "FICTITIOUS_AGENTPROF_METADATA_SENTINEL" };
    adapter.ingest(record, source(1)); const previous = adapter.snapshot();
    adapter.ingest(record, source(1)); expect(adapter.snapshot()).toEqual(previous);
    expect(previous.capabilities.unsupportedRecords).toBe(1);
    expect(JSON.stringify(adapter.inspectRetainedState())).not.toContain("FICTITIOUS_AGENTPROF_METADATA_SENTINEL");
  });
  test("later cwd metadata cannot reinterpret an earlier same-source call on replay", () => {
    const adapter = createClaudeAdapter(context);
    const rows = [assistant(), user(), assistant("later-context", 10, [], { cwd: "/fictitious-later-context" })];
    rows.forEach((record, index) => adapter.ingest(record, source(index + 1)));
    const before = adapter.snapshot();
    const retained = adapter.inspectRetainedState();
    rows.forEach((record, index) => adapter.ingest(record, source(index + 1)));
    expect(adapter.snapshot()).toEqual(before);
    expect(adapter.inspectRetainedState()).toEqual(retained);
    expect(event(adapter).status).toBe("completed");
    expect(codes(adapter)).not.toContain("INCONSISTENT_REPLAY");
    expect(event(adapter).operationKey).toBeNull();
    const knownContext = createClaudeAdapter(context);
    knownContext.ingest(assistant("call-uuid", 0, [callBlock()], { cwd: "/fictitious-original-project" }), source(1));
    knownContext.ingest(user(), source(2));
    knownContext.ingest(assistant("later-context", 10, [callBlock()], { cwd: "/fictitious-contradictory-project" }), source(3));
    expect(event(knownContext)).toMatchObject({ status: "unknown", operationKey: null });
    expect(codes(knownContext)).toContain("INCONSISTENT_REPLAY");
  });
  test("session-change ambiguity keeps original source-point interpretation on replay", () => {
    const adapter = createClaudeAdapter(context);
    const rows = [assistant(), assistant("other-session", 10, [callBlock("other")], { sessionId: "different-fictitious-session" })];
    rows.forEach((record, index) => adapter.ingest(record, source(index + 1)));
    expect(codes(adapter)).toContain("AMBIGUOUS_ORIGIN");
    const before = adapter.snapshot();
    const retained = adapter.inspectRetainedState();
    rows.forEach((record, index) => adapter.ingest(record, source(index + 1)));
    expect(adapter.snapshot()).toEqual(before);
    expect(adapter.inspectRetainedState()).toEqual(retained);
    adapter.ingest(assistant("call-uuid", 0, [callBlock()], { sessionId: "contradictory-fictitious-declaration" }), source(1));
    expect(codes(adapter)).toContain("INCONSISTENT_REPLAY");
    expect(adapter.snapshot().metadata[0]!.origin).toBe("ordinary");
    expect(adapter.snapshot().observations.some((value) => value.origin === "ambiguous" && value.sourceRef.byteOffset === 100)).toBe(true);
  });
  test("malformed input, unknown properties and accessor candidates do not expose or execute provider content", () => {
    const adapter = createClaudeAdapter(context);
    let executed = false;
    const record = assistant("private-uuid", 0, [callBlock("private-call", "mcp__PRIVATE_TOOL_SENTINEL", { query: "FICTITIOUS_AGENTPROF_QUERY_SENTINEL" })], { version: "FICTITIOUS_AGENTPROF_VERSION_SENTINEL", cwd: "/FICTITIOUS_AGENTPROF_PRIVATE_PATH", prompt: "FICTITIOUS_AGENTPROF_PROMPT_SENTINEL", annotation: { final: true, complete: true } });
    Object.defineProperty(record, "unknownAccessor", { enumerable: true, get() { executed = true; throw new Error("FICTITIOUS_AGENTPROF_THROW_SENTINEL"); } });
    adapter.ingest(record, source(1, "/FICTITIOUS_AGENTPROF_SOURCE_PATH"));
    const poisoned = Object.create(null); Object.defineProperty(poisoned, "type", { enumerable: true, get() { executed = true; throw new Error("FICTITIOUS_AGENTPROF_THROW_SENTINEL"); } });
    expect(() => adapter.ingest(poisoned, source(2))).not.toThrow();
    expect(() => adapter.ingest(null, source(3))).not.toThrow();
    expect(executed).toBe(false);
    expect(JSON.stringify(adapter.inspectRetainedState())).not.toMatch(/FICTITIOUS_AGENTPROF_|private-uuid|private-call|PRIVATE_TOOL_SENTINEL/);
    expect(event(adapter, "private-call").toolName).toBe("mcp");
  });
  test("unsafe limit overrides throw a fixed safe error", () => {
    for (const limits of [{ events: 0 }, { events: -1 }, { events: 1.1 }, { events: 1_000_001 }, { private: 1 }]) {
      let caught: unknown;
      try { createClaudeAdapter(context, limits as Partial<ClaudeLimits>); } catch (error) { caught = error; }
      expect(caught).toBeDefined(); expect(safeErrorEnvelope(caught).error.code).toBe("INVALID_ARGUMENT");
    }
  });
  test("snapshots, batches and retained inspection never expose mutable canonical values", () => {
    const adapter = createClaudeAdapter(context);
    const batch = adapter.ingest(assistant(), source(1));
    const before = adapter.snapshot();
    expect(Object.isFrozen(batch)).toBe(true); expect(Object.isFrozen(batch.events)).toBe(true); expect(Object.isFrozen(batch.events[0])).toBe(true);
    expect(() => { (before.events[0] as unknown as { status: string }).status = "failed"; }).toThrow();
    adapter.ingest(user(), source(2));
    expect(before.events[0]!.status).toBe("pending"); expect(event(adapter).status).toBe("completed");
    expect(Object.isFrozen(adapter.snapshot().stateCounts)).toBe(true);
    expect(claudeEventId(context, stream, "call")).toBe(event(adapter).id);
  });
});
