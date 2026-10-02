// Planning artifact only. NOT RUN. Proposed destination: tests/source-report-command-breakdown.test.ts
// Expected failure before implementation: missing ../src/report/command-breakdown.js.
import { expect, it } from "vitest";
import { buildSourceCommandBreakdown } from "../src/report/command-breakdown.js";
import { buildSourceReportModel } from "../src/report/source-model.js";
import { renderSourceReport } from "../src/report/render.js";
import { analyzeSourceSlowTool } from "../src/analysis/source-slow-tool.js";
import { summarizeSource } from "../src/analysis/source-summary.js";
import { encodeSourceSnapshot } from "../src/db/source-metric-validation.js";
import type { StoredSource, MetricEvidence } from "../src/db/source-store.js";
import type { NormalizedEvent } from "../src/normalize/types.js";

const keyId = "c".repeat(32);
const id = (domain: string, n: number) => `h1:${keyId}:${domain}:${n.toString(16).padStart(64, "0")}`;
const sourceId = id("source", 1), sessionId = id("session", 1);
const groupLabel = "npm test <target>";
const event = (i: number, patch: Partial<NormalizedEvent> = {}): NormalizedEvent => ({
  normalizationVersion: 1, keyVersion: 1, keyId, id: id("event", i), sessionId,
  turnId: null, parentEventId: null, provider: "codex", kind: "shell", category: "test",
  toolName: "exec_command", commandPattern: groupLabel, operationKey: null, fileFingerprint: null,
  lookupKey: null, lookupRange: null, contentFingerprint: null, contentState: "unknown",
  changeState: "unknown", validationScope: "unknown", startAt: null, endAt: null,
  intervalTimingEvidence: "unknown", intervalScope: "unknown",
  durationMs: 4, timingEvidence: "source_reported", durationScope: "process_runtime",
  status: "completed", executionOutcome: "success", exitCode: 0,
  errorFingerprint: null, errorClass: null,
  sourceRef: { fileId: sourceId, byteOffset: i * 10, recordType: "event_msg" },
  ...patch,
});
function observations(e: NormalizedEvent): MetricEvidence["observations"] {
  const base = {
    id: id("source", 10000 + Number.parseInt(e.id.slice(-5), 16)),
    eventId: e.id, turnId: null, usageId: null, origin: "ordinary" as const,
    transportStatus: e.status, observedUsage: null, sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset },
  };
  if (e.timingEvidence === "paired_timestamps") return [
    { ...base, id: id("source", 20000 + Number.parseInt(e.id.slice(-5), 16)), representation: "call" },
    { ...base, representation: "result" },
  ];
  return [{ ...base, representation: "structured" }];
}
function source(rows: readonly NormalizedEvent[], proof?: MetricEvidence["observations"]): StoredSource {
  const result: StoredSource = {
    sourceId, provider: "codex", parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId,
    revision: 3, availability: "available", completedOffset: 100000, observedSize: 100005,
    boundaryFingerprint: id("content", 1), cacheEvidence: null, relationshipEvidence: null,
    events: rows, persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false,
    evidence: {
      turns: [], usage: [], diagnostics: [], observations: proof ?? rows.flatMap(observations),
      capabilities: { provider: "codex", parserVersion: 1, support: "shape_verified_only",
        coverage: "recognized_shapes", observedShapes: [], unsupportedRecords: 0, ambiguousRecords: 0,
        stateLimited: false, diagnosticsDropped: 0 },
    },
  };
  // Positive fixtures must pass the real persisted event/metric validators.
  // Explicit malformed helper inputs are constructed only after this boundary.
  const { revision, availability, persistedScope, aggregationReady, parserResumeReady, ...input } = result;
  encodeSourceSnapshot(input, keyId);
  return result;
}
const six = () => source([
  ...Array.from({ length: 5 }, (_, i) => event(i + 1)),
  event(6, { category: "build", commandPattern: "cargo build", durationMs: 80 }),
]);
function project(s: StoredSource) {
  const slow = analyzeSourceSlowTool(s), breakdown = buildSourceCommandBreakdown(s, slow);
  return { slow, breakdown, model: buildSourceReportModel(summarizeSource(s), slow, breakdown) };
}
function partition(s: StoredSource) { return project(s).breakdown.partitions[0]!; }
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object
  ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

it("shows an 80/100 one-call build even though unchanged SlowTool only selects the five-call test group", () => {
  const s = six(), before = JSON.stringify(s), { slow, breakdown, model } = project(s), p = breakdown.partitions[0]!;
  expect(slow.candidates).toHaveLength(1);
  expect(slow.candidates![0]).toMatchObject({ n: 5, sumMs: 20, observedEligibleNativeToolDurationShare: 0.2 });
  expect(p).toMatchObject({ status: "evaluated", denominatorN: 6, denominatorSumMs: 100 });
  expect(p.groups).toEqual([
    { ordinal: 1, group: { kind: "shell", category: "build", toolName: "exec_command", commandPattern: "cargo build" }, n: 1, sumMs: 80, share: 0.8 },
    { ordinal: 2, group: { kind: "shell", category: "test", toolName: "exec_command", commandPattern: groupLabel }, n: 5, sumMs: 20, share: 0.2 },
  ]);
  expect(p.calls!.map(c => [c.ordinal, c.groupOrdinal, c.durationMs])).toEqual([
    [6, 1, 80], [1, 2, 4], [2, 2, 4], [3, 2, 4], [4, 2, 4], [5, 2, 4],
  ]);
  expect(model.schema).toBe("agentprof.source-report/v2");
  expect(JSON.stringify(s)).toBe(before);
  expect(Object.isFrozen(s)).toBe(false);
  expect(Object.isFrozen(breakdown)).toBe(true);
  expect(Object.isFrozen(p.groups)).toBe(true);
  expect(JSON.stringify(breakdown)).not.toMatch(/eventIds|sourceRef|keyId|startAt|endAt|boundaryFingerprint/);
});

it("includes all admitted groups below threshold and keeps zero numerator distinct from unknown", () => {
  const p = partition(source([
    event(1, { durationMs: 0 }), event(2, { category: "build", commandPattern: "cargo build", durationMs: 99 }),
    event(3, { category: "other", commandPattern: "git status", durationMs: 1 }),
  ]));
  expect(p.groups!.map(g => [g.n, g.sumMs, g.share])).toEqual([[1, 99, 0.99], [1, 1, 0.01], [1, 0, 0]]);
  expect(p.denominatorN).toBe(3); expect(p.denominatorSumMs).toBe(100);
});

it("preserves zero denominator as known zero durations with null shares", () => {
  const { breakdown, model } = project(source([event(1, { durationMs: 0 }), event(2, { category: "build", commandPattern: "cargo build", durationMs: 0 })]));
  const p = breakdown.partitions[0]!;
  expect(p.status).toBe("zero_denominator"); expect(p.denominatorN).toBe(2); expect(p.denominatorSumMs).toBe(0);
  expect(p.groups!.map(g => g.share)).toEqual([null, null]);
  expect(p.calls!.map(c => c.durationMs)).toEqual([0, 0]);
  const html = renderSourceReport(model);
  expect(html).toContain("Native command duration shares");
  expect(html).toContain("unknown");
  const table = html.match(/<table\b[^>]*>\s*<caption\b[^>]*>Native command duration shares[\s\S]*?<\/table>/)![0];
  expect(table).not.toMatch(/<svg|0\.0%/);
});

it("copies ordered fractional sums rather than manufacturing an exact stacked composition", () => {
  const p = partition(source([
    event(1, { durationMs: 0.1 }), event(2, { durationMs: 0.2 }),
    event(3, { category: "build", commandPattern: "cargo build", durationMs: 0.3 }),
  ]));
  expect(p.denominatorSumMs).toBe(0.6000000000000001);
  expect(p.groups!.map(g => g.sumMs)).toEqual([0.30000000000000004, 0.3]);
  expect(p.groups![0]!.share).toBe(0.5);
  expect(p.groups![1]!.share).toBe(0.4999999999999999);
});

it("keeps failed native calls while excluding pending, cancelled, unknown and unmeasured calls", () => {
  const rows = [
    event(1, { status: "failed", executionOutcome: "error", exitCode: 1 }),
    event(2, { status: "pending", durationMs: null, timingEvidence: "unknown", durationScope: "unknown" }), event(3, { status: "cancelled" }),
    event(4, { status: "unknown" }), event(5, { durationMs: null, timingEvidence: "unknown", durationScope: "unknown" }),
    event(6, { timingEvidence: "estimated" }),
  ];
  const p = partition(source(rows));
  expect(p.denominatorN).toBe(1); expect(p.denominatorSumMs).toBe(4);
  expect(p.calls).toHaveLength(1); expect(p.calls![0]!.status).toBe("failed");
});

it("does not turn broad summary observations into native admission", () => {
  const rows = six().events, s = source(rows, rows.slice(1).flatMap(observations)), { slow, breakdown, model } = project(s);
  expect(summarizeSource(s).durations!.some(d => d.sumMs === 80)).toBe(true);
  expect(slow.partitions[0]!.eventIds).toHaveLength(6); // tentative IDs are still present
  expect(breakdown.partitions[0]).toMatchObject({ status: "identity_unresolved", denominatorN: null, denominatorSumMs: null, groups: null, calls: null });
  expect(model.commandBreakdown.state).toBe("details_unavailable");
  expect(model.commandBreakdown.selection.groups).toBeNull();
  expect(model.commandBreakdown.selection.calls).toBeNull();
  expect(model.commandBreakdown.selection.unavailablePartitions!.total).toBe(1);
});

it("preserves numeric overflow without showing partial groups or zero findings", () => {
  const p = partition(source([event(1, { durationMs: Number.MAX_SAFE_INTEGER }), event(2, { durationMs: 1 })]));
  expect(p).toMatchObject({ status: "numeric_overflow", denominatorN: 2, denominatorSumMs: null, groups: null, calls: null });
});

it.each(["source_unavailable", "evidence_absent", "state_limited", "ambiguous_origin", "unsupported_contract", "unresolved_execution_relation"] as const)(
  "preserves source suppression %s with no inferred groups", reason => {
    const s = structuredClone(six()) as Mutable<StoredSource>;
    if (reason === "source_unavailable") s.availability = "unavailable";
    if (reason === "evidence_absent") s.evidence = null;
    if (reason === "state_limited") s.evidence!.capabilities.stateLimited = true;
    if (reason === "ambiguous_origin") s.evidence!.capabilities.ambiguousRecords = 1;
    if (reason === "unsupported_contract") s.parserVersion = 99;
    if (reason === "unresolved_execution_relation") s.events[0]!.parentEventId = id("event", 999);
    const { slow, breakdown } = project(s);
    expect(slow.suppressionReason).toBe(reason);
    expect(breakdown.suppressionReason).toBe(reason);
    expect(breakdown.partitions).toEqual([]);
  },
);

it("uses actual analyzer version admission instead of a report-owned exception", () => {
  const s = structuredClone(six()) as Mutable<StoredSource>; s.parserVersion = 2;
  // Codex2 is unsupported both before and after the independently owned Claude1/2 gate change.
  expect(project(s).breakdown.suppressionReason).toBe("unsupported_contract");
});

it("keeps sessions and compatible timing evidence separate without aggregate time denominators", () => {
  const s = source([
    event(1, { durationMs: 10 }), event(2, { sessionId: id("session", 2), durationMs: 20 }),
    event(3, { durationScope: "invocation_latency", timingEvidence: "paired_timestamps", durationMs: 30 }),
  ]);
  const out = project(s).breakdown;
  expect(out.partitions).toHaveLength(3);
  expect(out.partitions.map(p => p.denominatorSumMs).sort((a, b) => a! - b!)).toEqual([10, 20, 30]);
  for (const p of out.partitions) expect(p.groups![0]!.share).toBe(1);
  expect(out).not.toHaveProperty("denominatorSumMs");
});

it("keeps identical labels separated by their exact group tuple and keeps null patterns", () => {
  const p = partition(source([
    event(1, { category: "test", commandPattern: null }),
    event(2, { category: "build", commandPattern: null }),
    event(3, { category: "other", commandPattern: "git status" }),
  ]));
  expect(p.groups).toHaveLength(3);
  expect(p.groups!.map(g => g.group.category)).toEqual(["build", "other", "test"]);
  expect(p.groups!.filter(g => g.group.commandPattern === null)).toHaveLength(2);
});

it("retains deterministic group/call ties and does not mutate borrowed objects", () => {
  const a = six(), b = { ...a, events: [...a.events].reverse(), evidence: { ...a.evidence!, observations: [...a.evidence!.observations].reverse() } };
  const out = project(a), before = JSON.stringify(out.slow);
  expect(project(b).breakdown).toEqual(out.breakdown);
  expect(renderSourceReport(project(b).model)).toBe(renderSourceReport(out.model));
  buildSourceCommandBreakdown(a, out.slow);
  expect(JSON.stringify(out.slow)).toBe(before);
});

it.each(["revision", "completedOffset", "observedSize", "parserVersion"] as const)("rejects mismatched generation field %s", field => {
  const s = six(), slow = structuredClone(analyzeSourceSlowTool(s)) as Mutable<ReturnType<typeof analyzeSourceSlowTool>>;
  slow[field]++;
  expect(() => buildSourceCommandBreakdown(s, slow)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
});

it.each(["missing", "duplicate", "count", "sum", "tuple"] as const)("rejects contradictory partition membership: %s", mode => {
  const s = six(), slow = structuredClone(analyzeSourceSlowTool(s)) as Mutable<ReturnType<typeof analyzeSourceSlowTool>>, p = slow.partitions[0]!;
  if (mode === "missing") p.eventIds[0] = id("event", 999);
  if (mode === "duplicate") p.eventIds[1] = p.eventIds[0]!;
  if (mode === "count") p.denominatorN = 5;
  if (mode === "sum") p.denominatorSumMs = 99;
  if (mode === "tuple") p.sessionId = id("session", 2);
  expect(() => buildSourceCommandBreakdown(s, slow)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
});

it("rejects the same event referenced by multiple partitions", () => {
  const s = six(), slow = structuredClone(analyzeSourceSlowTool(s)) as Mutable<ReturnType<typeof analyzeSourceSlowTool>>;
  slow.partitions.push({ ...structuredClone(slow.partitions[0]!), id: "partition-2" });
  expect(() => buildSourceCommandBreakdown(s, slow)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
});

it("bounds helper inputs before accumulating repeated references", () => {
  const s = six(), slow = analyzeSourceSlowTool(s);
  expect(() => buildSourceCommandBreakdown({ ...s, events: Array(4097).fill(s.events[0]!) }, slow)).toThrowError(expect.objectContaining({ code: "REPORT_LIMIT" }));
  expect(() => buildSourceCommandBreakdown(s, { ...slow, partitions: Array(4097).fill(slow.partitions[0]!) })).toThrowError(expect.objectContaining({ code: "REPORT_LIMIT" }));
});

it("bounds rows without altering full denominators and counts parent omissions", () => {
  const rows = Array.from({ length: 7 }, (_, si) => Array.from({ length: 11 }, (_, gi) => event(si * 20 + gi + 1, {
    sessionId: id("session", si + 1), commandPattern: `npm test ${"--verbose ".repeat(gi)}<target>`, durationMs: gi + 1,
  }))).flat();
  const { model } = project(source(rows)), b = model.commandBreakdown;
  expect(model.selection.sessions).toEqual({ total: 7, shown: 6, omitted: 1 });
  expect(b.selection.eligiblePartitions).toEqual({ total: 7, shown: 6, omitted: 1 });
  expect(b.selection.groups).toEqual({ total: 77, shown: 60, omitted: 17 });
  expect(b.selection.calls).toEqual({ total: 77, shown: 60, omitted: 17 });
  for (const p of b.contexts) {
    expect(p.denominatorN).toBe(11); expect(p.denominatorSumMs).toBe(66);
    expect(p.groups).toHaveLength(10); expect(p.calls).toHaveLength(10);
    expect(p.groups![0]!.share).toBe(11 / 66);
  }
});

it("retains group identity through overlong-label substitution", () => {
  const s = source([
    event(1, { commandPattern: `npm test ${"--verbose ".repeat(70)}<target>` }),
    event(2, { commandPattern: `npm test ${"--verbose ".repeat(71)}<target>` }),
  ]);
  const { model } = project(s), groups = model.commandBreakdown.contexts[0]!.groups!;
  expect(groups).toHaveLength(2);
  expect(groups.map(g => g.group.commandPattern)).toEqual(["safe pattern omitted (display limit)", "safe pattern omitted (display limit)"]);
  expect(groups.map(g => g.ordinal)).toEqual([1, 2]);
});

it("renders denominator-based bars separately from legacy relative-summary bars", () => {
  const html = renderSourceReport(project(six()).model);
  expect(html).toContain("Native command duration shares · ms");
  expect(html).toContain("Slowest recorded calls · ms");
  expect(html).toContain("80 / 100 ms"); expect(html).toContain("20 / 100 ms");
  expect(html).toContain("80.0%"); expect(html).toContain("20.0%");
  expect(html).toContain("Share of admitted compatible recorded duration");
  expect(html).toContain("API/network share"); expect(html).toContain("unavailable");
  expect(html).toContain("not time share"); // inherited summary-bar caption
  const shares = html.match(/<table\b[^>]*>\s*<caption\b[^>]*>Native command duration shares[\s\S]*?<\/table>/)![0];
  const rows = [...shares.match(/<tbody>([\s\S]*?)<\/tbody>/)![1]!.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(match => match[0]);
  const widthFor = (text: string) => {
    const row = rows.find(value => value.includes(text))!;
    expect(row).toMatch(/<svg\b[^>]*class="[^"]*native-share-bar/);
    const svg = [...row.matchAll(/<svg\b[^>]*>/g)].map(match => match[0]).find(value => /class="[^"]*native-share-bar/.test(value))!;
    const viewBox = svg.match(/\bviewBox="([^"]+)"/)![1]!.trim().split(/\s+/).map(Number);
    expect(viewBox.slice(0, 3)).toEqual([0, 0, 100]); expect(viewBox[3]).toBeGreaterThan(0);
    const rect = [...row.matchAll(/<rect\b[^>]*>/g)].map(match => match[0]).find(value => /class="[^"]*native-share-value/.test(value))!;
    expect(rect).toBeDefined();
    expect(Number(rect.match(/\bx="([^"]+)"/)![1])).toBe(0);
    return Number(rect.match(/\bwidth="([^"]+)"/)![1]);
  };
  expect(widthFor("cargo build")).toBe(80);
  expect(widthFor("npm test")).toBe(20); // maximum-relative 100/25 must fail
  expect(html).not.toMatch(/<script|<iframe|<object|<embed|<link|<img|\sstyle\s*=|\son[a-z]+\s*=|unsafe-inline|javascript:/i);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const m of html.matchAll(/href="#([^"]+)"/g)) expect(ids).toContain(m[1]);
  expect(ids.every(value => !value!.includes("h1:"))).toBe(true);
});

it("keeps exact tiny positive share visible without rounding it into a zero", () => {
  const { model } = project(source([
    event(1, { durationMs: 0.0001 }), event(2, { category: "build", commandPattern: "cargo build", durationMs: 100 }),
  ]));
  expect(model.commandBreakdown.contexts[0]!.groups![1]!.share).toBe(0.0001 / 100.0001);
  expect(renderSourceReport(model)).toContain("&lt;0.1%");
});

it("validates new closed model fields without invoking accessors or disclosing IDs", () => {
  const model = project(six()).model;
  expect(JSON.stringify(model.commandBreakdown)).not.toContain(id("event", 1));
  const bad = structuredClone(model) as Mutable<typeof model>;
  Object.assign(bad.commandBreakdown.contexts[0]!.calls![0]!, { sourceRef: "RAW_SENTINEL" });
  expect(() => renderSourceReport(bad)).toThrow();
  let calls = 0;
  const accessor = structuredClone(model);
  Object.defineProperty(accessor.commandBreakdown.contexts[0]!.groups![0]!, "share", { enumerable: true, get() { calls++; return 0.8; } });
  expect(() => renderSourceReport(accessor)).toThrow();
  expect(calls).toBe(0);
});

it("never rebuilds D from rounded or regrouped cohort sums", () => {
  const p = partition(source([
    event(1, { commandPattern: "npm test", durationMs: 0.1 }),
    event(2, { category: "build", commandPattern: "cargo build", durationMs: 0.2 }),
    event(3, { category: "build", commandPattern: "cargo build", durationMs: 0.3 }),
  ]));
  expect(p.denominatorSumMs).toBe(0.6000000000000001);
  expect(p.groups!.map(g => [g.sumMs, g.share])).toEqual([
    [0.5, 0.8333333333333333], [0.1, 0.16666666666666666],
  ]);
  expect(p.groups!.reduce((total, g) => total + g.sumMs, 0)).toBe(0.6);
});

it("does not call positive division underflow an exact zero share", () => {
  const { breakdown, model } = project(source([
    event(1, { durationMs: Number.MIN_VALUE }),
    event(2, { category: "build", commandPattern: "cargo build", durationMs: Number.MAX_SAFE_INTEGER }),
  ]));
  expect(breakdown.partitions[0]!.groups![1]).toMatchObject({ sumMs: Number.MIN_VALUE, share: 0 });
  const html = renderSourceReport(model);
  expect(html).toContain("5e-324");
  expect(html).toContain("&lt;0.1%");
});

it("does not round a less-than-whole share into an exact 100 percent claim", () => {
  const html = renderSourceReport(project(source([
    event(1, { durationMs: 999.9 }),
    event(2, { category: "build", commandPattern: "cargo build", durationMs: 0.1 }),
  ])).model);
  expect(html).toContain("&lt;100.0%");
});

it("separates a source suppression from an unsuppressed empty native subset and summary-only work", () => {
  const suppressed = project({ ...six(), evidence: null }).model.commandBreakdown;
  expect(suppressed.state).toBe("suppressed");
  expect(suppressed.suppressionReason).toBe("evidence_absent");
  expect(suppressed.selection).toMatchObject({ eligiblePartitions: null, unavailablePartitions: null, missingNativeContexts: null, groups: null, calls: null });
  const summaryOnly = project(source([event(1, { kind: "model", category: "model", toolName: null, commandPattern: null })])).model.commandBreakdown;
  expect(summaryOnly.state).toBe("no_native_partitions");
  expect(summaryOnly.selection.groups).toEqual({ total: 0, shown: 0, omitted: 0 });
  expect(summaryOnly.selection.calls).toEqual({ total: 0, shown: 0, omitted: 0 });
  expect(summaryOnly.selection.missingNativeContexts).toEqual({ total: 1, shown: 1, omitted: 0 });
  expect(summaryOnly.contexts[0]).toMatchObject({ state: "no_native_partition", nativePartitionId: null, denominatorN: null, denominatorSumMs: null, groups: null, calls: null, counts: { groups: null, calls: null } });
});

it("does not count overflow admission as available-detail rows or omissions", () => {
  const rows = [
    ...six().events,
    event(21, { sessionId: id("session", 2), durationMs: Number.MAX_SAFE_INTEGER }),
    event(22, { sessionId: id("session", 2), durationMs: 1 }),
    event(31, { sessionId: id("session", 3) }), event(32, { sessionId: id("session", 3) }),
  ];
  const s = source(rows, rows.filter(r => r.id !== id("event", 31)).flatMap(observations));
  const { slow, model } = project(s), b = model.commandBreakdown;
  expect(slow.eligibility.admittedTimedCalls).toBe(8);
  expect(b.state).toBe("details_partial");
  expect(b.selection.eligiblePartitions).toEqual({ total: 1, shown: 1, omitted: 0 });
  expect(b.selection.unavailablePartitions).toEqual({ total: 2, shown: 2, omitted: 0 });
  expect(b.selection.groups).toEqual({ total: 2, shown: 2, omitted: 0 });
  expect(b.selection.calls).toEqual({ total: 6, shown: 6, omitted: 0 });
  expect(b.contexts.filter(p => p.groups === null).map(p => p.state)).toEqual(["numeric_overflow", "identity_unresolved"]);
  expect(b.selection.totalsScope).toBe("eligible_detail_partitions_only");
});

it("uses the actual displayed tuple anchor instead of a coincidentally resolving native-only ordinal", () => {
  const s = source([
    event(1, { kind: "model", category: "model", toolName: null, commandPattern: null, durationScope: "invocation_latency", durationMs: 1000 }),
    ...six().events.map((e, i) => ({ ...e, id: id("event", i + 2) })),
  ]);
  const { slow, model } = project(s);
  expect(slow.partitions[0]!.id).toBe("partition-1");
  expect(model.commandBreakdown.contexts[0]).toMatchObject({
    displayPartitionId: "partition-1", nativePartitionId: null, state: "no_native_partition", durationScope: "invocation_latency",
  });
  expect(model.commandBreakdown.contexts[1]).toMatchObject({
    displayPartitionId: "partition-2", nativePartitionId: "partition-1", state: "evaluated",
    sessionId, durationScope: "process_runtime", timingEvidence: "source_reported",
  });
  const html = renderSourceReport(model);
  const nativeTable = html.match(/<table\b[^>]*>\s*<caption\b[^>]*>Slowest recorded calls[\s\S]*?<\/table>/)![0];
  expect(nativeTable).toContain('href="#partition-2"');
  expect(nativeTable).not.toContain('href="#partition-1"');
  const target = html.indexOf('id="partition-2"'), caption = html.indexOf("Native command duration shares", target);
  expect(target).toBeGreaterThan(-1); expect(caption).toBeGreaterThan(target);
  expect(html.slice(target, caption)).toContain("process_runtime");
  expect(html.slice(target, caption)).toContain("source_reported");
});

it("keeps the slowest call visible when its group is omitted and links only to retained context", () => {
  const rows = Array.from({ length: 10 }, (_, gi) => [
    event(gi * 2 + 1, { commandPattern: `npm test ${"--verbose ".repeat(gi)}<target>`, durationMs: 10 }),
    event(gi * 2 + 2, { commandPattern: `npm test ${"--verbose ".repeat(gi)}<target>`, durationMs: 10 }),
  ]).flat();
  rows.push(event(21, { category: "build", commandPattern: "cargo build", durationMs: 19 }));
  const { model } = project(source(rows)), b = model.commandBreakdown, p = b.contexts[0]!;
  expect(p.denominatorN).toBe(21); expect(p.denominatorSumMs).toBe(219);
  expect(p.counts.groups).toEqual({ total: 11, shown: 10, omitted: 1 });
  expect(p.counts.calls).toEqual({ total: 21, shown: 10, omitted: 11 });
  expect(p.groups!.every(g => g.n === 2 && g.sumMs === 20 && g.share === 0.091324200913242)).toBe(true);
  expect(p.calls![0]).toMatchObject({ ordinal: 21, groupOrdinal: 11, durationMs: 19, group: { commandPattern: "cargo build" } });
  expect(p.groups!.some(g => g.ordinal === 11)).toBe(false);
  const html = renderSourceReport(model);
  const table = html.match(/<table\b[^>]*>\s*<caption\b[^>]*>Slowest recorded calls[\s\S]*?<\/table>/)![0];
  const firstRow = table.match(/<tbody>\s*(<tr\b[\s\S]*?<\/tr>)/)![1]!;
  expect(firstRow).toContain("cargo build");
  expect(firstRow.replace(/<[^>]*>/g, " ")).toMatch(/\b1\b/); // visible rank1, distinct from alias Call21
  expect(firstRow).toContain('href="#partition-1"');
  expect(firstRow).not.toMatch(/href="#[^"]*group[^"]*"/);
});

it("treats null native tool name as an admission-negative case, while null pattern is retained", () => {
  const { slow, breakdown } = project(source([event(1, { toolName: null }), event(2, { commandPattern: null })]));
  expect(slow.eligibility.exclusions.unsupported_call_class).toBe(1);
  expect(breakdown.partitions[0]!.groups![0]).toMatchObject({ n: 1, group: { toolName: "exec_command", commandPattern: null } });
});

it("bounds the Summary/native union to four contexts without inventing five native timing contracts", () => {
  const shapes = [
    ["invocation_latency", "paired_timestamps"], ["invocation_latency", "source_reported"],
    ["item_lifecycle", "paired_timestamps"], ["item_lifecycle", "source_reported"],
  ] as const;
  const s = source([
    ...shapes.map(([durationScope, timingEvidence], i) => event(i + 1, {
      kind: "model", category: "model", toolName: null, commandPattern: null, durationScope, timingEvidence,
    })),
    event(5),
  ]);
  const { breakdown, model } = project(s);
  expect(breakdown.partitions).toHaveLength(1); // only process_runtime/source_reported is native
  expect(model.selection.sessionCounts[0]!.partitions).toEqual({ total: 5, shown: 4, omitted: 1 });
  expect(model.commandBreakdown.contexts.every(c => c.state === "no_native_partition")).toBe(true);
  expect(model.commandBreakdown.selection.eligiblePartitions).toEqual({ total: 1, shown: 0, omitted: 1 });
  expect(model.commandBreakdown.selection.groups).toEqual({ total: 1, shown: 0, omitted: 1 });
  expect(model.commandBreakdown.selection.calls).toEqual({ total: 1, shown: 0, omitted: 1 });
  expect(model.commandBreakdown.selection.missingNativeContexts).toEqual({ total: 4, shown: 4, omitted: 0 });
});

// Structural renderer ceiling, deliberately not an ordinary-provider support fixture.
function maximumCombinedModel() {
  const m = structuredClone(project(six()).model) as Mutable<ReturnType<typeof project>["model"]>;
  const summaryRow = structuredClone(m.summary.durations![0]!);
  const nativePartition = structuredClone(m.slowTool.partitions[0]!);
  const card = structuredClone(m.slowTool.candidates![0]!);
  const context = structuredClone(m.commandBreakdown.contexts[0]!);
  const originalGroup = structuredClone(context.groups![0]!);
  const originalCall = structuredClone(context.calls![0]!);
  const sessions = Array.from({ length: 6 }, (_, i) => id("session", i + 1));
  const shapes = [
    ["invocation_latency", "paired_timestamps"], ["invocation_latency", "source_reported"],
    ["item_lifecycle", "paired_timestamps"], ["process_runtime", "source_reported"],
  ] as const;
  const count = (total: number, shown = total) => ({ total, shown, omitted: total - shown });
  m.selection.shownSessionIds = sessions; m.selection.sessionCounts = []; m.selection.partitionCounts = [];
  m.summary.durations = []; m.summary.usage = []; m.slowTool.partitions = []; m.slowTool.candidates = [];
  m.commandBreakdown.contexts = [];
  m.commandBreakdown.state = "details_available";
  for (const [si, sid] of sessions.entries()) {
    m.selection.sessionCounts.push({ sessionId: sid, partitions: count(4), usage: count(4) });
    for (const [pi, [durationScope, timingEvidence]] of shapes.entries()) {
      const index = si * 4 + pi, partitionId = `partition-${index + 1}`;
      const fields = { sessionId: sid, durationScope, timingEvidence };
      m.slowTool.partitions.push({ ...nativePartition, ...fields, id: partitionId, denominatorN: 50, denominatorSumMs: 500, tentativeTimedCalls: 50, evidenceEventCount: 50 });
      m.selection.partitionCounts.push({ ...fields, known: count(10), unknown: count(10), candidates: count(index < 10 ? 1 : 0) });
      for (let i = 0; i < 20; i++) m.summary.durations.push({
        ...summaryRow, ...fields, commandPattern: `npm test ${"--verbose ".repeat(i)}<target>`,
        n: 5, sumMs: i < 10 ? 20 : null, meanMs: i < 10 ? 4 : null, maxMs: 4, p50Ms: 4, p95Ms: 4,
        limitations: i < 10 ? [] : ["numeric_overflow"],
      });
      const groups = Array.from({ length: 10 }, (_, gi) => {
        const sumMs = gi === 0 ? 100 : gi === 1 ? 80 : 40;
        return { ...originalGroup, ordinal: gi + 1,
          group: { kind: "shell" as const, category: index === 23 ? "build" as const : "test" as const, toolName: "exec_command",
            commandPattern: index === 23 ? `cargo build ${"--verbose ".repeat(gi + 1)}<target>` : `npm test ${"--verbose ".repeat(gi)}<target>` },
          n: 5, sumMs, share: sumMs / 500,
        };
      });
      const calls = Array.from({ length: 10 }, (_, i) => ({
        ...originalCall, ordinal: i + 1, groupOrdinal: i < 5 ? 1 : 2,
        group: structuredClone(groups[i < 5 ? 0 : 1]!.group), durationMs: i < 5 ? 20 : 16,
      }));
      m.commandBreakdown.contexts.push({
        ...context, ...fields, displayPartitionId: partitionId, nativePartitionId: partitionId,
        state: "evaluated", denominatorN: 50, denominatorSumMs: 500, groups, calls,
        counts: { groups: count(10), calls: count(50, 10) },
      });
      if (index < 10) m.slowTool.candidates.push({
        ...card, ...fields, id: `candidate-${index + 1}`, partitionId, group: groups[0]!.group,
        n: 5, sumMs: 100, meanMs: 20, maxMs: 20, p50Ms: 20, p95Ms: 20,
        denominatorN: 50, denominatorSumMs: 500, observedEligibleNativeToolDurationShare: 0.2,
      });
    }
    for (let i = 0; i < 4; i++) m.summary.usage.push({
      sessionId: sid, provider: "codex", mapping: i < 2 ? "openai_responses" : "anthropic_messages",
      finality: i % 2 ? "trusted_final" : "source_terminal", observedResponses: 1,
      counts: { input: 10, output: 2, total: 12, cachedInput: 3, cacheWriteInput: 0, reasoningOutput: null, uncachedInput: null },
      overflowComponents: [], limitations: [], evidenceUsageCount: 1,
    });
  }
  m.selection.sessions = count(6); m.selection.partitions = count(24); m.selection.durations = count(480);
  m.selection.usage = count(24); m.selection.candidates = count(10);
  m.commandBreakdown.selection = {
    eligiblePartitions: count(24), unavailablePartitions: count(0), missingNativeContexts: count(0),
    groups: count(240), calls: count(1200, 240), totalsScope: "eligible_detail_partitions_only",
  };
  return m;
}

it("renders the combined old-plus-new structural ceiling within the unchanged 1MiB cap", () => {
  const m = maximumCombinedModel(), html = renderSourceReport(m);
  expect(m.summary.durations).toHaveLength(480); expect(m.summary.usage).toHaveLength(24); expect(m.slowTool.candidates).toHaveLength(10);
  expect(m.commandBreakdown.contexts).toHaveLength(24);
  expect(m.commandBreakdown.contexts.flatMap(c => c.groups!)).toHaveLength(240);
  expect(m.commandBreakdown.contexts.flatMap(c => c.calls!)).toHaveLength(240);
  expect(Buffer.byteLength(html)).toBeLessThanOrEqual(1048576);
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/g)].map(match => match[0]);
  const shareTables = tables.filter(table => /<caption\b[^>]*>Native command duration shares · ms<\/caption>/.test(table));
  const callTables = tables.filter(table => /<caption\b[^>]*>Slowest recorded calls · ms<\/caption>/.test(table));
  expect(shareTables).toHaveLength(24); expect(callTables).toHaveLength(24);
  const rowCount = (table: string) => [...table.match(/<tbody>([\s\S]*?)<\/tbody>/)![1]!.matchAll(/<tr\b/g)].length;
  expect(shareTables.map(rowCount)).toEqual(Array(24).fill(10));
  expect(callTables.map(rowCount)).toEqual(Array(24).fill(10));
  expect(shareTables.reduce((n, table) => n + rowCount(table), 0)).toBe(240);
  expect(callTables.reduce((n, table) => n + rowCount(table), 0)).toBe(240);
  const lastSentinel = "cargo build --verbose &lt;target&gt;";
  expect(shareTables[23]).toContain(lastSentinel); expect(callTables[23]).toContain(lastSentinel);
  const lastContext = html.slice(html.indexOf('id="partition-24"'));
  expect(lastContext).toContain(lastSentinel);
  expect(html).toContain('id="session-6"'); expect(html).toContain('id="partition-24"'); expect(html).toContain('id="card-10"');
  for (const c of m.slowTool.candidates!) {
    expect(html).toContain(c.necessaryWorkCounterexample); expect(html).toContain(c.investigativeAction);
    expect(html).toContain(c.matchedExperiment); expect(html).toContain(c.qualityGuardrail);
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const link of html.matchAll(/href="#([^"]+)"/g)) expect(ids).toContain(link[1]);
});

it("rejects combined escaped output overflow without weakening per-field limits or dropping safeguards", () => {
  const m = maximumCombinedModel();
  for (const row of m.summary.durations!) row.commandPattern = "&".repeat(512);
  for (const row of m.summary.usage!) row.limitations = Array(64).fill("&".repeat(128));
  for (const c of m.commandBreakdown.contexts) {
    for (const g of c.groups!) g.group.commandPattern = "&".repeat(512);
    for (const call of c.calls!) call.group.commandPattern = "&".repeat(512);
  }
  expect(() => renderSourceReport(m)).toThrowError(expect.objectContaining({ code: "REPORT_LIMIT" }));
});
