import { describe, expect, test } from "vitest";
import { createClaudeAdapter } from "../src/parsers/claude/index.js";
import { tokenCounts } from "../src/parsers/claude/usage.js";
import { assistant, codes, context, proof, source, usage, usageRecord } from "./claude-helpers.js";

describe("Anthropic Messages token accounting", () => {
  test("common all-input adds uncached, cache read and creation exactly once", () => {
    const checked = tokenCounts({ ...usage(10), cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 15 }, iterations: [{ input_tokens: 500, output_tokens: 100 }], thinking_tokens: 99 });
    expect(checked).toEqual({ status: "complete", counts: { uncachedInput: 100, input: 150, output: 10, cachedInput: 30, cacheWriteInput: 20, reasoningOutput: null, total: 160 } });
  });
  test("cache components may exceed uncached input without applying OpenAI containment", () => {
    expect(tokenCounts({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 30, cache_creation_input_tokens: 20 })).toMatchObject({ status: "complete", counts: { input: 51, total: 53 } });
  });
  test.each(["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"])("missing %s remains null and preserves independent valid components", (key) => {
    const raw: Record<string, unknown> = usage(10); delete raw[key];
    const checked = tokenCounts(raw);
    expect(checked.status).toBe("partial");
    expect(checked.counts.total).toBeNull();
    expect(checked.counts.reasoningOutput).toBeNull();
    if (key === "output_tokens") expect(checked.counts).toMatchObject({ input: 150, output: null, uncachedInput: 100, cachedInput: 30, cacheWriteInput: 20 });
    else { expect(checked.counts.input).toBeNull(); expect(checked.counts.output).toBe(10); }
  });
  test.each([-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "private-count"])("invalid token component %s is not coerced or zero-filled", (value) => {
    const checked = tokenCounts({ ...usage(10), input_tokens: value });
    expect(checked.status).toBe("invalid");
    expect(checked.counts).toMatchObject({ uncachedInput: null, input: null, total: null, output: 10, cachedInput: 30, cacheWriteInput: 20 });
  });
  test("safe integer component sums and total cannot overflow", () => {
    const inputOverflow = tokenCounts({ input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 });
    expect(inputOverflow).toMatchObject({ status: "invalid", counts: { input: null, total: null, output: 1 } });
    const totalOverflow = tokenCounts({ input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    expect(totalOverflow).toMatchObject({ status: "invalid", counts: { input: Number.MAX_SAFE_INTEGER, total: null } });
  });
  test("all four explicit zero counts are valid, while absent/null usage is invalid", () => {
    expect(tokenCounts({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toMatchObject({ status: "complete", counts: { input: 0, total: 0, output: 0 } });
    expect(tokenCounts(undefined)).toMatchObject({ status: "invalid", counts: { input: null, output: null, total: null } });
    expect(tokenCounts(null).status).toBe("invalid");
  });
});

describe("Claude usage snapshot ordering and finality", () => {
  test("stop reason, version and raw annotation never certify a final response", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(usageRecord("one", 10, 0, { version: "2.1.241", annotation: { final: true, mapping: "anthropic_messages" }, message: { id: "response", role: "assistant", content: [], usage: usage(10), stop_reason: "end_turn" } }), source(1));
    expect(adapter.snapshot().usage[0]).toMatchObject({ finality: "unknown", selection: "provisional", stopReason: "end_turn", terminalCandidate: true, counts: { total: 160 }, turnId: null, toolEventId: null, phase: "unknown" });
    expect(adapter.snapshot().usage[0]!.limitations).toContain("unknown_finality");
  });
  test("unknown stop reason is a fixed enum and not a terminal candidate", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(usageRecord("one", 10, 0, { message: { id: "response", role: "assistant", content: [], usage: usage(10), stop_reason: "FICTITIOUS_AGENTPROF_STOP_SENTINEL" } }), source(1));
    expect(adapter.snapshot().usage[0]).toMatchObject({ finality: "unknown", selection: "provisional", stopReason: "unknown", terminalCandidate: false });
    expect(JSON.stringify(adapter.inspectRetainedState())).not.toContain("FICTITIOUS_AGENTPROF_STOP_SENTINEL");
  });
  test("same-file ordinal selects latest provisional output and stores every source usage", () => {
    const adapter = createClaudeAdapter(context);
    for (const [ordinal, output] of [[1, 6], [2, 8], [3, 10]]) adapter.ingest(usageRecord(`uuid-${ordinal}`, output!, ordinal!), source(ordinal!));
    expect(adapter.snapshot().usage).toHaveLength(1);
    expect(adapter.snapshot().usage[0]).toMatchObject({ finality: "unknown", selection: "provisional", counts: { output: 10, total: 160 }, sourceRef: { byteOffset: 300 } });
    expect(adapter.snapshot().observations.filter((value) => value.observedUsage).map((value) => value.observedUsage!.counts.output)).toEqual([6, 8, 10]);
    expect(codes(adapter)).not.toContain("USAGE_CONFLICT");
    expect(codes(adapter)).not.toContain("USAGE_RESET");
  });
  test("reverse ingestion uses source ordinal and never clock maximum", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(usageRecord("later-source", 10, 0), source(2));
    adapter.ingest(usageRecord("earlier-source", 6, 100), source(1));
    expect(adapter.snapshot().usage[0]).toMatchObject({ counts: { output: 10 }, sourceRef: { byteOffset: 200 }, selection: "provisional" });
    expect(codes(adapter)).toContain("REORDERED_RECORD"); expect(codes(adapter)).not.toContain("USAGE_CONFLICT");
  });
  test("trusted partial6→partial8→final10 advances and does not double-sum", () => {
    const adapter = createClaudeAdapter(context);
    const trusted = proof([{ ordinal: 1, finality: "partial", order: 1 }, { ordinal: 2, finality: "partial", order: 2 }, { ordinal: 3, finality: "final", order: 3 }]);
    for (const [ordinal, output] of [[1, 6], [2, 8], [3, 10]]) adapter.ingest(usageRecord(`uuid-${ordinal}`, output!), source(ordinal!, undefined, trusted));
    expect(adapter.snapshot().usage).toHaveLength(1);
    expect(adapter.snapshot().usage[0]).toMatchObject({ counts: { input: 150, output: 10, total: 160 }, finality: "trusted_final", selection: "eligible" });
    expect(codes(adapter)).not.toContain("USAGE_CONFLICT");
  });
  test("trusted ordering group compares cross-file snapshots without guessing from timestamps", () => {
    const adapter = createClaudeAdapter(context);
    const trusted = proof([{ ordinal: 1, finality: "partial", order: 1 }, { ordinal: 2, finality: "final", order: 2 }]);
    adapter.ingest(usageRecord("first", 6, 100), source(1, "file-one", trusted));
    adapter.ingest(usageRecord("last", 10, 0), source(2, "file-two", trusted));
    expect(adapter.snapshot().usage[0]).toMatchObject({ finality: "trusted_final", selection: "eligible", counts: { output: 10 } });
    expect(codes(adapter)).not.toContain("USAGE_CONFLICT");
  });
  test("same-file older raw snapshot without proof cannot erase a later trusted final", () => {
    const adapter = createClaudeAdapter(context);
    const trusted = proof([{ ordinal: 2, finality: "final", order: 2 }]);
    adapter.ingest(usageRecord("later-final", 10), source(2, undefined, trusted));
    adapter.ingest(usageRecord("earlier-raw", 6), source(1));
    expect(adapter.snapshot().usage[0]).toMatchObject({ finality: "trusted_final", selection: "eligible", counts: { output: 10 } });
    expect(codes(adapter)).not.toContain("USAGE_CONFLICT");
  });
  test("known raw archive snapshot without fixture proof preserves latest final counts", () => {
    const adapter = createClaudeAdapter(context);
    const trusted = proof([{ ordinal: 1, finality: "partial", order: 1 }, { ordinal: 2, finality: "final", order: 2 }]);
    adapter.ingest(usageRecord("partial", 6), source(1, "original", trusted));
    adapter.ingest(usageRecord("final", 10), source(2, "original", trusted));
    adapter.ingest(usageRecord("partial", 6), source(1, "raw-archive"));
    expect(adapter.snapshot().usage[0]).toMatchObject({ finality: "trusted_final", selection: "eligible", counts: { output: 10 } });
    expect(codes(adapter)).not.toContain("USAGE_CONFLICT");
    expect(adapter.snapshot().observations.filter((value) => value.observedUsage).map((value) => value.observedUsage!.finality)).toEqual(["trusted_partial", "trusted_final", "unknown"]);
  });
  test("a new trusted proof on the same raw snapshot is validated; identical proof replay is stable", () => {
    const adapter = createClaudeAdapter(context);
    const record = usageRecord("uuid", 10);
    adapter.ingest(record, source(1));
    expect(adapter.snapshot().usage[0]!.selection).toBe("provisional");
    const trusted = proof([{ ordinal: 1, finality: "final", order: 1 }]);
    adapter.ingest(record, source(1, undefined, trusted));
    expect(adapter.snapshot().usage[0]).toMatchObject({ counts: { output: 10 }, selection: "eligible", finality: "trusted_final" });
    const before = adapter.snapshot();
    adapter.ingest(record, source(1, undefined, trusted));
    expect(adapter.snapshot()).toEqual(before);
  });
  test("new conflicting final proof on known raw history is not suppressed by raw replay", () => {
    const adapter = createClaudeAdapter(context);
    const first = usageRecord("first", 6);
    const last = usageRecord("last", 10);
    const ordinary = proof([{ ordinal: 1, finality: "partial", order: 1 }, { ordinal: 2, finality: "final", order: 2 }]);
    adapter.ingest(first, source(1, "original", ordinary));
    adapter.ingest(last, source(2, "original", ordinary));
    adapter.ingest(first, source(1, "proof-source", proof([{ ordinal: 1, finality: "final", order: 3 }], "different-proof")));
    expect(adapter.snapshot().usage[0]).toMatchObject({ selection: "conflicted", counts: null });
    const before = adapter.snapshot();
    adapter.ingest(first, source(1, "original", ordinary));
    adapter.ingest(last, source(2, "original", ordinary));
    expect(adapter.snapshot()).toEqual(before);
  });
  test("trusted proof replay history has an independent bound; overflow cannot upgrade canonical usage", () => {
    const adapter = createClaudeAdapter(context, { usageProofReplays: 1 });
    const trusted = proof([{ ordinal: 1, finality: "partial", order: 1 }, { ordinal: 2, finality: "final", order: 2 }], "FICTITIOUS_AGENTPROF_ORDER_GROUP_SENTINEL");
    adapter.ingest(usageRecord("partial", 6), source(1, undefined, trusted));
    adapter.ingest(usageRecord("final", 10), source(2, undefined, trusted));
    expect(adapter.snapshot().stateCounts).toMatchObject({ usageProofReplays: 1, usageOrders: 1, usage: 1 });
    expect(adapter.snapshot().usage[0]).toMatchObject({ counts: { output: 6 }, finality: "trusted_partial", selection: "provisional" });
    expect(adapter.snapshot().capabilities).toMatchObject({ stateLimited: true, coverage: "partial" });
    expect(codes(adapter)).toContain("STATE_LIMIT");
    expect(JSON.stringify(adapter.inspectRetainedState())).not.toContain("FICTITIOUS_AGENTPROF_ORDER_GROUP_SENTINEL");
    const before = adapter.snapshot();
    adapter.ingest(usageRecord("partial", 6), source(1, undefined, trusted));
    expect(adapter.snapshot()).toEqual(before);
  });
  test("trusted older partial cannot downgrade final, but later unknown changed counts conflict", () => {
    const adapter = createClaudeAdapter(context);
    const trusted = proof([{ ordinal: 1, finality: "partial", order: 1 }, { ordinal: 2, finality: "final", order: 2 }]);
    adapter.ingest(usageRecord("final", 10), source(2, "final-file", trusted));
    adapter.ingest(usageRecord("partial", 6), source(1, "partial-file", trusted));
    expect(adapter.snapshot().usage[0]).toMatchObject({ finality: "trusted_final", selection: "eligible", counts: { output: 10 } });
    adapter.ingest(usageRecord("new-unknown", 12), source(3, "final-file"));
    expect(adapter.snapshot().usage[0]).toMatchObject({ counts: null, selection: "conflicted" });
    expect(codes(adapter)).toContain("USAGE_CONFLICT");
  });
  test("unseen unordered cross-source changed counts conflict; observations preserve both snapshots", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(usageRecord("one", 6), source(1, "file-one"));
    adapter.ingest(usageRecord("two", 10), source(1, "file-two"));
    expect(adapter.snapshot().usage[0]).toMatchObject({ counts: null, selection: "conflicted" });
    expect(adapter.snapshot().usage[0]!.limitations).toContain("unknown_source_order");
    expect(adapter.snapshot().observations.filter((value) => value.observedUsage).map((value) => value.observedUsage!.counts.output)).toEqual([6, 10]);
  });
  test("same counts from another file do not replace the original file's ordering authority", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(usageRecord("first", 6), source(1, "original"));
    adapter.ingest(usageRecord("equivalent-other-source", 6), source(10, "other"));
    adapter.ingest(usageRecord("later-original", 10), source(2, "original"));
    expect(adapter.snapshot().usage[0]).toMatchObject({ selection: "provisional", counts: { output: 10 } });
    expect(codes(adapter)).not.toContain("USAGE_CONFLICT");
  });
  test("different values at equal trusted order and different final values are sticky conflicts", () => {
    for (const final of [false, true]) {
      const adapter = createClaudeAdapter(context);
      const trusted = proof([{ ordinal: 1, finality: final ? "final" : "partial", order: 1 }, { ordinal: 2, finality: final ? "final" : "partial", order: final ? 2 : 1 }]);
      adapter.ingest(usageRecord("one", 6), source(1, undefined, trusted));
      adapter.ingest(usageRecord("two", 10), source(2, undefined, trusted));
      expect(adapter.snapshot().usage[0]).toMatchObject({ counts: null, selection: "conflicted" });
      adapter.ingest(usageRecord("one", 6), source(1, undefined, trusted));
      expect(adapter.snapshot().usage[0]!.selection).toBe("conflicted");
    }
  });
  test("missing API message identity cannot become eligible despite trusted proof", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(assistant("uuid", 0, [], { message: { role: "assistant", content: [], usage: usage(10) } }), source(1, undefined, proof([{ ordinal: 1, finality: "final", order: 1 }])));
    expect(adapter.snapshot().usage[0]).toMatchObject({ responseId: null, selection: "invalid", finality: "unknown", counts: { total: 160 } });
    expect(adapter.snapshot().usage[0]!.limitations).toContain("missing_response_id");
  });
  test("partial counts retain valid components while final proof stays ineligible", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(usageRecord("uuid", 10, 0, { message: { id: "response", role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 20 } } }), source(1, undefined, proof([{ ordinal: 1, finality: "final", order: 1 }])));
    expect(adapter.snapshot().usage[0]).toMatchObject({ finality: "trusted_final", selection: "provisional", countStatus: "partial", counts: { uncachedInput: 100, cachedInput: null, cacheWriteInput: 20, output: 10, input: null, total: null } });
    expect(adapter.snapshot().usage[0]!.limitations).toContain("partial_counts");
    expect(codes(adapter)).toContain("INSUFFICIENT_USAGE");
  });
  test("ambiguous origin and invalid counts cannot become eligible", () => {
    const adapter = createClaudeAdapter(context);
    adapter.ingest(usageRecord("fork-row", 10, 0, { forkedFromSessionId: "unknown-origin" }), source(1, undefined, proof([{ ordinal: 1, finality: "final", order: 1 }])));
    expect(adapter.snapshot().usage[0]).toMatchObject({ finality: "trusted_final", selection: "provisional" });
    expect(adapter.snapshot().usage[0]!.limitations).toContain("ambiguous_origin");
    const invalid = createClaudeAdapter(context);
    invalid.ingest(usageRecord("uuid", 10, 0, { message: { id: "response", role: "assistant", content: [], usage: { ...usage(10), output_tokens: -1 } } }), source(1, undefined, proof([{ ordinal: 1, finality: "final", order: 1 }])));
    expect(invalid.snapshot().usage[0]).toMatchObject({ finality: "trusted_final", selection: "invalid", countStatus: "invalid", counts: { output: null, total: null } });
    expect(codes(invalid)).toContain("INVALID_USAGE");
  });
});
