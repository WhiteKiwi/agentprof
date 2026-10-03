import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../src/normalize/types.js";
import type { MetricEvidence, StoredSource } from "../src/db/source-store.js";
import { analyzeSourcePatterns } from "../src/analysis/source-patterns.js";
import { event, id, source, success } from "./recovery-fixture.js";

const failure = (name: string, start: number, end: number, extra: Partial<NormalizedEvent> = {}) => event(name, start, end, { errorClass: "process_exit", errorFingerprint: id("error", "failure"), ...extra });
const edit = (name: string, start: number, end: number, extra: Partial<NormalizedEvent> = {}) => event(name, start, end,
  { ...success, kind: "file_edit", category: "edit", toolName: "apply_patch", errorClass: null, errorFingerprint: null, ...extra });
const validation = (name: string, start: number, end: number, passed = true, extra: Partial<NormalizedEvent> = {}) => event(name, start, end,
  { ...(passed ? success : {}), category: "test", operationKey: id("operation", "test-a"), validationScope: "targeted", errorFingerprint: passed ? null : id("error", "test-error"), ...extra });
const rule = (a: ReturnType<typeof analyzeSourcePatterns>, name: string) => a.rules.find(r => r.ruleId === name)!;

function claudeSource(events: readonly NormalizedEvent[]): StoredSource {
  const adapted = events.map(e => ({ ...e, provider: "claude" as const, toolName: e.kind === "file_read" ? "Read" : e.kind === "file_edit" ? "Edit" : "Bash",
    turnId: null, intervalScope: "invocation_latency" as const, intervalTimingEvidence: "paired_timestamps" as const,
    durationMs: Date.parse(e.endAt!) - Date.parse(e.startAt!), durationScope: "invocation_latency" as const, timingEvidence: "paired_timestamps" as const,
    sourceRef: { ...e.sourceRef, recordType: "user" as const } }));
  const observations: MetricEvidence["observations"] = adapted.flatMap(e => {
    const base = { sessionId: e.sessionId, eventId: e.id, turnId: null, messageId: null, usageId: null, origin: "ordinary" as const, observedUsage: null };
    return [{ ...base, id: id("source", `call-${e.id}`), representation: "call" as const, observedResult: null,
      sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset - 1 } },
    { ...base, id: id("source", `result-${e.id}`), representation: "result" as const,
      observedResult: { isError: e.status === "failed", completionKind: "invocation_result" as const, unassignedAcknowledgement: false,
        observedAt: e.endAt, acknowledgementLatencyMs: null, durationMs: null, durationScope: "unknown" as const },
      sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset } }];
  });
  const s = source(adapted, observations);
  return { ...s, provider: "claude", parserVersion: 2, evidence: { ...s.evidence!, observations,
    capabilities: { provider: "claude", parserVersion: 2, support: "shape_verified_only", coverage: "recognized_shapes", observedShapes: ["tool_use", "tool_result"],
      unsupportedRecords: 0, ambiguousRecords: 0, stateLimited: false, diagnosticsDropped: 0 } } };
}
const read = (name: string, start: number, extra: Partial<NormalizedEvent> = {}) => event(name, start, start + 2000,
  { ...success, kind: "file_read", category: "read", toolName: "Read", lookupKey: id("lookup", "same"), lookupRange: { startLine: 1, endLine: 10 },
    contentFingerprint: id("content", "unchanged"), contentState: "complete", changeState: "unchanged", errorFingerprint: null, ...extra });

describe("observed edit validation cycles", () => {
  it("groups multiple edits, first failure and same-operation recovery without claiming first-pass success", () => {
    const s = source([edit("edit1", 0, 1000), edit("edit2", 2000, 3000), validation("bad", 4000, 5000, false), validation("good", 6000, 7000)]);
    const a = analyzeSourcePatterns(s), p = a.editValidation.partitions[0]!;
    expect(p).toMatchObject({ cycleN: 1, firstPassN: 0, firstTerminalN: 1, firstPassValidationRate: 0, scopeKnownN: 1, fullScopeN: 0 });
    expect(a.editValidation.cycles[0]).toMatchObject({ editEventIds: s.events.slice(0, 2).map(e => e.id), validationEventIds: s.events.slice(2).map(e => e.id),
      firstResult: "failure", resolved: true, successfulValidationEventId: s.events[3]!.id, changedFiles: null, changedLines: null });
  });
  it("keeps no-edit validation and awaiting edits outside the first-pass denominator", () => {
    const a = analyzeSourcePatterns(source([validation("orphan", 0, 1000), edit("edit", 2000, 3000)]));
    expect(a.editValidation.partitions[0]).toMatchObject({ firstTerminalN: 0, firstPassValidationRate: null, withoutObservedEditN: 1, awaitingValidationEditN: 1 });
  });
  it("does not infer full scope from a successful test command", () => {
    const a = analyzeSourcePatterns(source([edit("edit", 0, 1000), validation("test", 2000, 3000, true, { validationScope: "unknown" })]));
    expect(a.editValidation.partitions[0]).toMatchObject({ firstPassValidationRate: 1, scopeKnownN: 0, fullValidationRatio: null });
    expect(rule(a, "validation-thrashing").status).toBe("not_evaluable");
  });
  it("does not call an unrelated validation target recovery", () => {
    const a = analyzeSourcePatterns(source([edit("edit", 0, 1000), validation("failed", 2000, 3000, false), validation("other", 4000, 5000, true, { operationKey: id("operation", "test-b") })]));
    expect(a.editValidation.cycles[0]?.resolved).toBe(false); expect(a.editValidation.partitions[0]?.withoutObservedEditN).toBe(1);
  });
  it.each([
    { status: "pending", endAt: null, intervalScope: "unknown", intervalTimingEvidence: "unknown" },
    { status: "unknown" }, { kind: "mcp", category: "mcp", toolName: "mcp" }, { startAt: null },
    { kind: "other", category: "other", toolName: "other" },
  ] as const)("blocks ambiguous intervening evidence %j", patch => {
    const a = analyzeSourcePatterns(source([edit("edit", 0, 1000), event("barrier", 2000, 3000, patch), validation("test", 4000, 5000)]));
    expect(a.editValidation.partitions[0]?.status).toBe("unavailable"); expect(a.editValidation.cycles).toEqual([]);
  });
  it("rejects overlapping or tied chronology without erasing positioned category time", () => {
    const a = analyzeSourcePatterns(source([edit("edit", 0, 10000), validation("test", 5000, 15000)]));
    expect(a.editValidation.partitions[0]?.reasons).toContain("overlapping_actions");
    expect(a.timePartitions?.[0]).toMatchObject({ toolBusyMs: 15000, concurrentCategoriesMs: 5000 });
  });
});

describe("evidence-qualified pattern rules", () => {
  it("includes first retry failure, excludes success and gaps, and keeps process durations independent", () => {
    const es = [failure("f1", 0, 2000), failure("f2", 3000, 6000), failure("f3", 7000, 11000), event("success", 12000, 13000, success)];
    const a = analyzeSourcePatterns(source(es)), c = a.candidates.find(x => x.ruleId === "retry-loop")!;
    expect(c.includedEventIds).toEqual(es.slice(0, 3).map(e => e.id)); expect(c.occurrences).toBe(3);
    expect(a.timePartitions?.[0]?.perRuleMs["retry-loop"]).toBe(9000); expect(a.timePartitions?.[0]?.intervalLengthSumMs).toBe(10000);
  });
  it.each([2, 3, 4])("uses the literal three-failure threshold: %i", n => {
    const a = analyzeSourcePatterns(source(Array.from({ length: n }, (_, i) => failure(`f${i}`, i * 2000, i * 2000 + 1000))));
    expect(rule(a, "retry-loop").candidateIds.length).toBe(n >= 3 ? 1 : 0);
  });
  it.each([600000, 600001])("uses a closed 600000ms failure window: %i", delta => {
    const a = analyzeSourcePatterns(source([failure("a", 0, 1000), failure("b", 2000, 3000), failure("c", delta, delta + 1000)]));
    expect(rule(a, "retry-loop").candidateIds.length).toBe(delta === 600000 ? 1 : 0);
  });
  it.each(["error", "operation", "turn", "success"] as const)("does not bridge changed %s", change => {
    const extra: Partial<NormalizedEvent> = change === "error" ? { errorFingerprint: id("error", "other") }
      : change === "operation" ? { operationKey: id("operation", "other") } : change === "turn" ? { turnId: id("turn", "other") } : success;
    const a = analyzeSourcePatterns(source([failure("a", 0, 1000), failure("b", 2000, 3000, extra), failure("c", 4000, 5000)]));
    expect(rule(a, "retry-loop").candidateIds).toEqual([]);
  });
  it("keeps ordinary missing error evidence unavailable rather than diagnosing from exit-code equality", () => {
    const a = analyzeSourcePatterns(source([event("a", 0, 1000), event("b", 2000, 3000), event("c", 4000, 5000)]));
    expect(rule(a, "retry-loop")).toMatchObject({ status: "not_evaluable", eligibleEventN: 0 });
    expect(a.timePartitions?.[0]?.perRuleMs["retry-loop"]).toBeNull(); expect(a.timePartitions?.[0]?.patternAssociatedMs).toBeNull();
  });
  it("requires three occurrences across at least two streams for Repeated Error", () => {
    const es = [failure("a", 0, 1000), failure("b", 2000, 3000), failure("c", 4000, 5000, { sessionId: id("session", "second") })];
    const a = analyzeSourcePatterns(source(es)), c = a.candidates.find(x => x.ruleId === "repeated-error")!;
    expect(c.occurrences).toBe(3); expect(c.sessionIds).toHaveLength(2); expect(c.includedEventIds).toHaveLength(3);
    expect(rule(analyzeSourcePatterns(source(es.slice(0, 2))), "repeated-error").candidateIds).toEqual([]);
  });
  it("does not erase confirmed repeated errors when some failures have no interval", () => {
    const es = [failure("a", 0, 1000), failure("b", 2000, 3000), failure("c", 4000, 5000,
      { sessionId: id("session", "second"), startAt: null, endAt: null, intervalScope: "unknown", intervalTimingEvidence: "unknown" })];
    const a = analyzeSourcePatterns(source(es)), c = a.candidates.find(x => x.ruleId === "repeated-error")!;
    expect(c).toMatchObject({ occurrences: 3, timedContributionN: 2, untimedContributionEventIds: [es[2]!.id] });
    expect(rule(a, "repeated-error").status).toBe("partial");
  });
  it("qualifies Retry before clipping its contribution window", () => {
    const es = [failure("a", 0, 1000), failure("b", 2000, 3000), failure("c", 4000, 5000)];
    const a = analyzeSourcePatterns(source(es), { startMs: 4500, endMs: 6000 });
    expect(rule(a, "retry-loop").candidateIds).toHaveLength(1); expect(a.candidates[0]?.evidenceEventIds).toHaveLength(3);
    expect(a.timePartitions?.[0]?.perRuleMs["retry-loop"]).toBe(500);
  });
  it("does not count period-external Repeated Error occurrences", () => {
    const es = [failure("a", 0, 1000), failure("b", 2000, 3000), failure("c", 4000, 5000, { sessionId: id("session", "second") })];
    expect(rule(analyzeSourcePatterns(source(es), { startMs: 1500, endMs: 6000 }), "repeated-error").candidateIds).toEqual([]);
  });
  it("includes only the second and later exact complete unchanged lookups", () => {
    const a = analyzeSourcePatterns(claudeSource(Array.from({ length: 4 }, (_, i) => read(`r${i}`, i * 3000))));
    const c = a.candidates.find(x => x.ruleId === "context-churn")!;
    expect(c).toMatchObject({ occurrences: 4, timedContributionN: 3 }); expect(c.includedEventIds).toEqual(c.evidenceEventIds.slice(1));
    expect(a.timePartitions?.[0]?.perRuleMs["context-churn"]).toBe(6000);
  });
  it.each([{ contentState: "truncated" }, { changeState: "unknown" }, { changeState: "changed" }, { contentFingerprint: null },
    { lookupKey: null }, { lookupRange: null }] as const)("does not infer repeat equivalence from %j", patch => {
    const a = analyzeSourcePatterns(claudeSource(Array.from({ length: 4 }, (_, i) => read(`r${i}`, i * 3000, patch))));
    expect(rule(a, "context-churn").candidateIds).toEqual([]); expect(rule(a, "context-churn").status).toBe("not_evaluable");
  });
  it("does not bridge an intervening edit even when the returned content matches", () => {
    const a = analyzeSourcePatterns(claudeSource([read("r1", 0), read("r2", 3000), edit("edit", 6000, 7000), read("r3", 8000), read("r4", 11000)]));
    expect(rule(a, "context-churn").candidateIds).toEqual([]);
  });
  it("exposes repeated known-scope validation as informational with no included time", () => {
    const a = analyzeSourcePatterns(source([edit("e", 0, 1000), validation("v1", 2000, 3000), validation("v2", 4000, 5000), validation("v3", 6000, 7000)]));
    const c = a.candidates.find(x => x.ruleId === "validation-thrashing")!;
    expect(c).toMatchObject({ severity: "INFO", occurrences: 3, includedEventIds: [], avoidability: "unestablished", improvement: "not_measured" });
    expect(c.qualityGuardrail).toContain("full regression/security/build");
  });
  it.each(["source", "evidence", "state", "version", "proof"] as const)("preserves %s suppression", kind => {
    let s = source([failure("a", 0, 1000), failure("b", 2000, 3000), failure("c", 4000, 5000)]);
    if (kind === "source") s = { ...s, availability: "unavailable" };
    if (kind === "evidence") s = { ...s, evidence: null };
    if (kind === "state") s = { ...s, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, stateLimited: true } } };
    if (kind === "version") s = { ...s, parserVersion: 999 };
    if (kind === "proof") s = { ...s, evidence: { ...s.evidence!, observations: [] } };
    const a = analyzeSourcePatterns(s); expect(a.candidates).toEqual([]); expect(a.editValidation.cycles).toEqual([]);
    expect(a.rules.every(r => r.status === "suppressed" || r.status === "not_evaluable")).toBe(true);
  });
  it("is deterministic and freezes owned output without freezing input", () => {
    const s = structuredClone(source([failure("a", 0, 1000), failure("b", 2000, 3000), failure("c", 4000, 5000)])), before = JSON.stringify(s);
    const a = analyzeSourcePatterns(s), b = analyzeSourcePatterns({ ...s, events: [...s.events].reverse(), evidence: { ...s.evidence!, observations: [...s.evidence!.observations].reverse() } });
    expect(a).toEqual(b); expect(JSON.stringify(s)).toBe(before); expect(Object.isFrozen(s.events)).toBe(false); expect(Object.isFrozen(a.candidates)).toBe(true);
    expect(JSON.stringify(a)).not.toMatch(/operationKey|errorFingerprint|contentFingerprint|lookupKey|sourceRef|FICTITIOUS_/);
    for (const e of s.events) for (const secret of [e.operationKey, e.errorFingerprint]) if (secret !== null) expect(JSON.stringify(a)).not.toContain(secret);
  });
});
