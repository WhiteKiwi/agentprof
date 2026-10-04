import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFile, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import type { StoredSource } from "../src/db/source-store.js";
import { createSourceStore } from "../src/db/source-store.js";
import { openDatabase } from "../src/db/database.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { runScan } from "../src/cli/scan.js";
import { analyzeSourceActiveTime } from "../src/analysis/source-active-time.js";
import { analyzeSourceExploration } from "../src/analysis/source-exploration.js";
import type { SourceExplorationAnalysis } from "../src/analysis/source-exploration.js";
import { analyzeSelectedHistory } from "../src/analysis/source-history.js";
import { reconcileHistorySources } from "../src/analysis/history-reconcile.js";
import { parseHistoryQuery, HistoryQueryError } from "../src/analysis/history-query.js";
import { bytes, codexMeta, context, disk, encode, record, window } from "./usage-timing-fixture.js";
import type { Provider } from "./usage-timing-fixture.js";
import { migrateHistoricalSchema6Copy, routeDataDirectory } from "./schema6-compatibility.js";
import { htmlText } from "../src/report/evidence-page.js";
import { assertAndStripActiveTimeHtml } from "./active-time-html-compatibility.js";

const providers = ["codex", "claude"] as const;
const current = resolve("dist/agentprof.cjs");
const baseline = process.env.AGENTPROF_USAGE_TIMING_COMPOSITION_BASELINE_BINARY;
const installed = process.env.AGENTPROF_USAGE_TIMING_COMPOSITION_INSTALLED_BINARY;
const epoch = Date.UTC(2026, 9, 3);
const at = (n: number) => new Date(epoch + n).toISOString();
const query = parseHistoryQuery(window);

/** Ordinary inert records: one positioned native call, one native turn and one usage response. */
function nativeRows(provider: Provider): unknown[] {
  if (provider === "codex") return [
    { ...codexMeta, payload: { ...codexMeta.payload, cwd: "/FICTITIOUS_COMPOSITION_ROOT" } },
    { type: "turn_context", payload: { turn_id: "FICTITIOUS_TURN" } },
    { type: "response_item", timestamp: at(0), payload: { type: "function_call", call_id: "FICTITIOUS_CALL", name: "exec_command", arguments: JSON.stringify({ cmd: "rg FICTITIOUS_INERT_QUERY src" }) } },
    { type: "response_item", timestamp: at(1000), payload: { type: "function_call_output", call_id: "FICTITIOUS_CALL", output: { exit_code: 0, output: "FICTITIOUS_INERT_OUTPUT" } } },
    { type: "event_msg", timestamp: at(10000), payload: { type: "task_complete", thread_id: "FICTITIOUS_USAGE_SESSION", turn_id: "FICTITIOUS_TURN", started_at: epoch / 1000, completed_at: (epoch + 10000) / 1000, duration_ms: 8150 } },
    record(provider),
  ];
  return [
    { type: "assistant", uuid: "FICTITIOUS_CALL_UUID", sessionId: "FICTITIOUS_USAGE_SESSION", cwd: "/FICTITIOUS_COMPOSITION_ROOT", timestamp: at(0), message: { id: "FICTITIOUS_MESSAGE", role: "assistant", content: [{ type: "tool_use", id: "FICTITIOUS_CALL", name: "Bash", input: { command: "rg FICTITIOUS_INERT_QUERY src" } }] } },
    { type: "user", uuid: "FICTITIOUS_RESULT_UUID", sessionId: "FICTITIOUS_USAGE_SESSION", cwd: "/FICTITIOUS_COMPOSITION_ROOT", timestamp: at(1000), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "FICTITIOUS_CALL", is_error: false, content: "FICTITIOUS_INERT_OUTPUT" }] } },
    record(provider),
  ];
}
async function fixture(provider: Provider) {
  const x = await disk(provider), rows = nativeRows(provider), copy = join(x.inputRoot, "FICTITIOUS_COPY.jsonl");
  await writeFile(x.path, encode(rows)); await writeFile(copy, encode(rows));
  return { ...x, rows, copy, copyId: context.fingerprint("source", [provider, copy]), provider };
}
async function readSource(data: string, sourceId: string): Promise<StoredSource> {
  return withReadOnlyStore(data, (db, key) => createSourceStore(db, key).readSource(sourceId)!);
}
async function pair(provider: Provider) {
  const x = await fixture(provider);
  expect((await runScan({ ...x.options, [`${provider}Root`]: [x.path, x.copy] })).counts.committed).toBe(2);
  const legacy = await readSource(x.data, x.sourceId), legacyCopy = await readSource(x.data, x.copyId);
  expect((await runScan({ ...x.options, usageTiming: true })).sources[0]!.committedRevision).toBe(2);
  return { ...x, legacy, legacyCopy, timed: await readSource(x.data, x.sourceId) };
}
/** Deliberately malformed consumer inputs; these are never written as future stored contracts. */
function contract(source: StoredSource, parserVersion: number, capabilityVersion = parserVersion): StoredSource {
  return { ...source, parserVersion, evidence: { ...source.evidence!, capabilities: { ...source.evidence!.capabilities, parserVersion: capabilityVersion } } } as StoredSource;
}
function nativeProofIds(source: StoredSource): string[] {
  return source.evidence!.observations.filter(o => o.eventId === source.events[0]!.id && ["call", "result", "poll", "structured"].includes(o.representation)).map(o => o.id).sort();
}
function turnProofIds(source: StoredSource): string[] {
  return source.evidence!.observations.filter(o => o.turnId === source.evidence!.turns[0]!.id && o.representation === "turn").map(o => o.id).sort();
}
function invoke(binary: string, args: string[]) {
  const r = spawnSync(process.execPath, [binary, ...args], { env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
  expect(r.error, `${binary}: ${r.stderr}`).toBeUndefined();
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const scanArgs = (x: Awaited<ReturnType<typeof fixture>>, paths = [x.path], timing = false) => ["scan", "--data-dir", x.data, ...paths.flatMap(p => [`--${x.provider}-root`, p]), ...(timing ? ["--usage-timing"] : []), "--json"];
const historyArgs = (x: Awaited<ReturnType<typeof fixture>>) => ["history", "--data-dir", x.data, "--source", x.sourceId, "--source", x.copyId, "--from", window.from, "--to", window.to, "--offset", window.offset];

const explorationLink = '<a href="#unified-exploration">Exploration</a>';
const slowLink = '<a href="#unified-slow">Slow Tool</a>', timelineLink = '<a href="#unified-timeline">Intervals</a>';
const oldPatternNotice = "The following four-rule section keeps its full original evidence qualifications. Slow Tool is shown above; exploration-thrashing assessment remains outside this layout. Read/search recurrence is not a substitute for that diagnostic. All session/event aliases keep the same meaning throughout this report.";
const newPatternNotice = "The following four-rule section keeps its full original evidence qualifications. Slow Tool and informational exploration are shown separately above; neither adds events to Detected Waste. Read/search recurrence is not a substitute for that diagnostic. All session/event aliases keep the same meaning throughout this report.";
type ReportOutput = Readonly<{ cli: ReturnType<typeof invoke>; html: Buffer }>;
type ReportEnvelope = { schema: unknown; ok: unknown; command: unknown; result: Record<string, unknown> };
const occurrences = (html: string, literal: string) => html.split(literal).length - 1;
function once(html: string, literal: string): void { strictEqual(occurrences(html, literal), 1, literal); }
function region(html: string, opening: string, closing: string) {
  once(html, opening);
  const start = html.indexOf(opening), last = html.indexOf(closing, start + opening.length);
  ok(last >= start + opening.length, opening);
  return { start, end: last + closing.length, html: html.slice(start, last + closing.length) };
}
const tableOpening = (id: string) => `<div class="table-wrap" tabindex="0" role="region" aria-labelledby="${id}-caption"><table>`;
const tableRow = (cells: readonly (string | number | null)[]) => `<tr>${cells.map((value, index) => index === 0
  ? `<th scope="row">${htmlText(value)}</th>` : `<td>${htmlText(value)}</td>`).join("")}</tr>`;
function nativeTable(section: string, id: string, rows: readonly (readonly (string | number | null)[])[]) {
  const table = region(section, tableOpening(id), "</table></div>").html;
  strictEqual(occurrences(table, "<table>"), 1);
  strictEqual(region(table, "<tbody>", "</tbody>").html, `<tbody>${rows.map(tableRow).join("")}</tbody>`);
}
function assertUnifiedHtml(oldBytes: Buffer, currentBytes: Buffer, a: SourceExplorationAnalysis, source: StoredSource) {
  const old = oldBytes.toString("utf8"), rawCurrent = currentBytes.toString("utf8");
  deepStrictEqual(Buffer.from(old, "utf8"), oldBytes); deepStrictEqual(Buffer.from(rawCurrent, "utf8"), currentBytes);
  const nativeActiveTime = analyzeSourceActiveTime(source);
  const activeTime = assertAndStripActiveTimeHtml(oldBytes, currentBytes, nativeActiveTime, source);
  const current = activeTime.normalizedCurrentBytes.toString("utf8");
  deepStrictEqual(Buffer.from(current, "utf8"), activeTime.normalizedCurrentBytes);
  for (const added of [explorationLink, '<section id="unified-exploration">', '<th scope="row">Exploration</th>', newPatternNotice])
    strictEqual(occurrences(old, added), 0, added);
  once(current, explorationLink); once(current, '<th scope="row">Exploration</th>');
  const oldNav = region(old, '<nav aria-label="Unified report sections">', "</nav>").html;
  const currentNav = region(current, '<nav aria-label="Unified report sections">', "</nav>").html;
  const oldLinks = `${slowLink} ${timelineLink}`, currentLinks = `${slowLink} ${explorationLink} ${timelineLink}`;
  once(oldNav, oldLinks); once(currentNav, currentLinks);
  strictEqual(currentNav, oldNav.replace(oldLinks, currentLinks));

  const oldOverview = region(old, tableOpening("unified-assessments"), "</table></div>").html;
  const currentOverview = region(current, tableOpening("unified-assessments"), "</table></div>").html;
  const row = tableRow(["Exploration", a.assessment, a.suppressionReason ?? "none"]);
  once(current, row);
  const tail = "</tbody></table></div>", patternStart = oldOverview.lastIndexOf('<tr><th scope="row">Patterns</th>');
  ok(patternStart >= 0);
  strictEqual(oldOverview.slice(oldOverview.indexOf("</tr>", patternStart) + 5), tail);
  ok(currentOverview.endsWith(row + tail));
  strictEqual(currentOverview.replace(row, ""), oldOverview);
  for (const [page, table] of [[old, oldOverview], [current, currentOverview]])
    once(region(page!, '<section class="panel" id="unified-summary">', "</section>").html, table!);

  const oldSlow = region(old, '<section id="unified-slow">', "</section>");
  const currentSlow = region(current, '<section id="unified-slow">', "</section>");
  const exploration = region(current, '<section id="unified-exploration">', "</section>");
  const oldTimeline = region(old, '<section id="unified-timeline">', "</section>");
  const currentTimeline = region(current, '<section id="unified-timeline">', "</section>");
  strictEqual(oldSlow.end, oldTimeline.start); strictEqual(currentSlow.end, exploration.start);
  strictEqual(exploration.end, currentTimeline.start); strictEqual(currentSlow.html, oldSlow.html);
  strictEqual(occurrences(exploration.html, "<section"), 1);
  once(exploration.html, '<h2>Exploration patterns — informational only</h2>');
  once(exploration.html, `<p>Assessment=${htmlText(a.assessment)}; suppression=${htmlText(a.suppressionReason ?? "none")}; rule=exploration-thrashing / source-prefix-native-v1.</p>`);
  deepStrictEqual(a.thresholds, { windowMs: 600000, minimumLookups: 20, minimumRepeatedSearch: 5, maximumMutations: 1 });
  deepStrictEqual(a.includedEventIds, []);
  nativeTable(exploration.html, "unified-exploration-thresholds", [
    ["Window width ms (both endpoints included)", 600000], ["Minimum completed native lookups", 20],
    ["Minimum same exact native search invocations", 5], ["Maximum intersecting Edit/Write invocations", 1],
    ["Intersecting opaque actions allowed", 0],
  ]);
  const states = new Map<string, number>(), reasons = new Map<string, number>();
  for (const p of a.partitions) {
    states.set(p.status, (states.get(p.status) ?? 0) + 1);
    for (const reason of p.reasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const sorted = (values: Map<string, number>) => [...values].sort(([x], [y]) => x < y ? -1 : x > y ? 1 : 0);
  nativeTable(exploration.html, "unified-exploration-population", [
    ["Session partitions", a.partitions.length], ["Candidate windows", a.candidates === null ? null : a.candidates.length],
    ...sorted(states).map(([state, n]) => [`Session state: ${state}`, n]),
  ]);
  nativeTable(exploration.html, "unified-exploration-reasons", sorted(reasons));
  const sessions = [...new Set([...source.events, ...(source.evidence?.usage ?? []), ...(source.evidence?.turns ?? [])].map(item => item.sessionId))].sort();
  const partitions = [...a.partitions].sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0).slice(0, 12);
  nativeTable(exploration.html, "unified-exploration-partitions", partitions.map(p => {
    const index = sessions.indexOf(p.sessionId); ok(index >= 0);
    return [`session-${index + 1}`, p.status, p.observedCompletedLookupN, p.positionedLookupN, p.excludedLookupN,
      p.mutationN, p.opaqueN, p.unresolvedEventIds.length, p.windowEndpointsEvaluated, p.numericQualifiedWindows,
      p.opaqueBlockedWindows, p.reasons.join(", ") || "none"];
  }));
  once(exploration.html, `<p class="omission">Exploration partitions: shown=${partitions.length}/${a.partitions.length}; omitted=${a.partitions.length - partitions.length}.</p>`);
  // These real predecessor fixtures have one shell call, never twenty native lookups.
  ok(a.candidates === null || a.candidates.length === 0);
  const unavailable = '<p class="notice">Exploration candidates unavailable; not zero findings. See the native assessment and reasons above.</p>';
  const empty = '<p class="omission">Exploration candidates: shown=0/0; omitted=0.</p>';
  once(exploration.html, a.candidates === null ? unavailable : empty);
  strictEqual(occurrences(exploration.html, a.candidates === null ? empty : unavailable), 0);
  strictEqual(occurrences(exploration.html, '<article class="card">'), 0);
  const g = a.guidance;
  once(exploration.html, `<p>${htmlText(g.meaning)} No exploration events or time are added to Detected Waste. An empty candidate list does not establish efficient work.</p>`);
  once(exploration.html, `<dl><dt>Necessary-work counterexample</dt><dd>${htmlText(g.necessaryWorkCounterexample)}</dd><dt>Investigate</dt><dd>${htmlText(g.investigativeAction)}</dd><dt>Matched experiment — suggested, not executed</dt><dd>${htmlText(g.matchedExperiment)}</dd><dt>Quality guardrail</dt><dd>${htmlText(g.qualityGuardrail)}</dd></dl>`);
  for (const limit of g.limitations) once(exploration.html, `<p class="notice">${htmlText(limit)}</p>`);
  once(exploration.html, '<code>agentprof insights --source FULL_SOURCE_ID --exploration --json</code>');
  ok(!/<script|<iframe|<img|h1:[a-f0-9]{32}:|FICTITIOUS_|(?:src|href)="https?:/.test(exploration.html));

  const noticeOpening = '<section class="notice"><h2>Pattern and validation detail</h2><p>';
  const oldNotice = region(old, noticeOpening, "</p></section>").html;
  const currentNotice = region(current, noticeOpening, "</p></section>").html;
  once(old, oldPatternNotice); strictEqual(occurrences(old, newPatternNotice), 0);
  once(current, newPatternNotice); strictEqual(occurrences(current, oldPatternNotice), 0);
  strictEqual(oldNotice, `${noticeOpening}${oldPatternNotice}</p></section>`);
  strictEqual(currentNotice, `${noticeOpening}${newPatternNotice}</p></section>`);
  const remaining = current.replace(currentNav, oldNav).replace(row, "").replace(exploration.html, "")
    .replace(newPatternNotice, oldPatternNotice);
  deepStrictEqual(Buffer.from(remaining, "utf8"), oldBytes);
  return { row, section: exploration.html, activeTime };
}
function publication(envelope: ReportEnvelope, fresh: boolean): Record<string, unknown> {
  strictEqual(envelope.schema, "agentprof.cli/v1"); strictEqual(envelope.command, "report");
  strictEqual(typeof envelope.ok, "boolean");
  deepStrictEqual(Object.keys(envelope), ["schema", "ok", "command", "result"]);
  strictEqual(envelope.result["mode"], fresh ? "fresh_input" : "selected_source");
  const report = fresh ? envelope.result["report"] : envelope.result;
  ok(report !== null && typeof report === "object" && !Array.isArray(report));
  const result = report as Record<string, unknown>;
  strictEqual(result["mode"], "selected_source"); strictEqual(result["layout"], "unified");
  strictEqual(result["status"], "published"); strictEqual(result["published"], true);
  return result;
}
function assertUnifiedCompatibility(old: ReportOutput, current: ReportOutput, a: SourceExplorationAnalysis, source: StoredSource, fresh: boolean) {
  const additions = assertUnifiedHtml(old.html, current.html, a, source);
  const oldEnvelope = JSON.parse(old.cli.stdout) as ReportEnvelope, currentEnvelope = JSON.parse(current.cli.stdout) as ReportEnvelope;
  for (const [output, envelope] of [[old, oldEnvelope], [current, currentEnvelope]] as const) {
    strictEqual(output.cli.stdout, JSON.stringify(envelope) + "\n");
    const report = publication(envelope, fresh), bytes = report["bytes"];
    ok(typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes > 0);
    strictEqual(bytes, output.html.length);
  }
  // Mutate only this parsed inert copy's verified publication-byte field. Its
  // property order and every complete scan/publication/envelope field survive.
  publication(currentEnvelope, fresh)["bytes"] = publication(oldEnvelope, fresh)["bytes"];
  deepStrictEqual({ ...current.cli, stdout: JSON.stringify(currentEnvelope) + "\n" }, old.cli);
  return additions;
}
function assertUnifiedRejectionGuards(old: ReportOutput, current: ReportOutput, a: SourceExplorationAnalysis, source: StoredSource, fresh: boolean, additions: ReturnType<typeof assertUnifiedHtml>) {
  const html = current.html.toString("utf8"), section = additions.section, row = additions.row;
  const withReceipt = (edit: (envelope: ReportEnvelope, report: Record<string, unknown>) => void, output = current): ReportOutput => {
    const envelope = JSON.parse(output.cli.stdout) as ReportEnvelope;
    edit(envelope, publication(envelope, fresh));
    return { ...output, cli: { ...output.cli, stdout: JSON.stringify(envelope) + "\n" } };
  };
  const withHtml = (value: string, output = current): ReportOutput => {
    const bytes = Buffer.from(value, "utf8");
    return { ...withReceipt((_, report) => { report["bytes"] = bytes.length; }, output), html: bytes };
  };
  const movedSection = html.replace(section, "").replace('<section id="unified-slow">', section + '<section id="unified-slow">');
  const movedRow = html.replace(row, "").replace("<tbody>", "<tbody>" + row);
  const noticeOpening = '<section class="notice"><h2>Pattern and validation detail</h2><p>';
  const badHtml = [
    ["missing nav", html.replace(explorationLink, "")], ["duplicate nav", html.replace(explorationLink, explorationLink + explorationLink)],
    ["misplaced nav", html.replace(explorationLink + " ", "").replace(timelineLink, timelineLink + " " + explorationLink)],
    ["missing row", html.replace(row, "")], ["duplicate row", html.replace(row, row + row)], ["misplaced row", movedRow],
    ["wrong native row", html.replace(row, tableRow(["Exploration", "WRONG_NATIVE", a.suppressionReason ?? "none"]))],
    ["missing section", html.replace(section, "")], ["duplicate section", html.replace(section, section + section)], ["misplaced section", movedSection],
    ["nested section", html.replace('<section id="unified-exploration">', '<section id="unified-exploration"><section id="inert-nested"></section>')],
    ["wrong native assessment", html.replace(section, section.replace(`Assessment=${htmlText(a.assessment)}`, "Assessment=WRONG_NATIVE"))],
    ["wrong threshold", html.replace('Minimum completed native lookups</th><td>20</td>', 'Minimum completed native lookups</th><td>21</td>')],
    ["wrong native population", html.replace(`Candidate windows</th><td>${a.candidates === null ? "Unavailable" : "0"}</td>`, 'Candidate windows</th><td>1</td>')],
    ["private identity", html.replace('<section id="unified-exploration">', '<section id="unified-exploration">' + source.sourceId)],
    ["missing notice", html.replace(newPatternNotice, "")], ["duplicate notice", html.replace(newPatternNotice, newPatternNotice + newPatternNotice)],
    ["misplaced notice", html.replace(newPatternNotice, "").replace(noticeOpening, newPatternNotice + noticeOpening)],
    ["old notice", html.replace(newPatternNotice, oldPatternNotice)], ["wrong notice", html.replace(newPatternNotice, "Inert different notice")],
    ["unrelated HTML", html.replace("</head>", "<!-- inert unrelated change --></head>")],
  ] as const;
  // Keep each forged HTML's own byte field correct so these guards exercise
  // content/location validation rather than accidentally failing on its length.
  for (const [name, value] of badHtml) {
    ok(value !== html, name);
    if (name === "wrong native assessment") {
      once(section, `Assessment=${htmlText(a.assessment)}`);
      for (const item of [additions.activeTime.navLink, additions.activeTime.assessmentRow, additions.activeTime.section]) once(value, item.html);
    }
    expect(() => assertUnifiedCompatibility(old, withHtml(value), a, source, fresh), name).toThrow();
  }
  const badReceipts: readonly (readonly [string, ReportOutput])[] = [
    ["missing bytes", withReceipt((_, report) => { delete report["bytes"]; })],
    ["wrong bytes", withReceipt((_, report) => { report["bytes"] = current.html.length + 1; })],
    ["noninteger bytes", withReceipt((_, report) => { report["bytes"] = current.html.length + 0.5; })],
    ["wrong revision", withReceipt((_, report) => { report["revision"] = Number(report["revision"]) + 1; })],
    ["unrelated receipt", withReceipt(envelope => { envelope.result["inertExtra"] = true; })],
    ["wrong bytes path", withReceipt((envelope, report) => { delete report["bytes"]; envelope.result[fresh ? "bytes" : "report"] = fresh ? current.html.length : { bytes: current.html.length }; })],
    ["publication key order", withReceipt((envelope, report) => {
      const reordered = Object.fromEntries(Object.entries(report).reverse());
      if (fresh) envelope.result["report"] = reordered; else envelope.result = reordered;
    })],
    ["envelope key order", { ...current, cli: { ...current.cli, stdout: (() => { const e = JSON.parse(current.cli.stdout); return JSON.stringify({ ok: e.ok, schema: e.schema, command: e.command, result: e.result }) + "\n"; })() } }],
    ["duplicate JSON key", { ...current, cli: { ...current.cli, stdout: current.cli.stdout.replace('{"schema":', '{"schema":"agentprof.cli/v1","schema":') } }],
    ["stdout whitespace", { ...current, cli: { ...current.cli, stdout: " " + current.cli.stdout } }],
    ["stdout trailing text", { ...current, cli: { ...current.cli, stdout: current.cli.stdout + "inert\n" } }],
    ["status", { ...current, cli: { ...current.cli, status: current.cli.status === 0 ? 1 : 0 } }],
    ["stderr", { ...current, cli: { ...current.cli, stderr: "inert stderr\n" } }],
  ];
  for (const [name, value] of badReceipts) expect(() => assertUnifiedCompatibility(old, value, a, source, fresh), name).toThrow();
  expect(() => assertUnifiedCompatibility(withReceipt((_, report) => { report["bytes"] = old.html.length + 1; }, old), current, a, source, fresh)).toThrow();
  expect(() => assertUnifiedCompatibility(withHtml(old.html.toString("utf8").replace(slowLink, slowLink + " " + explorationLink), old), current, a, source, fresh)).toThrow();
}

it.each(providers)("%s ordinary replay preserves one mixed-mode execution and every native proof", async provider => {
  const x = await pair(provider), before = await bytes(x.data);
  expect([x.legacy.parserVersion, x.timed.parserVersion]).toEqual(provider === "codex" ? [1, 2] : [2, 3]);
  expect(x.timed.events).toEqual(x.legacy.events);
  expect(x.timed.evidence!.turns).toEqual(x.legacy.evidence!.turns);
  expect(x.timed.evidence!.usage).toEqual(x.legacy.evidence!.usage);
  const history = analyzeSelectedHistory([x.timed, x.legacyCopy], query), r = history.reconciliation;
  expect(r.counts).toEqual({ eventCopies: 2, canonicalExecutions: 1, duplicateCopies: 1, admittedExecutions: 1, conflictingExecutions: 0, excludedExecutions: 0, unpositionedExecutions: 0 });
  expect(r.sources.map(s => s.parserVersion).sort()).toEqual(provider === "codex" ? [1, 2] : [2, 3]);
  const copies = r.executions[0]!.copies;
  for (const source of [x.timed, x.legacyCopy]) expect(copies.find(c => c.sourceId === source.sourceId)).toMatchObject({ revision: source.revision, admitted: true, positioned: true, proofIds: nativeProofIds(source), reason: null });
  expect(history.days).toHaveLength(1);
  expect(history.days[0]).toMatchObject({ terminalCompletions: 1, completedN: 1, toolBusyMs: 1000 });
  expect(analyzeSelectedHistory([x.legacyCopy, x.timed], query)).toEqual(history);
  await rm(x.inputRoot, { recursive: true });
  expect(analyzeSelectedHistory([await readSource(x.data, x.sourceId), await readSource(x.data, x.copyId)], query)).toEqual(history);
  expect(await bytes(x.data)).toEqual(before);
});

it("Codex1/2 replay retains the exact native 10000ms union/span and full turn membership", async () => {
  const x = await pair("codex"), legacy = analyzeSourceActiveTime(x.legacy), timed = analyzeSourceActiveTime(x.timed);
  expect(legacy.partitions).toEqual(timed.partitions);
  expect(timed).toMatchObject({ assessment: "evaluated", summary: { eligibleTurns: 1, excludedTurns: 0, partitions: 1 }, partitions: [{ turnN: 1, activeTimeMs: 10000, observedSpanMs: 10000, turnIds: [x.timed.evidence!.turns[0]!.id], turnEvidence: [{ evidenceObservationIds: turnProofIds(x.timed) }] }] });
  expect(x.timed.evidence!.turns[0]!.durationMs).toBe(8150);
  const changedUsage = { ...x.timed, evidence: { ...x.timed.evidence!, observations: x.timed.evidence!.observations.map(o => o.representation === "usage" ? { ...o, usageObservedAt: "2099-01-01T00:00:00.000Z" } : o) } };
  expect(analyzeSourceActiveTime(changedUsage).partitions).toEqual(timed.partitions);
});

it.each(providers)("%s future native contract does not become a timestamp alias", async provider => {
  const x = await pair(provider), future = contract(x.timed, provider === "codex" ? 4 : 5);
  const r = analyzeSelectedHistory([x.legacyCopy, future], query);
  expect(r.reconciliation.executions[0]).toMatchObject({ state: "conflict", interval: null });
  expect(r.reconciliation.executions[0]!.reasons).toContain("semantic_or_contract_conflict");
  expect(r.reconciliation.sources.find(s => s.sourceId === future.sourceId)!.parserVersion).toBe(future.parserVersion);
  expect(r.days).toEqual([]);
});
it("Claude1 remains distinct from the explicit Claude2/3 native pair", async () => {
  const x = await pair("claude"), r = reconcileHistorySources([x.legacyCopy, contract(x.timed, 1)]);
  expect(r.counts.conflictingExecutions).toBe(1);
  expect(r.executions[0]!.reasons).toContain("semantic_or_contract_conflict");
});
it.each(providers)("%s matching native signature cannot rescue a header/capability mismatch", async provider => {
  const x = await pair(provider), malformed = contract(x.timed, x.timed.parserVersion, x.legacy.parserVersion);
  const r = analyzeSelectedHistory([x.legacyCopy, malformed], query);
  expect(r.reconciliation.executions[0]!.reasons).toContain("copy_admission_disagreement");
  expect(r.reconciliation.executions[0]!.copies.find(c => c.sourceId === malformed.sourceId)!.admitted).toBe(false);
  expect(r.days).toEqual([]);
});
for (const provider of providers) it.each(["duration", "status", "session", "provider"] as const)(`${provider} alias still withholds changed %s event fields before query filtering`, async field => {
  const x = await pair(provider), e = x.timed.events[0]!;
  const changed = { ...x.timed, events: [{ ...e, ...(field === "duration" ? { durationMs: e.durationMs! + 1 }
    : field === "status" ? { status: "failed" as const, executionOutcome: "error" as const }
    : field === "provider" ? { provider: provider === "codex" ? "claude" as const : "codex" as const }
    : { sessionId: context.fingerprint("session", ["FICTITIOUS_OTHER_SESSION"]) }) }] };
  const r = analyzeSelectedHistory([x.legacyCopy, changed], { ...query, sessionId: x.legacyCopy.events[0]!.sessionId });
  expect(r.reconciliation.counts.conflictingExecutions).toBe(1);
  expect(r.reconciliation.executions[0]!.reasons).toContain("semantic_or_contract_conflict");
  expect(r.days).toEqual([]);
});
for (const provider of providers) it.each(["missing proof", "contradictory proof", "unavailable"] as const)(`${provider} alias keeps %s admission disagreement withheld`, async kind => {
  const x = await pair(provider), id = x.timed.events[0]!.id;
  const changed = kind === "unavailable" ? { ...x.timed, availability: "unavailable" as const }
    : { ...x.timed, evidence: { ...x.timed.evidence!, observations: kind === "missing proof"
      ? x.timed.evidence!.observations.filter(o => o.eventId !== id)
      : x.timed.evidence!.observations.map(o => o.eventId === id ? { ...o, origin: "wrapper" as const } : o) } };
  const r = analyzeSelectedHistory([x.legacyCopy, changed], query);
  expect(r.reconciliation.counts.conflictingExecutions).toBe(1);
  expect(r.reconciliation.executions[0]!.reasons).toContain("copy_admission_disagreement");
  expect(r.days).toEqual([]);
});
it.each(providers)("%s alias retains admission while contradictory call-position proof stays unpositioned", async provider => {
  const x = await pair(provider);
  const changed = { ...x.timed, evidence: { ...x.timed.evidence!, observations: x.timed.evidence!.observations.map(o => o.representation === "call" ? { ...o, turnId: context.fingerprint("turn", ["FICTITIOUS_OTHER_TURN"]) } : o) } };
  const r = analyzeSelectedHistory([x.legacyCopy, changed], query), execution = r.reconciliation.executions[0]!;
  expect(execution.copies.every(c => c.admitted)).toBe(true);
  expect(execution).toMatchObject({ state: "unpositioned", interval: null });
  expect(execution.reasons).toContain("contradictory_turn_proof");
  expect(r.days).toEqual([]);
});
it.each(["normalizationVersion", "keyVersion", "keyId"] as const)("native alias never bypasses mixed %s selection rejection", async field => {
  const x = await pair("codex"), changed = { ...x.timed, [field]: field === "keyId" ? "8".repeat(32) : 2 };
  expect(() => reconcileHistorySources([x.legacyCopy, changed])).toThrow(HistoryQueryError);
});
it.each([[4, 4], [2, 1], [1, 2]] as const)("Active Time rejects Codex header%i/capability%i instead of inferring supported timing", async (header, capability) => {
  const x = await pair("codex"), r = analyzeSourceActiveTime(contract(x.timed, header, capability));
  expect(r).toMatchObject({ assessment: "unavailable", activeTimeAssessmentReason: "unsupported_parser_contract", summary: { eligibleTurns: null, excludedTurns: null, partitions: null }, partitions: null });
});
it("Claude3 remains unsupported for native turn Active Time", async () => {
  const x = await pair("claude");
  expect(analyzeSourceActiveTime(x.timed)).toMatchObject({ assessment: "unavailable", activeTimeAssessmentReason: "unsupported_provider", partitions: null });
});
it.each(["missing", "contradictory"] as const)("Codex2 keeps %s native terminal turn proof excluded", async kind => {
  const x = await pair("codex"), changed = { ...x.timed, evidence: { ...x.timed.evidence!, observations: kind === "missing"
    ? x.timed.evidence!.observations.filter(o => o.representation !== "turn")
    : x.timed.evidence!.observations.map(o => o.representation === "turn" ? { ...o, transportStatus: "cancelled" as const } : o) } };
  expect(analyzeSourceActiveTime(changed)).toMatchObject({ assessment: "no_eligible_turns", summary: { eligibleTurns: 0, excludedTurns: 1, partitions: 0 }, exclusions: { [kind === "missing" ? "missingTerminalProof" : "contradictoryTerminalProof"]: 1 }, partitions: [] });
});

/** These controls need authentic external artifacts; core semantic regressions above always run in CI. */
it.runIf(Boolean(baseline)).each(providers)("%s genuine current-main sealed generation keeps default bytes and real replay semantics", async provider => {
  const original = await fixture(provider), historicalArgs = scanArgs(original, [original.path, original.copy]);
  const first = invoke(baseline!, historicalArgs);
  expect(first.status, first.stderr).toBe(provider === "codex" ? 0 : 1);
  expect(JSON.parse(first.stdout).result.counts.committed).toBe(2);
  const compatibility = await migrateHistoricalSchema6Copy(baseline!, original.data, join(original.root, "migrated-copy"));
  const x = { ...original, data: compatibility.copied, options: { ...original.options, dataDir: compatibility.copied } };
  const originalArgs = routeDataDirectory(historicalArgs, x.data);
  const legacy = await readSource(x.data, x.sourceId);
  expect(legacy.parserVersion).toBe(provider === "codex" ? 1 : 2);
  expect(legacy.evidence!.observations.every(o => !Object.hasOwn(o, "usageObservedAt"))).toBe(true);
  const db = await openDatabase(x.data);
  try { expect(createSourceStore(db, legacy.keyId).readSourceForIngestion(x.sourceId, context).checkpoint).not.toBeNull(); }
  finally { db.close(); }
  const before = await bytes(x.data);
  expect(invoke(current, originalArgs)).toEqual(invoke(baseline!, historicalArgs));
  const help = invoke(baseline!, ["stats", "--help"]);
  expect(help.status).toBe(0); expect(invoke(current, ["stats", "--help"])).toEqual(help);
  const flags = [...help.stdout.matchAll(/^\s{2}--([a-z-]+)\s{2,}/gm)].map(m => m[1]!).filter(f => f !== "list-sources");
  const selections = [null, ...flags]; // The default summary plus45 explicit views make46 selections.
  expect(selections).toHaveLength(46);
  for (const flag of selections) for (const json of [false, true]) {
    const args = ["stats", "--data-dir", x.data, "--source", x.sourceId, ...(flag === null ? [] : [`--${flag}`]), ...(json ? ["--json"] : [])];
    const old = invoke(baseline!, routeDataDirectory(args, original.data)); expect(old.status, old.stderr).toBe(0); expect(invoke(current, args)).toEqual(old);
  }
  for (const json of [false, true]) {
    const args = ["stats", "--data-dir", x.data, "--list-sources", ...(json ? ["--json"] : [])];
    expect(invoke(current, args)).toEqual(invoke(baseline!, routeDataDirectory(args, original.data)));
  }
  for (const command of ["insights", "patterns"]) for (const json of [false, true]) {
    const args = [command, "--data-dir", x.data, "--source", x.sourceId, ...(json ? ["--json"] : [])];
    const old = invoke(baseline!, routeDataDirectory(args, original.data)); expect(old.status, old.stderr).toBe(0); expect(invoke(current, args)).toEqual(old);
  }
  for (const json of [false, true]) expect(invoke(current, [...historyArgs(x), ...(json ? ["--json"] : [])])).toEqual(invoke(baseline!, routeDataDirectory([...historyArgs(x), ...(json ? ["--json"] : [])], original.data)));
  for (const fresh of [false, true]) for (const unified of [false, true]) {
    const output = join(x.root, `preserved-${fresh}-${unified}.html`);
    const args = ["report", "--data-dir", x.data, ...(fresh ? ["--provider", provider, "--input", x.path] : ["--source", x.sourceId]), ...(unified ? ["--unified"] : []), "--output", output, "--json"];
    const old = invoke(baseline!, routeDataDirectory(args, original.data)); expect([0, 1]).toContain(old.status);
    const html = await readFile(output); await unlink(output);
    const actual = invoke(current, args), actualHtml = await readFile(output);
    if (unified) {
      const native = analyzeSourceExploration(legacy), prior = { cli: old, html }, candidate = { cli: actual, html: actualHtml };
      const additions = assertUnifiedCompatibility(prior, candidate, native, legacy, fresh);
      assertUnifiedRejectionGuards(prior, candidate, native, legacy, fresh, additions);
    } else { expect(actual).toEqual(old); expect(actualHtml).toEqual(html); }
    if (installed) {
      await unlink(output);
      expect(invoke(installed, args)).toEqual(actual); expect(await readFile(output)).toEqual(actualHtml);
    }
  }
  expect(await bytes(x.data)).toEqual(before);
  compatibility.assertUnchanged();
  expect(JSON.parse(invoke(current, scanArgs(x, [x.path], true)).stdout).result.sources[0].committedRevision).toBe(2);
  compatibility.assertOriginalUnchanged();
  const timed = await readSource(x.data, x.sourceId);
  expect(timed.events).toEqual(legacy.events); expect(timed.evidence!.turns).toEqual(legacy.evidence!.turns); expect(timed.evidence!.usage).toEqual(legacy.evidence!.usage);
  expect(timed.evidence!.observations.map(({ usageObservedAt: _, ...o }) => o)).toEqual(legacy.evidence!.observations);
  const r = analyzeSelectedHistory([timed, await readSource(x.data, x.copyId)], query);
  expect(r.reconciliation.counts.admittedExecutions).toBe(1); expect(r.reconciliation.counts.conflictingExecutions).toBe(0);
  if (provider === "codex") expect(analyzeSourceActiveTime(timed).partitions).toEqual(analyzeSourceActiveTime(legacy).partitions);
  const unchanged = await bytes(x.data);
  expect(JSON.parse(invoke(current, scanArgs(x, [x.path], true)).stdout).result.counts.unchanged).toBe(1); expect(await bytes(x.data)).toEqual(unchanged);
  compatibility.assertOriginalUnchanged();
  await appendFile(x.path, encode([record(provider, "FICTITIOUS_APPEND_RESPONSE", "2026-10-03T15:00:00.000Z", 20)]));
  expect(JSON.parse(invoke(current, scanArgs(x, [x.path], true)).stdout).result.sources[0].committedRevision).toBe(3);
  compatibility.assertOriginalUnchanged();
  expect((await readSource(x.data, x.sourceId)).evidence!.observations.filter(o => o.representation === "usage").map(o => o.usageObservedAt)).toEqual(["2026-10-03T14:59:59.000Z", "2026-10-03T15:00:00.000Z"]);
  expect(JSON.parse(invoke(current, scanArgs(x)).stdout).result.sources[0].committedRevision).toBe(4);
  expect((await readSource(x.data, x.sourceId)).evidence!.observations.every(o => !Object.hasOwn(o, "usageObservedAt"))).toBe(true);
  compatibility.assertOriginalUnchanged();
}, 60000);

it.runIf(Boolean(installed))("actual installed artifact preserves both providers' mixed native copies and Codex Active Time", async () => {
  for (const provider of providers) {
    const x = await fixture(provider);
    expect(JSON.parse(invoke(current, scanArgs(x, [x.path, x.copy])).stdout).result.counts.committed).toBe(2);
    const before = await bytes(x.data);
    expect(invoke(installed!, scanArgs(x, [x.path, x.copy]))).toEqual(invoke(current, scanArgs(x, [x.path, x.copy])));
    expect(await bytes(x.data)).toEqual(before);
    expect(JSON.parse(invoke(installed!, scanArgs(x, [x.path], true)).stdout).result.sources[0].committedRevision).toBe(2);
    const sealed = await bytes(x.data), args = [...historyArgs(x), "--json"];
    const native = invoke(installed!, args); expect(native.status, native.stderr).toBe(0); expect(native).toEqual(invoke(current, args));
    expect(JSON.parse(native.stdout).result.reconciliation.counts).toMatchObject({ admittedExecutions: 1, conflictingExecutions: 0 });
    const tokens = invoke(installed!, [...args, "--tokens"]); expect(tokens.status, tokens.stderr).toBe(0); expect(tokens).toEqual(invoke(current, [...args, "--tokens"]));
    expect(JSON.parse(tokens.stdout).result.days).toHaveLength(1);
    if (provider === "codex") {
      const activeArgs = ["stats", "--data-dir", x.data, "--source", x.sourceId, "--active-time", "--json"];
      const active = invoke(installed!, activeArgs); expect(active.status, active.stderr).toBe(0); expect(active).toEqual(invoke(current, activeArgs));
      expect(JSON.parse(active.stdout).result.analysis.partitions[0]).toMatchObject({ activeTimeMs: 10000, observedSpanMs: 10000, turnN: 1 });
    }
    await rm(x.inputRoot, { recursive: true }); expect(invoke(installed!, args)).toEqual(native); expect(await bytes(x.data)).toEqual(sealed);
  }
}, 60000);
