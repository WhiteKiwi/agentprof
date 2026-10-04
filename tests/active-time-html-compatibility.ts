import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import type { SourceActiveTimeAnalysis } from "../src/analysis/source-active-time.js";
import type { StoredSource } from "../src/db/source-store.js";
import { htmlText } from "../src/report/evidence-page.js";

type Cell = string | number | null;
export type ActiveTimeHtmlRegion = Readonly<{ startByte: number; endByte: number; html: string }>;
export type ActiveTimeHtmlDelta = Readonly<{
  normalizedCurrentBytes: Buffer;
  navLink: ActiveTimeHtmlRegion;
  assessmentRow: ActiveTimeHtmlRegion;
  section: ActiveTimeHtmlRegion;
}>;
const link = '<a href="#unified-active-time">Active Time</a>';
const overviewLink = '<a href="#unified-summary">Overview</a>';
const commandsLink = '<a href="#unified-commands">Time and commands</a>';
const rowMarker = '<tr><th scope="row">Active Time</th>';
const sectionOpening = '<section id="unified-active-time">';
const exclusions = ["unsupportedProvider", "pending", "unknownStatus", "missingBoundaries", "unknownInterval", "estimatedTiming", "inconsistentInterval", "invalidBoundaries", "missingTerminalProof", "contradictoryTerminalProof", "missingPendingProof"] as const;
const tableOpening = (id: string) => `<div class="table-wrap" tabindex="0" role="region" aria-labelledby="${id}-caption"><table>`;
const count = (html: string, literal: string) => html.split(literal).length - 1;
function once(html: string, literal: string) { strictEqual(count(html, literal), 1, literal); }
function region(html: string, opening: string, closing: string) {
  once(html, opening);
  const start = html.indexOf(opening), end = html.indexOf(closing, start + opening.length);
  ok(end >= start + opening.length, opening);
  return { start, end: end + closing.length, html: html.slice(start, end + closing.length) };
}
function numeric(value: number | null): string {
  if (value === null) return "Unavailable";
  ok(Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0), "native nonnegative safe integer");
  return String(value);
}
const row = (cells: readonly Cell[]) => `<tr>${cells.map((value, i) => i === 0
  ? `<th scope="row">${htmlText(value)}</th>` : `<td>${htmlText(value)}</td>`).join("")}</tr>`;
// Independent fixed grammar: never use the subject's model builder, section
// renderer, table renderer or omission renderer to produce expected HTML.
function table(id: string, caption: string, columns: readonly string[], rows: readonly (readonly Cell[])[]) {
  return `${tableOpening(id)}<caption id="${id}-caption">${htmlText(caption)}</caption><thead><tr>${columns.map(c => `<th scope="col">${htmlText(c)}</th>`).join("")}</tr></thead><tbody>${rows.map(row).join("")}</tbody></table></div>`;
}
function nativeSection(a: SourceActiveTimeAnalysis, source: StoredSource): string {
  for (const field of ["sourceId", "provider", "revision", "parserVersion", "normalizationVersion", "keyVersion", "completedOffset", "observedSize"] as const)
    strictEqual(a[field], source[field], field);
  strictEqual(a.schema, "agentprof.source-active-time/v1"); strictEqual(a.metric, "active_time");
  strictEqual(a.version, "codex-positioned-turn-v1"); strictEqual(a.scope, "source_prefix");
  strictEqual(a.availability, source.availability); strictEqual(a.persistedScope, source.persistedScope);
  deepStrictEqual(a.capabilities, source.evidence?.capabilities ?? null);
  for (const field of ["sourceFreshnessChecked", "crossSourceReconciled", "aggregationReady", "parserResumeReady"] as const) strictEqual(a[field], false, field);
  strictEqual(a.queryPeriod, null);
  deepStrictEqual(a.observationWindow, { unit: "source_bytes", startInclusive: 0, endExclusive: source.completedOffset });
  ok(source.events.length <= 4096 && (source.evidence === null || source.evidence.turns.length <= 4096
    && source.evidence.usage.length <= 4096 && source.evidence.observations.length <= 8192 && source.evidence.diagnostics.length <= 8192), "source bounds");
  ok((a.partitions?.length ?? 0) <= 4096, "native partition bound");
  const sessions = [...new Set([...source.events, ...(source.evidence?.usage ?? []), ...(source.evidence?.turns ?? [])].map(x => x.sessionId))].sort();
  const turnIds = new Set(source.evidence?.turns.map(t => t.id)), observationIds = new Set(source.evidence?.observations.map(o => o.id));
  const allProofs = new Set<string>(), partitionIds = new Set<string>(), admittedIds = new Set<string>();
  const details: Cell[][] = [];
  let admitted = 0, unionOverflow = 0, spanOverflow = 0;
  for (const p of a.partitions ?? []) {
    const index = sessions.indexOf(p.sessionId); ok(index >= 0, "every native partition has a source session alias");
    ok(!partitionIds.has(p.id), "unique partition identity"); partitionIds.add(p.id);
    strictEqual(p.turnN, p.turnIds.length); strictEqual(p.turnN, p.turnEvidence.length);
    ok(p.turnN > 0); admitted += p.turnN;
    deepStrictEqual(p.turnEvidence.map(t => t.turnId), p.turnIds);
    const proofs = new Set<string>();
    for (const t of p.turnEvidence) {
      ok(turnIds.has(t.turnId) && !admittedIds.has(t.turnId), "owned distinct admitted turn"); admittedIds.add(t.turnId);
      ok(t.status === "completed" || t.status === "cancelled");
      for (const id of t.evidenceObservationIds) { ok(observationIds.has(id), "owned native proof"); proofs.add(id); allProofs.add(id); }
    }
    ok(p.intervalScope === "turn_wall" && p.intervalTimingEvidence === "source_reported"
      || p.intervalScope === "observed_turn" && p.intervalTimingEvidence === "paired_timestamps", "native interval contract");
    strictEqual(p.activeTimeReason, p.activeTimeMs === null ? "numeric_overflow" : null);
    strictEqual(p.observedSpanReason, p.observedSpanMs === null ? "numeric_overflow" : null);
    if (p.activeTimeReason === "numeric_overflow") unionOverflow++;
    if (p.observedSpanReason === "numeric_overflow") spanOverflow++;
    const cells: Cell[] = [`session-${index + 1}`, `${p.intervalScope} / ${p.intervalTimingEvidence}`, numeric(p.turnN), numeric(proofs.size),
      numeric(p.activeTimeMs), p.activeTimeReason ?? "none", numeric(p.observedSpanMs), p.observedSpanReason ?? "none"];
    if (details.length < 12) details.push(cells);
  }
  if (a.partitions === null) {
    deepStrictEqual(a.summary, { eligibleTurns: null, excludedTurns: null, partitions: null });
    strictEqual(a.exclusions, null); strictEqual(a.excludedTurnEvidence, null); strictEqual(a.assessment, "unavailable");
  } else {
    ok(a.exclusions !== null && a.excludedTurnEvidence !== null);
    deepStrictEqual(Object.keys(a.exclusions), exclusions);
    strictEqual(a.summary.eligibleTurns, admitted); strictEqual(a.summary.partitions, a.partitions.length);
    strictEqual(a.summary.excludedTurns, a.excludedTurnEvidence.length);
    strictEqual(exclusions.reduce((n, reason) => n + Number(numeric(a.exclusions![reason])), 0), a.summary.excludedTurns);
    strictEqual(admitted + a.excludedTurnEvidence.length, source.evidence!.turns.length);
  }
  const c = a.capabilities;
  const context: Cell[][] = [
    ["Provider / parser", `${a.provider} / ${numeric(a.parserVersion)}`],
    ["Normalization / key version", `${numeric(a.normalizationVersion)} / ${numeric(a.keyVersion)}`],
    ["Metric / version / scope", `${a.metric} / ${a.version} / ${a.scope}`],
    ["Availability / persisted scope", `${a.availability} / ${a.persistedScope}`],
    ["Observation window", `${a.observationWindow.unit}: [${numeric(a.observationWindow.startInclusive)}, ${numeric(a.observationWindow.endExclusive)})`],
    ["Query period", a.queryPeriod], ["Source freshness checked", String(a.sourceFreshnessChecked)],
    ["Cross-source reconciled", String(a.crossSourceReconciled)], ["Aggregation ready", String(a.aggregationReady)], ["Parser resume ready", String(a.parserResumeReady)],
    ["Capability provider / parser", c === null ? null : `${c.provider} / ${numeric(c.parserVersion)}`],
    ["Capability support / coverage", c === null ? null : `${c.support} / ${c.coverage}`],
    ["Observed shapes", c === null ? null : c.observedShapes.join(", ") || "none"],
    ["Unsupported records", numeric(c?.unsupportedRecords ?? null)], ["Ambiguous records", numeric(c?.ambiguousRecords ?? null)],
    ["State limited", c === null ? null : String(c.stateLimited)], ["Dropped diagnostics", numeric(c?.diagnosticsDropped ?? null)],
  ];
  const result = [sectionOpening + '<h2>Observed turn Active Time</h2>',
    `<p>Assessment=${htmlText(a.assessment)}; assessment reason=${htmlText(a.activeTimeAssessmentReason ?? "none")}; suppression=${htmlText(a.suppressionReason ?? "none")}.</p>`,
    '<p>Native turn interval union excludes gaps; observed span includes gaps. Completed and cancelled observed turns can include waiting. Sessions and interval contracts stay separate. Neither measurement is CPU time, task elapsed time, productivity, waste or savings. Recorded turn duration does not supply interval endpoints.</p>',
    table("unified-active-time-context", "Native Active Time source and capability context", ["Context", "Value"], context),
    table("unified-active-time-population", "Full native Active Time population — before display limits", ["Population", "Count"], [
      ["Admitted turns", numeric(a.summary.eligibleTurns)], ["Excluded turns", numeric(a.summary.excludedTurns)], ["Compatible partitions", numeric(a.summary.partitions)],
      ["Distinct corroborating observations", numeric(a.partitions === null ? null : allProofs.size)],
    ]),
    table("unified-active-time-arithmetic", "Full-population arithmetic qualifications — partition counts can overlap", ["Qualification", "Partitions"], [
      ["Active Time union numeric_overflow", numeric(a.partitions === null ? null : unionOverflow)],
      ["Observed span numeric_overflow", numeric(a.partitions === null ? null : spanOverflow)],
    ]),
  ];
  result.push(a.exclusions === null ? '<p>Native turn exclusions unavailable; no zero exclusion counts are inferred.</p>'
    : table("unified-active-time-exclusions", "Native primary exclusion reasons — one reason per excluded turn", ["Reason", "Turns"], exclusions.map(reason => [reason, numeric(a.exclusions![reason])])));
  if (a.partitions === null) result.push('<p class="notice">Active Time partitions unavailable; not zero observed time. See native assessment and reasons above.</p>');
  else {
    result.push(`<p class="omission">Active Time partitions: shown=${details.length}/${a.partitions.length}; omitted=${a.partitions.length - details.length}.</p>`,
      table("unified-active-time-partitions", "Native turn intervals — independent compatible partitions, milliseconds", ["Session", "Interval scope / evidence", "Admitted turns", "Distinct corroborating observations", "Active Time union ms", "Union reason", "Observed span ms", "Span reason"], details));
    if (a.partitions.length === 0) result.push('<p>No supported turn intervals were admitted. An empty partition list is not a measured Active Time zero.</p>');
  }
  result.push(...a.limitations.map(value => `<p class="notice">${htmlText(value)}</p>`),
    '<p>Complete admitted turn endpoints, terminal statuses, proof identities and excluded-turn membership: <code>agentprof stats --source FULL_SOURCE_ID --active-time --json</code>. This count-only summary does not embed individual turn or proof identities; partition display limits do not truncate the native evidence.</p></section>');
  return result.join("");
}

/** Internal trusted native/source control. Strip only independently verified
 * Active Time bytes; the caller still verifies every other historical byte. */
export function assertAndStripActiveTimeHtml(oldBytes: Buffer, currentBytes: Buffer, native: SourceActiveTimeAnalysis, source: StoredSource): ActiveTimeHtmlDelta {
  ok(Buffer.isBuffer(oldBytes) && Buffer.isBuffer(currentBytes));
  ok(oldBytes.length <= 1_048_576 && currentBytes.length <= 1_048_576, "original page byte bound");
  const old = oldBytes.toString("utf8"), current = currentBytes.toString("utf8");
  deepStrictEqual(Buffer.from(old, "utf8"), oldBytes); deepStrictEqual(Buffer.from(current, "utf8"), currentBytes);
  for (const marker of [link, 'href="#unified-active-time"', "unified-active-time", rowMarker, sectionOpening, 'id="unified-active-time"', '<h2>Observed turn Active Time</h2>',
    ...["context", "population", "arithmetic", "exclusions", "partitions"].map(name => `unified-active-time-${name}-caption`)]) strictEqual(count(old, marker), 0, marker);
  once(current, link); once(current, 'href="#unified-active-time"'); once(current, rowMarker); once(current, 'id="unified-active-time"');
  const oldNav = region(old, '<nav aria-label="Unified report sections">', "</nav>");
  const currentNav = region(current, '<nav aria-label="Unified report sections">', "</nav>");
  once(oldNav.html, `${overviewLink} ${commandsLink}`); once(currentNav.html, `${overviewLink} ${link} ${commandsLink}`);
  const oldOverview = region(old, '<section class="panel" id="unified-summary">', "</section>");
  const currentOverview = region(current, '<section class="panel" id="unified-summary">', "</section>");
  const oldTable = region(old, tableOpening("unified-assessments"), "</table></div>");
  const currentTable = region(current, tableOpening("unified-assessments"), "</table></div>");
  once(oldOverview.html, oldTable.html); once(currentOverview.html, currentTable.html);
  const summaryRow = region(oldTable.html, '<tr><th scope="row">Summary</th>', "</tr>").html;
  const nativeFailure = '<tr><th scope="row">Native failure</th>';
  once(oldTable.html, summaryRow + nativeFailure);
  const assessment = row(["Active Time", native.assessment, `assessment reason: ${native.activeTimeAssessmentReason ?? "none"}; suppression: ${native.suppressionReason ?? "none"}`]);
  once(current, assessment); once(currentTable.html, summaryRow + assessment + nativeFailure);
  const actualSection = region(current, sectionOpening, "</section>");
  strictEqual(count(actualSection.html, "<section"), 1);
  strictEqual(oldOverview.end, region(old, '<section id="unified-commands">', "</section>").start);
  strictEqual(currentOverview.end, actualSection.start);
  strictEqual(actualSection.end, region(current, '<section id="unified-commands">', "</section>").start);
  const expectedSection = nativeSection(native, source);
  strictEqual(actualSection.html, expectedSection);
  strictEqual(count(current, "unified-active-time"), count(expectedSection, "unified-active-time") + 1, "section family marker collisions");
  ok(!/<script|<iframe|<img|h1:[a-f0-9]{32}:|FICTITIOUS_|(?:src|href)="https?:|\/Users\/|\/home\//.test(actualSection.html), "private or active markup");
  const privateIds = [source.sourceId, source.keyId, source.boundaryFingerprint, ...source.events.flatMap(e => [e.id, e.sessionId]),
    ...(source.evidence?.turns.flatMap(t => [t.id, t.sessionId]) ?? []), ...(source.evidence?.usage.flatMap(u => [u.id, u.sessionId]) ?? []),
    ...(source.evidence?.observations.map(o => o.id) ?? []), ...(native.partitions?.map(p => p.id) ?? [])];
  for (const id of privateIds) if (id) strictEqual(count(actualSection.html, htmlText(id)), 0, "private identity");
  const metadata = (start: number, html: string): ActiveTimeHtmlRegion => Object.freeze({ startByte: Buffer.byteLength(current.slice(0, start)), endByte: Buffer.byteLength(current.slice(0, start) + html), html });
  const navLink = metadata(current.indexOf(link), link + " ");
  const assessmentRow = metadata(current.indexOf(assessment), assessment);
  const section = metadata(actualSection.start, actualSection.html);
  const parts: Buffer[] = []; let position = 0;
  for (const item of [navLink, assessmentRow, section]) {
    ok(item.startByte >= position);
    deepStrictEqual(currentBytes.subarray(item.startByte, item.endByte), Buffer.from(item.html));
    parts.push(currentBytes.subarray(position, item.startByte)); position = item.endByte;
  }
  parts.push(currentBytes.subarray(position));
  return Object.freeze({ normalizedCurrentBytes: Buffer.concat(parts), navLink, assessmentRow, section });
}
