import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildUnifiedSourceReport, UNIFIED_LIMITS } from "../src/report/unified-model.js";
import { renderUnifiedSourceReport } from "../src/report/unified-page.js";
import { renderPatternPage } from "../src/report/pattern-page.js";
import { htmlText } from "../src/report/evidence-page.js";
import { summarizeSource } from "../src/analysis/source-summary.js";
import { analyzeSourcePatterns } from "../src/analysis/source-patterns.js";
import { analyzeSourceFailures } from "../src/analysis/source-failures.js";
import { analyzeSourceSlowTool } from "../src/analysis/source-slow-tool.js";
import { analyzeSourceRecovery } from "../src/analysis/source-recovery.js";
import { analyzeSourceRetryOverhead } from "../src/analysis/source-retry-overhead.js";
import { analyzeSourceReadRevisits } from "../src/analysis/source-read-revisits.js";
import { analyzeSourceSearchRecurrence } from "../src/analysis/source-search-recurrence.js";
import { event, source, id, success, epoch, proofs } from "./recovery-fixture.js";
import { failed, edited, validated, syntheticContextSource } from "./pattern-export-fixture.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function invariantHtml(html: string) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(x => x[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const [, ref] of html.matchAll(/(?:href="#|aria-labelledby=")([^"]+)"/g)) expect(ids).toContain(ref);
  expect((html.match(/<!doctype html>/g) ?? []).length).toBe(1);
  expect((html.match(/<html /g) ?? []).length).toBe(1);
  expect((html.match(/<main /g) ?? []).length).toBe(1);
  expect(html).not.toMatch(/<script|<iframe|<link|<img|\bon(?:load|error|click)=|(?:src|href)="https?:|h1:[a-f0-9]{32}:|FICTITIOUS_/);
  const css = html.match(/<style>([\s\S]*?)<\/style>/)![1]!;
  expect(html).toContain(`style-src &#39;sha256-${createHash("sha256").update(css).digest("base64")}&#39;`);
  expect(html).toContain("script-src &#39;none&#39;");
  expect(html).toContain("connect-src &#39;none&#39;");
  expect(Buffer.byteLength(html)).toBeLessThanOrEqual(1048576);
}
function patternSource() {
  return source([failed("unified-fail1", 0, 1000), failed("unified-fail2", 2000, 3000),
    failed("unified-fail3", 4000, 5000), event("unified-success", epoch + 6000, epoch + 7000, success),
    edited("unified-edit", 8000, 9000), validated("unified-test1", 10000, 11000), validated("unified-test2", 12000, 13000), validated("unified-test3", 14000, 15000)]);
}
function usageSource(provider: "codex" | "claude" = "codex") {
  const s = provider === "codex" ? source() : syntheticContextSource();
  const usage = { id: id("event", "usage-one"), sessionId: id("session", "usage-only-session"), responseId: id("event", "response-one"), turnId: null, provider,
    source: provider === "codex" ? "response_usage" : "message_usage", scope: provider === "codex" ? "response_increment" : "response_snapshot",
    counts: { input: 100, output: 20, total: 120, cachedInput: 40, cacheWriteInput: 10, reasoningOutput: provider === "codex" ? 5 : null, ...(provider === "claude" ? { uncachedInput: 50 } : {}) },
    mapping: provider === "codex" ? "openai_responses" : "anthropic_messages", finality: "source_terminal", selection: "eligible", countStatus: "complete",
    limitations: [], toolEventId: null, phase: "unknown", sourceRef: { fileId: s.sourceId, byteOffset: 1 },
    ...(provider === "claude" ? { stopReason: "end_turn", terminalCandidate: true } : {}) };
  return { ...s, evidence: { ...s.evidence!, usage: [usage, { ...usage, id: id("event", "usage-duplicate") }] } } as typeof s;
}

describe("unified source model and rendering", () => {
  it("composes unchanged domain results from the same source without mutating or freezing input", () => {
    const s = patternSource(), before = structuredClone(s), m = buildUnifiedSourceReport(s);
    expect(m.summary).toEqual(summarizeSource(s)); expect(m.slow).toEqual(analyzeSourceSlowTool(s));
    expect(m.failures).toEqual(analyzeSourceFailures(s)); expect(m.recovery).toEqual(analyzeSourceRecovery(s));
    expect(m.retry).toEqual(analyzeSourceRetryOverhead(s)); expect(m.reads).toEqual(analyzeSourceReadRevisits(s));
    expect(m.searches).toEqual(analyzeSourceSearchRecurrence(s)); expect(m.patterns).toEqual(analyzeSourcePatterns(s));
    expect(s).toEqual(before); expect(Object.isFrozen(s)).toBe(false); expect(Object.isFrozen(s.events)).toBe(false);
    expect(Object.isFrozen(m)).toBe(true); expect(Object.isFrozen(m.timeline)).toBe(true);
    for (const row of m.timeline) expect(Object.isFrozen(row)).toBe(true);
    invariantHtml(renderUnifiedSourceReport(m));
  });
  it("retains positive pattern candidates and all original full safeguards in one document", () => {
    const m = buildUnifiedSourceReport(patternSource()), html = renderUnifiedSourceReport(m);
    expect(m.patterns.candidates.length).toBeGreaterThan(0);
    for (const c of m.patterns.candidates) for (const field of ["necessaryWorkCounterexample", "investigativeAction", "matchedExperiment", "qualityGuardrail"] as const) expect(html).toContain(htmlText(c[field]));
    expect(html).toContain(htmlText(m.patterns.patternTimeMeaning));
    expect(html).toContain("Pattern-associated time is not avoidable time, savings or productivity.");
    expect(html).toContain("Diagnoses outside this pattern section"); invariantHtml(html);
  });
  it("renders independently positive context-churn and repeated-error controls without promoting provider support", () => {
    const repeated = source([failed("cross-one", 0, 1000), failed("cross-two", 2000, 3000), failed("cross-three", 4000, 5000, { sessionId: id("session", "second-stream") })]);
    for (const [input, rule] of [[syntheticContextSource(), "context-churn"], [repeated, "repeated-error"]] as const) {
      const m = buildUnifiedSourceReport(input), html = renderUnifiedSourceReport(m);
      expect(m.patterns.rules.find(r => r.ruleId === rule)!.status).toBe("candidates");
      expect(html).toContain(rule); invariantHtml(html);
    }
  });
  it("unified footer directs complete evidence to actual JSON commands instead of an unsupported output-less report", () => {
    const html = renderUnifiedSourceReport(buildUnifiedSourceReport(source()));
    expect(html).toContain("use the corresponding stats, insights or patterns commands with --json");
    expect(html).not.toContain("original command without --output");
  });
  it("separates recorded failed duration, occupied interval union and recovery elapsed", () => {
    const s = source([event("distinct-fail", epoch, epoch + 1000), event("distinct-success", epoch + 5000, epoch + 6000, success)]);
    const m = buildUnifiedSourceReport(s), html = renderUnifiedSourceReport(m);
    expect(m.retry.summary.failedAttemptDurationSumMs).toBe(20);
    expect(m.retry.summary.retryOverheadMs).toBe(1000);
    expect(m.recovery.chains![0]!.recoveryElapsedMs).toBe(5000);
    expect(html).toContain("Failed-attempt recorded-duration sum ms</th><td>20</td>");
    expect(html).toContain("Compatible failed-attempt interval union ms</th><td>1000</td>");
    expect(html).toContain("2026-10-03T00:00:06.000Z</td><td>5000</td>");
  });
  it.each(["codex", "claude"] as const)("%s eligible usage retains exact deduplication, subset semantics and usage-only session alias", provider => {
    const m = buildUnifiedSourceReport(usageSource(provider)), html = renderUnifiedSourceReport(m);
    expect(m.summary.usageEligibility).toMatchObject({ observedResponses: 1, deduplicatedRows: 1 });
    expect(m.summary.usage![0]!.counts).toMatchObject({ input: 100, output: 20, total: 120, cachedInput: 40 });
    expect(html).toContain("total</th><td>120</td>"); expect(html).toContain("daily tokens are unavailable");
    expect(html).toContain(provider === "codex" ? "Do not add those subsets again" : "uncached input, cache-read input and cache-write input");
    invariantHtml(html);
  });
  it("preserves usage component overflow separately from selected counts", () => {
    const s = usageSource(); const u = s.evidence!.usage[0]!;
    const rows = [{ ...u, counts: { ...u.counts!, input: Number.MAX_SAFE_INTEGER, total: Number.MAX_SAFE_INTEGER } }, { ...u, id: id("event", "usage-two"), responseId: id("event", "response-two") }];
    const m = buildUnifiedSourceReport({ ...s, evidence: { ...s.evidence!, usage: rows } });
    expect(m.summary.usage![0]!.counts.total).toBe(null);
    expect(m.summary.usageEligibility!.observedResponses).toBe(2);
    const html = renderUnifiedSourceReport(m); expect(html).toContain("overflow: total"); expect(html).toContain("total</th><td>Unavailable</td>");
  });
  it.each(["source_unavailable", "evidence_absent", "state_limited", "ambiguous_origin"])("preserves %s without a manufactured healthy zero", reason => {
    const s = patternSource();
    const candidate = reason === "source_unavailable" ? { ...s, availability: "unavailable" as const }
      : reason === "evidence_absent" ? { ...s, evidence: null, persistedScope: "events_only" as const }
      : { ...s, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, ...(reason === "state_limited" ? { stateLimited: true } : { ambiguousRecords: 1 }) } } };
    const m = buildUnifiedSourceReport(candidate), html = renderUnifiedSourceReport(m);
    expect(m.summary.suppressionReason).toBe(reason); expect(m.timelineSuppressed).toBe(true);
    expect(html).toContain(reason); expect(html).toContain("Interval analysis suppressed"); invariantHtml(html);
  });
  it("empty stored evidence is distinct from absent evidence", () => {
    const m = buildUnifiedSourceReport(source()), html = renderUnifiedSourceReport(m);
    expect(m.summary.inventory.events).toBe(0); expect(m.summary.suppressionReason).toBe(null);
    expect(html).toContain("No eligible final response-usage cohort. This is not zero token use."); invariantHtml(html);
  });
  it("a zero-duration native cohort retains 0 and an unavailable fraction", () => {
    const m = buildUnifiedSourceReport(source([event("zero", epoch, epoch, { ...success, durationMs: 0 })]));
    expect(m.commands.partitions[0]!.status).toBe("zero_denominator");
    expect(m.commands.partitions[0]!.groups![0]!.share).toBe(null);
    const html = renderUnifiedSourceReport(m); expect(html).toContain("full denominator=0 ms"); expect(html).not.toContain("NaN"); invariantHtml(html);
  });
  it("keeps full denominators and exact omissions beyond each display cap", () => {
    const events = Array.from({ length: 20 }, (_, si) => Array.from({ length: 6 }, (_, i) => event(`large-${si}-${i}`, epoch + si * 10000 + i * 1000, epoch + si * 10000 + i * 1000 + 500, { ...success, sessionId: id("session", `large-${si}`) }))).flat();
    const m = buildUnifiedSourceReport(source(events)), html = renderUnifiedSourceReport(m);
    expect(m.commands.partitions).toHaveLength(20); expect(m.positionedEventN).toBe(120);
    expect(m.timeline).toHaveLength(UNIFIED_LIMITS.timeline);
    expect(html).toContain("Native command partitions: shown=12/20; omitted=8");
    expect(html).toContain("Earliest admitted intervals: shown=48/120; omitted=72");
    expect(html).toContain("full eligible N=6; full denominator=120 ms"); invariantHtml(html);
  });
  it("full raw-free model is deterministic across input permutations", () => {
    const s = patternSource(); const other = { ...s, events: [...s.events].reverse(), evidence: { ...s.evidence!, observations: [...s.evidence!.observations].reverse() } };
    const first = renderUnifiedSourceReport(buildUnifiedSourceReport(s));
    expect(renderUnifiedSourceReport(buildUnifiedSourceReport(other))).toBe(first);
  });
  it("timeline contains only positioned admitted members, not unknown or pending input", () => {
    const good = event("good", epoch, epoch + 1000, success), pending = event("pending", epoch, epoch + 500, { status: "pending", executionOutcome: "unknown" });
    const unknown = event("unknown-position", epoch, epoch + 500, { ...success, startAt: null, endAt: null, intervalTimingEvidence: "unknown", intervalScope: "unknown" });
    const m = buildUnifiedSourceReport(source([good, pending, unknown], [good, pending, unknown].flatMap(proofs)));
    expect(m.timeline.map(e => e.id)).toEqual([good.id]);
  });
  it("escapes dynamic display content and refuses oversize output without clipping evidence", () => {
    const m = structuredClone(buildUnifiedSourceReport(patternSource()));
    const bad = '</script><img src=x onerror="alert(1)">';
    m.summary.durations![0]!.commandPattern = bad;
    const html = renderUnifiedSourceReport(m); expect(html).toContain(htmlText(bad)); expect(html).not.toContain(bad);
    const large = structuredClone(buildUnifiedSourceReport(source(Array.from({ length: 20 }, (_, i) => event(`max-${i}`, epoch + i * 1000, epoch + i * 1000 + 500, success)))));
    // Escape expansion is counted in the final page's unchanged UTF-8 ceiling.
    large.summary.limitations = Array.from({ length: 64 }, () => "&".repeat(4090)) as any;
    expect(() => renderUnifiedSourceReport(large)).toThrowError(expect.objectContaining({ code: "REPORT_LIMIT" }));
  });
  it("refuses a mixed-generation composite instead of presenting inconsistent sections", () => {
    const m = structuredClone(buildUnifiedSourceReport(source())); m.retry.revision++;
    expect(() => renderUnifiedSourceReport(m)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
  });
  it("uses the same event and session aliases in embedded pattern and timeline sections", () => {
    const s = patternSource(), m = buildUnifiedSourceReport(s), html = renderUnifiedSourceReport(m);
    const aliases = new Map(m.eventIds.map((id, i) => [id, `event-${i + 1}`]));
    for (const c of m.patterns.candidates) for (const id of c.evidenceEventIds) expect(html).toContain(aliases.get(id)!);
    for (const e of m.timeline) expect(html).toContain(`<th scope="row">${aliases.get(e.id)}</th><td>session-1</td>`);
    invariantHtml(html);
  });
  it.each([
    ["positive rule controls", patternSource, "02a32c24d6935dc88b858f2c31c4defdc4ace152a9eb1072109c16d339b10165"],
    ["Claude context controls", syntheticContextSource, "19248846e3c0231e77b0a3356f95552e39b5e40fc36be491b3a48c0155a4cd2e"],
  ] as const)("standalone pattern HTML keeps immutable parent bytes for %s", (_name, fixture, expected) => {
    expect(sha(renderPatternPage(analyzeSourcePatterns(fixture())))).toBe(expected);
  });
  it("standalone pattern renderer retains the immutable parent empty-source HTML", () => {
    // Recorded from unchanged parent cce10ca source renderer before the section extraction.
    expect(sha(renderPatternPage(analyzeSourcePatterns(source())))).toBe("6a7e0eec42eef6313d8dff29b1184d9b33415bce38c1ea5a6ffc017c8dcf1b94");
  });
});
