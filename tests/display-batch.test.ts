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
