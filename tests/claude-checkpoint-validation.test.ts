import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { ClaudeAdapter, createClaudeAdapter } from "../src/parsers/claude/index.js";
import type { ClaudeInputSource, ClaudeLimits } from "../src/parsers/claude/types.js";

const context = createIdentityContext(Buffer.alloc(32, 23), "2".repeat(32));
const fileIdentity = "/FICTITIOUS_CHECKPOINT_VALIDATION_PATH";
const sourceId = context.fingerprint("source", ["claude", fileIdentity]);
const boundary = { sourceId, completedOffset: 2000, nextOrdinal: 3 };
const usage = { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const records = [
  { type: "assistant", uuid: "call", sessionId: "session", timestamp: "2026-09-01T00:00:00.000Z", message: { id: "response", role: "assistant", content: [{ type: "tool_use", id: "call", name: "Bash", input: { command: "npm test private-target" } }], usage } },
  { type: "user", uuid: "result", sessionId: "session", timestamp: "2026-09-01T00:00:04.000Z", parentUuid: "call", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call", is_error: false, content: "PRIVATE_RESULT_SENTINEL" }] } },
  { type: "system", subtype: "turn_duration", uuid: "turn", sessionId: "session", durationMs: 4000 },
];
function good() {
  const adapter = createClaudeAdapter(context);
  records.forEach((record, ordinal) => adapter.ingest(record, { fileIdentity, sourceAlias: "source-1", ordinal, byteOffset: ordinal * 500 }));
  const result = adapter.exportCheckpoint(boundary);
  expect(result.status).toBe("captured");
  if (result.status !== "captured") throw new Error("capture failed");
  return { adapter, encoded: result.checkpoint };
}
type Data = Record<string, any>; // Intentionally untrusted mutation fixtures, never production validation.
function decode(encoded: string): Data { return JSON.parse(JSON.parse(encoded).payload); }
function sign(value: Data): string {
  const payload = JSON.stringify(value);
  return JSON.stringify({ schema: "agentprof.claude-checkpoint/v1", payload, tag: context.fingerprint("source", ["agentprof.claude-checkpoint/v1", createHash("sha256").update(payload).digest("hex")]) });
}
function reject(encoded: unknown, expected = boundary, limits: Partial<ClaudeLimits> = {}) {
  const original = good().adapter, before = original.inspectRetainedState();
  const restored = ClaudeAdapter.restoreCheckpoint(context, encoded as string, expected, limits);
  expect(restored.status).toBe("rejected");
  expect("adapter" in restored).toBe(false);
  expect(original.inspectRetainedState()).toEqual(before);
  expect(JSON.stringify(restored)).not.toContain("PRIVATE");
  return restored;
}

describe("bounded untrusted Claude checkpoint restore", () => {
  it.each([null, undefined, 7, {}, [], true, "", "null", "[]", "{", '{"schema":"wrong"}'])("rejects invalid outer input %#", value => {
    reject(value);
  });

  it("never invokes object accessors, toJSON, proxies or conversion hooks", () => {
    let calls = 0;
    const dangerous = { get payload() { calls++; throw Error("PRIVATE"); }, toJSON() { calls++; throw Error("PRIVATE"); }, toString() { calls++; throw Error("PRIVATE"); } };
    reject(dangerous);
    reject(new Proxy({}, { get() { calls++; throw Error("PRIVATE"); }, ownKeys() { calls++; throw Error("PRIVATE"); } }));
    expect(calls).toBe(0);
  });

  it("rejects outer byte overflow, deep nesting and malformed escaped strings", () => {
    reject(" ".repeat(4 * 1024 * 1024 + 1));
    reject('"'+ "한".repeat(2 * 1024 * 1024) + '"');
    reject("[".repeat(17) + "0" + "]".repeat(17));
    reject('{"payload":"\\');
  });

  it("rejects duplicate JSON keys in outer and authenticated inner objects", () => {
    const { encoded } = good(), outer = JSON.parse(encoded);
    reject(encoded.replace('{"schema":', '{"schema":"agentprof.claude-checkpoint/v1","schema":'));
    const payload = outer.payload.replace('{"schemaVersion":', '{"schemaVersion":1,"schemaVersion":');
    expect(payload).not.toBe(outer.payload);
    reject(JSON.stringify({ schema: outer.schema, payload, tag: context.fingerprint("source", ["agentprof.claude-checkpoint/v1", createHash("sha256").update(payload).digest("hex")]) }));
  });

  it("rejects altered tags, data, tag domains and wrong secrets including same keyId", () => {
    const { encoded } = good(), outer = JSON.parse(encoded);
    reject(JSON.stringify({ ...outer, tag: outer.tag.slice(0, -1) + (outer.tag.endsWith("0") ? "1" : "0") }));
    reject(JSON.stringify({ ...outer, payload: outer.payload + " " }));
    reject(JSON.stringify({ ...outer, tag: outer.tag.replace(":source:", ":event:") }));
    for (const identity of [createIdentityContext(Buffer.alloc(32, 24), context.keyId), createIdentityContext(Buffer.alloc(32, 23), "3".repeat(32))]) {
      const result = ClaudeAdapter.restoreCheckpoint(identity, encoded, boundary);
      expect(result.status).toBe("rejected");
      expect("adapter" in result).toBe(false);
    }
  });

  it("rejects reordered outer schema/payload/tag keys", () => {
    const outer = JSON.parse(good().encoded);
    reject(JSON.stringify({ payload: outer.payload, schema: outer.schema, tag: outer.tag }));
    reject(JSON.stringify({ tag: outer.tag, payload: outer.payload, schema: outer.schema }));
  });

  it("requires exact external source, completed boundary, next ordinal and effective limits", () => {
    const { encoded } = good();
    reject(encoded, { ...boundary, sourceId: context.fingerprint("source", ["claude", "other"]) });
    reject(encoded, { ...boundary, completedOffset: 1999 });
    reject(encoded, { ...boundary, nextOrdinal: 4 });
    reject(encoded, boundary, { events: 1 });
  });

  const mutations: readonly [string, (value: Data) => void][] = [
    ["schema version", value => { value.schemaVersion = 2; }],
    ["parser version", value => { value.parserVersion = 3; }],
    ["normalization version", value => { value.normalizationVersion = 2; }],
    ["key version", value => { value.keyVersion = 2; }],
    ["provider", value => { value.provider = "codex"; }],
    ["keyId", value => { value.keyId = "3".repeat(32); }],
    ["extra root field", value => { value.rawPrompt = "PRIVATE"; }],
    ["extra state field", value => { value.state.rawPrompt = "PRIVATE"; }],
    ["negative last ordinal", value => { value.position.lastOrdinal = -1; }],
    ["unsafe next ordinal", value => { value.nextOrdinal = Number.MAX_SAFE_INTEGER + 1; }],
    ["mismatched tracker count", value => { value.position.recordCount += 1; }],
    ["nonempty null tracker", value => { value.position.firstOrdinal = null; }],
    ["wrong completed boundary", value => { value.completedOffset = value.position.lastByteOffset; }],
    ["unknown limit", value => { value.limits.rawLimit = 1; }],
    ["oversized configured collection", value => { value.limits.events = 0; }],
    ["duplicate source row", value => { value.state.sources.push(value.state.sources[0]); }],
    ["duplicate stream row", value => { value.state.streams.push(value.state.streams[0]); }],
    ["duplicate event row", value => { value.state.events.push(value.state.events[0]); }],
    ["duplicate usage row", value => { value.state.usage.push(value.state.usage[0]); }],
    ["duplicate metadata row", value => { value.state.metadata.push(value.state.metadata[0]); }],
    ["duplicate replay entry", value => { value.state.uuidReplays.push(value.state.uuidReplays[0]); }],
    ["missing mandatory event stream", value => { value.state.streams = []; }],
    ["missing mandatory usage order", value => { value.state.usageOrders = []; }],
    ["extra mandatory usage order", value => { value.state.usageOrders.push([context.fingerprint("event", ["unused"]), value.state.usageOrders[0][1]]); }],
    ["map key mismatch", value => { value.state.events[0][0] = context.fingerprint("event", ["other"]); }],
    ["wrong sourceRef", value => { value.state.events[0][1].event.sourceRef.fileId = context.fingerprint("source", ["claude", "other"]); }],
    ["future retained byteOffset", value => { value.state.events[0][1].position.sourceRef.byteOffset = boundary.completedOffset; }],
    ["unsafe ordinal", value => { value.state.events[0][1].position.ordinal = 1e30; }],
    ["bad event domain", value => { value.state.events[0][1].callDigest = context.fingerprint("source", ["bad"]); }],
    ["raw command pattern", value => { value.state.events[0][1].event.commandPattern = "PRIVATE_COMMAND_SENTINEL"; }],
    ["raw tool name", value => { value.state.events[0][1].event.toolName = "PRIVATE_TOOL_SENTINEL"; }],
    ["event source-reported timing", value => { value.state.events[0][1].event.timingEvidence = "source_reported"; }],
    ["event estimated timing", value => { value.state.events[0][1].event.timingEvidence = "estimated"; }],
    ["event process runtime", value => { value.state.events[0][1].event.durationScope = "process_runtime"; }],
    ["event item lifecycle", value => { value.state.events[0][1].event.intervalScope = "item_lifecycle"; }],
    ["event source-reported interval", value => { value.state.events[0][1].event.intervalTimingEvidence = "source_reported"; }],
    ["event fabricated lookup", value => { value.state.events[0][1].event.lookupKey = context.fingerprint("lookup", ["false-proof"]); }],
    ["event fabricated range", value => { value.state.events[0][1].event.lookupRange = { startLine: 1, endLine: 2 }; }],
    ["event fabricated change", value => { value.state.events[0][1].event.changeState = "unchanged"; }],
    ["event fabricated validation", value => { value.state.events[0][1].event.validationScope = "full"; }],
    ["extra safe result body", value => { value.state.events[0][1].result.body = "PRIVATE_RESULT_SENTINEL"; }],
    ["trusted result completeness", value => { value.state.events[0][1].result.contentState = "complete"; }],
    ["trusted direct result duration", value => { value.state.events[0][1].result.directDurationMs = 1; }],
    ["trusted usage finality", value => { value.state.usage[0][1].finality = "trusted_final"; }],
    ["trusted order group", value => { value.state.usageOrders[0][1].group = context.fingerprint("source", ["trusted"]); }],
    ["trusted proof replay", value => { value.state.usageProofReplays = [context.fingerprint("event", ["trusted"])]; }],
    ["trusted copied metadata", value => { value.state.metadata[0][1].origin = "trusted_copied"; }],
    ["unsafe message edge counter", value => { value.state.messageEdges = Number.MAX_SAFE_INTEGER + 1; }],
    ["wrong message edge counter", value => { value.state.messageEdges += 1; }],
    ["negative unsupported counter", value => { value.state.unsupported = -1; }],
    ["excess ambiguous counter", value => { value.state.ambiguous = value.state.observations.length + 1; }],
    ["wrong shapes enum", value => { value.state.shapes = ["PRIVATE_SHAPE"]; }],
    ["duplicate shapes enum", value => { value.state.shapes = ["tool_use", "tool_use"]; }],
    ["wrong partial flag type", value => { value.state.partial = 1; }],
    ["drop counter without flags", value => { value.state.diagnosticsDropped = 1; value.state.partial = false; value.state.limited = false; }],
    ["unsafe source alias", value => { value.state.events[0][1].position.sourceAlias = "PRIVATE_PATH"; }],
  ];
  it.each(mutations)("rejects re-signed malformed %s", (_name, mutate) => {
    const value = decode(good().encoded); mutate(value); reject(sign(value));
  });

  it("checks oversized rows and collection counts even when signed with a known test key", () => {
    const value = decode(good().encoded);
    value.state.events[0][1].event.commandPattern = "npm " + "--quiet ".repeat(9000) + "<args>";
    reject(sign(value));
    const over = decode(good().encoded);
    over.state.uuidReplays = Array.from({ length: over.limits.messageLinks + 1 }, (_, i) => context.fingerprint("event", ["replay", i]));
    reject(sign(over));
  });

  it("keeps inherited adapter usable after rejected restore attempts", () => {
    const { adapter } = good(), before = adapter.inspectRetainedState();
    reject("{");
    expect(adapter.inspectRetainedState()).toEqual(before);
    const baseline = good().adapter;
    const source = { fileIdentity, sourceAlias: "source-1", ordinal: 3, byteOffset: 2000 };
    expect(adapter.ingest(records[0], source)).toEqual(baseline.ingest(records[0], source));
    expect(adapter.inspectRetainedState()).toEqual(baseline.inspectRetainedState());
  });
});

describe("checkpoint eligibility without changing existing ingest behavior", () => {
  it.each([{}, { ownerSessionId: "inherited-owner" }])("excludes inherited trusted fixture context %j", trustedFixtureContext => {
    const source = Object.assign(Object.create({ trustedFixtureContext }), { fileIdentity, ordinal: 0, byteOffset: 0 });
    const adapter = createClaudeAdapter(context);
    adapter.ingest(records[0], source);
    const before = adapter.inspectRetainedState();
    expect(adapter.exportCheckpoint({ sourceId, completedOffset: 500, nextOrdinal: 1 }).status).toBe("unavailable");
    expect(adapter.inspectRetainedState()).toEqual(before);
  });

  it("never serializes caller-owned alias hooks retained by existing ingest", () => {
    let jsonCalls = 0;
    const alias = { toString: () => "source-1", toJSON: () => { jsonCalls++; return "source-1"; } };
    const adapter = createClaudeAdapter(context);
    adapter.ingest(records[0], { fileIdentity, ordinal: 0, byteOffset: 0, sourceAlias: alias } as unknown as ClaudeInputSource);
    const before = adapter.inspectRetainedState();
    jsonCalls = 0;
    const exported = adapter.exportCheckpoint({ sourceId, completedOffset: 500, nextOrdinal: 1 });
    expect(jsonCalls).toBe(0);
    expect(exported.status).toBe("unavailable");
    expect(adapter.inspectRetainedState()).toEqual(before);
  });

  it("does not invoke inherited trusted or source-alias getters during eligibility/export", () => {
    let trustedGets = 0, aliasGets = 0;
    const inherited = Object.create({ get trustedFixtureContext() { trustedGets++; throw new Error("PRIVATE"); } });
    Object.assign(inherited, { fileIdentity, ordinal: 0, byteOffset: 0 });
    const adapter = createClaudeAdapter(context);
    adapter.ingest(records[0], inherited);
    expect(trustedGets).toBe(1); // Existing ingest attempts it once; tracking must not.
    expect(adapter.exportCheckpoint({ sourceId, completedOffset: 500, nextOrdinal: 1 }).status).toBe("unavailable");
    expect(trustedGets).toBe(1);
    const withAlias = { fileIdentity, ordinal: 0, byteOffset: 0, get sourceAlias() { aliasGets++; return "source-1"; } };
    const aliasAdapter = createClaudeAdapter(context); aliasAdapter.ingest(records[0], withAlias);
    const afterIngest = aliasGets;
    expect(aliasAdapter.exportCheckpoint({ sourceId, completedOffset: 500, nextOrdinal: 1 }).status).toBe("unavailable");
    expect(aliasGets).toBe(afterIngest);
  });

  it("marks any trusted fixture involvement unavailable, including empty context", () => {
    for (const trustedFixtureContext of [{}, { knownCopiedOrdinals: [0] }]) {
      const adapter = createClaudeAdapter(context);
      adapter.ingest(records[0], { fileIdentity, byteOffset: 0, ordinal: 0, trustedFixtureContext });
      const before = adapter.inspectRetainedState();
      const exported = adapter.exportCheckpoint({ sourceId, completedOffset: 500, nextOrdinal: 1 });
      expect(exported.status).toBe("unavailable");
      expect("checkpoint" in exported).toBe(false);
      expect(adapter.inspectRetainedState()).toEqual(before);
    }
  });

  it.each([
    { fileIdentity: "other", ordinal: 3, byteOffset: 2000 },
    { fileIdentity, ordinal: 4, byteOffset: 2000 },
    { fileIdentity, ordinal: 3, byteOffset: 1000 },
    { fileIdentity, ordinal: -1, byteOffset: 2000 },
    { fileIdentity, ordinal: 3, byteOffset: Number.MAX_SAFE_INTEGER + 1 },
  ])("unavailable for invalid descriptor progression %# without rewriting old state", source => {
    const { adapter } = good(), baseline = good().adapter;
    expect(adapter.ingest(records[0], source)).toEqual(baseline.ingest(records[0], source));
    const exported = adapter.exportCheckpoint({ sourceId, completedOffset: 2500, nextOrdinal: 4 });
    expect(exported.status).toBe("unavailable");
    expect("checkpoint" in exported).toBe(false);
    expect(adapter.inspectRetainedState()).toEqual(baseline.inspectRetainedState());
  });

  it("requires restored first byte start to be at least completedOffset, not last start", () => {
    const { encoded } = good();
    for (const byteOffset of [1001, 1999]) {
      const restored = ClaudeAdapter.restoreCheckpoint(context, encoded, boundary);
      expect(restored.status).toBe("restored");
      if (restored.status !== "restored") throw new Error("restore failed");
      const source = { fileIdentity, ordinal: 3, byteOffset };
      const baseline = good().adapter;
      expect(restored.adapter.ingest(records[0], source)).toEqual(baseline.ingest(records[0], source));
      expect(restored.adapter.exportCheckpoint({ sourceId, completedOffset: 2500, nextOrdinal: 4 }).status).toBe("unavailable");
    }
    const result = ClaudeAdapter.restoreCheckpoint(context, encoded, boundary);
    if (result.status !== "restored") throw new Error("restore failed");
    result.adapter.ingest(records[0], { fileIdentity, ordinal: 3, byteOffset: 2000 });
    expect(result.adapter.exportCheckpoint({ sourceId, completedOffset: 2500, nextOrdinal: 4 }).status).toBe("captured");
  });

  it("rejects invalid caller boundaries without damaging future valid export", () => {
    const { adapter } = good(), before = adapter.inspectRetainedState();
    for (const invalid of [
      { ...boundary, completedOffset: 1000 }, { ...boundary, nextOrdinal: 4 },
      { ...boundary, completedOffset: Number.POSITIVE_INFINITY },
      { ...boundary, sourceId: context.fingerprint("source", ["wrong"]) },
    ]) expect(adapter.exportCheckpoint(invalid).status).toBe("unavailable");
    expect(adapter.inspectRetainedState()).toEqual(before);
    expect(adapter.exportCheckpoint(boundary).status).toBe("captured");
  });
});
