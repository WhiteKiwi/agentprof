import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeSourceSlowTool } from "../src/analysis/source-slow-tool.js";
import type { MetricEvidence, StoredSource } from "../src/db/source-store.js";
import type { NormalizedEvent } from "../src/normalize/types.js";
import { normalizeEvent } from "../src/normalize/event.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import type { SourceObservation } from "../src/parsers/types.js";
import type { ClaudeSourceObservation } from "../src/parsers/claude/types.js";

const identity = createIdentityContext(new Uint8Array(32).fill(77), "a".repeat(32));
const sourceId = identity.fingerprint("source", ["codex", "synthetic-slow-tool"]);
const otherSession = identity.fingerprint("session", ["other"]);
const id = (value: string) => identity.fingerprint("event", ["synthetic-slow", value]);
function event(name: string, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { ...normalizeEvent({ provider: "codex", eventIdentity: name, sessionIdentity: "synthetic-slow", kind: "shell", toolName: "exec_command", command: "npm test SYNTHETIC_SECRET_TARGET",
    status: "completed", statusEvidence: "explicit", exitCode: 0, durationMs: 4, timingEvidence: "source_reported", durationScope: "process_runtime",
    sourceRef: { fileIdentity: "synthetic-slow-tool", byteOffset: 10, recordType: "event_msg" } }, identity).event!, ...extra };
}
function codexObservation(e: NormalizedEvent, name = e.id, extra: Partial<SourceObservation> = {}): SourceObservation {
  return { id: id(`observation-${name}`), eventId: e.id, turnId: null, usageId: null, representation: "structured", origin: "ordinary", transportStatus: "completed", observedUsage: null,
    sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset }, ...extra };
}
function claudeObservations(e: NormalizedEvent): ClaudeSourceObservation[] {
  const base = { sessionId: e.sessionId, eventId: e.id, messageId: null, usageId: null, turnId: null, origin: "ordinary" as const, observedUsage: null };
  return [{ ...base, id: id(`call-${e.id}`), representation: "call", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 2 }, observedResult: null },
    { ...base, id: id(`result-${e.id}`), representation: "result", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset },
      observedResult: { isError: e.status === "failed", completionKind: "invocation_result", unassignedAcknowledgement: false, observedAt: e.endAt,
        acknowledgementLatencyMs: null, durationMs: e.timingEvidence === "source_reported" ? e.durationMs : null, durationScope: e.timingEvidence === "source_reported" ? e.durationScope : "unknown" } }];
}
function source(events: NormalizedEvent[] = [], observations?: MetricEvidence["observations"]): StoredSource {
  const provider = events[0]?.provider ?? "codex";
  return { sourceId, provider, parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: identity.keyId, revision: 3, availability: "available",
    completedOffset: 10000, observedSize: 10005, boundaryFingerprint: identity.fingerprint("content", ["boundary"]), cacheEvidence: null, events,
    persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false,
    evidence: { turns: [], usage: [], observations: observations ?? events.flatMap(e => provider === "claude" ? claudeObservations(e) : [codexObservation(e)]), diagnostics: [],
      capabilities: { provider, parserVersion: 1, support: "shape_verified_only", coverage: "recognized_shapes", observedShapes: [], unsupportedRecords: 0, ambiguousRecords: 0, stateLimited: false, diagnosticsDropped: 0 } } };
}
function group(n = 5, extra: Partial<NormalizedEvent> = {}, prefix = "a"): NormalizedEvent[] {
  return Array.from({ length: n }, (_, i) => event(`${prefix}-${i}`, extra));
}
function checked(s: StoredSource) {
  const result = analyzeSourceSlowTool(s);
  expect(result.eligibility.admittedTimedCalls + Object.values(result.eligibility.exclusions).reduce((a, b) => a + b, 0)).toBe(s.events.length);
  expect(result.provenance.unresolvedEvents).toBe(Object.values(result.provenance.failures).reduce((a, b) => a + b, 0));
  expect(result.partitions.flatMap(p => p.eventIds).length).toBeLessThanOrEqual(4096);
  expect(result.partitions.flatMap(p => p.unresolvedEventIds).length).toBeLessThanOrEqual(4096);
  expect(result.candidates?.flatMap(c => c.evidenceEventIds).length ?? 0).toBeLessThanOrEqual(4096);
  expect(result.candidates?.flatMap(c => c.evidenceObservationIds).length ?? 0).toBeLessThanOrEqual(8192);
  return result;
}
const evidenceIds = (rows: NormalizedEvent[]) => rows.map(e => e.id).sort();
const paired = (e: NormalizedEvent) => [codexObservation(e, `call-${e.id}`, { representation: "call", transportStatus: "unknown", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 2 } }), codexObservation(e, `result-${e.id}`, { representation: "result", transportStatus: "unknown" })];

describe("fixed source-local thresholds and arithmetic", () => {
  it("uses all admitted categories and small cohorts in the exact 20/100 denominator", () => {
    const rows = group(), rest = [event("other", { category: "build", commandPattern: "npm run build", durationMs: 80 })];
    const r = checked(source([...rows, ...rest]));
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates![0]).toMatchObject({ n: 5, sumMs: 20, meanMs: 4, denominatorN: 6, denominatorSumMs: 100, observedEligibleNativeToolDurationShare: 0.2, evidenceEventIds: evidenceIds(rows), includedEventIds: [], thresholds: { minimumTimedCalls: 5, minimumDurationShare: 0.2, p95LowSampleBelow: 20 } });
    expect(r.partitions[0]!.eventIds).toEqual(evidenceIds([...rows, ...rest]));
  });
  it("rejects 19/100 without rounding and four high-share calls", () => {
    expect(checked(source([...group(5, { durationMs: 3.8 }), event("b", { durationMs: 81, category: "build", commandPattern: "npm run build" })])).candidates).toEqual([]);
    expect(checked(source(group(4, { durationMs: 1000 }))).candidates).toEqual([]);
  });
  it("keeps recorded zeros as samples but distinguishes zero denominator from absent input", () => {
    const r = checked(source([event("positive", { durationMs: 1 }), ...group(4, { durationMs: 0 })]));
    expect(r.candidates![0]).toMatchObject({ n: 5, sumMs: 1, meanMs: 0.2, p50Ms: 0, p95Ms: 1, observedEligibleNativeToolDurationShare: 1 });
    const zero = checked(source(group(5, { durationMs: 0 })));
    expect(zero).toMatchObject({ assessment: "evaluated", candidates: [], candidateAssessmentReason: null });
    expect(zero.partitions[0]).toMatchObject({ status: "zero_denominator", denominatorN: 5, denominatorSumMs: 0 });
    expect(checked(source())).toMatchObject({ assessment: "no_eligible_events", candidates: null, candidateAssessmentReason: "no_eligible_events", partitions: [] });
  });
  it.each([5, 19, 20])("uses independent nearest-rank quantiles at n=%s", n => {
    const rows = Array.from({ length: n }, (_, i) => event(`q-${i}`, { durationMs: i + 1 }));
    expect(checked(source(rows)).candidates![0]).toMatchObject({ n, sumMs: n * (n + 1) / 2, meanMs: (n + 1) / 2, maxMs: n, p50Ms: Math.ceil(n / 2), p95Ms: Math.ceil(0.95 * n), lowSampleP95: n < 20 });
  });
  it("retains equal-duration and fractional distributions", () => {
    expect(checked(source(group(5, { durationMs: 0.125 }))).candidates![0]).toMatchObject({ sumMs: 0.625, meanMs: 0.125, maxMs: 0.125, p50Ms: 0.125, p95Ms: 0.125 });
  });
  it("does not pool scopes, evidence or streams to reach five calls", () => {
    const rows = [event("1"), event("2"), event("3", { sessionId: otherSession }), event("4", { timingEvidence: "paired_timestamps", durationScope: "invocation_latency" }), event("5", { kind: "mcp", category: "mcp", toolName: "mcp", durationScope: "invocation_latency" })];
    const r = checked(source(rows, rows.flatMap(e => e.timingEvidence === "paired_timestamps" ? paired(e) : [codexObservation(e)])));
    expect(r.partitions).toHaveLength(4); expect(r.candidates).toEqual([]);
  });
  it("suppresses all candidates in an overflowed partition while retaining admitted count", () => {
    const r = checked(source(group(5, { durationMs: Number.MAX_SAFE_INTEGER })));
    expect(r).toMatchObject({ assessment: "partial", candidates: null, candidateAssessmentReason: "no_evaluable_partition", eligibility: { admittedTimedCalls: 5 } });
    expect(r.partitions[0]).toMatchObject({ status: "numeric_overflow", denominatorSumMs: null, denominatorN: 5 });
    expect(JSON.stringify(r)).not.toMatch(/Infinity|NaN/);
  });
  it("checks denominator overflow even when the candidate cohort sum itself is small", () => {
    const r = checked(source([...group(), event("huge", { durationMs: Number.MAX_SAFE_INTEGER, category: "build", commandPattern: "npm run build" })]));
    expect(r.candidates).toBeNull(); expect(r.eligibility.admittedTimedCalls).toBe(6);
  });
  it("orders floating sums by event ID independently of input order", () => {
    const rows = group(); rows.sort((a, b) => a.id.localeCompare(b.id));
    const values = [1e15, 0.0625, 0.0625, 1, 1];
    const assigned = rows.map((e, i) => ({ ...e, durationMs: values[i]! }));
    let expected = 0; for (const n of values) expected += n;
    expect(checked(source(assigned)).candidates![0]!.sumMs).toBe(expected);
    expect(checked(source([...assigned].reverse()))).toEqual(checked(source(assigned)));
  });
});

describe("source suppression and disjoint native-call eligibility", () => {
  it.each(["unavailable", "absent", "limited", "dropped", "ambiguousCount", "ambiguousObservation", "parser", "capabilityParser", "capabilityProvider", "parent", "wrapper"] as const)("suppresses the source for %s", mode => {
    const s = source(group()); const e = s.events[0]!;
    const r = checked({ ...s, availability: mode === "unavailable" ? "unavailable" : "available", parserVersion: mode === "parser" ? 2 : 1,
      events: mode === "parent" ? [{ ...e, parentEventId: id("parent") }, ...s.events.slice(1)] : s.events,
      evidence: mode === "absent" ? null : { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, stateLimited: mode === "limited", diagnosticsDropped: mode === "dropped" ? 1 : 0, ambiguousRecords: mode === "ambiguousCount" ? 1 : 0, parserVersion: mode === "capabilityParser" ? 2 : 1, provider: mode === "capabilityProvider" ? "claude" : "codex" } as MetricEvidence["capabilities"],
        observations: [...s.evidence!.observations, ...(mode === "wrapper" ? [codexObservation(e, "wrapper", { representation: "wrapper" })] : []), ...(mode === "ambiguousObservation" ? [codexObservation(e, "ambiguous", { origin: "ambiguous", representation: "provenance", eventId: null })] : [])] } });
    const reason = mode === "unavailable" ? "source_unavailable" : mode === "absent" ? "evidence_absent" : ["limited", "dropped"].includes(mode) ? "state_limited" : mode.startsWith("ambiguous") ? "ambiguous_origin" : ["parent", "wrapper"].includes(mode) ? "unresolved_execution_relation" : "unsupported_contract";
    expect(r).toMatchObject({ suppressionReason: reason, assessment: "suppressed", candidates: null, partitions: [], eligibility: { admittedTimedCalls: 0, exclusions: { source_suppressed: 5 } } });
  });
  it("preserves source-summary suppression precedence", () => {
    const s = source([{ ...event("x"), parentEventId: id("parent") }]);
    const combined = { ...s, parserVersion: 2, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, stateLimited: true, ambiguousRecords: 1 } } };
    expect(checked({ ...combined, availability: "unavailable" }).suppressionReason).toBe("source_unavailable");
    expect(checked({ ...combined, evidence: null }).suppressionReason).toBe("evidence_absent");
    expect(checked(combined).suppressionReason).toBe("state_limited");
    expect(checked({ ...combined, evidence: { ...combined.evidence, capabilities: { ...combined.evidence.capabilities, stateLimited: false } } }).suppressionReason).toBe("ambiguous_origin");
  });
  it.each([
    ["model", { kind: "model" }], ["model", { category: "model" }], ["unsupported_call_class", { kind: "subagent", toolName: "other" }], ["unsupported_call_class", { kind: "skill", toolName: "other" }],
    ["unsupported_call_class", { kind: "other", toolName: "other" }], ["unsupported_call_class", { toolName: null }], ["unsupported_call_class", { toolName: "write_stdin" }], ["inconsistent_category", { category: "edit" }],
    ["cancelled", { status: "cancelled", durationMs: null }], ["pending", { status: "pending", durationMs: null }], ["unknown_status", { status: "unknown" }],
    ["missing_duration", { durationMs: null }], ["invalid_duration", { durationMs: -1 }], ["invalid_duration", { durationMs: Infinity }], ["invalid_duration", { durationMs: Number.MAX_SAFE_INTEGER + 1 }],
    ["unknown_scope", { durationScope: "unknown" }], ["estimated_timing", { timingEvidence: "estimated" }], ["unknown_timing", { timingEvidence: "unknown" }],
  ] as [string, Partial<NormalizedEvent>][]) ("assigns exactly one primary %s exclusion (%j)", (reason, patch) => {
    const r = checked(source([event("excluded", patch)]));
    expect(r.eligibility.exclusions[reason as keyof typeof r.eligibility.exclusions]).toBe(1); expect(r.candidates).toBeNull();
  });
  it("excludes model rows from the compatible denominator rather than measuring gaps", () => {
    const r = checked(source([...group(), event("model", { category: "model", kind: "model", durationMs: 10000 })]));
    expect(r.candidates![0]).toMatchObject({ denominatorN: 5, denominatorSumMs: 20, observedEligibleNativeToolDurationShare: 1 }); expect(r.eligibility.exclusions.model).toBe(1);
  });
  it("retains partial capabilities, source boundaries and safe confidence limits", () => {
    const s = source(group()), r = checked({ ...s, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, coverage: "partial", unsupportedRecords: 2 } } });
    expect(r).toMatchObject({ assessment: "partial", sourceId, revision: 3, completedOffset: 10000, observedSize: 10005, queryPeriod: null, observationWindow: { unit: "source_bytes", startInclusive: 0, endExclusive: 10000 }, sourceFreshnessChecked: false, aggregationReady: false, parserResumeReady: false, crossSourceReconciled: false });
    expect(r.limitations).toContain("partial_shape_coverage"); expect(r.candidates).toHaveLength(1);
  });
});

describe("ordinary native-call provenance and representation controls", () => {
  it("preserves semantic no_match/change_detected despite failed transport", () => {
    const rows = group(5, { status: "completed", executionOutcome: "no_match", category: "search", commandPattern: "rg <query> <path>", exitCode: 1 });
    const r = checked(source(rows, rows.map(e => codexObservation(e, e.id, { transportStatus: "failed" }))));
    expect(r.candidates).toHaveLength(1); expect(r.inventory.eventOutcomes.no_match).toBe(5);
    expect(checked(source(group(5, { executionOutcome: "change_detected" }))).candidates).toHaveLength(1);
    expect(checked(source(group(5, { status: "failed", executionOutcome: "error" }))).candidates).toHaveLength(1);
  });
  it.each(["missing", "position", "file", "unrelatedId", "mixedOrigin", "providerShape", "providerEvent", "unsupportedTiming", "nonterminalStructured"] as const)("suppresses the whole compatible partition for %s provenance", mode => {
    const good = group(), bad = event("bad", { durationMs: 1000, category: "build", commandPattern: "npm run build", ...(mode === "unsupportedTiming" ? { kind: "file_edit", toolName: "apply_patch", category: "edit" } : {}), ...(mode === "providerEvent" ? { provider: "claude" } : {}) });
    let obs: MetricEvidence["observations"] = [codexObservation(bad)];
    if (mode === "missing") obs = [];
    if (mode === "position") obs = [codexObservation(bad, "badpos", { sourceRef: { fileId: bad.sourceRef.fileId, byteOffset: 11 } })];
    if (mode === "file") obs = [codexObservation(bad, "badfile", { sourceRef: { fileId: identity.fingerprint("source", ["different-source"]), byteOffset: bad.sourceRef.byteOffset } })];
    if (mode === "unrelatedId") obs = [codexObservation(bad, "unrelated", { eventId: id("unrelated") })];
    if (mode === "mixedOrigin") obs = [codexObservation(bad), codexObservation(bad, "copy", { origin: "trusted_copied", representation: "call" })];
    if (mode === "providerShape") obs = claudeObservations(bad);
    if (mode === "nonterminalStructured") obs = [codexObservation(bad, "pending", { transportStatus: "pending" })];
    const r = checked(source([...good, bad], [...good.map(e => codexObservation(e)), ...obs]));
    expect(r.candidates).toBeNull(); expect(r.eligibility).toMatchObject({ admittedTimedCalls: 0, exclusions: { identity_unresolved_partition: 6 } });
    expect(r.partitions[0]).toMatchObject({ status: "identity_unresolved", denominatorN: null, denominatorSumMs: null, unresolvedEventIds: [bad.id] }); expect(r.provenance.unresolvedEvents).toBe(1);
  });
  it("does not suppress an independent resolved partition", () => {
    const good = group(), bad = event("bad", { sessionId: otherSession });
    const r = checked(source([...good, bad], good.map(e => codexObservation(e))));
    expect(r.assessment).toBe("partial"); expect(r.candidates).toHaveLength(1); expect(r.candidates![0]!.denominatorN).toBe(5);
  });
  it("counts five replay observations of one ID as one call", () => {
    const e = event("one"), r = checked(source([e], Array.from({ length: 5 }, (_, i) => codexObservation(e, `${i}`))));
    expect(r.eligibility.admittedTimedCalls).toBe(1); expect(r.candidates).toEqual([]);
  });
  it("retains distinct native calls with identical operation and duration", () => {
    const rows = group(5, { operationKey: id("same-operation") });
    expect(checked(source(rows)).candidates![0]!.evidenceEventIds).toEqual(evidenceIds(rows));
  });
  it("structured priority and wrapper/poll/replay observations never add executions", () => {
    const rows = group(), observations = rows.flatMap(e => [codexObservation(e), ...paired(e)]);
    observations.push(codexObservation(rows[0]!, "wrapper", { representation: "wrapper", eventId: id("known-wrapper") }));
    for (let i = 0; i < 3; i++) observations.push(codexObservation(rows[0]!, `poll-${i}`, { representation: "poll", transportStatus: "unknown" }));
    const r = checked(source(rows, observations));
    expect(r.eligibility.admittedTimedCalls).toBe(5); expect(r.candidates![0]).toMatchObject({ sumMs: 20, measurementBasis: "direct" });
    expect(r.observationInventory).toMatchObject({ knownWrapperIds: 1, orphanEventReferences: 1 }); expect(r.candidates![0]!.evidenceObservationIds).toHaveLength(5);
  });
  it("requires paired call and final result/poll at the canonical stored position", () => {
    const rows = group(5, { timingEvidence: "paired_timestamps", durationScope: "invocation_latency" });
    const observations = rows.flatMap(e => paired(e).map(o => o.representation === "result" ? { ...o, representation: "poll" as const } : o));
    expect(checked(source(rows, observations)).candidates![0]).toMatchObject({ measurementBasis: "observed", n: 5 });
    expect(checked(source(rows, observations.filter(o => o.representation !== "call"))).candidates).toBeNull();
    expect(checked(source(rows, observations.map(o => o.representation === "poll" ? { ...o, sourceRef: { ...o.sourceRef, byteOffset: 3 } } : o))).candidates).toBeNull();
  });
  it.each(["session", "origin", "at", "position", "error", "completion", "ack", "duration", "scope", "missingCall"] as const)("requires Claude decisive provenance: %s", mode => {
    const rows = group(5, { provider: "claude", toolName: "Bash", endAt: "2026-10-01T00:00:01.000Z" });
    let obs = rows.flatMap(e => claudeObservations(e));
    const first = obs[1]!;
    if (mode === "missingCall") obs = obs.filter(o => o.eventId !== rows[0]!.id || o.representation !== "call");
    else obs[1] = { ...first, ...(mode === "session" ? { sessionId: otherSession } : {}), ...(mode === "origin" ? { origin: "trusted_copied" } : {}), ...(mode === "position" ? { sourceRef: { ...first.sourceRef, byteOffset: 11 } } : {}),
      observedResult: { ...first.observedResult!, ...(mode === "at" ? { observedAt: "2026-10-01T00:00:02.000Z" } : {}), ...(mode === "error" ? { isError: true } : {}), ...(mode === "completion" ? { completionKind: "background_acknowledgement" } : {}), ...(mode === "ack" ? { unassignedAcknowledgement: true } : {}), ...(mode === "duration" ? { durationMs: 55 } : {}), ...(mode === "scope" ? { durationScope: "item_lifecycle" } : {}) } };
    const r = checked(source(rows, obs)); expect(r.candidates).toBeNull(); expect(r.eligibility.exclusions.identity_unresolved_partition).toBe(5);
  });
  it.each(["source_reported", "paired_timestamps"] as const)("admits Claude %s independently and marks direct fixture limits", timingEvidence => {
    const r = checked(source(group(5, { provider: "claude", toolName: "Bash", timingEvidence, durationScope: timingEvidence === "source_reported" ? "process_runtime" : "invocation_latency" })));
    expect(r.candidates).toHaveLength(1); expect(r.candidates![0]!.evidenceObservationIds).toHaveLength(10);
    expect(r.candidates![0]!.limitations.includes("claude_direct_duration_synthetic_contract_only")).toBe(timingEvidence === "source_reported");
  });
  it.each(["Read", "Write", "Edit", "Grep", "Glob", "mcp", "browser"] as const)("admits current Claude native %s tuple", toolName => {
    const mapping = { Read: ["file_read", "read"], Write: ["file_write", "write"], Edit: ["file_edit", "edit"], Grep: ["search", "search"], Glob: ["search", "search"], mcp: ["mcp", "mcp"], browser: ["browser", "browser"] } as const;
    const [kind, category] = mapping[toolName], r = checked(source(group(5, { provider: "claude", kind, category, toolName, commandPattern: null, timingEvidence: "paired_timestamps", durationScope: "invocation_latency" })));
    expect(r.candidates).toHaveLength(1); expect(r.candidates![0]!.group.toolName).toBe(toolName);
  });
});

describe("bounded immutable explanations and privacy", () => {
  it("coarse MCP/browser cards contain only one investigation/experiment and preserve required work", () => {
    for (const kind of ["mcp", "browser"] as const) {
      const r = checked(source(group(5, { provider: "claude", kind, category: kind, toolName: kind, commandPattern: null, timingEvidence: "paired_timestamps", durationScope: "invocation_latency" }))), c = r.candidates![0]!;
      expect(c).toMatchObject({ grouping: "coarse_tool_family", includedEventIds: [], confidence: { pattern: "candidate", avoidableWork: "unestablished", rootCause: "unestablished", effect: "unestablished" } });
      expect(c.investigativeAction).toContain("endpoint and target are unknown"); expect(c.necessaryWorkCounterexample).toContain("all remain necessary");
      expect(c.matchedExperiment).toContain("extra retries/refetches"); expect(c.matchedExperiment).toContain("effect-none, worse, noisy and incomparable"); expect(c.qualityGuardrail).toContain("mandatory full validation");
    }
  });
  it("preserves same-pattern different-operation cohort ambiguity", () => {
    const rows = group().map((e, i) => ({ ...e, operationKey: id(`different-operation-${i}`) }));
    const c = checked(source(rows)).candidates![0]!; expect(c.n).toBe(5); expect(c.limitations).toContain("display_cohort_not_same_operation");
  });
  it("is deterministic under all event/observation/capability shape reordering and freezes only new output", () => {
    const rows = [...group(5, {}, "a"), ...group(5, { durationMs: 8, commandPattern: "npm run build", category: "build" }, "b"), ...group(5, { sessionId: otherSession }, "c")];
    const s = structuredClone(source(rows)), before = structuredClone(s), r = checked(s);
    const reordered = { ...s, events: [...s.events].reverse(), evidence: { ...s.evidence!, observations: [...s.evidence!.observations].reverse() } };
    expect(checked(reordered)).toEqual(r); expect(s).toEqual(before);
    const inspect = (v: unknown, frozen: boolean): void => { if (v !== null && typeof v === "object") { expect(Object.isFrozen(v)).toBe(frozen); for (const child of Object.values(v)) inspect(child, frozen); } };
    inspect(r, true); inspect(s, false);
    expect(r.candidates!.map(c => c.id)).toEqual(["candidate-1", "candidate-2", "candidate-3"]);
    for (const c of r.candidates!) { expect(c).not.toHaveProperty("denominatorEventIds"); expect(c.sourceContextRef).toBe("source"); }
  });
  it("never exposes private fingerprints, byte payloads or raw commands", () => {
    const rows = group().map(e => ({ ...e, operationKey: "SYNTHETIC_SECRET_OPERATION", contentFingerprint: "SYNTHETIC_SECRET_CONTENT", fileFingerprint: "SYNTHETIC_SECRET_FILE", errorFingerprint: "SYNTHETIC_SECRET_ERROR" }));
    expect(JSON.stringify(checked(source(rows)))).not.toMatch(/SYNTHETIC_SECRET|boundaryFingerprint|operationKey|contentFingerprint|errorFingerprint|fileFingerprint|sourceRef/);
    const module = readFileSync(new URL("../src/analysis/source-slow-tool.ts", import.meta.url), "utf8");
    expect(module.match(/^import .+$/gm)!.every(line => line.startsWith("import type "))).toBe(true);
    expect(module).not.toMatch(/Date\.now|process\.|fetch\(|node:|Math\.random/);
  });
  it("retains 819 natural cards and all event evidence at the event cap", () => {
    const rows: NormalizedEvent[] = [];
    for (let p = 0; p < 819; p++) rows.push(...group(5, { sessionId: identity.fingerprint("session", [`partition-${p}`]) }, `p-${p}`));
    rows.push(event("extra", { sessionId: otherSession }));
    const r = checked(source(rows)); expect(r.inventory.events).toBe(4096); expect(r.partitions).toHaveLength(820); expect(r.candidates).toHaveLength(819);
    expect(r.candidates!.flatMap(c => c.evidenceEventIds)).toHaveLength(4095);
  });
  it("accepts 8192 observations while retaining bounded candidate proof IDs", () => {
    const rows = group(), observations = [...rows.map(e => codexObservation(e))];
    for (let i = 5; i < 8192; i++) observations.push(codexObservation(rows[0]!, `metadata-${i}`, { eventId: null, representation: "metadata" }));
    expect(checked(source(rows, observations)).candidates![0]!.evidenceObservationIds).toHaveLength(5);
  });
  it.each(["events", "turns", "usage", "observations", "diagnostics"] as const)("rejects one-over %s before per-row access", key => {
    const s = source(), limit = key === "observations" || key === "diagnostics" ? 8192 : 4096;
    const hostile = new Array(limit + 1); Object.defineProperty(hostile, "0", { get() { throw new Error("payload must not be visited"); } });
    const over = key === "events" ? { ...s, events: hostile } : { ...s, evidence: { ...s.evidence!, [key]: hostile } };
    expect(() => analyzeSourceSlowTool(over)).toThrow("source_slow_tool_limit_exceeded");
  });
});


describe("additional boundary combinations", () => {
  it("an observed-zero partition permits an empty assessment beside unresolved and overflow partitions", () => {
    const zero = group(5, { durationMs: 0 }), unresolved = event("unresolved", { sessionId: otherSession });
    const overflow = group(5, { durationMs: Number.MAX_SAFE_INTEGER, sessionId: identity.fingerprint("session", ["overflow"]) }, "over");
    const r = checked(source([...zero, unresolved, ...overflow], [...zero, ...overflow].map(e => codexObservation(e))));
    expect(r).toMatchObject({ assessment: "partial", candidates: [], candidateAssessmentReason: null });
    expect(r.partitions.map(p => p.status).sort()).toEqual(["identity_unresolved", "numeric_overflow", "zero_denominator"]);
  });
  it("rejects unsupported Codex direct lifecycle without changing the duration scope", () => {
    const r = checked(source(group(5, { durationScope: "item_lifecycle" })));
    expect(r.provenance.failures.unsupported_timing_representation).toBe(5);
    expect(r.partitions[0]).toMatchObject({ durationScope: "item_lifecycle", status: "identity_unresolved", denominatorSumMs: null });
  });
  it("admits supported paired apply_patch without inventing a direct timing contract", () => {
    const rows = group(5, { kind: "file_edit", category: "edit", toolName: "apply_patch", commandPattern: null, timingEvidence: "paired_timestamps", durationScope: "invocation_latency" });
    expect(checked(source(rows, rows.flatMap(paired))).candidates![0]).toMatchObject({ n: 5, sumMs: 20, group: { toolName: "apply_patch" } });
  });
  it("compares same-partition sum, count and group tuple rather than global severity", () => {
    const rows = [...group(5, { durationMs: 4, commandPattern: "npm test", category: "test" }, "a"), ...group(10, { durationMs: 2, commandPattern: "cargo build", category: "build" }, "b"), ...group(5, { durationMs: 4, commandPattern: "rg <target>", category: "search" }, "c")];
    const cards = checked(source(rows)).candidates!;
    expect(cards.map(c => [c.sumMs, c.n, c.group.category])).toEqual([[20, 10, "build"], [20, 5, "search"], [20, 5, "test"]]);
  });
  it("keeps all 8192 decisive proof references at the joint event/observation caps", () => {
    const r = checked(source(group(4096, { provider: "claude", toolName: "Bash", timingEvidence: "paired_timestamps", durationScope: "invocation_latency" })));
    expect(r.candidates).toHaveLength(1); expect(r.candidates![0]!.evidenceEventIds).toHaveLength(4096); expect(r.candidates![0]!.evidenceObservationIds).toHaveLength(8192);
  });
  it.each(["turns", "usage", "diagnostics"] as const)("accepts exact %s cap without expanding its metric scope", key => {
    const s = source(group());
    // Independent valid-shaped rows: this rule only inventories these evidence kinds.
    const length = key === "diagnostics" ? 8192 : 4096, sessionId = s.events[0]!.sessionId;
    const rows = Array.from({ length }, (_, i) => key === "diagnostics" ? { code: "UNSUPPORTED_RECORD", severity: "warning", sourceAlias: "source-1", byteOffset: i }
      : key === "turns" ? { id: identity.fingerprint("turn", [`cap-${i}`]), sessionId, provider: "codex", startAt: null, endAt: null,
        startTimingEvidence: "unknown", endTimingEvidence: "unknown", intervalTimingEvidence: "unknown", intervalScope: "unknown",
        durationMs: null, timingEvidence: "unknown", durationScope: "unknown", status: "unknown", sourceRef: { fileId: sourceId, byteOffset: i } }
      : { id: id(`usage-${i}`), sessionId, turnId: null, responseId: id(`response-${i}`), provider: "codex", source: "response_usage", counts: { input: 1, output: 1, total: 2, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0 },
        scope: "response_increment", selection: "eligible", finality: "source_terminal", countStatus: "complete", mapping: "openai_responses", limitations: [], toolEventId: null, phase: "unknown", sourceRef: { fileId: sourceId, byteOffset: i } });
    const r = checked({ ...s, evidence: { ...s.evidence!, [key]: rows } } as StoredSource);
    expect(r.inventory[key]).toBe(length); expect(r.candidates).toHaveLength(1);
  });
});
