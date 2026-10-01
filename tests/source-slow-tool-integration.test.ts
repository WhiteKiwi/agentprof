import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSourceSlowTool } from "../src/analysis/source-slow-tool.js";
import type { SourceSlowToolAnalysis } from "../src/analysis/source-slow-tool.js";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import type { SourceSnapshotInput, StoredSource } from "../src/db/source-store.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createCodexAdapter, codexEventId, codexStreamId } from "../src/parsers/codex/index.js";
import { createClaudeAdapter } from "../src/parsers/claude/index.js";
import type { ClaudeTrustedFixtureContext } from "../src/parsers/claude/types.js";
import { temporaryDirectory } from "./helpers.js";

const identity = createIdentityContext(new Uint8Array(32).fill(83), "b".repeat(32));
const epoch = Date.UTC(2026, 8, 20);
const at = (ms: number) => new Date(epoch + ms).toISOString();
const sentinel = "FICTITIOUS_SLOW_TOOL_PRIVATE_SENTINEL";
const stream = "synthetic-slow-stream";
const cid = (raw: string) => codexEventId(identity, codexStreamId(identity, stream), raw);
const codexRecord = (payload: unknown, ms = 0, type = "response_item") => ({ timestamp: at(ms), type, payload });
const metadata = () => codexRecord({ id: stream, cli_version: "0.159.0", cwd: `/${sentinel}`, instructions: sentinel }, 0, "session_meta");
const call = (raw: string, command: string, ms = 0) => codexRecord({ type: "function_call", call_id: raw, name: "exec_command", arguments: JSON.stringify({ cmd: command }) }, ms);
const result = (raw: string, output: unknown, ms: number) => codexRecord({ type: "function_call_output", call_id: raw, output }, ms);
const item = (raw: string, duration: number, command = "npm test full", extra: Record<string, unknown> = {}) => codexRecord({ type: "item_completed", thread_id: stream, started_at_ms: epoch, completed_at_ms: epoch + 1000,
  item: { type: "CommandExecution", id: raw, source: "unified_exec_startup", command, status: "completed", exit_code: 0, duration: { secs: 0, nanos: duration * 1e6 }, output: sentinel, ...extra } }, 1000, "event_msg");
const codexBoundary = () => [metadata(), ...Array.from({ length: 5 }, (_, i) => item(`a-${i}`, 4, `npm test target-${i}`)), item("b", 80, "cargo build")];
function claudeCall(raw: string, name = "Bash", input: Record<string, unknown> = { command: "npm test full" }, ms = 0, extra: Record<string, unknown> = {}) {
  return { type: "assistant", uuid: `call-${raw}`, sessionId: stream, isSidechain: false, cwd: `/${sentinel}`, version: "synthetic-2.x", timestamp: at(ms),
    message: { id: `response-${raw}`, role: "assistant", content: [{ type: "tool_use", id: raw, name, input }] }, ...extra };
}
function claudeResult(raw: string, ms = 4, extra: Record<string, unknown> = {}) {
  return { type: "user", uuid: `result-${raw}`, sessionId: stream, isSidechain: false, timestamp: at(ms),
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: raw, is_error: false, content: sentinel }] }, ...extra };
}
function claudeBoundary() {
  return [...Array.from({ length: 5 }, (_, i) => [claudeCall(`a-${i}`, "Bash", { command: `npm test target-${i}` }), claudeResult(`a-${i}`)]).flat(), claudeCall("b", "Bash", { command: "cargo build" }), claudeResult("b", 80)];
}
async function fixture(provider: "codex" | "claude", records: unknown[], fileIdentity = "synthetic-slow-source", trusted?: ClaudeTrustedFixtureContext) {
  const directory = temporaryDirectory(), path = join(directory, "synthetic.jsonl"), bytes = Buffer.from(records.map(r => JSON.stringify(r)).join("\n") + "\n");
  await writeFile(path, bytes);
  const adapter = provider === "codex" ? createCodexAdapter(identity) : createClaudeAdapter(identity);
  let offset = 0;
  const points = records.map((record, ordinal) => {
    const point = { fileIdentity, byteOffset: offset, ordinal, sourceAlias: "source-1", ...(trusted ? { trustedFixtureContext: trusted } : {}) };
    adapter.ingest(record, point); offset += Buffer.byteLength(JSON.stringify(record)) + 1; return point;
  });
  const snapshot = adapter.snapshot();
  // Same source replay at identical positions must not invent additional executions.
  records.forEach((record, i) => adapter.ingest(record, points[i]!));
  expect(adapter.snapshot()).toEqual(snapshot);
  const input: SourceSnapshotInput = { sourceId: identity.fingerprint("source", [provider, fileIdentity]), provider, parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: identity.keyId,
    completedOffset: bytes.length, observedSize: bytes.length, boundaryFingerprint: identity.fingerprint("content", ["synthetic-boundary", bytes.length]), events: snapshot.events,
    evidence: { turns: snapshot.turns, usage: snapshot.usage, observations: snapshot.observations, diagnostics: snapshot.diagnostics, capabilities: snapshot.capabilities } };
  return { input, path, bytes, snapshot };
}
async function fileBytes(directory: string) {
  const out: Record<string, Buffer> = {};
  for (const name of (await readdir(directory)).sort()) out[name] = await readFile(join(directory, name));
  return out;
}
async function persisted(input: SourceSnapshotInput, verify: (r: SourceSlowToolAnalysis, s: StoredSource) => void) {
  const directory = temporaryDirectory(); let db = await openDatabase(directory);
  try {
    expect(createSourceStore(db, identity.keyId).replaceSourceSnapshot(input, null)).toEqual({ status: "committed", revision: 1 });
    db.close(); db = await openDatabase(directory);
    const store = createSourceStore(db, identity.keyId), saved = store.readSource(input.sourceId)!, before = await fileBytes(directory), frozenBefore = JSON.stringify(saved);
    const r = analyzeSourceSlowTool(saved); verify(r, saved);
    expect(await fileBytes(directory)).toEqual(before); expect(JSON.stringify(saved)).toBe(frozenBefore); expect(store.readSource(input.sourceId)).toEqual(saved);
    expect(JSON.stringify(r)).not.toMatch(/FICTITIOUS_SLOW_TOOL|synthetic-slow-source|boundaryFingerprint|sourceRef|operationKey|contentFingerprint|errorFingerprint/);
    expect(store.replaceSourceSnapshot(input, 1)).toEqual({ status: "committed", revision: 2 });
    expect({ ...analyzeSourceSlowTool(store.readSource(input.sourceId)!), revision: 1 }).toEqual(r);
    return r;
  } finally { db.close(); }
}

describe("persisted ordinary provider paths", () => {
  it.each(["codex", "claude"] as const)("%s adapter -> store -> reopen preserves exact threshold and bytes", async provider => {
    const f = await fixture(provider, provider === "codex" ? codexBoundary() : claudeBoundary());
    await persisted(f.input, (r, s) => {
      expect(s.events).toHaveLength(6); expect(s.events.every(e => e.parentEventId === null)).toBe(true);
      expect(r.suppressionReason).toBeNull(); expect(r.candidates).toHaveLength(1);
      const rows = s.events.filter(e => e.category === "test");
      expect(r.candidates![0]).toMatchObject({ n: 5, sumMs: 20, meanMs: 4, p50Ms: 4, p95Ms: 4, denominatorN: 6, denominatorSumMs: 100, observedEligibleNativeToolDurationShare: 0.2,
        evidenceEventIds: rows.map(e => e.id).sort(), includedEventIds: [], measurementBasis: provider === "codex" ? "direct" : "observed", durationScope: provider === "codex" ? "process_runtime" : "invocation_latency" });
      expect(new Set(rows.map(e => e.operationKey)).size).toBe(5);
    });
    expect(await readFile(f.path)).toEqual(f.bytes);
  });
  it("structured plus fallback and repeated representations count one native event each", async () => {
    const records: unknown[] = [metadata()];
    for (let i = 0; i < 5; i++) {
      records.push(call(`a-${i}`, "npm test full"), result(`a-${i}`, { exit_code: 0, output: sentinel }, 100), item(`a-${i}`, 4), item(`a-${i}`, 4));
    }
    const f = await fixture("codex", records);
    await persisted(f.input, (r, s) => {
      expect(s.events).toHaveLength(5); expect(r.candidates![0]).toMatchObject({ n: 5, sumMs: 20, timingEvidence: "source_reported", durationScope: "process_runtime" });
      expect(r.candidates![0]!.evidenceObservationIds).toHaveLength(5); expect(s.evidence!.observations.filter(o => o.representation === "structured")).toHaveLength(10);
    });
  });
  it("known wrapper without stored relationship neither adds calls nor erases children", async () => {
    const records = codexBoundary();
    records.splice(1, 0, codexRecord({ type: "custom_tool_call", call_id: "wrapper", name: "exec", input: `${sentinel}; never execute me` }));
    records.push(codexRecord({ type: "custom_tool_call_output", call_id: "wrapper", output: sentinel }, 2000));
    const f = await fixture("codex", records);
    await persisted(f.input, (r, s) => {
      expect(r.suppressionReason).toBeNull(); expect(s.events).toHaveLength(6); expect(r.observationInventory.knownWrapperIds).toBe(1); expect(r.candidates![0]!.sumMs).toBe(20);
    });
  });
  it("three polls per execution complete original Codex calls without extra samples", async () => {
    const records: unknown[] = [metadata()];
    for (let i = 0; i < 5; i++) {
      records.push(call(`launch-${i}`, "npm test full"), result(`launch-${i}`, { session_id: i + 100, output: sentinel }, 1));
      for (let p = 0; p < 3; p++) {
        records.push(codexRecord({ type: "function_call", call_id: `poll-${i}-${p}`, name: "write_stdin", arguments: JSON.stringify({ session_id: i + 100, chars: "" }) }, p + 1));
        records.push(result(`poll-${i}-${p}`, p === 2 ? { exit_code: 0, output: sentinel } : { session_id: i + 100, output: sentinel }, p + 2));
      }
    }
    const f = await fixture("codex", records);
    await persisted(f.input, (r, s) => {
      expect(s.events).toHaveLength(5); expect(r.eligibility.admittedTimedCalls).toBe(5);
      expect(r.candidates![0]).toMatchObject({ n: 5, sumMs: 20, measurementBasis: "observed", timingEvidence: "paired_timestamps", evidenceEventIds: Array.from({ length: 5 }, (_, i) => cid(`launch-${i}`)).sort() });
      const decisiveIds = new Set(r.candidates![0]!.evidenceObservationIds);
      expect(s.evidence!.observations.filter(o => decisiveIds.has(o.id) && o.representation === "poll")).toHaveLength(5);
    });
  });
  it("Codex ordinary failed transport with rg exit 1 keeps completed/no_match eligibility", async () => {
    const f = await fixture("codex", [metadata(), ...Array.from({ length: 5 }, (_, i) => item(`rg-${i}`, 4, "rg absent src", { exit_code: 1, status: "failed" }))]);
    await persisted(f.input, r => { expect(r.inventory.eventOutcomes.no_match).toBe(5); expect(r.candidates![0]!.n).toBe(5); });
  });
  it("Codex structured MCP keeps only coarse family identity", async () => {
    const records = [metadata(), ...Array.from({ length: 5 }, (_, i) => codexRecord({ type: "item_completed", thread_id: stream,
      item: { type: "McpToolCall", id: `mcp-${i}`, server: `server-${i}-${sentinel}`, tool: `tool-${i}`, arguments: { url: `https://fixture.invalid/${i}?${sentinel}` }, status: "completed", duration: { secs: 0, nanos: 4e6 }, result: { isError: false, content: [{ type: "text", text: sentinel }] } } }, 4, "event_msg"))];
    await persisted((await fixture("codex", records)).input, r => {
      expect(r.candidates![0]).toMatchObject({ n: 5, grouping: "coarse_tool_family", durationScope: "invocation_latency", sumMs: 20, group: { kind: "mcp", toolName: "mcp" } });
    });
  });
  it("Claude result-before-call reordering and a multi-call message retain final provenance", async () => {
    const callRecord = claudeCall("combined");
    callRecord.message.content = Array.from({ length: 5 }, (_, i) => ({ type: "tool_use", id: `a-${i}`, name: "Bash", input: { command: "npm test full" } }));
    const resultRecord = claudeResult("combined");
    resultRecord.message.content = Array.from({ length: 5 }, (_, i) => ({ type: "tool_result", tool_use_id: `a-${i}`, is_error: false, content: sentinel }));
    const f = await fixture("claude", [resultRecord, callRecord]);
    await persisted(f.input, r => { expect(r.candidates![0]).toMatchObject({ n: 5, sumMs: 20, measurementBasis: "observed" }); expect(r.provenance.unresolvedEvents).toBe(0); });
  });
  it("Claude sidechain stream does not pool with main stream", async () => {
    const records: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      const extra = i >= 3 ? { isSidechain: true, agentId: "synthetic-sidechain" } : {};
      records.push(claudeCall(`a-${i}`, "Bash", { command: "npm test full" }, 0, extra), claudeResult(`a-${i}`, 4, extra));
    }
    await persisted((await fixture("claude", records)).input, r => { expect(r.partitions).toHaveLength(2); expect(r.candidates).toEqual([]); expect(r.eligibility.admittedTimedCalls).toBe(5); });
  });
  it("Claude Agent/Task/Skill/unknown and background acknowledgements cannot inflate denominator", async () => {
    const records: unknown[] = claudeBoundary();
    for (const name of ["Agent", "Task", "Skill", "unknown_private_tool"]) records.push(claudeCall(name, name, { prompt: sentinel }), claudeResult(name, 999));
    records.push(claudeCall("background", "Bash", { command: "npm test full", run_in_background: true }), claudeResult("background", 1, { toolUseResult: { backgroundTaskId: "synthetic-bg", stdout: sentinel } }));
    const multi = claudeResult("unassigned", 1, { toolUseResult: { backgroundTaskId: "synthetic-unassigned", isAsync: true } });
    multi.message.content = ["u-1", "u-2"].map(raw => ({ type: "tool_result", tool_use_id: raw, is_error: false, content: sentinel }));
    records.push(claudeCall("u-1"), claudeCall("u-2"), multi);
    await persisted((await fixture("claude", records)).input, (r, s) => {
      expect(r.candidates![0]).toMatchObject({ denominatorN: 6, denominatorSumMs: 100, observedEligibleNativeToolDurationShare: 0.2 });
      expect(r.eligibility.exclusions.unsupported_call_class).toBe(4); expect(r.eligibility.exclusions.pending).toBe(1); expect(r.eligibility.exclusions.unknown_status).toBe(2);
      expect(s.evidence!.observations.some(o => "observedResult" in o && o.observedResult?.unassignedAcknowledgement)).toBe(true);
    });
  });
  it.each(["mcp__private__tool", "WebFetch"])("Claude %s stays a coarse family across different targets", async name => {
    const records = Array.from({ length: 5 }, (_, i) => [claudeCall(`a-${i}`, name, { url: `https://fixture.invalid/${i}`, query: `${sentinel}-${i}` }), claudeResult(`a-${i}`)]).flat();
    await persisted((await fixture("claude", records)).input, (r, s) => {
      expect(r.candidates![0]).toMatchObject({ grouping: "coarse_tool_family", n: 5, sumMs: 20 });
      expect(new Set(s.events.map(e => e.operationKey)).size).toBe(5); expect(JSON.stringify(r)).not.toContain("fixture.invalid");
    });
  });
  it("Claude trusted direct-duration fixture keeps scope and does not promote empirical support", async () => {
    const records: unknown[] = [], toolTimings: NonNullable<ClaudeTrustedFixtureContext["toolTimings"]>[number][] = [];
    for (let i = 0; i < 5; i++) {
      records.push(claudeCall(`a-${i}`)); toolTimings.push({ ordinal: records.length, toolUseId: `a-${i}`, source: "tool_use_result_duration_ms", durationScope: "process_runtime" });
      records.push(claudeResult(`a-${i}`, 1000, { toolUseResult: { durationMs: 4 } }));
    }
    await persisted((await fixture("claude", records, "synthetic-direct-source", { toolTimings })).input, r => {
      expect(r.candidates![0]).toMatchObject({ measurementBasis: "direct", durationScope: "process_runtime", sumMs: 20 });
      expect(r.candidates![0]!.limitations).toContain("claude_direct_duration_synthetic_contract_only");
    });
  });
});

describe("stored incompleteness, source separation and no mutation", () => {
  it.each(["codex", "claude"] as const)("missing %s timed provenance suppresses full partition after round trip", async provider => {
    const f = await fixture(provider, provider === "codex" ? codexBoundary() : claudeBoundary());
    const large = f.input.events.find(e => e.category === "build")!;
    await persisted({ ...f.input, evidence: { ...f.input.evidence, observations: f.input.evidence.observations.filter(o => o.eventId !== large.id) } }, r => {
      expect(r.candidates).toBeNull(); expect(r.partitions[0]).toMatchObject({ status: "identity_unresolved", denominatorSumMs: null, unresolvedEventIds: [large.id] });
      expect(r.eligibility.exclusions.identity_unresolved_partition).toBe(6);
    });
  });
  it("mixed ordinary/copied timed evidence is not rescued by a convenient observation", async () => {
    const f = await fixture("codex", codexBoundary()), observation = f.input.evidence.observations.find(o => o.eventId !== null)!;
    await persisted({ ...f.input, evidence: { ...f.input.evidence, observations: [...f.input.evidence.observations, { ...observation, id: identity.fingerprint("source", ["copied-observation"]), origin: "trusted_copied" }] } }, r => {
      expect(r.candidates).toBeNull(); expect(r.provenance.failures.contradictory_provenance).toBe(1); expect(r.eligibility.exclusions.identity_unresolved_partition).toBe(6);
    });
  });
  it.each(["wrapper_collision", "parent"] as const)("stored %s cannot be resolved by event similarity", async mode => {
    const f = await fixture("codex", codexBoundary()), e = f.input.events[0]!;
    const input = mode === "parent" ? { ...f.input, events: f.input.events.map(row => row.id === e.id ? { ...row, parentEventId: cid("unproven-parent") } : row) }
      : { ...f.input, evidence: { ...f.input.evidence, observations: [...f.input.evidence.observations, { id: identity.fingerprint("source", ["collision"]), eventId: e.id, turnId: null, usageId: null, representation: "wrapper" as const, origin: "ordinary" as const, transportStatus: "unknown" as const, observedUsage: null, sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset } }] } };
    await persisted(input, r => { expect(r.suppressionReason).toBe("unresolved_execution_relation"); expect(r.candidates).toBeNull(); });
  });
  it("same canonical IDs in another source stay in two uncombined envelopes", async () => {
    const a = await fixture("codex", codexBoundary(), "synthetic-source-a"), b = await fixture("codex", codexBoundary(), "synthetic-source-b");
    const one = await persisted(a.input, () => {}), two = await persisted(b.input, () => {});
    expect(one.sourceId).not.toBe(two.sourceId); expect(one.candidates![0]!.evidenceEventIds).toEqual(two.candidates![0]!.evidenceEventIds);
    expect(one.candidates![0]!.sumMs).toBe(20); expect(two.candidates![0]!.sumMs).toBe(20);
  });
  it("persisted unavailable and historical evidence-absent generations remain unknown", async () => {
    const { input } = await fixture("codex", codexBoundary()), db = await openDatabase(temporaryDirectory());
    try {
      const store = createSourceStore(db, identity.keyId); store.replaceSourceSnapshot(input, null); store.markUnavailable(input.sourceId, 1);
      expect(analyzeSourceSlowTool(store.readSource(input.sourceId)!)).toMatchObject({ candidates: null, suppressionReason: "source_unavailable" });
      const { evidence: _omitted, ...eventsOnly } = input; store.replaceSource(eventsOnly, 2);
      expect(analyzeSourceSlowTool(store.readSource(input.sourceId)!)).toMatchObject({ candidates: null, suppressionReason: "evidence_absent" });
    } finally { db.close(); }
  });
});
