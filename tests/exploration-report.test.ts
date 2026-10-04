import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import * as engine from "../src/analysis/source-exploration.js";
import { analyzeSourcePatterns } from "../src/analysis/source-patterns.js";
import { summarizeSource } from "../src/analysis/source-summary.js";
import { buildUnifiedSourceReport } from "../src/report/unified-model.js";
import { renderUnifiedSourceReport } from "../src/report/unified-page.js";
import { renderExplorationSection } from "../src/report/exploration-section.js";
import { evidenceAliases, htmlText } from "../src/report/evidence-page.js";
import { source, lookups, validated, event, mutation, opaque, id } from "./exploration-fixture.js";
import { snapshot } from "./provider-evidence-fixture.js";

const section = (html: string) => html.match(/<section id="unified-exploration">([\s\S]*?)<\/section>/)![1]!;
function invariantHtml(html: string) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const [, ref] of html.matchAll(/(?:href="#|aria-labelledby=")([^"]+)"/g)) expect(ids).toContain(ref);
  expect(html).not.toMatch(/<script|<iframe|<link|<img|(?:src|href)="https?:|h1:[a-f0-9]{32}:|FICTITIOUS_/);
  expect(html).toContain("script-src &#39;none&#39;"); expect(html).toContain("connect-src &#39;none&#39;");
  const css = html.match(/<style>([\s\S]*?)<\/style>/)![1]!;
  expect(html).toContain(`style-src &#39;sha256-${createHash("sha256").update(css).digest("base64")}&#39;`);
  expect(Buffer.byteLength(html)).toBeLessThanOrEqual(1048576);
}
afterEach(() => vi.restoreAllMocks());

it("includes unchanged exploration evidence in the unified offline report", () => {
  const s = validated(source(lookups())), before = structuredClone(s);
  const m = buildUnifiedSourceReport(s);
  expect(m.exploration).toEqual(engine.analyzeSourceExploration(s));
  expect(m.patterns).toEqual(analyzeSourcePatterns(s)); expect(m.summary).toEqual(summarizeSource(s));
  expect(m.exploration.includedEventIds).toEqual([]); expect(s).toEqual(before);
  expect(Object.isFrozen(m.exploration)).toBe(true);
  const html = renderUnifiedSourceReport(m), body = section(html);
  expect(html).toContain('href="#unified-exploration"'); expect(html).not.toContain("assessment remains outside this layout");
  expect(body).toContain("Exploration candidates: shown=1/1; omitted=0");
  expect(body).toContain("INFO"); expect(body).toContain("No exploration events or time are added to Detected Waste");
  expect(body).toContain("Window width ms (both endpoints included)</th><td>600000");
  expect(body).toContain("Minimum completed native lookups</th><td>20");
  expect(body).toContain("Minimum same exact native search invocations</th><td>5");
  expect(body).toContain("Maximum intersecting Edit/Write invocations</th><td>1");
  expect(body).toContain("Completed native lookups</th><td>20");
  expect(body).toContain("Largest repeated exact search</th><td>5");
  expect(body).toContain("Owned call/result proof count</th><td>40");
  expect(body).toContain("Window counters stop at the first selected candidate");
  invariantHtml(html);
});
it("calls the native exploration analyzer exactly once per unified build", () => {
  const s = validated(source(lookups())), analyze = vi.spyOn(engine, "analyzeSourceExploration");
  const m = buildUnifiedSourceReport(s); renderUnifiedSourceReport(m);
  expect(analyze).toHaveBeenCalledExactlyOnceWith(s);
});
it.each(["sourceId", "provider", "revision", "parserVersion", "completedOffset", "observedSize"] as const)("rejects mismatched exploration %s in composition and rendering", field => {
  const s = validated(source(lookups())), m = buildUnifiedSourceReport(s);
  const corrupt = { ...m.exploration, [field]: typeof m.exploration[field] === "number" ? Number(m.exploration[field]) + 1 : "different" };
  vi.spyOn(engine, "analyzeSourceExploration").mockReturnValue(corrupt as never);
  expect(() => buildUnifiedSourceReport(s)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
  expect(() => renderUnifiedSourceReport({ ...m, exploration: corrupt } as never)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
});
it.each([
  { name: "empty", events: [], state: "empty", unavailable: false },
  { name: "nineteen", events: lookups(19), state: "insufficient", unavailable: false },
  { name: "four repeats", events: lookups(20, 4), state: "no_candidate", unavailable: false },
  { name: "two mutations", events: [...lookups(), mutation("a"), mutation("b")], state: "no_candidate", unavailable: false },
  { name: "opaque", events: [...lookups(), opaque()], state: "blocked", unavailable: false },
  { name: "missing lookup identity", events: lookups().map(e => ({ ...e, lookupKey: null })), state: "unavailable", unavailable: true },
  { name: "missing boundary", events: lookups().map(e => ({ ...e, startAt: null, intervalScope: "unknown" as const, intervalTimingEvidence: "unknown" as const })), state: "unavailable", unavailable: true },
])("retains $name native assessment and null/empty distinction", ({ events, state, unavailable }) => {
  const s = validated(source(events)), m = buildUnifiedSourceReport(s), html = renderUnifiedSourceReport(m), body = section(html);
  expect(m.exploration.assessment).toBe(state); expect(body).toContain(`Assessment=${state}`);
  if (unavailable) {
    expect(body).toContain("candidates unavailable; not zero findings");
    expect(body).toContain("Candidate windows</th><td>Unavailable");
    expect(body).not.toContain("Exploration candidates: shown=0/0");
  } else expect(body).toContain("Exploration candidates: shown=0/0; omitted=0");
  for (const value of Object.values(m.exploration.guidance).filter(x => typeof x === "string")) expect(body).toContain(htmlText(value));
  invariantHtml(html);
});
it.each(["codex", "claude"] as const)("preserves ordinary %s native support and other domain output", provider => {
  const s = snapshot(provider).source, m = buildUnifiedSourceReport(s), html = renderUnifiedSourceReport(m), a = engine.analyzeSourceExploration(s);
  expect(m.exploration).toEqual(a); expect(section(html)).toContain(`Assessment=${a.assessment}`);
  expect(m.patterns).toEqual(analyzeSourcePatterns(s));
  if (provider === "codex") { expect(a.suppressionReason).toBe("unsupported_provider"); expect(section(html)).toContain("candidates unavailable; not zero findings"); }
  invariantHtml(html);
});
it("source suppression retains nonzero inventory and unavailable candidates", () => {
  const s = { ...validated(source(lookups())), availability: "unavailable" as const }, m = buildUnifiedSourceReport(s);
  expect(m.exploration.assessment).toBe("suppressed");
  const body = section(renderUnifiedSourceReport(m)); expect(body).toContain("Assessment=suppressed");
  expect(body).toContain("Candidate windows</th><td>Unavailable"); expect(body).toContain("Completed lookups");
});
it("aggregates an omitted unavailable session's reason before clipping partitions or candidates", () => {
  const sessions = Array.from({ length: 20 }, (_, i) => id("session", `s-${i}`)).sort();
  const events = sessions.flatMap((sid, i) => lookups().map((e, j) => event(`session-${i}-${j}`, 1000, "same", { sessionId: sid, ...(i === 19 ? { lookupKey: null } : {}) })));
  const m = buildUnifiedSourceReport(validated(source(events))), body = section(renderUnifiedSourceReport(m));
  expect(m.exploration.assessment).toBe("partial"); expect(m.exploration.candidates).toHaveLength(19);
  expect(body).toContain("Exploration partitions: shown=12/20; omitted=8");
  expect(body).toContain("Exploration candidates: shown=12/19; omitted=7");
  expect(body).toContain("Session state: unavailable</th><td>1");
  expect(body).toContain("missing_search_identity</th><td>1");
});
it("keeps repeated-group and event display limits distinct from complete native proofs", () => {
  const rows = Array.from({ length: 100 }, (_, i) => event(`g-${i}`, 1000, `group-${Math.floor(i / 5)}`));
  const m = buildUnifiedSourceReport(validated(source(rows))), c = m.exploration.candidates![0]!;
  const body = section(renderUnifiedSourceReport(m));
  expect(c.evidenceObservationIds).toHaveLength(200); expect(c.repeatedSearchGroups).toHaveLength(20);
  expect(body).toContain("Repeated search groups: shown=12/20; omitted=8");
  expect(body).toContain("Selected exploration event evidence: shown=12/100; omitted=88");
  expect(body).toContain("Owned call/result proof count</th><td>200");
});
it("uses shared report-local session/event aliases without leaking lookup, operation or proof identities", () => {
  const s = validated(source([...lookups(), mutation()])), m = buildUnifiedSourceReport(s), html = renderUnifiedSourceReport(m);
  const aliases = evidenceAliases(m.eventIds, "event"), body = section(html);
  for (const eid of m.exploration.candidates![0]!.evidenceEventIds.slice(0, 12)) expect(body).toContain(aliases.get(eid));
  for (const e of s.events) for (const value of [e.id, e.sessionId, e.lookupKey, e.operationKey]) if (value !== null) expect(html).not.toContain(value);
  for (const o of s.evidence!.observations) expect(html).not.toContain(o.id);
  expect(html).not.toContain(s.sourceId); invariantHtml(html);
});
it("refuses missing evidence aliases even for an event beyond the twelve shown rows", () => {
  const m = buildUnifiedSourceReport(validated(source(lookups()))), eventAliases = new Map(evidenceAliases(m.eventIds, "event"));
  eventAliases.delete(m.exploration.candidates![0]!.evidenceEventIds[19]!);
  expect(() => renderExplorationSection(m.exploration, { eventAliases, sessionAliases: evidenceAliases(m.sessionIds, "session") })).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
});
it.each(["severity", "includedEventIds"])("rejects a corrupted candidate %s rather than promoting the diagnostic", field => {
  const m = structuredClone(buildUnifiedSourceReport(validated(source(lookups()))));
  Object.assign(m.exploration.candidates![0]!, { [field]: field === "severity" ? "CRITICAL" : [m.eventIds[0]!] });
  expect(() => renderUnifiedSourceReport(m)).toThrowError(expect.objectContaining({ code: "INVALID_RECORD" }));
});
it("escapes hostile diagnostic text with native CSP and refuses over-limit text", () => {
  const m = structuredClone(buildUnifiedSourceReport(validated(source(lookups()))));
  const bad = '</p><script>alert("x")</script><img src=x onerror="x">'; m.exploration.guidance.meaning = bad;
  const html = renderUnifiedSourceReport(m); expect(html).toContain(htmlText(bad)); expect(html).not.toContain(bad); invariantHtml(html);
  m.exploration.guidance.meaning = "x".repeat(4097);
  expect(() => renderUnifiedSourceReport(m)).toThrowError(expect.objectContaining({ code: "REPORT_LIMIT" }));
});
it("enforces the final combined page ceiling after adding exploration without clipping its native result", () => {
  const m = structuredClone(buildUnifiedSourceReport(validated(source(lookups()))));
  m.exploration.guidance.limitations = Array.from({ length: 64 }, () => "&".repeat(4090));
  expect(() => renderUnifiedSourceReport(m)).toThrowError(expect.objectContaining({ code: "REPORT_LIMIT" }));
  expect(m.exploration.candidates![0]!.evidenceObservationIds).toHaveLength(40);
});
it("does not mutate input or reorder native arrays, and renders event/proof permutations identically", () => {
  const s = validated(source(lookups())), m = buildUnifiedSourceReport(s), before = JSON.stringify(m);
  const permuted = { ...s, events: [...s.events].reverse(), evidence: { ...s.evidence!, observations: [...s.evidence!.observations].reverse() } };
  expect(renderUnifiedSourceReport(buildUnifiedSourceReport(permuted))).toBe(renderUnifiedSourceReport(m));
  expect(JSON.stringify(m)).toBe(before);
});
it.each(["tied", "unique", "many-sessions", "many-candidates", "missing"] as const)("keeps actual validated maximum %s sources bounded and raw-free", shape => {
  const count = shape === "many-candidates" ? 4000 : 4096;
  const rows = Array.from({ length: count }, (_, i) => event(`max-${i}`, 1000, shape === "unique" ? `q-${i}` : "same", {
    ...(shape === "many-sessions" ? { sessionId: id("session", String(i)) } : shape === "many-candidates" ? { sessionId: id("session", String(Math.floor(i / 20))) } : {}),
    ...(shape === "missing" ? { lookupKey: null } : {}),
  }));
  const m = buildUnifiedSourceReport(validated(source(rows))), html = renderUnifiedSourceReport(m);
  if (shape === "tied") expect(m.exploration.candidates![0]!.evidenceObservationIds).toHaveLength(8192);
  if (shape === "many-candidates") expect(m.exploration.candidates).toHaveLength(200);
  if (shape === "many-sessions") expect(m.exploration.partitions).toHaveLength(4096);
  if (shape === "missing") expect(m.exploration.candidates).toBeNull();
  expect(section(html)).toContain(`Exploration partitions: shown=${Math.min(12, m.exploration.partitions.length)}/${m.exploration.partitions.length}`);
  invariantHtml(html); console.log(`EXPLORATION_REPORT_BOUND ${shape}: bytes=${Buffer.byteLength(html)}`);
});
