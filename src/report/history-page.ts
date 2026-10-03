import type { SelectedHistoryAnalysis } from "../analysis/source-history.js";
import type { HistoryDay } from "../analysis/history-daily.js";
import type { HistoryExecution } from "../analysis/history-reconcile.js";
import { SafeError } from "../privacy/diagnostics.js";
import { evidenceAlias, evidenceAliases, evidenceBar, evidenceLink, evidencePage, evidenceTable, htmlText, numericText, omissions } from "./evidence-page.js";

export const HISTORY_PAGE_LIMITS = Object.freeze({ series: 12, daysPerSeries: 31, membersPerDay: 8, executions: 64, copies: 16, reasons: 64 });
const keyOf = (d: HistoryDay): string => JSON.stringify([d.provider, d.sessionId, d.intervalScope, d.intervalTimingEvidence]);
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
/** Display projection only. Never rescan, reanalyze, merge partitions or mutate the analysis. */
export function renderHistoryPage(a: SelectedHistoryAnalysis): string {
  const r = a.reconciliation;
  if (a.schema !== "agentprof.selected-history/v1" || r.sources.length > 16 || a.days.length > 32768) throw new SafeError("INVALID_ARGUMENT");
  const sources = [...r.sources].sort((x, y) => compare(x.sourceId, y.sourceId));
  const sourceAliases = evidenceAliases(sources.map(s => s.sourceId), "source");
  const sessionAliases = evidenceAliases([...a.days.map(d => d.sessionId), ...(a.query.sessionId === null ? [] : [a.query.sessionId])], "session");
  const executionIndex = new Map(r.executions.map(e => [e.id, e]));
  const executionAliases = evidenceAliases(executionIndex.keys(), "execution");
  const groups = new Map<string, HistoryDay[]>();
  for (const d of a.days) { const key = keyOf(d), group = groups.get(key); if (group) group.push(d); else groups.set(key, [d]); }
  const series = [...groups].sort(([x], [y]) => compare(x, y)).slice(0, HISTORY_PAGE_LIMITS.series).map(([, days]) => ({
    all: days, shown: [...days].sort((x, y) => compare(x.date, y.date) || compare(x.id, y.id)).slice(0, HISTORY_PAGE_LIMITS.daysPerSeries),
  }));
  const displayedDays = series.flatMap(s => s.shown);
  const selectedExecutions = new Map<string, HistoryExecution>(), dayMembers = new Map<string, readonly string[]>();
  for (const d of displayedDays) {
    const members: string[] = [];
    for (const id of [...d.memberExecutionIds].sort(compare).slice(0, HISTORY_PAGE_LIMITS.membersPerDay)) {
      const e = executionIndex.get(id);
      if (e === undefined || e.state !== "admitted") throw new SafeError("INVALID_ARGUMENT");
      if (selectedExecutions.has(id) || selectedExecutions.size < HISTORY_PAGE_LIMITS.executions) {
        selectedExecutions.set(id, e); members.push(id);
      }
    }
    dayMembers.set(d.id, members);
  }
  const reasonCounts = new Map<string, number>();
  for (const e of r.executions) if (e.state !== "admitted") {
    for (const reason of e.reasons.length ? e.reasons : ["no_positioned_native_observation"]) {
      const key = `${e.state}: ${reason}`; reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
  }
  const reasons = [...reasonCounts].sort(([x], [y]) => compare(x, y)).slice(0, HISTORY_PAGE_LIMITS.reasons);
  const body: string[] = [
    `<nav aria-label="Report sections">${evidenceLink("selection", "Selection")}${evidenceLink("sources", "Sources")}${evidenceLink("reconciliation", "Reconciliation")}${evidenceLink("daily", "Daily observations")}${evidenceLink("evidence", "Evidence")}</nav>`,
    `<section id="selection" class="panel"><h2>Selection and measurement context</h2><dl><dt>UTC period [inclusive, exclusive)</dt><dd>${htmlText(a.query.startInclusive)} → ${htmlText(a.query.endExclusive)}</dd><dt>Daily calendar</dt><dd>Fixed offset ${htmlText(a.query.offset)}; no IANA or daylight-saving conversion.</dd><dt>Session filter</dt><dd>${a.query.sessionId === null ? "All selected session identities" : htmlText(evidenceAlias(sessionAliases, a.query.sessionId))}</dd><dt>Assessment</dt><dd class="state">${htmlText(a.assessment)}</dd></dl><p>No freshness check. Empty days are not filled; unavailable timestamps are not assigned to a day. Daily tokens are unavailable.</p></section>`,
    `<section id="sources"><h2>Selected stored generations</h2>${omissions("Sources", sources.length, sources.length)}<div class="sources">`,
  ];
  for (const s of sources) {
    const alias = evidenceAlias(sourceAliases, s.sourceId);
    body.push(`<article class="panel" id="${alias}"><h3>${alias} · ${htmlText(s.provider)}</h3><dl><dt>Revision / parser version</dt><dd>${s.revision} / ${s.parserVersion}</dd><dt>Stored byte prefix / observed size</dt><dd>[0, ${s.completedOffset}) / ${s.observedSize}</dd><dt>Availability / persisted scope</dt><dd>${htmlText(s.availability)} / ${htmlText(s.persistedScope)}</dd><dt>Native assessment / suppression</dt><dd>${htmlText(s.nativeAssessment)} / ${htmlText(s.suppressionReason ?? "none")}</dd><dt>Parser coverage / unsupported records</dt><dd>${htmlText(s.parserCoverage)} / ${htmlText(s.unsupportedRecords)}</dd><dt>Events / admitted terminals before reconciliation</dt><dd>${s.events} / ${s.admittedTerminals}</dd></dl></article>`);
  }
  body.push(`</div></section><section id="reconciliation" class="panel"><h2>Prefix-wide reconciliation</h2><p>These counts cover entire selected stored prefixes, before the date/session filter. They are not a dated failure rate. Duplicate copies include conflicting copies; they are not all admitted.</p>`,
    evidenceTable("reconciliation-counts", "Canonical identity decisions, before daily selection", ["Decision", "Executions or copies"], Object.entries(r.counts)),
    evidenceTable("exclusion-reasons", "Exclusion reasons; one execution may have several reasons", ["State and reason", "Executions"], reasons),
    omissions("Reason rows", reasons.length, reasonCounts.size),
    `</section><section id="daily"><h2>Dated observations</h2><p>Each series is one provider/session/interval-scope/evidence contract. No cross-series time total is calculated. Completion counts use terminal timestamps; time is clipped to each day. A call may contribute time on a day when it does not complete.</p>`,
    omissions("Series", series.length, groups.size), omissions("Daily partitions", displayedDays.length, a.days.length));
  if (!displayedDays.length) body.push(`<p class="notice">No positioned observations in this selection. This is not proof of zero activity in complete history.</p>`);
  series.forEach((s, si) => {
    const first = s.shown[0]!;
    const name = `${first.provider} · ${evidenceAlias(sessionAliases, first.sessionId)} · ${first.intervalScope} / ${first.intervalTimingEvidence}`;
    const id = `series-${si + 1}`;
    body.push(`<article class="panel series" id="${id}"><h3>${htmlText(name)}</h3>`, omissions("Chronological days in series", s.shown.length, s.all.length),
      evidenceTable(`${id}-days`, "Observed daily intervals in milliseconds; completion counts are a different population", ["Date", "Window ms", "Terminal completions", "Completed", "Failed", "Interval sum ms", "Busy union ms", "Concurrent calls ms", "Concurrent categories ms"],
        s.shown.map(d => [d.date, d.windowEndMs - d.windowStartMs, d.terminalCompletions, d.completedN, d.failedN, numericText(d.intervalLengthSumMs), numericText(d.toolBusyMs), numericText(d.concurrentCallsMs), numericText(d.concurrentCategoriesMs)])),
      `<p>Bars: observed busy union / the full clipped day-window duration. The denominator is not the displayed-row maximum. Blank calendar gaps are not measured zeros.</p><ol class="day-chart">`);
    for (const d of s.shown) body.push(`<li>${htmlText(d.date)}: ${numericText(d.toolBusyMs)} / ${d.windowEndMs - d.windowStartMs} ms${evidenceBar(d.toolBusyMs, d.windowEndMs - d.windowStartMs)}</li>`);
    body.push(`</ol>`);
    s.shown.forEach((d, di) => {
      const members = dayMembers.get(d.id)!;
      body.push(`<details><summary>${htmlText(d.date)}: category time and evidence</summary><p>UTC window: [${htmlText(new Date(d.windowStartMs).toISOString())}, ${htmlText(new Date(d.windowEndMs).toISOString())}). Arithmetic overflow: ${d.arithmeticOverflow}.</p>`,
        evidenceTable(`${id}-day-${di + 1}-categories`, "Exclusive category time; concurrent categories remain separate", ["Category", "Exclusive ms"], Object.entries(d.exclusiveCategoryMs).sort(([x], [y]) => compare(x, y)).map(([name, value]) => [name, numericText(value)])),
        omissions("Member execution links", members.length, d.memberExecutionIds.length),
        `<p class="evidence-links">${members.map(e => evidenceLink(evidenceAlias(executionAliases, e), evidenceAlias(executionAliases, e))).join(" ") || "No displayed member links."}</p></details>`);
    });
    body.push(`</article>`);
  });
  const referencedIds = new Set(displayedDays.flatMap(d => d.memberExecutionIds));
  body.push(`</section><section id="evidence"><h2>Displayed execution provenance</h2><p>Aliases are local to this export. Proof counts retain admission context; opaque keys and proof/event identifiers are deliberately absent from shared HTML. Full original receipts remain in CLI JSON.</p>`,
    omissions("Distinct executions from displayed days", selectedExecutions.size, referencedIds.size));
  for (const [id, e] of [...selectedExecutions].sort(([x], [y]) => compare(x, y))) {
    const alias = evidenceAlias(executionAliases, id), copies = e.copies.slice(0, HISTORY_PAGE_LIMITS.copies);
    body.push(`<details id="${alias}"><summary>${alias}: ${htmlText(e.provider)} / ${htmlText(e.status)} / ${htmlText(e.category)}</summary>`,
      omissions("Copy receipts", copies.length, e.copies.length),
      evidenceTable(`${alias}-copies`, "Selected copy revisions and admitted position proof", ["Source", "Revision", "Native admitted", "Positioned", "Proof count", "Reason"], copies.map(c => [evidenceAlias(sourceAliases, c.sourceId), c.revision, String(c.admitted), String(c.positioned), c.proofIds.length, c.reason ?? "none"])),
      `<p>${copies.map(c => evidenceLink(evidenceAlias(sourceAliases, c.sourceId), evidenceAlias(sourceAliases, c.sourceId))).join(" ")}</p></details>`);
  }
  body.push(`</section>`);
  return evidencePage("Native-call history", "Daily counts, compatible interval measurements and copy provenance from your explicit stored-source selection.", body.join(""), a.limitations);
}
