import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzeSourcePatterns } from "../src/analysis/source-patterns.js";
import { measurePatternIntervals } from "../src/analysis/pattern-intervals.js";
import { renderPatternPage } from "../src/report/pattern-page.js";
import { htmlText } from "../src/report/evidence-page.js";
import { event, source, id, success, epoch } from "./recovery-fixture.js";
import { edited, validated, failed, syntheticContextSource } from "./pattern-export-fixture.js";

const retry = () => analyzeSourcePatterns(source([failed("r1", 0, 2000), failed("r2", 3000, 6000), failed("r3", 7000, 11000), event("ok", epoch + 12000, epoch + 13000, success)]));
function doc(html: string) {
  expect(Buffer.byteLength(html)).toBeLessThanOrEqual(1_048_576);
  expect(html).not.toMatch(/h1:|FICTITIOUS_|operationKey|errorFingerprint|sourceRef|<(script|iframe|img|form|object|embed)\b|\bon[a-z]+\s*=|\b(?:src|style)\s*=/i);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]); expect(new Set(ids).size).toBe(ids.length);
  for (const m of html.matchAll(/(?:href="#|aria-labelledby=")([^"]+)"/g)) expect(ids).toContain(m[1]);
  for (const m of html.matchAll(/href="([^"]+)"/g)) expect(m[1]).toMatch(/^#/);
  const css = html.match(/<style>([\s\S]*?)<\/style>/)![1]!;
  expect(html).toContain(`sha256-${createHash("sha256").update(css).digest("base64")}`);
  expect(html).toContain('tabindex="0" role="region"');
}
describe("source-pattern HTML projection", () => {
  it("preserves a real positive retry kernel and all four safeguards", () => {
    const a = retry(), c = a.candidates.find(c => c.ruleId === "retry-loop")!, html = renderPatternPage(a);
    expect(c.occurrences).toBe(3); expect(a.timePartitions?.[0]?.perRuleMs["retry-loop"]).toBe(9000);
    expect(html).toContain("<th scope=\"row\">retry-loop</th><td>9000</td>");
    for (const value of [c.necessaryWorkCounterexample, c.investigativeAction, c.matchedExperiment, c.qualityGuardrail]) expect(html).toContain(htmlText(value));
    expect(html).toContain("9000 / 10000 ms"); expect(html).toContain('width="90.000000"');
    expect(html).toContain("improvement=not_measured"); expect(html).toContain("root cause=unestablished"); doc(html);
  });
  it("displays all four literal assessments and identifies the two omitted diagnoses", () => {
    const html = renderPatternPage(retry());
    for (const rule of ["retry-loop", "repeated-error", "context-churn", "validation-thrashing"]) expect(html).toContain(`id="rule-${rule}"`);
    expect(html).toContain("<td>600000</td>"); expect(html).toContain("<td>900000</td>"); expect(html).toContain("No fixed window");
    expect(html).toContain("slow-tool: use existing insights"); expect(html).toContain("exploration-thrashing: tracked separately");
  });
  it("retains repeated-error membership across sessions, including untimed occurrences", () => {
    const a = analyzeSourcePatterns(source([failed("a", 0, 1000), failed("b", 2000, 3000), failed("c", 4000, 5000, { sessionId: id("session", "second"), startAt: null, endAt: null })]));
    const c = a.candidates.find(c => c.ruleId === "repeated-error")!;
    expect(c.occurrences).toBe(3); expect(c.untimedContributionEventIds).toHaveLength(1);
    const html = renderPatternPage(a); expect(html).toContain("Untimed contributions</th><td>1</td>"); expect(html).toContain("missing_boundaries"); doc(html);
  });
  it("shows context first-read evidence separately from subsequent contributions", () => {
    const a = analyzeSourcePatterns(syntheticContextSource()), c = a.candidates.find(c => c.ruleId === "context-churn")!;
    expect(c.occurrences).toBe(4); expect(c.includedEventIds).toHaveLength(3);
    const html = renderPatternPage(a); expect(html).toContain("Evidence events</th><td>4</td>"); expect(html).toContain("Included contribution events</th><td>3</td>"); expect(html).toContain("Not a contribution"); doc(html);
  });
  it("keeps informational validation candidates outside pattern time", () => {
    const a = analyzeSourcePatterns(source(Array.from({ length: 3 }, (_, i) => [edited(`e${i}`, i * 4000, i * 4000 + 1000), validated(`v${i}`, i * 4000 + 2000, i * 4000 + 3000)]).flat()));
    const c = a.candidates.find(c => c.ruleId === "validation-thrashing")!;
    expect(c.severity).toBe("INFO"); expect(c.includedEventIds).toEqual([]); expect(c.relatedCycleIds).toHaveLength(3);
    const html = renderPatternPage(a); expect(html).toContain("Related cycle links: shown=3/3; omitted=0"); expect(html).toContain("Included contribution events</th><td>0</td>"); doc(html);
  });
  it("keeps missing ordinary evidence unavailable, not a healthy zero", () => {
    const a = analyzeSourcePatterns(source([event("unknown", epoch, epoch + 1000)])), html = renderPatternPage(a);
    expect(a.timePartitions?.[0]?.patternAssociatedMs).toBeNull(); expect(html).toContain("not_evaluable");
    expect(html).toContain("Unavailable / 1000 ms"); expect(html).toContain("No displayed candidates"); doc(html);
  });
  it("distinguishes empty, suppressed and measured zero intervals", () => {
    const empty = renderPatternPage(analyzeSourcePatterns(source([])));
    expect(empty).toContain("No positioned intervals selected");
    const suppressed = renderPatternPage(analyzeSourcePatterns({ ...source([]), availability: "unavailable" }));
    expect(suppressed).toContain("Time analysis is suppressed"); expect(suppressed).toContain("source_unavailable");
    const zero = renderPatternPage(analyzeSourcePatterns(source([event("zero", epoch, epoch, success)])));
    expect(zero).toContain("Busy union</th><td>0</td>"); doc(empty); doc(suppressed); doc(zero);
  });
  it("preserves prefix cycle numerator/denominator and unknown full scope", () => {
    const a = analyzeSourcePatterns(source([edited("e", 0, 1000), validated("bad", 2000, 3000, false, { validationScope: "unknown" }), validated("good", 4000, 5000)]));
    const p = a.editValidation.partitions[0]!; expect(p).toMatchObject({ firstPassN: 0, firstTerminalN: 1, scopeKnownN: 0, fullValidationRatio: null });
    const html = renderPatternPage(a); expect(html).toContain("First-pass / first-terminal</th><td>0 / 1</td>");
    expect(html).toContain("Full first validation / known first scope</th><td>0 / 0</td>"); expect(html).toContain("declared scope=unknown"); expect(html).toContain("resolved=true"); doc(html);
  });
  it("shows unavailable chronology without erasing concurrent positioned time", () => {
    const a = analyzeSourcePatterns(source([edited("e", 0, 10000), validated("v", 5000, 15000)]));
    expect(a.editValidation.cycles).toEqual([]);
    const html = renderPatternPage(a); expect(html).toContain("overlapping_actions"); expect(html).toContain("Concurrent categories</th><td>5000</td>"); expect(html).toContain("Unavailable / Unavailable"); doc(html);
  });
  it("uses query-clipped time but retains the original qualification witness", () => {
    const a = analyzeSourcePatterns(source([failed("f1", 0, 2000), failed("f2", 3000, 6000), failed("f3", 7000, 11000)]), { startMs: epoch + 8000, endMs: epoch + 10000 });
    expect(a.timePartitions?.[0]?.perRuleMs["retry-loop"]).toBe(2000);
    const html = renderPatternPage(a); expect(html).toContain("2026-10-03T00:00:08.000Z"); expect(html).toContain("2026-10-03T00:00:10.000Z");
    expect(html).toContain("2026-10-03T00:00:02.000Z"); expect(html).toContain("2026-10-03T00:00:11.000Z");
    expect(html).toContain("before query clipping</th><td>3</td>"); doc(html);
  });
  it("displays the independent retry12/error8/overlap5 union15 control without adding rule totals", () => {
    const partition = measurePatternIntervals([
      { id: "r", sessionId: "session-control", category: "test", startMs: 0, endMs: 12000, intervalScope: "invocation_latency", intervalTimingEvidence: "paired_timestamps" },
      { id: "e", sessionId: "session-control", category: "test", startMs: 7000, endMs: 15000, intervalScope: "invocation_latency", intervalTimingEvidence: "paired_timestamps" },
    ], { "retry-loop": ["r"], "repeated-error": ["e"], "context-churn": [] })[0]!;
    expect(partition).toMatchObject({ patternAssociatedMs: 15000, multipleRulesMs: 5000, ruleOverlapExcessMs: 5000 });
    const a = { ...retry(), timePartitions: [{ ...partition, qualifiedSubsetOnly: false }] };
    const html = renderPatternPage(a); expect(html).toContain("Pattern-associated union</th><td>15000</td>"); expect(html).toContain("Multiplicity-weighted rule overlap excess</th><td>5000</td>"); doc(html);
  });
  it("keeps caps and all links deterministic on many real kernel results", () => {
    const events = Array.from({ length: 20 }, (_, s) => {
      const patch = { sessionId: id("session", `session-${s}`) };
      return [...Array.from({ length: 3 }, (_, i) => failed(`f${s}-${i}`, i * 2000, i * 2000 + 1000, patch)),
        ...Array.from({ length: 3 }, (_, i) => [edited(`e${s}-${i}`, 10000 + i * 4000, 11000 + i * 4000, patch), validated(`v${s}-${i}`, 12000 + i * 4000, 13000 + i * 4000, true, patch)]).flat()];
    }).flat();
    const a = analyzeSourcePatterns(source(events)), before = JSON.stringify(a), html = renderPatternPage(a);
    expect(a.candidates.length).toBeGreaterThan(12); expect(a.editValidation.cycles).toHaveLength(60);
    expect(html).toContain(`Candidate details: shown=12/${a.candidates.length}; omitted=${a.candidates.length - 12}`);
    expect(html).toContain("Time partitions: shown=12/20; omitted=8"); expect(html).toContain("Validation partitions: shown=12/20; omitted=8");
    expect(html).toContain("Earliest observed cycles: shown=16/60; omitted=44");
    expect(renderPatternPage({ ...a, candidates: [...a.candidates].reverse(), rules: [...a.rules].reverse(), timePartitions: [...a.timePartitions!].reverse(), editValidation: { ...a.editValidation, cycles: [...a.editValidation.cycles].reverse(), partitions: [...a.editValidation.partitions].reverse() } })).toBe(html);
    expect(JSON.stringify(a)).toBe(before); doc(html);
  });
  it("bounds long positive episode evidence and witnesses with exact omissions", () => {
    const a = analyzeSourcePatterns(source(Array.from({ length: 100 }, (_, i) => failed(`f${i}`, i * 2000, i * 2000 + 1000))));
    expect(a.candidates[0]?.evidenceEventIds).toHaveLength(100);
    const html = renderPatternPage(a); expect(html).toContain("Candidate evidence aliases: shown=12/100; omitted=88");
    expect(html).toContain("Qualification witnesses: shown=16/98; omitted=82"); doc(html);
  });
  it("escapes hostile display text and refuses invalid schema/duplicate rule or dangling candidate", () => {
    const a = retry();
    const hostile = renderPatternPage({ ...a, limitations: ['</p><script>alert("x")</script>'] }); expect(hostile).not.toContain("<script>");
    expect(() => renderPatternPage({ ...a, rules: [a.rules[0]!, a.rules[0]!, a.rules[0]!, a.rules[0]!] })).toThrow();
    expect(() => renderPatternPage({ ...a, rules: a.rules.map(r => ({ ...r, candidateIds: ["missing"] })) })).toThrow();
  });
});
