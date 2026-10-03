import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzeSelectedHistory } from "../src/analysis/source-history.js";
import type { SelectedHistoryAnalysis } from "../src/analysis/source-history.js";
import { renderHistoryPage } from "../src/report/history-page.js";
import { evidenceBar, evidenceLink, evidencePage, evidenceTable, htmlText, numericText, omissions, EVIDENCE_HTML_BYTES } from "../src/report/evidence-page.js";
import { event, source, success, id, epoch } from "./recovery-fixture.js";

const DAY = 86_400_000;
function sample(events = [event("a", epoch, epoch + 10000, { ...success, category: "test" }), event("b", epoch + 5000, epoch + 15000, { ...success, category: "build" })], endMs = epoch + DAY) {
  return analyzeSelectedHistory([source(events)], { startMs: epoch, endMs, offsetMinutes: 0, sessionId: null });
}
function documentChecks(html: string) {
  expect(Buffer.byteLength(html)).toBeLessThanOrEqual(EVIDENCE_HTML_BYTES);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]!);
  expect(new Set(ids).size).toBe(ids.length);
  for (const m of html.matchAll(/(?:href="#|aria-labelledby=")([^"]+)"/g)) expect(ids).toContain(m[1]);
  expect(html).not.toMatch(/<(script|iframe|img|form|object|embed)\b|\bon[a-z]+\s*=|\b(?:src|style)\s*=/i);
  for (const m of html.matchAll(/href="([^"]+)"/g)) expect(m[1]).toMatch(/^#/);
  const css = html.match(/<style>([\s\S]*?)<\/style>/)![1]!;
  expect(html).toContain(`sha256-${createHash("sha256").update(css).digest("base64")}`);
  expect(html).toContain("script-src &#39;none&#39;");
  expect(html).toContain('tabindex="0" role="region"');
}
describe("static evidence page primitives", () => {
  it("escapes text, not just script closers", () => {
    expect(htmlText('<img onerror="x">&\'')).toBe("&lt;img onerror=&quot;x&quot;&gt;&amp;&#39;");
    expect(htmlText(null)).toBe("Unavailable"); expect(htmlText(0)).toBe("0");
    expect(() => htmlText("x".repeat(4097))).toThrow();
  });
  it("keeps numeric zero/null and rejects invalid measured numbers", () => {
    expect(numericText(0)).toBe("0"); expect(numericText(null)).toBe("Unavailable");
    for (const n of [-1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => numericText(n)).toThrow();
  });
  it("uses the declared denominator and handles zero/unavailable", () => {
    expect(evidenceBar(5, 10)).toContain('width="50.000000"');
    expect(evidenceBar(0, 10)).toContain('width="0.000000"');
    expect(evidenceBar(null, 10)).toContain("Unavailable");
    expect(evidenceBar(0, 0)).toContain("No positive denominator");
    expect(() => evidenceBar(11, 10)).toThrow();
  });
  it("rejects nonlocal link targets and malformed tables/omissions", () => {
    expect(() => evidenceLink('x\" onclick=\"evil', "x")).toThrow();
    expect(() => evidenceLink("https://example.invalid", "x")).toThrow();
    expect(() => evidenceTable("table", "caption", ["one"], [["two", "three"]])).toThrow();
    expect(() => omissions("Rows", 2, 1)).toThrow();
  });
  it("refuses oversized final UTF-8 output before publication", () => {
    expect(() => evidencePage("safe", "safe", "界".repeat(EVIDENCE_HTML_BYTES / 2), [])).toThrow();
  });
});
describe("history offline page", () => {
  it("keeps actual sum20/union15/concurrency5 and the full day denominator", () => {
    const a = sample(), html = renderHistoryPage(a);
    expect(a.days[0]).toMatchObject({ intervalLengthSumMs: 20000, toolBusyMs: 15000, concurrentCallsMs: 5000 });
    expect(html).toContain("<td>20000</td>"); expect(html).toContain("<td>15000</td>"); expect(html).toContain("<td>5000</td>");
    expect(html).toContain("15000 / 86400000 ms"); expect(html).toContain('width="0.017361"');
    expect(html).toContain(a.query.startInclusive); expect(html).toContain(a.query.endExclusive);
    documentChecks(html);
  });
  it("does not serialize opaque source/session/event/operation/proof identifiers", () => {
    const e = event("private", epoch, epoch + 1000), a = sample([e]), html = renderHistoryPage(a);
    for (const value of [e.id, e.sessionId, e.operationKey!, e.sourceRef.fileId, ...a.reconciliation.executions[0]!.copies.flatMap(c => [c.sourceId, ...c.proofIds])]) expect(html).not.toContain(value);
    expect(html).not.toMatch(/h1:|FICTITIOUS_|sourceRef|operationKey|errorFingerprint/);
    expect(html).toContain("source-1"); expect(html).toContain("execution-1");
    documentChecks(html);
  });
  it("retains sparse empty selection rather than inventing a zero day", () => {
    const html = renderHistoryPage(sample([]));
    expect(html).toContain("No positioned observations in this selection");
    expect(html).toContain("Daily partitions: shown=0/0; omitted=0");
    expect(html).not.toContain('<ol class="day-chart">'); documentChecks(html);
  });
  it("keeps a measured zero-length completion distinct from missing time", () => {
    const zero = sample([event("zero", epoch, epoch, success)]), html = renderHistoryPage(zero);
    expect(zero.days[0]).toMatchObject({ terminalCompletions: 1, toolBusyMs: 0 });
    expect(html).toContain("0 / 86400000 ms");
    const absent = sample([event("absent", epoch, epoch + 1, { ...success, startAt: null, endAt: null })]);
    expect(absent.days).toHaveLength(0); expect(renderHistoryPage(absent)).toContain("unpositioned");
  });
  it("preserves arithmetic unavailable without drawing a fake zero bar", () => {
    const a = sample();
    const unavailable: SelectedHistoryAnalysis = { ...a, days: a.days.map(d => ({ ...d, toolBusyMs: null, intervalLengthSumMs: null, arithmeticOverflow: true })) };
    const html = renderHistoryPage(unavailable); expect(html).toContain("Unavailable / 86400000 ms"); expect(html).toContain("Arithmetic overflow: true");
  });
  it("shows conflicting copies and source suppression rather than rescuing a winner", () => {
    const e = event("conflict", epoch, epoch + 1);
    const a = analyzeSelectedHistory([source([e]), { ...source([{ ...e, ...success }]), sourceId: id("source", "copy") }], { startMs: epoch, endMs: epoch + DAY, offsetMinutes: 0, sessionId: null });
    expect(a.reconciliation.counts.conflictingExecutions).toBe(1);
    const html = renderHistoryPage(a); expect(html).toContain("semantic_or_contract_conflict"); expect(html).toContain("shown=2/2"); documentChecks(html);
    const suppressed = analyzeSelectedHistory([{ ...source([e]), availability: "unavailable" }], { startMs: epoch, endMs: epoch + DAY, offsetMinutes: 0, sessionId: null });
    expect(renderHistoryPage(suppressed)).toContain("source_unavailable");
  });
  it("preserves midnight completion/time populations and +09:00 context", () => {
    const boundary = epoch + 15 * 3600000;
    const a = analyzeSelectedHistory([source([event("midnight", boundary - 1000, boundary + 1000, success)])], { startMs: boundary - 1000, endMs: boundary + 2000, offsetMinutes: 540, sessionId: null });
    expect(a.days.map(d => [d.terminalCompletions, d.toolBusyMs])).toEqual([[0, 1000], [1, 1000]]);
    const html = renderHistoryPage(a); expect(html).toContain("Fixed offset +09:00"); expect(html).toContain("2026-10-03"); expect(html).toContain("2026-10-04"); documentChecks(html);
  });
  it("has deterministic selection, exact row/member caps and no dangling links", () => {
    const events = Array.from({ length: 13 }, (_, s) => Array.from({ length: 32 }, (_, d) => event(`s${s}d${d}`, epoch + d * DAY, epoch + d * DAY + 1, { ...success, sessionId: id("session", `session-${s}`) }))).flat();
    const a = sample(events, epoch + 33 * DAY), before = JSON.stringify(a), html = renderHistoryPage(a);
    expect(html).toContain("Series: shown=12/13; omitted=1");
    expect(html).toContain("Daily partitions: shown=372/416; omitted=44");
    expect(html).toContain("Chronological days in series: shown=31/32; omitted=1");
    expect(html).toContain("Distinct executions from displayed days: shown=64/372; omitted=308");
    const reordered = { ...a, days: [...a.days].reverse(), reconciliation: { ...a.reconciliation, sources: [...a.reconciliation.sources].reverse(), executions: [...a.reconciliation.executions].reverse() } };
    expect(renderHistoryPage(reordered)).toBe(html); expect(JSON.stringify(a)).toBe(before); documentChecks(html);
  });
  it("escapes hostile display text and refuses dangling member evidence", () => {
    const a = sample();
    expect(renderHistoryPage({ ...a, limitations: ['</p><script>alert("x")</script>'] })).not.toContain("<script>");
    expect(() => renderHistoryPage({ ...a, days: a.days.map(d => ({ ...d, memberExecutionIds: ["absent"] })) })).toThrow();
  });
});
