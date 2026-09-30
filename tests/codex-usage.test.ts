import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createCodexAdapter } from "../src/parsers/codex/index.js";
import { tokenCounts } from "../src/parsers/codex/usage.js";
import { readJsonLines } from "../src/scanner/jsonl.js";
import type { TrustedFixtureContext } from "../src/parsers/types.js";

const context = createIdentityContext(new Uint8Array(32).fill(31), "3".repeat(32));
const directory = fileURLToPath(new URL("./fixtures/providers/", import.meta.url));
const expected = JSON.parse(await readFile(`${directory}/codex-usage-expected.json`, "utf8"));
const counts = (output = 10) => ({ input_tokens: 100, output_tokens: output, cached_input_tokens: 40, cache_write_input_tokens: 60, reasoning_output_tokens: 4, total_tokens: 100 + output });
function harness(version = "0.159.0", metadata: Record<string, unknown> = {}) {
  const adapter = createCodexAdapter(context);
  let ordinal = 0;
  const push = (payload: unknown, native = true, evidence?: { finality: "partial" | "final"; order: number; group?: string }) => {
    const supplied: TrustedFixtureContext | undefined = evidence ? { usageEvidence: [{ ordinal, finality: evidence.finality, order: evidence.order, orderingGroup: evidence.group ?? "synthetic-order-group", mapping: "openai_responses" }] } : undefined;
    const value = adapter.ingest({ type: native ? "token_usage_record" : "event_msg", timestamp: new Date(1788393600000 + ordinal * 1000).toISOString(), payload: native ? payload : { type: "token_usage_record", ...(payload as object) } }, { fileIdentity: "synthetic-usage-source", byteOffset: ordinal * 300, ordinal, ...(supplied ? { trustedFixtureContext: supplied } : {}) });
    ordinal++; return value;
  };
  adapter.ingest({ type: "session_meta", payload: { id: "synthetic-usage-stream", cli_version: version, ...metadata } }, { fileIdentity: "synthetic-usage-source", byteOffset: 0, ordinal: 0 });
  ordinal = 1;
  const response = (usage: unknown, native = true, evidence?: { finality: "partial" | "final"; order: number; group?: string }) => push({ thread_id: "synthetic-usage-stream", turn_id: "synthetic-turn", response_id: "synthetic-response", usage }, native, evidence);
  const selected = () => adapter.snapshot().usage.find((value) => value.source === "response_usage")!;
  return { adapter, response, selected, push };
}

test("independent partial6/partial8/final10 fixture picks the final snapshot without adding sources", async () => {
  const adapter = createCodexAdapter(context);
  let ordinal = 0;
  const evidence: TrustedFixtureContext = { usageEvidence: [1, 2, 3, 4, 5].map((ordinal) => ({ ordinal, finality: ordinal < 3 ? "partial" : "final", order: ordinal, orderingGroup: "synthetic-oracle-order", mapping: "openai_responses" })) };
  for await (const entry of readJsonLines(`${directory}/${expected.file}`)) if (entry.kind === "record") adapter.ingest(entry.value, { fileIdentity: "synthetic-oracle-source", byteOffset: entry.byteOffset, ordinal: ordinal++, trustedFixtureContext: evidence });
  const snapshot = adapter.snapshot();
  const response = snapshot.usage.filter((value) => value.source === "response_usage");
  expect(response).toHaveLength(expected.canonicalResponses);
  expect(response[0]).toMatchObject({ selection: "eligible", finality: "trusted_final", counts: expected.finalCounts });
  expect(snapshot.usage.filter((value) => value.source !== "response_usage")).toHaveLength(expected.snapshotCount);
  const observed = snapshot.observations.filter((value) => value.usageId === response[0]!.id).map((value) => value.observedUsage!.counts!.output);
  expect(observed).toEqual(expected.outputsObserved);
  expect(snapshot.diagnostics.some((value) => value.code === "USAGE_RESET")).toBe(expected.lastSnapshotDecreaseIsReset);
  expect(snapshot.diagnostics.some((value) => value.code === "USAGE_CONFLICT")).toBe(false);
});

describe("usage finality, replay order and unsupported attribution", () => {
  test("native terminal record requires verified source and ordinary ownership; event_msg stays provisional", () => {
    const native = harness(); native.response(counts());
    expect(native.selected()).toMatchObject({ selection: "eligible", finality: "source_terminal", mapping: "openai_responses", toolEventId: null, phase: "unknown" });
    const unverified = harness("synthetic-unknown"); unverified.response(counts());
    expect(unverified.selected()).toMatchObject({ selection: "provisional", finality: "unknown", counts: { input: 100, output: 10, total: null } });
    const fallback = harness(); fallback.response(counts(), false);
    expect(fallback.selected()).toMatchObject({ selection: "provisional", finality: "unknown" });
    const fork = harness("0.159.0", { forked_from_id: "synthetic-parent", subagent_history_start_ordinal: 9 }); fork.response(counts());
    expect(fork.selected()).toMatchObject({ selection: "provisional", finality: "unknown", mapping: "openai_responses", counts: { total: 110 } });
    expect(fork.selected().limitations).toContain("ambiguous_origin");
  });
  test("trusted partial progress converges to final and retains observed partial values", () => {
    const h = harness("synthetic-provisional");
    h.response(counts(6), false, { finality: "partial", order: 1 });
    expect(h.selected()).toMatchObject({ selection: "provisional", counts: { output: 6 } });
    h.response(counts(8), false, { finality: "partial", order: 2 });
    expect(h.selected()).toMatchObject({ selection: "provisional", counts: { output: 8 } });
    h.response(counts(10), false, { finality: "final", order: 3 });
    expect(h.selected()).toMatchObject({ selection: "eligible", counts: { output: 10, total: 110 } });
    expect(h.adapter.snapshot().usage).toHaveLength(1);
    expect(h.adapter.snapshot().diagnostics.some((value) => value.code === "USAGE_CONFLICT")).toBe(false);
  });
  test("only an earlier partial in the same trusted ordering group can replay after final", () => {
    const h = harness("synthetic-provisional");
    h.response(counts(10), false, { finality: "final", order: 3 });
    h.response(counts(6), false, { finality: "partial", order: 1 });
    expect(h.selected()).toMatchObject({ selection: "eligible", counts: { output: 10 } });
    expect(h.adapter.snapshot().diagnostics.some((value) => value.code === "REORDERED_RECORD")).toBe(true);
    h.response(counts(8), false);
    expect(h.selected()).toMatchObject({ selection: "conflicted", counts: null });
  });
  test.each([
    [{ finality: "partial", order: 1 }, { finality: "partial", order: 1 }],
    [{ finality: "partial", order: 1 }, { finality: "final", order: 2, group: "synthetic-other-order" }],
    [{ finality: "final", order: 2 }, { finality: "final", order: 3 }],
    [{ finality: "final", order: 2 }, { finality: "partial", order: 3 }],
  ] as const)("incomparable or contradictory usage does not choose a last/max/sum value", (first, second) => {
    const h = harness("synthetic-provisional");
    h.response(counts(6), false, first);
    h.response(counts(10), false, second);
    expect(h.selected()).toMatchObject({ selection: "conflicted", counts: null });
    expect(h.adapter.snapshot().diagnostics.some((value) => value.code === "USAGE_CONFLICT")).toBe(true);
  });
  test("reverse trusted partial progress keeps the newest provisional point until final", () => {
    const h = harness("synthetic-provisional");
    h.response(counts(8), false, { finality: "partial", order: 2 });
    h.response(counts(6), false, { finality: "partial", order: 1 });
    expect(h.selected()).toMatchObject({ selection: "provisional", counts: { output: 8 } });
    h.response(counts(10), false, { finality: "final", order: 3 });
    expect(h.selected()).toMatchObject({ selection: "eligible", counts: { output: 10 } });
  });
  test("native final response contradictions are excluded even with increasing timestamps", () => {
    const h = harness(); h.response(counts(6)); h.response(counts(10));
    expect(h.selected()).toMatchObject({ selection: "conflicted", counts: null });
    h.response(counts(6));
    expect(h.selected().selection).toBe("conflicted");
  });
  test("missing input/output preserves other valid components but keeps total null and provisional", () => {
    const inputMissing = harness(); inputMissing.response({ output_tokens: 10, cached_input_tokens: 40, reasoning_output_tokens: 4, total_tokens: 110 });
    expect(inputMissing.selected()).toMatchObject({ counts: { input: expected.missingInput.input, output: expected.missingInput.output, total: expected.missingInput.total }, selection: expected.missingInput.selection, countStatus: "partial", finality: "source_terminal" });
    const outputMissing = harness(); outputMissing.response({ input_tokens: 100, cached_input_tokens: 40, total_tokens: 110 });
    expect(outputMissing.selected()).toMatchObject({ counts: { input: 100, output: null, total: null }, selection: "provisional", countStatus: "partial" });
    const cacheMissing = harness(); cacheMissing.response({ input_tokens: 100, output_tokens: 10, total_tokens: 110 });
    expect(cacheMissing.selected()).toMatchObject({ counts: expected.optionalComponentsMissing, selection: "eligible", countStatus: "partial" });
  });
  test("cache-write is already included; reported zero retains its default ambiguity", () => {
    const h = harness(); h.response(counts());
    expect(h.selected().counts!.total).toBe(110);
    expect(h.selected().counts!.input! - h.selected().counts!.cachedInput! - h.selected().counts!.cacheWriteInput!).toBe(expected.ordinaryInputIfAllComponentsKnown);
    const zero = harness(); zero.response({ ...counts(), cache_write_input_tokens: 0 });
    expect(zero.selected().limitations).toContain("zero_or_source_default");
  });
});

describe("checked token components", () => {
  test.each([
    { ...counts(), cached_input_tokens: 101 },
    { ...counts(), cache_write_input_tokens: 101 },
    { ...counts(), cache_write_input_tokens: 61 },
    { ...counts(), reasoning_output_tokens: 11 },
    { ...counts(), output_tokens: -1 },
    { ...counts(), output_tokens: 1.5 },
    { ...counts(), input_tokens: Infinity },
    { ...counts(), total_tokens: 111 },
    { ...counts(), input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1, total_tokens: Number.MAX_SAFE_INTEGER },
  ])("invalid finite/integer/containment values never become eligible usage", (value) => {
    expect(tokenCounts(value, "openai_responses").status).toBe("invalid");
    const h = harness(); h.response(value);
    expect(h.selected().selection).toBe("invalid");
    expect(h.adapter.snapshot().diagnostics.some((value) => value.code === "INVALID_USAGE")).toBe(true);
  });
  test("only verified cumulative snapshots diagnose decreases; recent-response last snapshots can shrink", () => {
    const h = harness();
    h.push({ thread_id: "synthetic-usage-stream", turn_id: "t", response_id: "r1", usage: counts(), thread_token_usage: counts() });
    h.push({ thread_id: "synthetic-usage-stream", turn_id: "t", response_id: "r2", usage: counts(), thread_token_usage: { ...counts(), input_tokens: 50, output_tokens: 5, cached_input_tokens: 0, cache_write_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 55 } });
    expect(h.adapter.snapshot().diagnostics.filter((value) => value.code === "USAGE_RESET")).toHaveLength(1);
    expect(h.adapter.snapshot().usage.filter((value) => value.source === "thread_snapshot").every((value) => value.selection === "snapshot_only")).toBe(true);
  });
});
