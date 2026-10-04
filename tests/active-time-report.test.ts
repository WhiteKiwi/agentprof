import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import * as active from "../src/analysis/source-active-time.js";
import { summarizeSource } from "../src/analysis/source-summary.js";
import { analyzeSourceSlowTool } from "../src/analysis/source-slow-tool.js";
import { analyzeSourceFailures } from "../src/analysis/source-failures.js";
import { analyzeSourceRecovery } from "../src/analysis/source-recovery.js";
import { analyzeSourceRetryOverhead } from "../src/analysis/source-retry-overhead.js";
import { analyzeSourceReadRevisits } from "../src/analysis/source-read-revisits.js";
import { analyzeSourceSearchRecurrence } from "../src/analysis/source-search-recurrence.js";
import { analyzeSourceExploration } from "../src/analysis/source-exploration.js";
import { analyzeSourcePatterns } from "../src/analysis/source-patterns.js";
import { buildSourceCommandBreakdown } from "../src/report/command-breakdown.js";
import { buildUnifiedSourceReport } from "../src/report/unified-model.js";
import { renderUnifiedSourceReport } from "../src/report/unified-page.js";
import { renderActiveTimeSection } from "../src/report/active-time-section.js";
import { evidenceAliases, htmlText } from "../src/report/evidence-page.js";
import { capability, id, maximumSource, observation, paired, persisted, source, turn } from "./active-time-fixture.js";
import type { StoredSource } from "../src/db/source-store.js";
import type { NormalizedTurn } from "../src/parsers/types.js";

const section = (html: string) => html.match(/<section id="unified-active-time">([\s\S]*?)<\/section>/)![1]!;
const row = (label: string, value: number | string) => `${label}</th><td>${value}</td>`;
function safeHtml(html: string, s: StoredSource) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const [, ref] of html.matchAll(/(?:href="#|aria-labelledby=")([^"]+)"/g)) expect(ids).toContain(ref);
  expect(html).not.toMatch(/<script|<iframe|<link|<img|(?:src|href)="https?:|h1:[a-f0-9]{32}:|FICTITIOUS_|sourceRef|byteOffset/);
  expect(html).not.toContain(s.sourceId);
  for (const t of s.evidence?.turns ?? []) { expect(html).not.toContain(t.id); expect(html).not.toContain(t.sessionId); }
  for (const o of s.evidence?.observations ?? []) expect(html).not.toContain(o.id);
  expect(html).toContain("script-src &#39;none&#39;"); expect(html).toContain("connect-src &#39;none&#39;");
  const css = html.match(/<style>([\s\S]*?)<\/style>/)![1]!;
  expect(html).toContain(`style-src &#39;sha256-${createHash("sha256").update(css).digest("base64")}&#39;`);
  expect(Buffer.byteLength(html)).toBeLessThanOrEqual(1048576);
}
afterEach(() => vi.restoreAllMocks());

it("retains the complete unchanged native result once and every existing domain", () => {
  const s = source([turn("wall", 0, 10000), paired(turn("paired", 100000, 110000, { status: "cancelled" }))]), before = structuredClone(s);
  const expected = active.analyzeSourceActiveTime(s), spy = vi.spyOn(active, "analyzeSourceActiveTime");
  const m = buildUnifiedSourceReport(s), frozen = JSON.stringify(m), html = renderUnifiedSourceReport(m);
  expect(spy).toHaveBeenCalledExactlyOnceWith(s); expect(m.activeTime).toEqual(expected);
  expect(m.summary).toEqual(summarizeSource(s)); expect(m.slow).toEqual(analyzeSourceSlowTool(s));
  expect(m.commands).toEqual(buildSourceCommandBreakdown(s, m.slow)); expect(m.failures).toEqual(analyzeSourceFailures(s));
  expect(m.recovery).toEqual(analyzeSourceRecovery(s)); expect(m.retry).toEqual(analyzeSourceRetryOverhead(s));
  expect(m.reads).toEqual(analyzeSourceReadRevisits(s)); expect(m.searches).toEqual(analyzeSourceSearchRecurrence(s));
  expect(m.exploration).toEqual(analyzeSourceExploration(s)); expect(m.patterns).toEqual(analyzeSourcePatterns(s));
  expect(s).toEqual(before); expect(Object.isFrozen(s)).toBe(false); expect(JSON.stringify(m)).toBe(frozen);
  const checkFrozen = (v: unknown): void => { if (v && typeof v === "object") { expect(Object.isFrozen(v)).toBe(true); Object.values(v).forEach(checkFrozen); } }; checkFrozen(m.activeTime);
  expect(html).toContain('href="#unified-active-time"'); expect(html).toContain('<th scope="row">Active Time</th>');
  expect(section(html)).toContain("agentprof stats --source FULL_SOURCE_ID --active-time --json"); safeHtml(html, s);
});
it.each(["sourceId", "provider", "revision", "parserVersion", "normalizationVersion", "keyVersion", "completedOffset", "observedSize"] as const)("rejects native %s disagreement at build and render", field => {
  const s = source([turn("a", 0, 10)]), m = buildUnifiedSourceReport(s);
  const different = typeof m.activeTime[field] === "number" ? Number(m.activeTime[field]) + 1 : "different";
  const corrupt = { ...m.activeTime, [field]: different };
  vi.spyOn(active, "analyzeSourceActiveTime").mockReturnValue(corrupt as never);
  expect(() => buildUnifiedSourceReport(s)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
  expect(() => renderUnifiedSourceReport({ ...m, activeTime: corrupt } as never)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
  expect(() => renderUnifiedSourceReport({ ...m, [field]: different } as never)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
});
it.each([
  ["overlap", [[0, 10000], [5000, 15000]], 15000, 15000], ["identical", [[0, 10000], [0, 10000]], 10000, 10000],
  ["adjacent", [[0, 10000], [10000, 20000]], 20000, 20000], ["zero", [[100, 100]], 0, 0],
  ["long gap", [[0, 10000], [100000, 110000]], 20000, 110000], ["nested gap", [[0, 10000], [1000, 2000], [30000, 35000]], 15000, 35000],
  ["individual overflow", [[-8e15, 8e15]], null, null], ["sum overflow", [[-8e15, -3e15], [3e15, 8e15]], null, null],
  ["span-only overflow", [[-8e15, -8e15 + 1000], [8e15 - 1000, 8e15]], 2000, null],
] as const)("shows literal %s geometry and independent qualifications", (_name, intervals, union, span) => {
  const s = source(intervals.map(([start, end], i) => turn(`t-${i}`, start, end, { status: "cancelled" }))), m = buildUnifiedSourceReport(s);
  const p = m.activeTime.partitions![0]!, body = section(renderUnifiedSourceReport(m));
  expect(p).toMatchObject({ turnN: intervals.length, activeTimeMs: union, observedSpanMs: span });
  expect(p.turnEvidence.every(t => t.status === "cancelled")).toBe(true);
  expect(body).toContain(`<td>${union ?? "Unavailable"}</td><td>${union === null ? "numeric_overflow" : "none"}</td><td>${span ?? "Unavailable"}</td><td>${span === null ? "numeric_overflow" : "none"}</td>`);
  expect(body).toContain(row("Active Time union numeric_overflow", union === null ? 1 : 0));
  expect(body).toContain(row("Observed span numeric_overflow", span === null ? 1 : 0));
  expect(body).not.toContain("8150"); expect(body).not.toMatch(/<svg|Share|percentage|%/);
});
it("keeps separate turn-only sessions and wall/paired contracts with full native proof counts", () => {
  const rows = [turn("wall", 0, 10000), paired(turn("paired", 0, 10000)), turn("other", 100000, 110000, { sessionId: id("session", "other") })];
  const s = source(rows), m = buildUnifiedSourceReport(s), body = section(renderUnifiedSourceReport(m));
  expect(m.eventIds).toEqual([]); expect(m.sessionIds).toHaveLength(2); expect(m.activeTime.partitions).toHaveLength(3);
  expect(body).toContain(row("Admitted turns", 3)); expect(body).toContain(row("Distinct corroborating observations", 4));
  const aliases = evidenceAliases(m.sessionIds, "session");
  for (const p of m.activeTime.partitions!) expect(body).toContain(`<th scope="row">${aliases.get(p.sessionId)}</th><td>${p.intervalScope} / ${p.intervalTimingEvidence}</td>`);
  expect(m.activeTime.summary).not.toHaveProperty("activeTimeMs"); safeHtml(renderUnifiedSourceReport(m), s);
});
it("counts distinct corroboration and full membership without per-turn clipping", () => {
  const s = source(Array.from({ length: 30 }, (_, i) => paired(turn(`t-${i}`, i * 2000, i * 2000 + 1000))));
  const m = buildUnifiedSourceReport(s), body = section(renderUnifiedSourceReport(m));
  expect(body).toContain(row("Admitted turns", 30)); expect(body).toContain(row("Distinct corroborating observations", 60));
  expect(body).toContain("Active Time partitions: shown=1/1; omitted=0");
  expect(body).toContain("<td>30</td><td>60</td><td>30000</td><td>none</td><td>59000</td><td>none</td>");
  expect(m.activeTime.partitions![0]!.turnEvidence).toHaveLength(30);
  const copy = structuredClone(m), proofs = copy.activeTime.partitions![0]!.turnEvidence[0]!.evidenceObservationIds as string[];
  proofs.push(proofs[0]!);
  expect(section(renderUnifiedSourceReport(copy))).toBe(body);
});
it("retains ordinary replay proof membership and ignores a late pending replay", () => {
  const t = paired(turn("replay", 0, 10000)), obs = [observation(t), observation(t, { id: id("source", "early"), transportStatus: "pending", sourceRef: { ...t.sourceRef, byteOffset: 70 } }), observation(t, { id: id("source", "terminal-replay"), sourceRef: { ...t.sourceRef, byteOffset: 101 } }), observation(t, { id: id("source", "late"), transportStatus: "pending", sourceRef: { ...t.sourceRef, byteOffset: 102 } })];
  const m = buildUnifiedSourceReport(source([t], obs)), body = section(renderUnifiedSourceReport(m));
  expect(m.activeTime.partitions![0]!.turnEvidence[0]!.evidenceObservationIds).toHaveLength(3);
  expect(body).toContain(row("Distinct corroborating observations", 3));
});
it.each([
  ["pending", { status: "pending" }, "pending"], ["unknown status", { status: "unknown" }, "unknownStatus"],
  ["missing start", { startAt: null, startTimingEvidence: "unknown" }, "missingBoundaries"],
  ["unknown interval", { intervalScope: "unknown", intervalTimingEvidence: "unknown" }, "unknownInterval"],
  ["estimated interval", { intervalTimingEvidence: "estimated" }, "estimatedTiming"],
  ["mixed endpoint", { startTimingEvidence: "paired_timestamps" }, "inconsistentInterval"],
  ["reversed", { startAt: new Date(20000).toISOString() }, "invalidBoundaries"], ["malformed", { endAt: "invalid" }, "invalidBoundaries"],
] as const)("preserves %s native primary exclusions", (_name, change, reason) => {
  const s = source([turn("bad", 0, 10000, change as Partial<NormalizedTurn>)]), m = buildUnifiedSourceReport(s), body = section(renderUnifiedSourceReport(m));
  expect(m.activeTime.exclusions![reason]).toBe(1); expect(body).toContain(row(reason, 1));
  expect(Object.keys(m.activeTime.exclusions!)).toHaveLength(11);
  for (const [name, value] of Object.entries(m.activeTime.exclusions!)) expect(body).toContain(row(name, value));
  expect(body).toContain("Active Time partitions: shown=0/0; omitted=0");
  expect(body).toContain("assessment reason=no_supported_turn_intervals");
});
it.each(["absent", "reference", "nonordinary", "nonturn", "unknown", "contradictory", "pending absent", "pending late"])("renders %s proof exclusion unchanged", shape => {
  const t = shape.startsWith("pending") ? paired(turn("bad", 0, 10000)) : turn("bad", 0, 10000);
  const obs = shape === "absent" ? [] : [observation(t, shape === "reference" ? { sourceRef: { ...t.sourceRef, byteOffset: 99 } }
    : shape === "nonordinary" ? { origin: "trusted_copied" } : shape === "nonturn" ? { representation: "provenance" }
      : shape === "unknown" ? { transportStatus: "unknown" } : shape === "contradictory" ? { transportStatus: "cancelled" } : {})];
  if (shape === "pending late") obs.push(observation(t, { id: id("source", "late"), transportStatus: "pending", sourceRef: { ...t.sourceRef, byteOffset: 101 } }));
  const m = buildUnifiedSourceReport(source([t], obs)), body = section(renderUnifiedSourceReport(m));
  const reason = shape === "contradictory" ? "contradictoryTerminalProof" : shape.startsWith("pending") ? "missingPendingProof" : "missingTerminalProof";
  expect(m.activeTime.exclusions![reason]).toBe(1); expect(body).toContain(row(reason, 1));
});
const base = source([turn("a", 0, 10000)]);
it.each([
  ["unavailable", { ...base, availability: "unavailable" }, "source_unavailable"],
  ["evidence absent", { ...base, evidence: null, persistedScope: "events_only" }, "evidence_absent"],
  ["limited", capability(base, { stateLimited: true }), "state_limited"], ["dropped", capability(base, { diagnosticsDropped: 1 }), "state_limited"],
  ["ambiguous count", capability(base, { ambiguousRecords: 1 }), "ambiguous_origin"],
  ["ambiguous origin", source(base.evidence!.turns as NormalizedTurn[], [observation(base.evidence!.turns[0] as NormalizedTurn, { origin: "ambiguous" })]), "ambiguous_origin"],
  ["future matched parser", capability({ ...base, parserVersion: 4 }, { parserVersion: 4 as never }), "unsupported_parser_contract"],
  ["header mismatch", { ...base, parserVersion: 2 }, "unsupported_parser_contract"],
  ["capability mismatch", capability(base, { parserVersion: 2 as never }), "unsupported_parser_contract"],
  ["capability provider", capability(base, { provider: "claude" as never }), "unsupported_parser_contract"],
  ["normalization", { ...base, normalizationVersion: 2 }, "unsupported_parser_contract"],
  ["key", { ...base, keyVersion: 2 }, "unsupported_parser_contract"],
  ["Claude", { ...base, provider: "claude" }, "unsupported_provider"],
] as const)("shows %s unavailable with full native reason instead of empty counts", (_name, input, reason) => {
  const m = buildUnifiedSourceReport(input as StoredSource), html = renderUnifiedSourceReport(m), body = section(html);
  expect(m.activeTime.activeTimeAssessmentReason).toBe(reason); expect(body).toContain(`assessment reason=${reason}`);
  expect(html).toContain(`assessment reason: ${reason}; suppression:`);
  expect(body).toContain(row("Admitted turns", "Unavailable")); expect(body).toContain(row("Distinct corroborating observations", "Unavailable"));
  expect(body).toContain(row("Active Time union numeric_overflow", "Unavailable"));
  expect(body).toContain("Native turn exclusions unavailable"); expect(body).not.toContain("Active Time partitions: shown=0/0");
  expect(m.activeTime.inventory.turns).toBe(input.evidence === null ? null : 1);
});
it.each([1, 2, 3])("preserves matching Codex parser%s support", parserVersion => {
  const s = capability({ ...base, parserVersion }, { parserVersion: parserVersion as never }), m = buildUnifiedSourceReport(s);
  expect(m.activeTime.assessment).toBe("evaluated"); expect(section(renderUnifiedSourceReport(m))).toContain(row("Provider / parser", `codex / ${parserVersion}`));
});
it.each(["empty", "all excluded", "excluded", "partial shapes", "partial plus excluded", "partial empty"])("preserves %s assessment precedence and complete source context", shape => {
  let s = shape.endsWith("empty") ? source() : shape === "all excluded" ? source([turn("pending", 0, 10, { status: "pending" })]) : base;
  if (shape === "excluded" || shape === "partial plus excluded") s = source([turn("good", 0, 10000), turn("pending", 20000, 30000, { status: "pending" })]);
  if (shape.startsWith("partial")) s = capability(s, { coverage: "partial", unsupportedRecords: 2 });
  const m = buildUnifiedSourceReport(s), html = renderUnifiedSourceReport(m), body = section(html), a = m.activeTime;
  expect(body).toContain(`Assessment=${a.assessment}; assessment reason=${a.activeTimeAssessmentReason ?? "none"}`);
  expect(html).toContain(`assessment reason: ${a.activeTimeAssessmentReason ?? "none"}; suppression: none`);
  if (shape === "partial plus excluded") { expect(a.activeTimeAssessmentReason).toBe("partial_shape_coverage"); expect(body).toContain(row("pending", 1)); }
  for (const label of ["Source freshness checked", "Cross-source reconciled", "Aggregation ready", "Parser resume ready"]) expect(body).toContain(row(label, "false"));
  expect(body).toContain(row("Query period", "Unavailable")); expect(body).toContain("source_bytes: [0, 1000000)");
  if (shape.startsWith("partial")) { expect(body).toContain("shape_verified_only / partial"); expect(body).toContain(row("Unsupported records", 2)); expect(body).toContain("partial_shape_coverage"); }
});
it("counts omitted overflow partitions independently and preserves native order", () => {
  const sessions = Array.from({ length: 20 }, (_, i) => id("session", `session-${i}`)).sort();
  const rows = sessions.flatMap((sessionId, i) => i === 19 ? [turn(`s${i}`, -8e15, 8e15, { sessionId })]
    : i === 18 ? [turn(`s${i}a`, -8e15, -8e15 + 1000, { sessionId }), turn(`s${i}b`, 8e15 - 1000, 8e15, { sessionId })]
      : [turn(`s${i}`, 0, 10000, { sessionId })]);
  rows.push(turn("excluded", 0, 10, { sessionId: sessions[19]!, status: "pending" }));
  const m = buildUnifiedSourceReport(source(rows)), body = section(renderUnifiedSourceReport(m));
  expect(body).toContain("Active Time partitions: shown=12/20; omitted=8"); expect(body).toContain(row("Active Time union numeric_overflow", 1));
  expect(body).toContain(row("Observed span numeric_overflow", 2)); expect(body).toContain(row("Excluded turns", 1)); expect(body).toContain(row("pending", 1));
  const table = body.split('id="unified-active-time-partitions-caption"')[1]!;
  expect([...table.matchAll(/<th scope="row">(session-\d+)<\/th>/g)].map(x => x[1])).toEqual(Array.from({ length: 12 }, (_, i) => `session-${i + 1}`));
  expect(m.activeTime.partitions![19]!.activeTimeMs).toBeNull();
  const aliases = new Map(evidenceAliases(m.sessionIds, "session")); aliases.delete(m.activeTime.partitions![19]!.sessionId);
  expect(() => renderActiveTimeSection(m.activeTime, aliases)).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
});
it("escapes hostile native text and refuses oversized text and the escaped final page", () => {
  const m = structuredClone(buildUnifiedSourceReport(base)), hostile = '</p><script>alert("x")</script><img src=x onerror="x">';
  m.activeTime.limitations = [hostile]; m.activeTime.activeTimeAssessmentReason = hostile as never;
  m.activeTime.capabilities!.observedShapes = [hostile];
  const html = renderUnifiedSourceReport(m); expect(html).toContain(htmlText(hostile)); expect(html).not.toContain(hostile); safeHtml(html, base);
  m.activeTime.limitations = ["x".repeat(4097)]; expect(() => renderUnifiedSourceReport(m)).toThrowError(expect.objectContaining({ code: "REPORT_LIMIT" }));
  m.activeTime.limitations = Array.from({ length: 64 }, () => "&".repeat(4090));
  expect(() => renderUnifiedSourceReport(m)).toThrowError(expect.objectContaining({ code: "REPORT_LIMIT" })); expect(m.activeTime.partitions![0]!.turnN).toBe(1);
});
it("renders reversed native input arrays identically without mutation", () => {
  const s = source([turn("a", 0, 10000), paired(turn("b", 100000, 110000))]);
  const before = structuredClone(s), m = buildUnifiedSourceReport(s), frozen = JSON.stringify(m);
  const permuted = { ...s, evidence: { ...s.evidence!, turns: [...s.evidence!.turns].reverse(), observations: [...s.evidence!.observations].reverse() } };
  expect(renderUnifiedSourceReport(buildUnifiedSourceReport(permuted))).toBe(renderUnifiedSourceReport(m)); expect(JSON.stringify(m)).toBe(frozen); expect(s).toEqual(before);
});
it.each(["many sessions", "unsafe intervals", "one session"])("keeps persisted maximum %s 4096-turn/8192-proof combined reports bounded", async shape => {
  const max = maximumSource(), turns = (max.evidence!.turns as NormalizedTurn[]).map(t => ({ ...t,
    ...(shape === "one session" ? { sessionId: id("session", "only") } : {}),
    ...(shape === "unsafe intervals" ? { startAt: new Date(-8e15).toISOString(), endAt: new Date(8e15).toISOString() } : {}),
  }));
  const input = { ...max, evidence: { ...max.evidence!, turns } }, x = await persisted(input), m = buildUnifiedSourceReport(x.source);
  const html = renderUnifiedSourceReport(m), body = section(html), count = shape === "one session" ? 1 : 4096;
  expect(m.activeTime.summary).toEqual({ eligibleTurns: 4096, excludedTurns: 0, partitions: count });
  expect(m.activeTime.partitions!.flatMap(p => p.turnEvidence.flatMap(t => t.evidenceObservationIds))).toHaveLength(8192);
  expect(body).toContain(row("Admitted turns", 4096)); expect(body).toContain(row("Distinct corroborating observations", 8192));
  expect(body).toContain(`Active Time partitions: shown=${Math.min(12, count)}/${count}; omitted=${count - Math.min(12, count)}`);
  expect(body).toContain(row("Active Time union numeric_overflow", shape === "unsafe intervals" ? 4096 : 0));
  if (shape === "one session") expect(body).toContain("<td>4096</td><td>8192</td><td>4096000</td><td>none</td><td>8191000</td><td>none</td>");
  safeHtml(html, x.source); console.log(`ACTIVE_TIME_REPORT_BOUND ${shape}: bytes=${Buffer.byteLength(html)}`);
});
