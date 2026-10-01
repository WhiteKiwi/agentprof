import { describe, expect, it } from "vitest";
import { formatInsightsResult } from "../src/cli/insights.js";
import { analyzeSourceSlowTool } from "../src/analysis/source-slow-tool.js";
import type { SourceSlowToolAnalysis, SourceSlowToolCandidate } from "../src/analysis/source-slow-tool.js";
import type { MetricEvidence, StoredSource } from "../src/db/source-store.js";
import { validateEvent } from "../src/db/source-validation.js";
import { normalizeEvent } from "../src/normalize/event.js";
import type { NormalizedEvent } from "../src/normalize/types.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import type { SourceObservation } from "../src/parsers/types.js";
import type { ClaudeSourceObservation } from "../src/parsers/claude/types.js";
const identity = createIdentityContext(new Uint8Array(32).fill(61), "c".repeat(32));
const fileIdentity = "synthetic-insights-format", eventId = (s: string) => identity.fingerprint("event", [s]);
function event(name: string, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { ...normalizeEvent({ provider: "codex", eventIdentity: name, sessionIdentity: "synthetic-insights-session", kind: "shell", toolName: "exec_command", command: "npm test FICTITIOUS_INSIGHTS_TARGET",
    status: "completed", statusEvidence: "explicit", exitCode: 0, durationMs: 4, timingEvidence: "source_reported", durationScope: "process_runtime",
    sourceRef: { fileIdentity, byteOffset: 10, recordType: "event_msg" } }, identity).event!, ...extra };
}
function observation(e: NormalizedEvent): SourceObservation {
  return { id: eventId(`observation-${e.id}`), eventId: e.id, turnId: null, usageId: null, representation: "structured", origin: "ordinary", transportStatus: "completed", observedUsage: null,
    sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset } };
}
function claude(e: NormalizedEvent): ClaudeSourceObservation[] {
  const common = { sessionId: e.sessionId, eventId: e.id, messageId: null, usageId: null, turnId: null, origin: "ordinary" as const, observedUsage: null };
  return [{ ...common, id: eventId(`call-${e.id}`), representation: "call", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 2 }, observedResult: null },
    { ...common, id: eventId(`result-${e.id}`), representation: "result", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset },
      observedResult: { isError: e.status === "failed", completionKind: "invocation_result", unassignedAcknowledgement: false, observedAt: e.endAt, acknowledgementLatencyMs: null, durationMs: null, durationScope: "unknown" } }];
}
function source(rows: NormalizedEvent[] = [], observations?: MetricEvidence["observations"]): StoredSource {
  const provider = rows[0]?.provider ?? "codex";
  return { sourceId: rows[0]?.sourceRef.fileId ?? identity.fingerprint("source", [fileIdentity]), provider, parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: identity.keyId,
    revision: 7, availability: "available", completedOffset: 10000, observedSize: 10005, boundaryFingerprint: null, cacheEvidence: null, events: rows, persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false,
    evidence: { turns: [], usage: [], observations: observations ?? rows.flatMap(e => provider === "claude" ? claude(e) : [observation(e)]), diagnostics: [],
      capabilities: { provider, parserVersion: 1, support: "shape_verified_only", coverage: "recognized_shapes", observedShapes: [], unsupportedRecords: 0, ambiguousRecords: 0, stateLimited: false, diagnosticsDropped: 0 } } };
}
const group = (n = 5, patch: Partial<NormalizedEvent> = {}, prefix = "g") => Array.from({ length: n }, (_, i) => event(`${prefix}-${i}`, patch));
const result = (s: StoredSource) => ({ mode: "selected_source" as const, analysis: analyzeSourceSlowTool(s) });
const text = (a: SourceSlowToolAnalysis) => formatInsightsResult({ mode: "selected_source", analysis: a }, false);
const flat = (s: string) => s.replace(/\s+/g, " ");
function completeCard(output: string, c: SourceSlowToolCandidate) {
  const s = flat(output);
  for (const v of [c.id, c.partitionId, c.sessionId, c.group.kind, c.group.category, c.group.toolName, c.group.commandPattern, c.grouping, c.measurementBasis, c.durationScope, c.timingEvidence,
    ...c.limitations, c.necessaryWorkCounterexample, c.investigativeAction, c.matchedExperiment, c.qualityGuardrail]) if (v !== null) expect(s).toContain(flat(v));
  for (const v of [c.n, c.sumMs, c.meanMs, c.maxMs, c.p50Ms, c.p95Ms, c.denominatorN, c.denominatorSumMs, c.observedEligibleNativeToolDurationShare]) expect(s).toContain(String(v));
  for (const [k, v] of Object.entries(c.confidence)) { expect(s).toContain(k); expect(s).toContain(v); }
}
describe("complete evidence-first selected-source output", () => {
  it.each(["codex", "claude"] as const)("renders complete %s positive without changing rule JSON or frozen input", provider => {
    const extra = provider === "claude" ? { provider, toolName: "Bash", durationScope: "invocation_latency", timingEvidence: "paired_timestamps" } as const : {};
    const r = result(source([...group(5, extra), event("denominator", { ...extra, category: "build", commandPattern: "cargo build", durationMs: 80 })]));
    const before = JSON.stringify(r), output = text(r.analysis), card = r.analysis.candidates![0]!;
    expect(Object.isFrozen(r.analysis)).toBe(true); expect(card.observedEligibleNativeToolDurationShare).toBe(0.2); completeCard(output, card);
    for (const field of [r.analysis.sourceId, "revision", "7", "10000", "10005", "source_bytes", "source_prefix", "available", "events_and_metric_evidence", "slow-tool", "source-prefix-v1", "shape_verified_only", "recognized_shapes"]) expect(output).toContain(field);
    expect(flat(output)).toContain("fraction of admitted compatible native-call recorded duration; 1=100%");
    expect(output).toContain("--json"); expect(output).not.toMatch(/FICTITIOUS_|\x1b|boundaryFingerprint|sourceRef|operationKey/);
    expect(formatInsightsResult(r, true)).toBe(JSON.stringify({ schema: "agentprof.cli/v1", ok: true, command: "insights", result: r }) + "\n"); expect(JSON.stringify(r)).toBe(before);
    for (const id of [...r.analysis.partitions[0]!.eventIds, ...card.evidenceEventIds, ...card.evidenceObservationIds]) expect(formatInsightsResult(r, true)).toContain(id);
  });
  it("does not discard a small/other-category denominator or promote a necessary-only 100% concentration to waste", () => {
    const r = result(source([...group(), event("one-other", { category: "other", commandPattern: "other <args>", durationMs: 80 })]));
    expect(r.analysis.candidates![0]).toMatchObject({ denominatorN: 6, denominatorSumMs: 100, observedEligibleNativeToolDurationShare: 0.2 }); completeCard(text(r.analysis), r.analysis.candidates![0]!);
    const only = result(source(group())); expect(only.analysis.candidates![0]!.observedEligibleNativeToolDurationShare).toBe(1); completeCard(text(only.analysis), only.analysis.candidates![0]!);
    expect(text(only.analysis)).not.toMatch(/Detected Waste\s*[:=]\s*0|savings\s*[:=]\s*[0-9]|no bottlenecks/i);
  });
  it.each([5, 19, 20])("retains n=%s quantiles and low-sample state", n => {
    const r = result(source(Array.from({ length: n }, (_, i) => event(`q-${i}`, { durationMs: i + 1 }))));
    expect(r.analysis.candidates![0]!.lowSampleP95).toBe(n < 20); completeCard(text(r.analysis), r.analysis.candidates![0]!);
    expect(flat(text(r.analysis))).toContain(`lowSampleP95=${n < 20}`);
  });
  it("preserves exact fractional strings and observed zero as samples", () => {
    const a = result(source(group(5, { durationMs: 0.125 }))).analysis; completeCard(text(a), a.candidates![0]!); expect(text(a)).toContain("0.625"); expect(text(a)).toContain("0.125");
    const b = result(source([...group(4, { durationMs: 0 }), event("positive", { durationMs: 1 })])).analysis; completeCard(text(b), b.candidates![0]!); expect(b.candidates![0]).toMatchObject({ n: 5, p50Ms: 0, meanMs: 0.2 });
  });
  it.each([4, 5])("preserves negative threshold outcome for n=%s", n => {
    const rows = n === 4 ? group(4) : [...group(5, { durationMs: 3.8 }), event("rest", { durationMs: 81, category: "build", commandPattern: "cargo build" })];
    const a = result(source(rows)).analysis; expect(a.candidates).toEqual([]); expect(text(a)).toMatch(/no candidate met/i); expect(text(a)).not.toMatch(/no bottlenecks/i);
  });
  it.each(["missing", "unavailable", "limited"])("retains suppressed unavailable candidates for %s", reason => {
    const s = source(group()), a = result({ ...s, availability: reason === "unavailable" ? "unavailable" : "available", evidence: reason === "missing" ? null : { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, stateLimited: reason === "limited" } } }).analysis;
    const output = text(a); expect(a.candidates).toBeNull(); expect(output).toContain(a.suppressionReason!); expect(output).toContain("source_suppressed"); expect(output).toMatch(/unavailable/i); expect(output).not.toMatch(/no candidate met|no bottlenecks/i);
    if (reason === "missing") { expect(output).toContain("unknown"); expect(a.inventory.observations).toBeNull(); }
  });
  it("separates empty source, actual zero, overflow and unresolved partitions", () => {
    const empty = result(source()).analysis; expect(empty.candidates).toBeNull(); expect(text(empty)).toContain("no_eligible_events");
    const zero = result(source(group(5, { durationMs: 0 }))).analysis; expect(zero.candidates).toEqual([]); expect(text(zero)).toContain("zero_denominator"); expect(flat(text(zero))).toContain("denominator sum=0 ms");
    const overflow = result(source(group(5, { durationMs: Number.MAX_SAFE_INTEGER }))).analysis; expect(overflow.candidates).toBeNull(); expect(text(overflow)).toContain("numeric_overflow"); expect(flat(text(overflow))).toContain("denominator sum=unknown ms");
    const rows = group(), unresolved = result(source(rows, rows.slice(1).map(observation))).analysis; expect(unresolved.candidates).toBeNull(); expect(text(unresolved)).toContain("identity_unresolved"); expect(text(unresolved)).toContain("no_evaluable_partition"); expect(text(unresolved)).toContain("missing_provenance");
  });
  it("retains partial empty and nonempty outcomes beside suppressed partitions", () => {
    const bad = event("unresolved", { sessionId: identity.fingerprint("session", ["bad"]) });
    for (const durationMs of [0, 4]) {
      const rows = group(5, { durationMs }), a = result(source([...rows, bad], rows.map(observation))).analysis;
      expect(a.assessment).toBe("partial"); expect(a.candidates?.length).toBe(durationMs === 0 ? 0 : 1);
      const output = text(a); expect(output).toContain("partial"); expect(output).toContain("identity_unresolved"); expect(output).toContain("missing_provenance"); expect(output).toContain(bad.sessionId); expect(output).not.toMatch(/no bottlenecks/i);
    }
  });
  it.each(["mcp", "browser"] as const)("keeps coarse %s invocation prerequisite and quality safeguards intact", kind => {
    const rows = group(5, { provider: "claude", kind, category: kind, toolName: kind, commandPattern: null, durationScope: "invocation_latency", timingEvidence: "paired_timestamps" });
    const a = result(source(rows)).analysis, output = text(a); completeCard(output, a.candidates![0]!); expect(flat(output)).toContain("First identify the particular invocation locally"); expect(output).toContain("coarse_tool_family");
  });
  it("preserves event versus observation units and every nonzero exclusion", () => {
    const rows = [...group(), event("model", { kind: "model", category: "model" }), event("pending", { status: "pending" }), event("missing", { durationMs: null })], s = source(rows);
    const o = observation(rows[0]!); const a = result({ ...s, evidence: { ...s.evidence!, observations: [...s.evidence!.observations, { ...o, id: eventId("unlinked"), eventId: null, representation: "metadata" }, { ...o, id: eventId("orphan"), eventId: eventId("absent") }] } }).analysis;
    const output = flat(text(a)); for (const [key, n] of Object.entries(a.eligibility.exclusions)) if (n) expect(output).toContain(`${key}=${n}`);
    for (const [key, n] of Object.entries(a.observationInventory)) expect(output).toContain(`${key}=${n}`);
    expect(output).toContain("unlisted reasons=0"); expect(output).toContain("unresolvedEvents=0");
  });
  it("does not pool source/session/scope/evidence partitions and follows deterministic rule order", () => {
    const rows = [...group(), ...group(5, { sessionId: identity.fingerprint("session", ["other"]) }, "other"), ...group(5, { kind: "mcp", category: "mcp", toolName: "mcp", commandPattern: null, durationScope: "invocation_latency" }, "mcp")];
    const s = source(rows), a = result(s).analysis, output = text(a); expect(a.partitions).toHaveLength(3); expect(a.candidates).toHaveLength(3);
    for (const p of a.partitions) { expect(output).toContain(p.id); expect(output).toContain(p.sessionId); }
    const permuted = result({ ...s, events: [...s.events].reverse(), evidence: { ...s.evidence!, observations: [...s.evidence!.observations].reverse() } }).analysis;
    expect(text(permuted)).toBe(output); expect(formatInsightsResult({ mode: "selected_source", analysis: permuted }, true)).toBe(formatInsightsResult({ mode: "selected_source", analysis: a }, true));
  });
});
describe("bounded complete output", () => {
  it("renders all 4096 separate partitions without claiming eligible candidates", () => {
    const a = result(source(Array.from({ length: 4096 }, (_, i) => event(`partition-${i}`, { sessionId: identity.fingerprint("session", [`p-${i}`]) })))).analysis;
    expect(a.partitions).toHaveLength(4096); expect(a.candidates).toEqual([]); const output = text(a);
    const sessions = new Set(Array.from(output.matchAll(/^Session: (.+)$/gm), m => m[1])); expect(sessions).toEqual(new Set(a.partitions.map(p => p.sessionId))); expect(output).toContain("partition-4096"); expect(output).not.toContain("omitted=");
  });
  it("visits candidate buckets linearly and renders all 819 natural cards", () => {
    const rows: NormalizedEvent[] = []; for (let p = 0; p < 819; p++) for (let i = 0; i < 5; i++) rows.push(event(`p-${p}-${i}`, { sessionId: identity.fingerprint("session", [`p-${p}`]) }));
    rows.push(event("extra", { sessionId: identity.fingerprint("session", ["extra"]) }));
    const a = result(source(rows)).analysis; expect(a.candidates).toHaveLength(819); let visits = 0;
    const candidates = new Proxy([...a.candidates!], { get(target, key, receiver) { if (typeof key === "string" && /^\d+$/.test(key)) visits++; return Reflect.get(target, key, receiver); } });
    const output = text({ ...a, candidates }); expect(visits).toBeLessThanOrEqual(4 * 819);
    expect(new Set(output.match(/candidate-[0-9]+/g)).size).toBe(819); expect(output.match(/Quality guardrail:/g)).toHaveLength(819); expect(output).toContain("candidate-819"); expect(output).not.toContain("omitted=");
  });
  it("preserves all 8192 decisive references in JSON and reports counts in human output", () => {
    const a = result(source(group(4096, { provider: "claude", toolName: "Bash", timingEvidence: "paired_timestamps", durationScope: "invocation_latency" }))).analysis;
    expect(a.candidates![0]!.evidenceObservationIds).toHaveLength(8192); const output = text(a); expect(output).toContain("8192");
    const restored = JSON.parse(formatInsightsResult({ mode: "selected_source", analysis: a }, true)).result.analysis; expect(restored).toEqual(a);
  });
  it("wraps without clipping a long validated normalized pattern", () => {
    const commandPattern = "npm test" + " --runInBand".repeat(2048) + " <target>", s = source(group(5, { commandPattern }));
    for (const e of s.events) expect(validateEvent(e, s).commandPattern).toBe(commandPattern);
    const output = text(result(s).analysis); expect(flat(output)).toContain(commandPattern); expect(output).not.toContain("...");
  });
});
