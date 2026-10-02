import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { CodexAdapter, createCodexAdapter } from "../src/parsers/codex/index.js";
import type { CodexInputSource, CodexLimits } from "../src/parsers/types.js";

// Pre-implementation acceptance tests. Mutations are synthetic and re-signed;
// authentication-only rejection is not a structural validator test.
const secret = Buffer.alloc(32, 37), keyId = "7".repeat(32);
const context = createIdentityContext(secret, keyId);
const schema = "agentprof.codex-checkpoint/v1", fileIdentity = "/FICTITIOUS_CODEX_VALIDATION_SOURCE";
const identity = (domain: string, ...parts: unknown[]) => `h1:${keyId}:${domain}:${createHmac("sha256", secret).update(JSON.stringify([1, 1, domain, ...parts])).digest("hex")}`;
const sourceId = identity("source", "codex", fileIdentity);
const records = [
  { type: "session_meta", payload: { id: "session", cli_version: "0.159.0", cwd: "/FICTITIOUS_PROJECT" } },
  { type: "response_item", timestamp: "2026-09-01T00:00:00.000Z", payload: { type: "function_call", call_id: "call", name: "exec_command", arguments: '{"cmd":"rg target FICTITIOUS_COMMAND"}' } },
  { type: "response_item", timestamp: "2026-09-01T00:00:04.000Z", payload: { type: "function_call_output", call_id: "call", output: { exit_code: 1, output: "FICTITIOUS_OUTPUT" } } },
  { type: "token_usage_record", timestamp: "2026-09-01T00:00:05.000Z", payload: { response_id: "response", turn_id: "turn", usage: { input_tokens: 100, output_tokens: 10, cached_input_tokens: 20, cache_write_input_tokens: 5, reasoning_output_tokens: 2, total_tokens: 110 }, thread_token_usage: { input_tokens: 100, output_tokens: 10, cached_input_tokens: 20, cache_write_input_tokens: 5, reasoning_output_tokens: 2, total_tokens: 110 } } },
  { type: "event_msg", payload: { type: "task_complete", turn_id: "turn", started_at: 1788220800, completed_at: 1788220804, duration_ms: 3500 } },
  { type: "unknown", payload: {} },
  { type: "response_item", payload: { type: "function_call", call_id: "unsupported", name: "unknown", arguments: "{}" } },
  { type: "response_item", payload: { type: "function_call", call_id: "wrapper", name: "exec", arguments: "{}" } },
  { type: "response_item", payload: { type: "function_call", call_id: "poll", name: "write_stdin", arguments: '{"session_id":456,"chars":""}' } },
  { type: "response_item", payload: { type: "function_call_output", call_id: "orphan", output: { exit_code: 0 } } },
  { type: "response_item", timestamp: "2026-09-01T00:00:00.000Z", payload: { type: "function_call", call_id: "launch", name: "exec_command", arguments: '{"cmd":"rg other"}' } },
  { type: "response_item", payload: { type: "function_call_output", call_id: "launch", output: { running: true, session_id: 123 } } },
  { type: "response_item", timestamp: "2026-09-01T00:00:00.000Z", payload: { type: "function_call", call_id: "mcp", name: "mcp__fixture__tool", arguments: "{}" } },
  { type: "response_item", timestamp: "2026-09-01T00:00:01.000Z", payload: { type: "function_call_output", call_id: "mcp", output: { isError: false, content: "FICTITIOUS_MCP" } } },
  { type: "response_item", payload: { type: "custom_tool_call", call_id: "patch", name: "apply_patch", input: "FICTITIOUS_PATCH" } },
  { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "patch", output: "FICTITIOUS_PATCH_RESULT" } },
];
const sources: CodexInputSource[] = []; let total = 0;
records.forEach((record, ordinal) => { sources.push({ fileIdentity, ordinal, byteOffset: total, sourceAlias: "source-1" }); total += Buffer.byteLength(JSON.stringify(record) + "\n"); });
const binding = { sourceId, completedOffset: total, nextOrdinal: records.length };
function good() {
  const adapter = createCodexAdapter(context); records.forEach((record, i) => adapter.ingest(record, sources[i]!));
  const captured = adapter.exportCheckpoint(binding); expect(captured.status).toBe("captured");
  if (captured.status !== "captured") throw Error("capture failed");
  return { adapter, token: captured.checkpoint };
}
type Data = Record<string, any>; // Deliberately untrusted synthetic mutations.
const decode = (token: string): Data => JSON.parse(JSON.parse(token).payload);
function wrap(payload: string) { return JSON.stringify({ schema, payload, tag: identity("source", schema, createHash("sha256").update(payload, "utf8").digest("hex")) }); }
const sign = (value: Data) => wrap(JSON.stringify(value));
function reject(value: unknown, expected = binding, limits: Partial<CodexLimits> = {}) {
  const result = CodexAdapter.restoreCheckpoint(context, value, expected, limits);
  expect(result).toEqual({ status: "rejected", reason: "invalid_checkpoint" });
  expect("adapter" in result).toBe(false);
  expect(JSON.stringify(result)).not.toContain("FICTITIOUS");
}

describe("bounded untrusted ordinary Codex checkpoint", () => {
  it.each([undefined, null, 0, false, {}, [], "", "null", "[]", "{", '{"schema":"other"}'])("rejects noncanonical outer input %#", value => { reject(value); });
  it("rejects conversion hooks without invoking them", () => {
    let invoked = 0;
    reject({ get payload() { invoked++; throw Error("FICTITIOUS"); }, toJSON() { invoked++; throw Error("FICTITIOUS"); }, toString() { invoked++; throw Error("FICTITIOUS"); } });
    reject(new Proxy({}, { get() { invoked++; throw Error("FICTITIOUS"); }, ownKeys() { invoked++; throw Error("FICTITIOUS"); } }));
    expect(invoked).toBe(0);
  });
  it("preflights restore limits before constructor spread, without any getter or proxy trap", () => {
    const { token } = good(); let invoked = 0;
    const getter = { get events() { invoked++; throw Error("FICTITIOUS"); } };
    const proxy = new Proxy({}, { get() { invoked++; throw Error("FICTITIOUS"); }, ownKeys() { invoked++; throw Error("FICTITIOUS"); }, getPrototypeOf() { invoked++; throw Error("FICTITIOUS"); }, getOwnPropertyDescriptor() { invoked++; throw Error("FICTITIOUS"); } });
    for (const limits of [getter, proxy]) expect(CodexAdapter.restoreCheckpoint(context, token, binding, limits as Partial<CodexLimits>)).toEqual({ status: "rejected", reason: "invalid_checkpoint" });
    expect(invoked).toBe(0);
  });
  it("preflights binding and export options without invoking accessors or proxy traps", () => {
    const { adapter, token } = good(); let invoked = 0;
    const getter = { get sourceId() { invoked++; throw Error("FICTITIOUS"); }, completedOffset: binding.completedOffset, nextOrdinal: binding.nextOrdinal };
    const option = { get maxBytes() { invoked++; throw Error("FICTITIOUS"); } };
    const proxy = new Proxy({}, { get() { invoked++; throw Error("FICTITIOUS"); }, ownKeys() { invoked++; throw Error("FICTITIOUS"); }, getPrototypeOf() { invoked++; throw Error("FICTITIOUS"); }, getOwnPropertyDescriptor() { invoked++; throw Error("FICTITIOUS"); } });
    for (const value of [getter, proxy]) {
      expect(adapter.exportCheckpoint(value as typeof binding)).toEqual({ status: "unavailable", reason: "incompatible_binding" });
      expect(CodexAdapter.restoreCheckpoint(context, token, value as typeof binding)).toEqual({ status: "rejected", reason: "invalid_checkpoint" });
    }
    for (const value of [option, proxy]) expect(adapter.exportCheckpoint(binding, value)).toEqual({ status: "unavailable", reason: "incompatible_binding" });
    expect(invoked).toBe(0);
  });
  it("accepts safe null-prototype restore limits and preserves direct constructor behavior", () => {
    const { token } = good(), limits = Object.assign(Object.create(null), { events: 4096 });
    expect(CodexAdapter.restoreCheckpoint(context, token, binding, limits).status).toBe("restored");
    let invoked = 0;
    createCodexAdapter(context, { get events() { invoked++; return 4096; } });
    expect(invoked).toBe(1);
  });
  it("rejects outer/inner duplicate keys and reordered envelope", () => {
    const { token } = good(), outer = JSON.parse(token);
    reject(token.replace('{"schema":', `{"schema":"${schema}","schema":`));
    reject(wrap(outer.payload.replace('{"schemaVersion":', '{"schemaVersion":1,"schemaVersion":')));
    reject(JSON.stringify({ payload: outer.payload, schema, tag: outer.tag }));
  });
  it("rejects payload/tag/key mutations including same ID with a different secret", () => {
    const { token } = good(), outer = JSON.parse(token);
    reject(JSON.stringify({ ...outer, payload: outer.payload + " " }));
    reject(JSON.stringify({ ...outer, tag: outer.tag.replace(":source:", ":event:") }));
    reject(JSON.stringify({ ...outer, tag: outer.tag.slice(0, -1) + (outer.tag.endsWith("0") ? "1" : "0") }));
    const changedSecret = createIdentityContext(Buffer.alloc(32, 38), keyId);
    expect(CodexAdapter.restoreCheckpoint(changedSecret, token, binding)).toEqual({ status: "rejected", reason: "invalid_checkpoint" });
  });
  it.each(["schemaVersion", "provider", "parserVersion", "normalizationVersion", "keyVersion", "keyId", "sourceId", "completedOffset", "nextOrdinal"])("rejects re-signed incompatible %s", field => {
    const value = decode(good().token); value[field] = typeof value[field] === "number" ? value[field] + 1 : "incompatible"; reject(sign(value));
  });
  it.each(["events", "turns", "usage", "sources", "streams", "links", "observations", "metadata", "diagnostics"] as const)("requires exact effective %s limit", field => {
    const { token } = good(), value = decode(token); value.limits[field] += 1; reject(sign(value)); reject(token, binding, { [field]: value.limits[field] });
  });
  it.each(["sources", "streams", "events", "turns", "usage", "usageOrder", "lastSnapshots", "wrappers", "metadata", "observations", "diagnostics", "unsupportedCalls", "pendingResults", "resultReplays", "processes", "polls", "shapes"])("rejects missing or wrong-shaped state collection %s", field => {
    const value = decode(good().token); expect(Object.hasOwn(value.state, field)).toBe(true); delete value.state[field]; reject(sign(value));
    const wrong = decode(good().token); wrong.state[field] = {}; reject(sign(wrong));
  });
  it("rejects duplicate keyed map entries and wrong key/value identities", () => {
    for (const field of ["sources", "streams", "events", "turns", "usage", "lastSnapshots", "metadata", "observations", "diagnostics"]) {
      const value = decode(good().token); expect(value.state[field].length).toBeGreaterThan(0); value.state[field].push(value.state[field][0]); reject(sign(value));
    }
    const value = decode(good().token); value.state.events[0][0] = identity("event", "wrong"); reject(sign(value));
  });
  it("rejects every object's missing, extra and wrong-typed leaf, including private safe results", () => {
    const original = decode(good().token);
    const objects: Array<Array<string | number>> = [];
    const collect = (value: unknown, path: Array<string | number>) => {
      if (value === null || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach((child, index) => collect(child, [...path, index])); return; }
      objects.push(path);
      for (const [name, child] of Object.entries(value)) collect(child, [...path, name]);
    };
    collect(original, []);
    const get = (value: Data, path: Array<string | number>): Data => path.reduce<any>((node, part) => node[part], value);
    expect(objects.length).toBeGreaterThan(40);
    let leaves = 0;
    for (const path of objects) {
      const object = get(original, path);
      const extra = structuredClone(original); get(extra, path).rawSecret = "FICTITIOUS"; reject(sign(extra));
      for (const name of Object.keys(object)) {
        const missing = structuredClone(original); delete get(missing, path)[name]; reject(sign(missing));
        if (object[name] === null || typeof object[name] !== "object") {
          const wrong = structuredClone(original); get(wrong, path)[name] = { unexpected: "FICTITIOUS" }; reject(sign(wrong)); leaves++;
        }
      }
    }
    expect(leaves).toBeGreaterThan(150);
  }, 120000);
  it("rejects every map/set duplicate and wrong identity domain", () => {
    for (const field of ["unsupportedCalls", "resultReplays", "shapes"]) {
      const value = decode(good().token); expect(value.state[field].length).toBeGreaterThan(0); value.state[field].push(value.state[field][0]); reject(sign(value));
    }
    for (const field of ["pendingResults", "processes", "polls", "wrappers"]) {
      const value = decode(good().token); expect(value.state[field].length).toBeGreaterThan(0); value.state[field].push(value.state[field][0]); reject(sign(value));
    }
    for (const field of ["sources", "streams", "events", "turns", "usage", "lastSnapshots", "metadata", "observations", "pendingResults", "processes", "polls", "wrappers"]) {
      const value = decode(good().token); value.state[field][0][0] = identity("lookup", "wrong-domain"); reject(sign(value));
    }
  });
  it("rejects impossible counters, enum vocabularies, arithmetic and mandatory references", () => {
    const mutations: Array<(v: Data) => void> = [
      v => { v.state.partial = false; v.state.limited = true; },
      v => { v.state.diagnosticsDropped = 1; v.state.limited = false; },
      v => { v.state.unsupported = v.state.observations.length + 1; },
      v => { v.state.ambiguous = v.state.observations.length + 1; },
      v => { v.state.events[0][1].policy = "invented"; },
      v => { v.state.events[0][1].mode = "invented"; },
      v => { v.state.events[0][1].event.commandPattern = "FICTITIOUS_RAW_COMMAND"; },
      v => { v.state.events[0][1].event.durationMs = 3999; },
      v => { v.state.events[0][1].event.sessionId = identity("session", "absent"); },
      v => { v.state.events[0][1].result.exec.exitCode = 2147483648; },
      v => { v.state.events[0][1].result.mcp.isError = "false"; },
      v => { v.state.events[0][1].result.other.processKey = identity("file", "wrong"); },
      v => { v.state.turns[0][1].durationMs = -1; },
      v => { v.state.turns[0][1].intervalScope = "process_runtime"; },
      v => { v.state.usage[0][1].counts.total = 111; },
      v => { v.state.usage[0][1].counts.cachedInput = 101; },
      v => { v.state.usage[0][1].counts.cacheWriteInput = 81; },
      v => { v.state.usage[0][1].counts.reasoningOutput = 11; },
      v => { v.state.usage[0][1].mapping = "unknown"; },
      v => { v.state.usage[0][1].limitations = ["invented"]; },
      v => { v.state.lastSnapshots[0][1].counts.total = 111; },
      v => { v.state.lastSnapshots[0][1].at = "not-a-date"; },
      v => { v.state.wrappers[0][1].childEventIds = [identity("event", "child")]; },
      v => { v.state.wrappers[0][1].relationship = "trusted_fixture"; },
      v => { v.state.processes[0][1] = identity("event", "missing-event"); },
      v => { v.state.diagnostics[0][1].sourceAlias = fileIdentity; },
      v => { v.state.diagnostics[0][1].severity = "error"; },
      v => { v.state.diagnostics[0][0] = "wrong-dedup-key"; },
      v => { v.state.metadata[0][1].origin = "trusted_copied"; },
      v => { v.state.observations[0][1].origin = "trusted_copied"; },
      v => { v.state.observations[0][1].transportStatus = "invented"; },
    ];
    for (const mutate of mutations) { const value = decode(good().token); mutate(value); reject(sign(value)); }
  });
  it("rejects map counts exceeding authenticated limits and oversized valid-vocabulary rows", () => {
    const original = decode(good().token);
    for (const [field, limit] of [["sources", "sources"], ["streams", "streams"], ["events", "events"], ["turns", "turns"], ["usage", "usage"], ["pendingResults", "events"], ["wrappers", "events"], ["observations", "observations"], ["metadata", "metadata"], ["diagnostics", "diagnostics"], ["polls", "links"], ["processes", "links"], ["lastSnapshots", "usage"]]) {
      const value = structuredClone(original); value.state[field!] = Array.from({ length: value.limits[limit!] + 1 }, () => original.state[field!][0]); reject(sign(value));
    }
    const row = structuredClone(original); row.state.events[0][1].event.commandPattern = "rg " + "-n ".repeat(24000).trimEnd(); reject(sign(row));
  }, 120000);
  it("rejects extra raw fields, trusted usage/order/children, and evidence upgrades", () => {
    const mutate: Array<(value: Data) => void> = [
      v => { v.state.events[0][1].raw = "FICTITIOUS_OUTPUT"; },
      v => { v.state.events[0][1].event.sourceRef.path = fileIdentity; },
      v => { v.state.events[0][1].event.contentState = "complete"; },
      v => { v.state.events[0][1].event.contentFingerprint = identity("content", "FICTITIOUS"); },
      v => { v.state.events[0][1].event.lookupKey = identity("lookup", "FICTITIOUS"); },
      v => { v.state.usage[0][1].finality = "trusted_final"; },
      v => { v.state.usageOrder = [[v.state.usage[0][0], { group: identity("source", "order"), order: 1 }]]; },
      v => { v.state.observations.find((row: any) => row[1].observedUsage !== null)[1].observedUsage.finality = "trusted_partial"; },
      v => { v.state.wrapperChildLinks = 1; },
    ];
    for (const change of mutate) { const value = decode(good().token); change(value); reject(sign(value)); }
  });
  it("rejects unsafe scalar values and positions without removing legitimate unknowns", () => {
    for (const n of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, null, "1"]) { const value = decode(good().token); value.state.unsupported = n; reject(sign(value)); }
    const value = decode(good().token); value.state.events[0][1].event.sourceRef.byteOffset = binding.completedOffset; reject(sign(value));
    const order = decode(good().token); order.position.lastOrdinal -= 1; reject(sign(order));
    const count = decode(good().token); count.position.recordCount += 1; reject(sign(count));
    reject(good().token, { ...binding, nextOrdinal: binding.nextOrdinal + 1 });
  });
  it("rejects encoded byte/depth overflow before accepting any state", () => {
    reject(" ".repeat(4 * 1024 * 1024 + 1)); reject('"' + "한".repeat(2 * 1024 * 1024) + '"');
    reject("[".repeat(17) + "0" + "]".repeat(17)); reject(wrap("[".repeat(17) + "0" + "]".repeat(17)));
  });
  it("rejects noncanonical numbers, including signed negative zero in authenticated text", () => {
    const { token } = good(), payload = JSON.parse(token).payload as string;
    expect(payload).toContain('"byteOffset":0');
    for (const value of ["-0", "0e0", "1e400"]) reject(wrap(payload.replace('"byteOffset":0', `"byteOffset":${value}`)));
  });
  it("does not mutate the live adapter or its next suffix after rejection/budget refusal", () => {
    const { adapter, token } = good(), before = adapter.inspectRetainedState(); reject("{");
    expect(adapter.exportCheckpoint(binding, { maxBytes: Buffer.byteLength(token) - 1 })).toEqual({ status: "unavailable", reason: "checkpoint_budget" });
    expect(adapter.inspectRetainedState()).toEqual(before);
    const baseline = good().adapter, source = { fileIdentity, ordinal: binding.nextOrdinal, byteOffset: binding.completedOffset };
    const next = { type: "response_item", payload: { type: "function_call_output", call_id: "unseen", output: { exit_code: 0 } } };
    expect(adapter.ingest(next, source)).toEqual(baseline.ingest(next, source));
    expect(adapter.inspectRetainedState()).toEqual(baseline.inspectRetainedState());
  });
});

describe("ordinary eligibility and physical continuation", () => {
  const firstSource = { fileIdentity, ordinal: 0, byteOffset: 0 };
  const firstBinding = { sourceId, completedOffset: 500, nextOrdinal: 1 };
  it.each([{}, undefined, { usageEvidence: [] }, { knownCopiedOrdinals: [] }, { knownCompleteOutputOrdinals: [] }, { wrapperRelations: [] }])("rejects any own trusted context presence %#", value => {
    const adapter = createCodexAdapter(context); adapter.ingest(records[0], { ...firstSource, trustedFixtureContext: value } as CodexInputSource);
    expect(adapter.exportCheckpoint(firstBinding)).toEqual({ status: "unavailable", reason: "unsupported_state" });
  });
  it("rejects inherited trusted context and does not add tracker accessor invocation", () => {
    for (const value of [{}, undefined]) {
      const adapter = createCodexAdapter(context), source = Object.assign(Object.create({ trustedFixtureContext: value }), firstSource);
      adapter.ingest(records[0], source); expect(adapter.exportCheckpoint(firstBinding)).toEqual({ status: "unavailable", reason: "unsupported_state" });
    }
    let calls = 0; const source = Object.assign(Object.create({ get trustedFixtureContext() { calls++; return undefined; } }), firstSource);
    const adapter = createCodexAdapter(context); adapter.ingest(records[0], source);
    // Unchanged main reads this getter twice (copy and complete-output checks). The tracker adds zero.
    expect(calls).toBe(2); calls = 0;
    expect(adapter.exportCheckpoint(firstBinding)).toEqual({ status: "unavailable", reason: "unsupported_state" }); expect(calls).toBe(0);
  });
  it("rejects inherited alias getters and retained conversion objects without exporting hooks", () => {
    let calls = 0;
    for (const alias of [Object.create({ get sourceAlias() { calls++; return "source-1"; } }), { sourceAlias: { toString() { calls++; return "source-1"; }, toJSON() { calls++; return "FICTITIOUS"; } } }]) {
      const adapter = createCodexAdapter(context), source = Object.assign(alias, firstSource);
      adapter.ingest(records[0], source); calls = 0;
      expect(adapter.exportCheckpoint(firstBinding)).toEqual({ status: "unavailable", reason: "unsupported_state" }); expect(calls).toBe(0);
    }
  });
  it.each([-0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])("rejects unsafe descriptor ordinal %# without changing existing record output", ordinal => {
    const adapter = createCodexAdapter(context); adapter.ingest(records[0], { ...firstSource, ordinal });
    expect(adapter.exportCheckpoint(firstBinding)).toEqual({ status: "unavailable", reason: "unsafe_positions" });
  });
  it.each([{ byteOffset: 0, ordinal: 1 }, { byteOffset: 500, ordinal: 2 }, { byteOffset: 500, ordinal: 0 }])("rejects nonsequential source descriptor %#", bad => {
    const adapter = createCodexAdapter(context); adapter.ingest(records[0], firstSource); adapter.ingest(records[1], { fileIdentity, ...bad });
    expect(adapter.exportCheckpoint({ sourceId, completedOffset: 1000, nextOrdinal: 3 })).toEqual({ status: "unavailable", reason: "unsafe_positions" });
  });
  it("rejects a second physical source while preserving ordinary live parsing", () => {
    const adapter = createCodexAdapter(context); adapter.ingest(records[0], firstSource);
    adapter.ingest(records[1], { fileIdentity: "second-source", byteOffset: 500, ordinal: 1 });
    expect(adapter.exportCheckpoint({ sourceId, completedOffset: 1000, nextOrdinal: 2 })).toEqual({ status: "unavailable", reason: "unsupported_state" });
    expect(adapter.snapshot().stateCounts.sources).toBe(2);
  });
  it.each([0, 1, 7])("authenticates an empty prefix's chosen ordinal %i and leading physical bytes", ordinal => {
    const adapter = createCodexAdapter(context), emptyBinding = { sourceId, completedOffset: 0, nextOrdinal: ordinal };
    const token = adapter.exportCheckpoint(emptyBinding); expect(token.status).toBe("captured"); if (token.status !== "captured") throw Error("capture");
    const restored = CodexAdapter.restoreCheckpoint(context, token.checkpoint, emptyBinding); expect(restored.status).toBe("restored"); if (restored.status !== "restored") throw Error("restore");
    restored.adapter.ingest(records[0], { fileIdentity, ordinal, byteOffset: 5 });
    expect(restored.adapter.exportCheckpoint({ sourceId, completedOffset: 500, nextOrdinal: ordinal + 1 }).status).toBe("captured");
  });
  it("does not advance a restored boundary before receiving another descriptor", () => {
    const { token } = good(), restored = CodexAdapter.restoreCheckpoint(context, token, binding);
    expect(restored.status).toBe("restored"); if (restored.status !== "restored") throw Error("restore");
    expect(restored.adapter.exportCheckpoint({ ...binding, completedOffset: binding.completedOffset + 1 })).toEqual({ status: "unavailable", reason: "incompatible_binding" });
    expect(restored.adapter.exportCheckpoint({ ...binding, nextOrdinal: binding.nextOrdinal + 1 })).toEqual({ status: "unavailable", reason: "incompatible_binding" });
    expect(restored.adapter.exportCheckpoint(binding)).toEqual({ status: "captured", checkpoint: token });
  });
  it.each([{ ordinalDelta: 0, offsetDelta: -1 }, { ordinalDelta: 1, offsetDelta: 0 }])("rejects wrong first continuation descriptor %# without rolling back live ingest", ({ ordinalDelta, offsetDelta }) => {
    const { token } = good(), restored = CodexAdapter.restoreCheckpoint(context, token, binding);
    expect(restored.status).toBe("restored"); if (restored.status !== "restored") throw Error("restore");
    restored.adapter.ingest(records[0], { fileIdentity, ordinal: binding.nextOrdinal + ordinalDelta, byteOffset: binding.completedOffset + offsetDelta });
    expect(restored.adapter.exportCheckpoint({ sourceId, completedOffset: binding.completedOffset + 500, nextOrdinal: binding.nextOrdinal + ordinalDelta + 1 })).toEqual({ status: "unavailable", reason: "unsafe_positions" });
  });
  it("rejects retained negative zero while preserving positive-zero checkpointability", () => {
    for (const negative of [true, false]) {
      const adapter = createCodexAdapter(context), record = { type: "event_msg", payload: { type: "task_complete", turn_id: "zero", duration_ms: negative ? -0 : 0 } };
      adapter.ingest(records[0], firstSource); adapter.ingest(record, { fileIdentity, ordinal: 1, byteOffset: 500 });
      expect(Object.is(adapter.snapshot().turns[0]!.durationMs, -0)).toBe(negative);
      const value = adapter.exportCheckpoint({ sourceId, completedOffset: 1000, nextOrdinal: 2 });
      expect(value.status).toBe(negative ? "unavailable" : "captured");
      if (negative) expect(value).toEqual({ status: "unavailable", reason: "unsupported_state" });
      expect(Object.is(adapter.snapshot().turns[0]!.durationMs, -0)).toBe(negative);
    }
  });
});

// Additive initial-review regression cases; the frozen 87-case file above is unchanged.
describe("initial codec review regressions", () => {
  it("preflights authenticated collection counts and row bytes before payload graph allocation", () => {
    const original = decode(good().token);
    const tooMany = structuredClone(original); tooMany.state.events = Array.from({ length: tooMany.limits.events + 1 }, () => null);
    const tooLarge = structuredClone(original); tooLarge.state.events[0][1].event.commandPattern = "rg " + "-n ".repeat(24000).trimEnd();
    for (const value of [tooMany, tooLarge]) {
      const payload = JSON.stringify(value), token = wrap(payload), originalParse = JSON.parse;
      let payloadParses = 0;
      JSON.parse = (text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
        if (text === payload) payloadParses++;
        return originalParse(text, reviver);
      };
      try { reject(token); } finally { JSON.parse = originalParse; }
      expect(payloadParses).toBe(0);
    }
  });
  it("rejects a missing source with retained semantic state", () => {
    const value = decode(good().token); value.state.sources = []; reject(sign(value));
  });
  it("preserves source-empty malformed-record prefixes as a positive control", () => {
    const adapter = createCodexAdapter(context), emptySourcesBinding = { sourceId, completedOffset: 10, nextOrdinal: 2 };
    adapter.ingest(null, { fileIdentity, ordinal: 0, byteOffset: 0 });
    adapter.ingest([], { fileIdentity, ordinal: 1, byteOffset: 5 });
    const captured = adapter.exportCheckpoint(emptySourcesBinding); expect(captured.status).toBe("captured");
    if (captured.status !== "captured") throw Error("capture");
    expect(decode(captured.checkpoint).state.sources).toEqual([]);
    const restored = CodexAdapter.restoreCheckpoint(context, captured.checkpoint, emptySourcesBinding);
    expect(restored.status).toBe("restored");
    if (restored.status !== "restored") throw Error("restore");
    expect(restored.adapter.inspectRetainedState()).toEqual(adapter.inspectRetainedState());
  });
});

// Additive constructor-grounded relational regressions from the same initial review.
describe("initial codec relational regressions", () => {
  it.each(["mcp", "patch"])("rejects impossible nonnull %s exit metadata", mode => {
    const value = decode(good().token);
    value.state.events.find((row: any) => row[1].mode === mode)[1].event.exitCode = 0;
    reject(sign(value));
  });
  it("rejects source-terminal usage on the same ambiguous observation", () => {
    const value = decode(good().token);
    value.state.observations.find((row: any) => row[1].observedUsage?.finality === "source_terminal")[1].origin = "ambiguous";
    reject(sign(value));
  });
  it("rejects a nonstructured execution's mismatched call operation", () => {
    const value = decode(good().token);
    value.state.events[0][1].callOperationKey = identity("operation", "other-operation");
    reject(sign(value));
  });
  it("preserves a structured replacement's different call and event operations", () => {
    const { adapter } = good();
    adapter.ingest({ type: "event_msg", payload: { type: "item_completed", item: { type: "CommandExecution", id: "call", command: "rg other", source: "unified_exec_startup", status: "completed", exit_code: 0, duration: { secs: 2, nanos: 0 } } } }, { fileIdentity, ordinal: binding.nextOrdinal, byteOffset: binding.completedOffset });
    const nextBinding = { ...binding, nextOrdinal: binding.nextOrdinal + 1, completedOffset: binding.completedOffset + 500 };
    const captured = adapter.exportCheckpoint(nextBinding); expect(captured.status).toBe("captured");
    if (captured.status !== "captured") throw Error("capture");
    const state = decode(captured.checkpoint).state.events[0][1];
    expect(state.structured).toBe(true); expect(state.callOperationKey).not.toBe(state.event.operationKey);
    const restored = CodexAdapter.restoreCheckpoint(context, captured.checkpoint, nextBinding);
    expect(restored.status).toBe("restored");
    if (restored.status !== "restored") throw Error("restore");
    expect(restored.adapter.inspectRetainedState()).toEqual(adapter.inspectRetainedState());
  });
  it("preserves historical ordinary terminal evidence after current source ambiguity", () => {
    const { adapter } = good();
    adapter.ingest({ type: "session_meta", payload: { id: "session", forked_from_id: "parent" } }, { fileIdentity, ordinal: binding.nextOrdinal, byteOffset: binding.completedOffset });
    const nextBinding = { ...binding, nextOrdinal: binding.nextOrdinal + 1, completedOffset: binding.completedOffset + 500 };
    const captured = adapter.exportCheckpoint(nextBinding); expect(captured.status).toBe("captured");
    if (captured.status !== "captured") throw Error("capture");
    const state = decode(captured.checkpoint).state;
    expect(state.sources[0][1].ambiguous).toBe(true);
    expect(state.observations.some((row: any) => row[1].origin === "ordinary" && row[1].observedUsage?.finality === "source_terminal")).toBe(true);
    const restored = CodexAdapter.restoreCheckpoint(context, captured.checkpoint, nextBinding);
    expect(restored.status).toBe("restored");
    if (restored.status !== "restored") throw Error("restore");
    expect(restored.adapter.inspectRetainedState()).toEqual(adapter.inspectRetainedState());
  });
});

it("rejects source-empty state with a positioned malformed-object diagnostic", () => {
  const adapter = createCodexAdapter(context), oneBinding = { sourceId, completedOffset: 10, nextOrdinal: 1 };
  adapter.ingest({}, { fileIdentity, sourceAlias: "source-1", ordinal: 0, byteOffset: 5 });
  const captured = adapter.exportCheckpoint(oneBinding); expect(captured.status).toBe("captured");
  if (captured.status !== "captured") throw Error("capture");
  const value = decode(captured.checkpoint);
  expect(value.state.sources).toHaveLength(1);
  expect(value.state.diagnostics[0][1]).toMatchObject({ code: "INVALID_RECORD", sourceAlias: "source-1", byteOffset: 5 });
  value.state.sources = []; reject(sign(value), oneBinding);
});
