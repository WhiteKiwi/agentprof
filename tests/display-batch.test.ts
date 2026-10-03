import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { formatStatsResult, runStats, validateStatsArguments } from "../src/cli/stats.js";
import { summarizeSource } from "../src/analysis/source-summary.js";
import * as stores from "../src/db/source-store.js";
import { temporaryDirectory } from "./helpers.js";
import { bytes, binary, invoke, persisted, input as tokenInput, usage, id, sourceId } from "./tokens-support.js";
import { distributions, event } from "./time-breakdown-support.js";
import { displayCases } from "./display-batch-cases.js";

const old = ["failures", "readRevisits", "invocationOverlap", "searchRecurrence", "recovery", "retryOverhead", "activeTime", "tokens", "timeBreakdown"];
const snapshot = () => ({ ...tokenInput([usage("selected"), usage("provisional", { selection: "provisional", finality: "trusted_partial" })]), events: [...distributions(), event("pending", { status: "pending", exitCode: null, executionOutcome: "unknown", durationMs: null, durationScope: "unknown", timingEvidence: "unknown" })] });
describe.each(displayCases)("PR$pr --$flag", entry => {
  it("rejects nonboolean, missing/invalid and all new/old conflicting selections before I/O", () => {
    const dataDir = join(temporaryDirectory(), "absent");
    for (const bad of [null, 0, 1, "false", "true", [], {}]) expect(() => validateStatsArguments({ dataDir, source: sourceId, [entry.prop]: bad } as never)).toThrow();
    for (const selection of [{}, { source: "bad" }, { source: sourceId, listSources: true }, { source: sourceId, codexRoot: ["FICTITIOUS_ROOT"] }, ...old.map(flag => ({ source: sourceId, [flag]: true })), ...displayCases.filter(x => x.prop !== entry.prop).map(x => ({ source: sourceId, [x.prop]: true }))]) expect(() => validateStatsArguments({ dataDir, ...selection, [entry.prop]: true })).toThrow();
    expect(existsSync(dataDir)).toBe(false);
  });
  it("rejects duplicate/value-suffix CLI flags before I/O", () => {
    const data = join(temporaryDirectory(), "absent");
    for (const args of [[`--${entry.flag}`, `--${entry.flag}`], [`--${entry.flag}=false`], [`--${entry.flag}`, "extra"]]) {
      const r = invoke(binary, data, ["--json", "stats", "--source", sourceId, ...args]); expect(r.status).toBe(2); expect(r.stdout).toBe(""); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT");
    }
    expect(existsSync(data)).toBe(false);
  });
  it("uses one pinned read and complete evidence JSON, preserving read-only files", async () => {
    const x = await persisted(snapshot()), before = await bytes(x.data), original = stores.createSourceStore; let reads = 0;
    const spy = vi.spyOn(stores, "createSourceStore").mockImplementation((db, key) => {
      const store = original(db, key); return { ...store, readSource(id) { expect(db.isTransaction).toBe(true); reads++; return store.readSource(id); } };
    });
    try {
      const result = await runStats({ dataDir: x.data, source: x.sourceId, [entry.prop]: true }); expect(result.mode).toBe(entry.mode); expect(reads).toBe(1);
      const parsed = JSON.parse(formatStatsResult(result, true)).result;
      expect(Object.keys(parsed).sort()).toEqual(["mode", [71, 81, 82, 83].includes(entry.pr) ? "analysis" : "summary"].sort());
      if ("summary" in result) expect(parsed).toEqual({ mode: entry.mode, summary: summarizeSource(x.source) });
      else { expect(parsed.analysis.sourceId).toBe(x.sourceId); expect(parsed.analysis.partitions).toBeDefined(); expect(parsed.analysis.sourceFreshnessChecked).toBe(false); expect(parsed.analysis.completedOffset).toBe(100); }
      const human = formatStatsResult(result, false); expect(human).toContain("sourceFreshnessChecked=false"); expect(human).toContain("parserResumeReady=false"); expect(human).toContain("revision="); expect(human).toContain("availability=available"); expect(human).toContain("[0,100)/105"); expect(human).not.toContain("\\n");
      expect(await bytes(x.data)).toEqual(before);
    } finally { spy.mockRestore(); }
  });
  it("absent/false preserves prior selections and nullable evidence", async () => {
    const x = await persisted(snapshot());
    for (const selection of [{ source: x.sourceId }, { listSources: true }, ...old.map(flag => ({ source: x.sourceId, [flag]: true }))]) {
      const a = await runStats({ dataDir: x.data, ...selection }), b = await runStats({ dataDir: x.data, ...selection, [entry.prop]: false });
      for (const json of [false, true]) expect(formatStatsResult(b, json)).toBe(formatStatsResult(a, json));
    }
    const empty = await persisted(tokenInput([])), r = await runStats({ dataDir: empty.data, source: empty.sourceId, [entry.prop]: true });
    expect(formatStatsResult(r, false)).toMatch(/present_empty|unavailable|no_eligible/);
  });
  it("retains all source-wide counts before deterministic six-row clipping", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => usage(`eight-${i}`, { sessionId: id("session", `eight-${i}`) }));
    const events = Array.from({ length: 8 }, (_, i) => event(`eight-${i}`, { sessionId: rows[i]!.sessionId }));
    const x = await persisted({ ...tokenInput(rows), events }), r = await runStats({ dataDir: x.data, source: x.sourceId, [entry.prop]: true }), human = formatStatsResult(r, false);
    expect(human).toContain("events=8"); expect(human).toContain("stored usage rows=8");
    if ([65, 71, 72, 81, 82, 83, 84, 85, 112, 113].includes(entry.pr)) expect(human).toMatch(/showing 6 of 8; omitted=2/);
    if ("summary" in r) { expect(r.summary.durations).toHaveLength(8); expect(r.summary.usage).toHaveLength(8); }
    else if ("analysis" in r) expect(r.analysis.partitions).toHaveLength(8);
  });
});

it("PR65 latency preserves fractional quantiles, overflow means and low-N19/20", async () => {
  const x = await persisted(snapshot()), r = await runStats({ dataDir: x.data, source: x.sourceId, latency: true }), text = formatStatsResult(r, false);
  expect(text).toContain("mean=0.15000000000000002 ms"); expect(text).toContain("mean=unavailable ms"); expect(text).toContain("n=19"); expect(text).toContain("n=20"); expect(text).toContain("low-N=false"); expect(text).toContain("numeric_overflow"); expect(text).toContain("pending=1");
});

it("PR72 independently frozen fields and denominators", async () => {
  const x = await persisted(snapshot()), r = await runStats({ dataDir: x.data, source: x.sourceId, cacheShare: true }), text = formatStatsResult(r, false);
  for (const expected of ["cache read share=0.25", "provisional=1"]) expect(text).toContain(expected);
});

it("PR73 independently frozen fields and denominators", async () => {
  const x = await persisted(snapshot()), r = await runStats({ dataDir: x.data, source: x.sourceId, executionStatus: true }), text = formatStatsResult(r, false);
  for (const expected of ["completed=45; failed=0; cancelled=0; pending=1", "included=45"]) expect(text).toContain(expected);
});

it("PR74 independently frozen fields and denominators", async () => {
  const x = await persisted(snapshot()), r = await runStats({ dataDir: x.data, source: x.sourceId, durationCoverage: true }), text = formatStatsResult(r, false);
  for (const expected of ["terminal candidates=45; included=45", "Duration coverage=1"]) expect(text).toContain(expected);
});

it("PR75 independently frozen fields and denominators", async () => {
  const x = await persisted(snapshot()), r = await runStats({ dataDir: x.data, source: x.sourceId, usageCoverage: true }), text = formatStatsResult(r, false);
  for (const expected of ["observed responses=1; selected rows=1; deduplicated rows=0; excluded rows=1", "provisional=1"]) expect(text).toContain(expected);
});

it("PR81 canonical JSON is complete unchanged native authority", async () => {
  const x = await persisted(snapshot()), authority = (await import("../src/analysis/source-read-revisits.js")).analyzeSourceReadRevisits(x.source), r = await runStats({ dataDir: x.data, source: x.sourceId, readRatio: true });
  expect(JSON.parse(formatStatsResult(r, true)).result).toEqual({ mode: "selected_source_read_ratio", analysis: authority });
});

it("PR82 canonical JSON is complete unchanged native authority", async () => {
  const x = await persisted(snapshot()), authority = (await import("../src/analysis/source-search-recurrence.js")).analyzeSourceSearchRecurrence(x.source), r = await runStats({ dataDir: x.data, source: x.sourceId, searchRatio: true });
  expect(JSON.parse(formatStatsResult(r, true)).result).toEqual({ mode: "selected_source_search_ratio", analysis: authority });
});

it("PR83 canonical JSON is complete unchanged native authority", async () => {
  const x = await persisted(snapshot()), authority = (await import("../src/analysis/source-invocation-overlap.js")).analyzeSourceInvocationOverlap(x.source), r = await runStats({ dataDir: x.data, source: x.sourceId, overlapSummary: true });
  expect(JSON.parse(formatStatsResult(r, true)).result).toEqual({ mode: "selected_source_overlap_summary", analysis: authority });
});

it("PR84 independently frozen fields and denominators", async () => {
  const x = await persisted(snapshot()), r = await runStats({ dataDir: x.data, source: x.sourceId, cacheWriteShare: true }), text = formatStatsResult(r, false);
  for (const expected of ["cache write share=0.0625", "input=80; cache write=5"]) expect(text).toContain(expected);
});

it("PR85 independently frozen fields and denominators", async () => {
  const x = await persisted(snapshot()), r = await runStats({ dataDir: x.data, source: x.sourceId, reasoningShare: true }), text = formatStatsResult(r, false);
  for (const expected of ["reasoning share=0.3333333333333333", "output=12; reasoning output=4"]) expect(text).toContain(expected);
});

it("PR91 independently frozen fields and denominators", async () => {
  const x = await persisted(snapshot()), r = await runStats({ dataDir: x.data, source: x.sourceId, outcomeMix: true }), text = formatStatsResult(r, false);
  for (const expected of ["success: n=45; share=0.9782608695652174", "unknown: n=1; share=0.021739130434782608"]) expect(text).toContain(expected);
});

it("PR92 independently frozen fields and denominators", async () => {
  const x = await persisted(snapshot()), r = await runStats({ dataDir: x.data, source: x.sourceId, timingEvidence: true }), text = formatStatsResult(r, false);
  for (const expected of ["source_reported: n=44; share=0.9777777777777777", "paired_timestamps: n=1; share=0.022222222222222223"]) expect(text).toContain(expected);
});

it("PR93 independently frozen fields and denominators", async () => {
  const x = await persisted(snapshot()), r = await runStats({ dataDir: x.data, source: x.sourceId, durationScope: true }), text = formatStatsResult(r, false);
  for (const expected of ["process_runtime: n=44; share=0.9777777777777777", "item_lifecycle: n=1; share=0.022222222222222223"]) expect(text).toContain(expected);
});

it("PR94 independently frozen fields and denominators", async () => {
  const x = await persisted(snapshot()), r = await runStats({ dataDir: x.data, source: x.sourceId, usageFinality: true }), text = formatStatsResult(r, false);
  for (const expected of ["source_terminal: n=1; share=0.5", "trusted_partial: n=1; share=0.5"]) expect(text).toContain(expected);
});

it("PR95 independently frozen fields and denominators", async () => {
  const x = await persisted(snapshot()), r = await runStats({ dataDir: x.data, source: x.sourceId, capabilities: true }), text = formatStatsResult(r, false);
  for (const expected of ["parser version=1", "support=shape_verified_only", "Observed shape n=1"]) expect(text).toContain(expected);
});

it("PR106 independently frozen fields and denominators", async () => {
  const x = await persisted(snapshot()), r = await runStats({ dataDir: x.data, source: x.sourceId, statusMix: true }), text = formatStatsResult(r, false);
  for (const expected of ["completed: n=45; share=0.9782608695652174", "pending: n=1; share=0.021739130434782608"]) expect(text).toContain(expected);
});

it("PR107 independently frozen fields and denominators", async () => {
  const x = await persisted(snapshot()), r = await runStats({ dataDir: x.data, source: x.sourceId, usageSelection: true }), text = formatStatsResult(r, false);
  for (const expected of ["eligible: n=1; share=0.5", "provisional: n=1; share=0.5"]) expect(text).toContain(expected);
});

it("PR108 independently frozen fields and denominators", async () => {
  const x = await persisted(snapshot()), r = await runStats({ dataDir: x.data, source: x.sourceId, diagnostics: true }), text = formatStatsResult(r, false);
  for (const expected of ["Stored diagnostics=0", "dropped diagnostics=0"]) expect(text).toContain(expected);
});
