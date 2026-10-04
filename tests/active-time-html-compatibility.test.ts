import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { expect, it } from "vitest";
import { analyzeSourceActiveTime } from "../src/analysis/source-active-time.js";
import type { SourceActiveTimeAnalysis } from "../src/analysis/source-active-time.js";
import type { StoredSource } from "../src/db/source-store.js";
import { renderActiveTimeSection } from "../src/report/active-time-section.js";
import { htmlText } from "../src/report/evidence-page.js";
import { assertAndStripActiveTimeHtml } from "./active-time-html-compatibility.js";
import { capability, id, maximumSource, paired, source, turn } from "./active-time-fixture.js";

const overviewLink = '<a href="#unified-summary">Overview</a>';
const link = '<a href="#unified-active-time">Active Time</a>';
const commandsLink = '<a href="#unified-commands">Time and commands</a>';
const overviewOpening = '<section class="panel" id="unified-summary">';
const commandsOpening = '<section id="unified-commands">';
const tableOpening = (name: string) => `<div class="table-wrap" tabindex="0" role="region" aria-labelledby="${name}-caption"><table>`;
const summaryRow = '<tr><th scope="row">Summary</th><td>observed_eligible_subset</td><td>none</td></tr>';
const failureRow = '<tr><th scope="row">Native failure</th><td>evaluated</td><td>none</td></tr>';
const ordinarySource = () => source([turn("ordinary", 0, 10000)]);

/** Inert page shell, not an executable or historical artifact. The product
 * renderer supplies only the subject section. Expected values come directly
 * from the unchanged analyzer; the helper independently consumes all grammar.
 * The retained 36-case suite supplies the separate genuine full-page proof. */
function fixture(s = ordinarySource(), native = analyzeSourceActiveTime(s)) {
  const sessions = [...new Set([...s.events, ...(s.evidence?.usage ?? []), ...(s.evidence?.turns ?? [])].map(x => x.sessionId))].sort();
  const aliases = new Map(sessions.map((session, i) => [session, `session-${i + 1}`]));
  const section = renderActiveTimeSection(native, aliases);
  const assessmentRow = `<tr><th scope="row">Active Time</th><td>${htmlText(native.assessment)}</td><td>${htmlText(`assessment reason: ${native.activeTimeAssessmentReason ?? "none"}; suppression: ${native.suppressionReason ?? "none"}`)}</td></tr>`;
  const oldHtml = '<!doctype html><html><head><title>Inert boundary control</title></head><body>'
    + `<nav aria-label="Unified report sections">${overviewLink} ${commandsLink}</nav>`
    + overviewOpening + '<h2>Inert overview</h2>' + tableOpening("unified-assessments")
    + '<caption id="unified-assessments-caption">Inert assessments</caption><thead><tr><th scope="col">Domain</th><th scope="col">Assessment</th><th scope="col">Reason</th></tr></thead><tbody>'
    + summaryRow + failureRow + '</tbody></table></div></section>'
    + commandsOpening + '<h2>Inert commands</h2></section><footer>Untouched remainder</footer></body></html>';
  const currentHtml = oldHtml.replace(overviewLink + " " + commandsLink, overviewLink + " " + link + " " + commandsLink)
    .replace(summaryRow + failureRow, summaryRow + assessmentRow + failureRow).replace(commandsOpening, section + commandsOpening);
  return { source: s, native, oldHtml, currentHtml, old: Buffer.from(oldHtml), current: Buffer.from(currentHtml), section, assessmentRow };
}
type Fixture = ReturnType<typeof fixture>;
const ordinary = fixture();
const check = (x: Fixture, current = x.current, old = x.old, native = x.native, s = x.source) => assertAndStripActiveTimeHtml(old, current, native, s);
function replaceOne(html: string, original: string, replacement: string): string {
  expect(html.split(original).length - 1, original).toBe(1);
  const result = html.replace(original, replacement); expect(result).not.toBe(html); return result;
}
function badHtml(x: Fixture, transform: (html: string) => string) {
  const changed = transform(x.currentHtml); expect(changed).not.toBe(x.currentHtml);
  expect(() => check(x, Buffer.from(changed))).toThrow();
}
function cellChange(html: string, table: string, label: string, replacement = "INERT_WRONG_NATIVE"): string {
  const start = html.indexOf(tableOpening(table)); expect(start).toBeGreaterThanOrEqual(0);
  const end = html.indexOf("</table></div>", start) + "</table></div>".length;
  const target = html.slice(start, end), prefix = `<tr><th scope="row">${label}</th><td>`;
  expect(target.split(prefix).length - 1).toBe(1);
  const valueStart = target.indexOf(prefix) + prefix.length, valueEnd = target.indexOf("</td>", valueStart);
  const changed = target.slice(0, valueStart) + replacement + target.slice(valueEnd);
  return replaceOne(html, target, changed);
}
function manySource(n = 13): StoredSource {
  return source(Array.from({ length: n }, (_, i) => turn(`many-${i}`, i * 20000, i * 20000 + 1000, { sessionId: id("session", `many-${i}`) })));
}

const geometry = [
  ["wall", () => source([turn("wall", 0, 10000)]), [[10000, 10000]]],
  ["overlap", () => source([turn("a", 0, 10000), turn("b", 5000, 15000)]), [[15000, 15000]]],
  ["identical intervals", () => source([turn("a", 0, 10000), turn("b", 0, 10000)]), [[10000, 10000]]],
  ["adjacency", () => source([turn("a", 0, 10000), turn("b", 10000, 20000)]), [[20000, 20000]]],
  ["measured zero", () => source([turn("zero", 0, 0)]), [[0, 0]]],
  ["long gap", () => source([turn("a", 0, 10000), turn("b", 100000, 110000)]), [[20000, 110000]]],
  ["nested interval and gap", () => source([turn("a", 0, 10000), turn("b", 2000, 3000), turn("c", 20000, 40000)]), [[30000, 40000]]],
  ["cancelled turn", () => source([turn("cancel", 0, 10000, { status: "cancelled" })]), [[10000, 10000]]],
  ["paired boundaries", () => source([paired(turn("paired", 0, 10000))]), [[10000, 10000]]],
  ["separate interval contracts", () => source([turn("wall", 0, 10000), paired(turn("paired", 0, 10000))]), [[10000, 10000], [10000, 10000]]],
  ["separate sessions", () => source([turn("a", 0, 10000), turn("b", 100000, 110000, { sessionId: id("session", "second") })]), [[10000, 10000], [10000, 10000]]],
  ["both arithmetic overflows", () => source([turn("overflow", -8e15, 8e15)]), [[null, null]]],
  ["span overflow without union overflow", () => source([turn("a", -8e15, -8e15 + 1), turn("b", 8e15 - 1, 8e15)]), [[2, null]]],
] as const;
it.each(geometry)("independent Active Time HTML preserves %s native geometry", (_name, make, values) => {
  const x = fixture(make());
  expect(x.native.partitions!.map(p => [p.activeTimeMs, p.observedSpanMs])).toEqual(values);
  expect(check(x).normalizedCurrentBytes).toEqual(x.old);
});

const states = [
  ["unsupported Claude", () => ({ ...ordinarySource(), provider: "claude" as const }), "unavailable", "unsupported_provider"],
  ["Codex parser2", () => capability({ ...ordinarySource(), parserVersion: 2 }, { parserVersion: 2 }), "evaluated", null],
  ["Codex parser3", () => capability({ ...ordinarySource(), parserVersion: 3 }, { parserVersion: 3 }), "evaluated", null],
  ["unsupported parser4", () => capability({ ...ordinarySource(), parserVersion: 4 }, { parserVersion: 4 }), "unavailable", "unsupported_parser_contract"],
  ["unsupported normalization", () => ({ ...ordinarySource(), normalizationVersion: 2 }), "unavailable", "unsupported_parser_contract"],
  ["unsupported key", () => ({ ...ordinarySource(), keyVersion: 2 }), "unavailable", "unsupported_parser_contract"],
  ["evidence absent", () => ({ ...ordinarySource(), evidence: null }), "unavailable", "evidence_absent"],
  ["source unavailable", () => ({ ...ordinarySource(), availability: "unavailable" as const }), "unavailable", "source_unavailable"],
  ["partial shapes", () => capability(ordinarySource(), { coverage: "partial" }), "partial", "partial_shape_coverage"],
  ["state limited", () => capability(ordinarySource(), { stateLimited: true }), "unavailable", "state_limited"],
  ["dropped diagnostics", () => capability(ordinarySource(), { diagnosticsDropped: 1 }), "unavailable", "state_limited"],
  ["ambiguous records", () => capability(ordinarySource(), { ambiguousRecords: 1 }), "unavailable", "ambiguous_origin"],
  ["empty population", () => source(), "no_eligible_turns", "no_supported_turn_intervals"],
] as const;
it.each(states)("independent Active Time HTML preserves %s availability", (_name, make, assessment, reason) => {
  const x = fixture(make()); expect(x.native.assessment).toBe(assessment); expect(x.native.activeTimeAssessmentReason).toBe(reason);
  expect(check(x).normalizedCurrentBytes).toEqual(x.old);
  if (assessment === "unavailable") {
    expect(x.section).toContain("Active Time partitions unavailable; not zero observed time.");
    expect(x.section).not.toContain('Active Time partitions: shown=0/0; omitted=0.');
  }
});

const structure: readonly (readonly [string, (h: string) => string])[] = [
  ["all three additions missing", () => ordinary.oldHtml],
  ["nav missing", h => replaceOne(h, link + " ", "")],
  ["nav duplicate", h => replaceOne(h, link, link + link)],
  ["nav after commands", h => replaceOne(replaceOne(h, link + " ", ""), commandsLink, commandsLink + " " + link)],
  ["nav outside its landmark", h => replaceOne(replaceOne(h, link + " ", ""), "</nav>", "</nav>" + link)],
  ["nav double separator", h => replaceOne(h, link + " ", link + "  ")],
  ["nav line break", h => replaceOne(h, link + " ", link + "\n")],
  ["nav changed label", h => replaceOne(h, link, '<a href="#unified-active-time">Observed Time</a>')],
  ["nav changed target", h => replaceOne(h, link, '<a href="#future-active-time">Active Time</a>')],
  ["nav duplicate target with changed label", h => replaceOne(h, "</nav>", '<a href="#unified-active-time">INERT_CHANGED_LABEL</a></nav>')],
  ["assessment row missing", h => replaceOne(h, ordinary.assessmentRow, "")],
  ["assessment row duplicate", h => replaceOne(h, ordinary.assessmentRow, ordinary.assessmentRow + ordinary.assessmentRow)],
  ["assessment row before summary", h => replaceOne(replaceOne(h, ordinary.assessmentRow, ""), summaryRow, ordinary.assessmentRow + summaryRow)],
  ["assessment row after native failure", h => replaceOne(replaceOne(h, ordinary.assessmentRow, ""), failureRow, failureRow + ordinary.assessmentRow)],
  ["assessment row extra cell", h => replaceOne(h, ordinary.assessmentRow, ordinary.assessmentRow.replace("</tr>", "<td>extra</td></tr>"))],
  ["assessment row native value", h => replaceOne(h, ordinary.assessmentRow, ordinary.assessmentRow.replace("evaluated", "WRONG_NATIVE"))],
  ["assessment row native reason", h => replaceOne(h, ordinary.assessmentRow, ordinary.assessmentRow.replace("assessment reason: none", "assessment reason: WRONG_NATIVE"))],
  ["section missing", h => replaceOne(h, ordinary.section, "")],
  ["section duplicate", h => replaceOne(h, ordinary.section, ordinary.section + ordinary.section)],
  ["section before overview", h => replaceOne(replaceOne(h, ordinary.section, ""), overviewOpening, ordinary.section + overviewOpening)],
  ["section after commands", h => replaceOne(replaceOne(h, ordinary.section, ""), "<footer>", ordinary.section + "<footer>")],
  ["section nested", h => replaceOne(h, ordinary.section, ordinary.section.replace("<h2>", '<section id="inert-nested"></section><h2>'))],
  ["section unknown attribute", h => replaceOne(h, '<section id="unified-active-time">', '<section id="unified-active-time" data-extra="inert">')],
  ["section padded before", h => replaceOne(h, ordinary.section, " " + ordinary.section)],
  ["section padded after", h => replaceOne(h, ordinary.section, ordinary.section + "\n")],
  ["section changed assessment", h => replaceOne(h, "<p>Assessment=evaluated; assessment reason=none; suppression=none.</p>", "<p>Assessment=partial; assessment reason=none; suppression=none.</p>")],
  ["section unknown content", h => replaceOne(h, ordinary.section, ordinary.section.replace("</section>", "<p>INERT_UNKNOWN</p></section>"))],
  ["section family outside its region", h => replaceOne(h, "<footer>", '<section id="unified-active-time-future"></section><footer>')],
];
it.each(structure)("strict Active Time region rejects %s", (_name, transform) => badHtml(ordinary, transform));

const tableCells = [
  ...["Provider / parser", "Normalization / key version", "Metric / version / scope", "Availability / persisted scope", "Observation window", "Query period", "Source freshness checked", "Cross-source reconciled", "Aggregation ready", "Parser resume ready", "Capability provider / parser", "Capability support / coverage", "Observed shapes", "Unsupported records", "Ambiguous records", "State limited", "Dropped diagnostics"].map(label => ["context", label]),
  ...["Admitted turns", "Excluded turns", "Compatible partitions", "Distinct corroborating observations"].map(label => ["population", label]),
  ...["Active Time union numeric_overflow", "Observed span numeric_overflow"].map(label => ["arithmetic", label]),
  ...["unsupportedProvider", "pending", "unknownStatus", "missingBoundaries", "unknownInterval", "estimatedTiming", "inconsistentInterval", "invalidBoundaries", "missingTerminalProof", "contradictoryTerminalProof", "missingPendingProof"].map(label => ["exclusions", label]),
] as const;
it.each(tableCells)("strict native %s table rejects altered %s", (table, label) => badHtml(ordinary, h => cellChange(h, `unified-active-time-${table}`, label)));
it.each(["Session", "Interval scope / evidence", "Admitted turns", "Distinct corroborating observations", "Active Time union ms", "Union reason", "Observed span ms", "Span reason"])("strict partition detail rejects altered %s", label => {
  const column = ["Session", "Interval scope / evidence", "Admitted turns", "Distinct corroborating observations", "Active Time union ms", "Union reason", "Observed span ms", "Span reason"].indexOf(label);
  badHtml(ordinary, h => {
    const start = h.indexOf(tableOpening("unified-active-time-partitions")), end = h.indexOf("</table></div>", start) + 14;
    const target = h.slice(start, end), body = target.indexOf("<tbody>") + 7;
    const cells = [...target.slice(body).matchAll(/<(th scope="row"|td)>([^<]*)<\/(?:th|td)>/g)];
    expect(cells).toHaveLength(8); const cell = cells[column]!;
    const offset = body + cell.index!; const changed = target.slice(0, offset) + cell[0].replace(cell[2]!, "INERT_WRONG_NATIVE") + target.slice(offset + cell[0].length);
    return replaceOne(h, target, changed);
  });
});

it.each(["sourceId", "provider", "revision", "parserVersion", "normalizationVersion", "keyVersion", "completedOffset", "observedSize"] as const)("native envelope rejects mismatched %s", field => {
  const value = ordinary.native[field], native = { ...ordinary.native, [field]: typeof value === "number" ? value + 1 : value + "-inert" } as SourceActiveTimeAnalysis;
  expect(native).not.toEqual(ordinary.native); expect(() => check(ordinary, ordinary.current, ordinary.old, native)).toThrow();
});
it.each(["schema", "metric", "version", "scope"] as const)("native contract rejects future %s", field => {
  const native = { ...ordinary.native, [field]: "inert-future-contract" } as unknown as SourceActiveTimeAnalysis;
  expect(native).not.toEqual(ordinary.native); expect(() => check(ordinary, ordinary.current, ordinary.old, native)).toThrow();
});

it("full population includes 4096 partitions and 8192 proofs before twelve detail rows", () => {
  const x = fixture(maximumSource()); expect(x.native.summary.eligibleTurns).toBe(4096);
  expect(x.section).toContain("Distinct corroborating observations</th><td>8192</td>");
  expect(x.section).toContain("shown=12/4096; omitted=4084."); expect(check(x).normalizedCurrentBytes).toEqual(x.old);
});
it("all omitted sessions and proofs participate before detail clipping", () => {
  const x = fixture(manySource()); expect(x.section).toContain("shown=12/13; omitted=1.");
  expect(x.section).toContain("Distinct corroborating observations</th><td>13</td>");
  expect(check(x).normalizedCurrentBytes).toEqual(x.old);
});
it.each(["unknown session", "unknown proof", "removed proof", "union overflow", "span overflow"] as const)("omitted partition rejects %s drift", kind => {
  const x = fixture(manySource()), native = structuredClone(x.native), last = native.partitions![12]!;
  const changed = kind === "unknown session" ? { ...last, sessionId: id("session", "not-in-source") }
    : kind === "unknown proof" ? { ...last, turnEvidence: last.turnEvidence.map(t => ({ ...t, evidenceObservationIds: [id("source", "not-in-source")] })) }
    : kind === "removed proof" ? { ...last, turnEvidence: last.turnEvidence.map(t => ({ ...t, evidenceObservationIds: [] })) }
    : kind === "union overflow" ? { ...last, activeTimeMs: null, activeTimeReason: "numeric_overflow" as const }
    : { ...last, observedSpanMs: null, observedSpanReason: "numeric_overflow" as const };
  const altered = { ...native, partitions: native.partitions!.map((p, i) => i === 12 ? changed : p) };
  expect(altered).not.toEqual(x.native); expect(() => check(x, x.current, x.old, altered)).toThrow();
});

const grammar = [
  ["title", "Observed turn Active Time", "Observed elapsed Time"],
  ["union gap meaning", "Native turn interval union excludes gaps", "Native turn interval union includes gaps"],
  ["span gap meaning", "observed span includes gaps", "observed span excludes gaps"],
  ["CPU disclaimer", "Neither measurement is CPU time", "Both measurements are CPU time"],
  ["duration disclaimer", "Recorded turn duration does not supply interval endpoints.", "Recorded turn duration supplies interval endpoints."],
  ["partition omission", "shown=1/1; omitted=0.", "shown=1/1; omitted=1."],
  ["partition caption", "Native turn intervals — independent compatible partitions, milliseconds", "Native total duration"],
  ["native machine path", "agentprof stats --source FULL_SOURCE_ID --active-time --json", "agentprof stats --source INERT_WRONG_SOURCE --active-time --json"],
  ["privacy qualification", "This count-only summary does not embed individual turn or proof identities", "This summary embeds individual turn and proof identities"],
  ["full native evidence qualification", "partition display limits do not truncate the native evidence.", "partition display limits truncate the native evidence."],
] as const;
it.each(grammar)("complete native grammar rejects altered %s", (_name, original, replacement) => badHtml(ordinary, h => replaceOne(h, original, replacement)));
it.each(ordinary.native.limitations)("complete native grammar rejects missing limitation %s", value => badHtml(ordinary, h => replaceOne(h, `<p class="notice">${htmlText(value)}</p>`, "")));
it("native limitations retain their full order", () => {
  const first = `<p class="notice">${htmlText(ordinary.native.limitations[0]!)}</p>`, second = `<p class="notice">${htmlText(ordinary.native.limitations[1]!)}</p>`;
  badHtml(ordinary, h => replaceOne(h, first + second, second + first));
});
it.each(["Admitted turns", "Excluded turns", "Compatible partitions", "Distinct corroborating observations"])("unavailable %s cannot become measured zero", label => {
  const x = fixture({ ...ordinarySource(), provider: "claude" });
  badHtml(x, h => cellChange(h, "unified-active-time-population", label, "0"));
});
it("an empty partition list retains the explicit not-measured-zero explanation", () => {
  const x = fixture(source());
  badHtml(x, h => replaceOne(h, '<p>No supported turn intervals were admitted. An empty partition list is not a measured Active Time zero.</p>', ""));
});
it("measured zero cannot become unavailable", () => {
  const x = fixture(source([turn("zero", 0, 0)]));
  badHtml(x, h => replaceOne(h, "<td>0</td><td>none</td><td>0</td><td>none</td>", "<td>Unavailable</td><td>numeric_overflow</td><td>0</td><td>none</td>"));
});
it("native union and span cannot be exchanged across a long gap", () => {
  const x = fixture(source([turn("a", 0, 10000), turn("b", 100000, 110000)]));
  badHtml(x, h => replaceOne(h, "<td>20000</td><td>none</td><td>110000</td>", "<td>110000</td><td>none</td><td>20000</td>"));
});
it("full exclusion rows retain the native reason order", () => {
  const first = '<tr><th scope="row">unsupportedProvider</th><td>0</td></tr>', second = '<tr><th scope="row">pending</th><td>0</td></tr>';
  badHtml(ordinary, h => replaceOne(h, first + second, second + first));
});

it.each(["nav", "changed-label target", "assessment row", "section", "native table caption", "native title", "future section family"] as const)("historical page rejects preexisting Active Time %s", kind => {
  const marker = kind === "nav" ? link : kind === "assessment row" ? ordinary.assessmentRow : kind === "section" ? ordinary.section
    : kind === "changed-label target" ? '<a href="#unified-active-time">INERT_CHANGED_LABEL</a>'
    : kind === "future section family" ? '<section id="unified-active-time-future"></section>'
    : kind === "native table caption" ? '<caption id="unified-active-time-population-caption">inert</caption>' : '<h2>Observed turn Active Time</h2>';
  const old = Buffer.from(ordinary.oldHtml.replace("</body>", marker + "</body>")); expect(old).not.toEqual(ordinary.old);
  expect(() => check(ordinary, ordinary.current, old)).toThrow();
});
it.each(["source identity", "session identity", "turn identity", "proof identity", "partition identity", "private path", "active markup"] as const)("native section rejects leaked %s", kind => {
  const value = kind === "source identity" ? ordinary.source.sourceId : kind === "session identity" ? ordinary.native.partitions![0]!.sessionId
    : kind === "turn identity" ? ordinary.native.partitions![0]!.turnIds[0]! : kind === "proof identity" ? ordinary.native.partitions![0]!.turnEvidence[0]!.evidenceObservationIds[0]!
    : kind === "partition identity" ? ordinary.native.partitions![0]!.id : kind === "private path" ? "/Users/inert/private/source.jsonl" : '<img src="https://inert.invalid/remote">';
  badHtml(ordinary, h => replaceOne(h, ordinary.section, ordinary.section.replace("</section>", `<p>${value}</p></section>`)));
});
it.each(["old", "current"] as const)("original %s page rejects invalid UTF8", side => {
  const bytes = Buffer.concat([side === "old" ? ordinary.old : ordinary.current, Buffer.from([0xff])]);
  expect(() => check(ordinary, side === "current" ? bytes : ordinary.current, side === "old" ? bytes : ordinary.old)).toThrow();
});
it.each(["old", "current"] as const)("original %s page byte bound applies before stripping", side => {
  const bytes = Buffer.concat([side === "old" ? ordinary.old : ordinary.current, Buffer.alloc(1_048_576, 32)]);
  expect(() => check(ordinary, side === "current" ? bytes : ordinary.current, side === "old" ? bytes : ordinary.old)).toThrow();
});
it.each(["turns", "observations", "partitions", "dynamic text"] as const)("native input rejects excessive %s", kind => {
  const s = kind === "turns" ? { ...ordinary.source, evidence: { ...ordinary.source.evidence!, turns: Array(4097).fill(ordinary.source.evidence!.turns[0]) } }
    : kind === "observations" ? { ...ordinary.source, evidence: { ...ordinary.source.evidence!, observations: Array(8193).fill(ordinary.source.evidence!.observations[0]) } }
    : kind === "dynamic text" ? capability(ordinary.source, { observedShapes: ["x".repeat(4097) as never] }) : ordinary.source;
  const native = kind === "partitions" ? { ...ordinary.native, partitions: Array(4097).fill(ordinary.native.partitions![0]) }
    : kind === "dynamic text" ? { ...ordinary.native, capabilities: s.evidence!.capabilities } : ordinary.native;
  expect({ s, native }).not.toEqual({ s: ordinary.source, native: ordinary.native });
  expect(() => check(ordinary, ordinary.current, ordinary.old, native, s)).toThrow();
});
it("escaped hostile native text stays inert and within the exact grammar", () => {
  const x = fixture(capability(ordinarySource(), { observedShapes: ['<img src="inert">&\'' as never] }));
  expect(x.section).toContain("&lt;img src=&quot;inert&quot;&gt;&amp;&#39;"); expect(check(x).normalizedCurrentBytes).toEqual(x.old);
});
it("dynamic native text at the 4096 character boundary is preserved", () => {
  const x = fixture(capability(ordinarySource(), { observedShapes: ["x".repeat(4096) as never] }));
  expect(check(x).normalizedCurrentBytes).toEqual(x.old);
});
it("dynamic native text cannot be silently truncated at the boundary", () => {
  const x = fixture(capability(ordinarySource(), { observedShapes: ["x".repeat(4096) as never] }));
  badHtml(x, h => replaceOne(h, "x".repeat(4096), "x".repeat(4095)));
});
it("normalization returns exact byte regions and a fresh buffer without changing inputs", () => {
  const x = fixture(), old = Buffer.from(x.old), current = Buffer.from(x.current), s = structuredClone(x.source), native = structuredClone(x.native);
  const result = check(x); expect(result.normalizedCurrentBytes).toEqual(old); expect(result.normalizedCurrentBytes).not.toBe(x.old);
  for (const item of [result.navLink, result.assessmentRow, result.section]) {
    expect(x.current.subarray(item.startByte, item.endByte)).toEqual(Buffer.from(item.html)); expect(Object.isFrozen(item)).toBe(true);
  }
  result.normalizedCurrentBytes.fill(0); deepStrictEqual(x.old, old); deepStrictEqual(x.current, current);
  deepStrictEqual(x.source, s); deepStrictEqual(x.native, native);
});
it("frozen source and native inputs remain unchanged", () => {
  const x = fixture(); const freeze = (value: unknown): void => { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } };
  freeze(x.source); const before = JSON.stringify({ source: x.source, native: x.native });
  expect(check(x).normalizedCurrentBytes).toEqual(x.old); strictEqual(JSON.stringify({ source: x.source, native: x.native }), before);
});
it("region offsets refer to original UTF8 bytes with a Unicode prefix", () => {
  const x = fixture(), prefix = "관찰 🥝 — ", old = Buffer.from(x.oldHtml.replace("Inert boundary control", prefix)), current = Buffer.from(x.currentHtml.replace("Inert boundary control", prefix));
  const result = check(x, current, old); expect(result.normalizedCurrentBytes).toEqual(old);
  for (const item of [result.navLink, result.assessmentRow, result.section]) expect(current.subarray(item.startByte, item.endByte)).toEqual(Buffer.from(item.html));
  expect(result.navLink.startByte).toBeGreaterThan(current.toString("utf8").indexOf(link));
});
it.each(["head", "footer", "unrelated commands"] as const)("unrelated %s bytes survive normalization and fail the caller's residual comparison", kind => {
  const changed = kind === "head" ? replaceOne(ordinary.currentHtml, "</head>", "<!-- INERT_OUTSIDE --> </head>")
    : kind === "footer" ? replaceOne(ordinary.currentHtml, "Untouched remainder", "Altered remainder")
    : replaceOne(ordinary.currentHtml, "Inert commands", "Altered commands");
  const result = check(ordinary, Buffer.from(changed)); expect(result.normalizedCurrentBytes).not.toEqual(ordinary.old);
  expect(() => deepStrictEqual(result.normalizedCurrentBytes, ordinary.old)).toThrow();
});
