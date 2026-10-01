import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarizeSource } from "../src/analysis/source-summary.js";
import type { MetricEvidence, StoredSource } from "../src/db/source-store.js";
import type { NormalizedEvent } from "../src/normalize/types.js";
import { normalizeEvent } from "../src/normalize/event.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import type { UsageObservation } from "../src/parsers/types.js";
import type { ClaudeUsage } from "../src/parsers/claude/types.js";

const identity = createIdentityContext(new Uint8Array(32).fill(37), "7".repeat(32));
const sourceId = identity.fingerprint("source", ["codex", "synthetic"]);
const sessionId = identity.fingerprint("session", ["synthetic"]);
function event(id = "a", extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { ...normalizeEvent({ provider: "codex", eventIdentity: id, sessionIdentity: "synthetic", kind: "shell", toolName: "exec_command", command: "npm test synthetic",
    status: "completed", statusEvidence: "explicit", exitCode: 0, durationMs: 10, timingEvidence: "source_reported", durationScope: "process_runtime",
    sourceRef: { fileIdentity: "synthetic", byteOffset: 1, recordType: "event_msg" } }, identity).event!, ...extra };
}
function usage(id = "a", extra: Partial<UsageObservation> = {}): UsageObservation {
  return { id: identity.fingerprint("event", ["usage", id]), sessionId, responseId: identity.fingerprint("event", ["response", id]), turnId: null,
    provider: "codex", source: "response_usage", scope: "response_increment", counts: { input: 100, output: 20, total: 120, cachedInput: 40, cacheWriteInput: 0, reasoningOutput: 5 },
    mapping: "openai_responses", finality: "source_terminal", selection: "eligible", countStatus: "complete", limitations: [], toolEventId: null, phase: "unknown", sourceRef: { fileId: sourceId, byteOffset: 1 }, ...extra };
}
function source(events: readonly NormalizedEvent[] = [], rows: MetricEvidence["usage"] = []): StoredSource {
  return { sourceId, provider: "codex", parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: identity.keyId, completedOffset: 100, observedSize: 105,
    boundaryFingerprint: identity.fingerprint("content", ["boundary"]), revision: 3, availability: "available", events,
    persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false,
    evidence: { turns: [], usage: rows, observations: [], diagnostics: [], capabilities: { provider: "codex", parserVersion: 1, support: "shape_verified_only", coverage: "recognized_shapes", observedShapes: [], unsupportedRecords: 0, ambiguousRecords: 0, stateLimited: false, diagnosticsDropped: 0 } } };
}
const total = (value: Record<string, number>) => Object.values(value).reduce((a, b) => a + b, 0);
function bounded(sourceValue: StoredSource) {
  const result = summarizeSource(sourceValue);
  expect(result.durationEligibility.included + total(result.durationEligibility.exclusions)).toBe(sourceValue.events.length);
  if (result.usageEligibility) {
    expect(result.usageEligibility.selectedRows + result.usageEligibility.excludedRows + result.usageEligibility.deduplicatedRows).toBe(sourceValue.evidence!.usage.length);
    expect(total(result.usageEligibility.exclusions)).toBe(result.usageEligibility.excludedRows);
    expect(result.usageEligibility.observedResponses).toBe(result.usageEligibility.selectedRows);
  }
  return result;
}

describe("internal source contract", () => {
  it("keeps absent evidence distinct from empty observations and observed zero", () => {
    const saved = source([event()], [usage()]);
    const absent = bounded({ ...saved, evidence: null, persistedScope: "events_only" });
    expect(absent).toMatchObject({ suppressionReason: "evidence_absent", durations: null, usage: null, usageEligibility: null, inventory: { turns: null, usage: null, observations: null } });
    const empty = bounded(source());
    expect(empty).toMatchObject({ suppressionReason: null, durations: null, usage: null, inventory: { events: 0, usage: 0 } });
    const zero = bounded(source([event("zero", { durationMs: 0 })], [usage("zero", { counts: { input: 0, output: 0, total: 0, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0 }, limitations: ["zero_or_source_default"] })]));
    expect(zero.durations![0]).toMatchObject({ n: 1, sumMs: 0, meanMs: 0, p95Ms: 0 });
    expect(zero.usage![0]).toMatchObject({ observedResponses: 1, counts: { total: 0 }, limitations: ["zero_or_source_default"] });
  });
  it.each(["unavailable", "state", "dropped", "ambiguousCount", "ambiguousObservation"] as const)("suppresses the entire source for %s", (mode) => {
    const s = source([event()], [usage()]);
    const capabilities = { ...s.evidence!.capabilities, stateLimited: mode === "state", diagnosticsDropped: mode === "dropped" ? 1 : 0, ambiguousRecords: mode === "ambiguousCount" ? 1 : 0 };
    const observation = { id: "synthetic-observation", eventId: null, turnId: null, usageId: null, representation: "provenance" as const, origin: "ambiguous" as const, transportStatus: "unknown" as const, observedUsage: null, sourceRef: { fileId: sourceId, byteOffset: 1 } };
    const result = bounded({ ...s, availability: mode === "unavailable" ? "unavailable" : "available", evidence: { ...s.evidence!, capabilities, observations: mode === "ambiguousObservation" ? [observation] : [] } });
    expect(result).toMatchObject({ durations: null, usage: null, inventory: { events: 1, usage: 1 }, durationEligibility: { exclusions: { source_suppressed: 1 } }, usageEligibility: { exclusions: { source_suppressed: 1 } } });
    expect(result.suppressionReason).toBe(mode === "unavailable" ? "source_unavailable" : mode.startsWith("ambiguous") ? "ambiguous_origin" : "state_limited");
  });
  it("retains sound measured observations with partial coverage without support promotion", () => {
    const s = source([event()], [usage()]);
    const result = bounded({ ...s, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, coverage: "partial", unsupportedRecords: 7 } } });
    expect(result).toMatchObject({ schema: "agentprof.source-summary/v1", scope: "source_prefix", sourceId, revision: 3, completedOffset: 100, observedSize: 105, aggregationReady: false, parserResumeReady: false, crossSourceReconciled: false, suppressionReason: null, capabilities: { support: "shape_verified_only", unsupportedRecords: 7 } });
    expect(result.limitations).toContain("partial_shape_coverage"); expect(result.durations).toHaveLength(1); expect(result.usage).toHaveLength(1);
  });
  it("does not mutate or freeze inputs and deeply freezes its independent result", () => {
    const s = source([event("b"), event("a")], [usage("b"), usage("a")]), before = JSON.stringify(s);
    const result = bounded(s);
    expect(JSON.stringify(s)).toBe(before); expect(Object.isFrozen(s.evidence!.capabilities)).toBe(false);
    expect(result.capabilities).not.toBe(s.evidence!.capabilities);
    const inspect = (v: unknown): void => { if (v !== null && typeof v === "object") { expect(Object.isFrozen(v)).toBe(true); for (const child of Object.values(v)) inspect(child); } };
    inspect(result);
  });
  it.each(["events", "turns", "usage", "observations", "diagnostics"] as const)("rejects over-limit %s before iterating payloads", (name) => {
    const s = source(); const size = name === "observations" || name === "diagnostics" ? 8193 : 4097;
    const tooLarge = name === "events" ? { ...s, events: new Array(size) } : { ...s, evidence: { ...s.evidence!, [name]: new Array(size) } };
    expect(() => summarizeSource(tooLarge)).toThrow("source_summary_limit_exceeded");
  });
  it("accepts the exact event/usage ceilings with linear contributing ID counts", () => {
    const events = Array.from({ length: 4096 }, (_, i) => event(String(i))), rows = Array.from({ length: 4096 }, (_, i) => usage(String(i)));
    const result = bounded(source(events, rows));
    expect(result.durations![0]).toMatchObject({ n: 4096, sumMs: 40960 });
    expect(result.usage![0]).toMatchObject({ observedResponses: 4096, counts: { total: 491520 } });
    expect(result.durations!.reduce((n, c) => n + c.eventIds.length, 0)).toBe(4096);
    expect(result.usage!.reduce((n, c) => n + c.usageIds.length, 0)).toBe(4096);
  });
  it("has no runtime import or I/O dependency and exports only a single-source entry point", () => {
    const implementation = readFileSync(new URL("../src/analysis/source-summary.ts", import.meta.url), "utf8");
    expect(implementation.split("\n").filter((line) => line.startsWith("import ")).every((line) => line.startsWith("import type "))).toBe(true);
    expect(implementation).not.toMatch(/node:sqlite|node:fs|node:http|Date\.now|fetch\(/);
  });
});

describe("duration distributions", () => {
  it.each([0, 1, 19, 20])("uses nearest rank with %i samples", (n) => {
    const result = bounded(source(Array.from({ length: n }, (_, i) => event(String(i), { durationMs: i + 1 }))));
    if (!n) expect(result.durations).toBeNull();
    else expect(result.durations![0]).toMatchObject({ n, sumMs: n * (n + 1) / 2, meanMs: (n + 1) / 2, maxMs: n, p50Ms: Math.ceil(0.5 * n), p95Ms: Math.ceil(0.95 * n), lowSampleP95: n < 20 });
  });
  it("sums overlapping calls without inventing occupancy and keeps no_match completed", () => {
    const result = bounded(source([event("a", { durationMs: 10000, startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-01-01T00:00:10.000Z", executionOutcome: "no_match" }), event("b", { durationMs: 10000, startAt: "2026-01-01T00:00:05.000Z", endAt: "2026-01-01T00:00:15.000Z" })]));
    expect(result.durations![0]).toMatchObject({ sumMs: 20000, n: 2 });
    expect(result.inventory).toMatchObject({ eventStatuses: { completed: 2, failed: 0 }, eventOutcomes: { no_match: 1 } });
    expect(JSON.stringify(result)).not.toMatch(/busyMs|activeTime|percentage|windowStart|collectedAt/);
  });
  it("separates each cohort dimension and uses deterministic locale-independent order", () => {
    const events = [event("a"), event("b", { durationScope: "item_lifecycle" }), event("c", { timingEvidence: "paired_timestamps" }), event("d", { sessionId: "another" }), event("e", { category: "build" }), event("f", { toolName: null }), event("g", { commandPattern: null })];
    const a = bounded(source(events)), b = bounded(source([...events].reverse()));
    expect(a).toEqual(b); expect(a.durations).toHaveLength(7);
  });
  it("partitions exclusions once, with terminal status before timing", () => {
    const events = [event("ok"), event("failed", { status: "failed" }), event("cancelled", { status: "cancelled" }), event("pending", { status: "pending" }), event("unknown", { status: "unknown" }), event("null", { durationMs: null }), event("scope", { durationScope: "unknown" }), event("estimated", { timingEvidence: "estimated" }), event("timing", { timingEvidence: "unknown" }), event("invalid", { durationMs: Infinity })];
    const result = bounded(source(events));
    expect(result.durationEligibility).toEqual({ terminalCandidates: 7, included: 2, exclusions: { source_suppressed: 0, cancelled: 1, pending: 1, unknown_status: 1, missing_duration: 1, invalid_duration: 1, unknown_scope: 1, estimated_timing: 1, unknown_timing: 1 } });
  });
  it("preserves quantiles on sum overflow, handles fractional duration, and orders equal IDs", () => {
    const overflow = bounded(source([event("a", { durationMs: Number.MAX_SAFE_INTEGER }), event("b", { durationMs: 1 })])).durations![0]!;
    expect(overflow).toMatchObject({ n: 2, sumMs: null, meanMs: null, maxMs: Number.MAX_SAFE_INTEGER, p95Ms: Number.MAX_SAFE_INTEGER, limitations: ["numeric_overflow"] });
    const fractional = bounded(source([event("a", { durationMs: 0.1 }), event("b", { durationMs: 0.2 })])).durations![0]!;
    expect(fractional.sumMs).toBeCloseTo(0.3, 14); expect(fractional.meanMs).toBeCloseTo(0.15, 14);
    const same = bounded(source([event("b"), event("a")])); expect(same).toEqual(bounded(source([event("a"), event("b")])));
    expect(same.durations![0]!.eventIds).toEqual([...same.durations![0]!.eventIds].sort());
  });
});

describe("strict observed final usage", () => {
  it("never re-adds caches or reasoning subsets and separates finality", () => {
    const a = usage("a"), b = usage("b", { finality: "trusted_final" });
    const result = bounded(source([], [a, b])); expect(result.usage).toHaveLength(2);
    for (const cohort of result.usage!) expect(cohort.counts).toEqual({ input: 100, output: 20, total: 120, cachedInput: 40, cacheWriteInput: 0, reasoningOutput: 5, uncachedInput: null });
    const claude: ClaudeUsage = { ...a, provider: "claude", mapping: "anthropic_messages", scope: "response_snapshot", source: "message_usage", finality: "trusted_final", turnId: null, selection: "eligible", limitations: [], stopReason: "tool_use", terminalCandidate: true,
      counts: { input: 150, uncachedInput: 100, cachedInput: 30, cacheWriteInput: 20, output: 10, total: 160, reasoningOutput: null } };
    expect(bounded({ ...source([], [claude]), provider: "claude" }).usage![0]!.counts).toEqual({ input: 150, uncachedInput: 100, output: 10, total: 160, cachedInput: 30, cacheWriteInput: 20, reasoningOutput: null });
  });
  it("partitions snapshot rows before duplicate reconciliation and filters strict eligibility", () => {
    const a = usage(), rows = [a, usage("snapshot", { responseId: a.responseId, source: "thread_snapshot", scope: "thread_cumulative" }), usage("last", { source: "token_count_last", scope: "unverified_snapshot" }),
      usage("invalid", { selection: "invalid" }), usage("conflicted", { selection: "conflicted", counts: null }), usage("provisional", { selection: "provisional" }), usage("snapshotOnly", { selection: "snapshot_only" }),
      usage("finality", { finality: "trusted_partial" }), usage("missing", { responseId: null }), usage("partial", { countStatus: "partial" }), usage("mapping", { mapping: "unknown" }), usage("null", { counts: null })];
    const result = bounded(source([], rows)); expect(result.usageEligibility).toMatchObject({ observedResponses: 1, selectedRows: 1, excludedRows: 11, excludedResponseGroups: 0,
      exclusions: { cumulative_snapshot: 1, unverified_snapshot: 1, invalid: 1, conflicted: 1, provisional: 1, snapshot_only: 1, unverified_finality: 1, missing_response_id: 1, incomplete_components: 2, unverified_mapping: 1 } });
    expect(result.usage![0]!.counts.total).toBe(120);
  });
  it("deduplicates identical response payloads once regardless of row/source-reference order", () => {
    const a = usage(), b = { ...a, id: "different-row", sourceRef: { ...a.sourceRef, byteOffset: 2 } }, c = { ...a, id: "third-row" };
    const one = bounded(source([], [a, b, c])); expect(one).toEqual(bounded(source([], [c, b, a])));
    expect(one.usageEligibility).toMatchObject({ observedResponses: 1, selectedRows: 1, deduplicatedRows: 2, excludedRows: 0 }); expect(one.usage![0]!.counts.total).toBe(120);
  });
  it.each(["counts", "finality", "mapping", "selection", "limitations", "turnId"] as const)("excludes every contradictory response row when %s differs", (field) => {
    const a = usage(), b = { ...a, id: "different-row", ...(field === "counts" ? { counts: { ...a.counts!, output: 21, total: 121 } } : field === "finality" ? { finality: "trusted_final" as const } : field === "mapping" ? { mapping: "unknown" as const } : field === "selection" ? { selection: "provisional" as const } : field === "limitations" ? { limitations: ["zero_or_source_default" as const] } : { turnId: "another-turn" }) };
    const result = bounded(source([], [a, a, b])); expect(result).toEqual(bounded(source([], [b, a, a])));
    expect(result.usage).toBeNull(); expect(result.usageEligibility).toMatchObject({ observedResponses: 0, selectedRows: 0, deduplicatedRows: 0, excludedRows: 3, excludedResponseGroups: 1, exclusions: { duplicate_response_conflict: 3 } });
  });
  it("deduplicates identical ineligible candidates before selecting or excluding", () => {
    const a = usage("a", { selection: "provisional", finality: "unknown" }), b = { ...a, id: "other-row" };
    const result = bounded(source([], [a, b]));
    expect(result.usage).toBeNull(); expect(result.usageEligibility).toMatchObject({ selectedRows: 0, deduplicatedRows: 1, excludedRows: 1, exclusions: { provisional: 1 } });
  });
  it("does not combine identical response IDs across streams", () => {
    const a = usage(), b = { ...a, id: "other", sessionId: "another-stream" }; const result = bounded(source([], [a, b]));
    expect(result.usage).toHaveLength(2); expect(result.usageEligibility!.observedResponses).toBe(2);
  });
  it("has null optional aggregates whenever any selected component is unknown", () => {
    // Defensive typed calculation boundary only: current persisted countStatus=complete requires these fields.
    const a = usage("a"), b = usage("b", { counts: { ...a.counts!, cachedInput: null, cacheWriteInput: null, reasoningOutput: null } });
    const result = bounded(source([], [a, b])); expect(result.usage![0]!.counts).toEqual({ input: 200, output: 40, total: 240, cachedInput: null, cacheWriteInput: null, reasoningOutput: null, uncachedInput: null });
    expect(result).toEqual(bounded(source([], [b, a])));
  });
  it("nulls only overflowing token sums and retains counts and independent components", () => {
    const a = usage("a", { counts: { input: Number.MAX_SAFE_INTEGER, output: 0, total: Number.MAX_SAFE_INTEGER, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0 } });
    const b = usage("b", { counts: { input: 1, output: 0, total: 1, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0 } });
    const result = bounded(source([], [a, b])); expect(result.usage![0]).toMatchObject({ observedResponses: 2, counts: { input: null, output: 0, total: null, cachedInput: 0 }, overflowComponents: ["input", "total"], limitations: ["numeric_overflow"] });
    expect(JSON.stringify(result)).not.toContain("Infinity");
  });
});
