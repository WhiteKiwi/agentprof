import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSourceEvidenceView } from "../src/analysis/source-evidence-views.js";
import { analyzeSourceFailures } from "../src/analysis/source-failures.js";
import { summarizeSource } from "../src/analysis/source-summary.js";
import { EVIDENCE_STATS_OPTIONS, formatEvidenceStatsResult } from "../src/cli/evidence-stats.js";
import { formatStatsResult, runStats } from "../src/cli/stats.js";
import { displayCases } from "./display-batch-cases.js";
import { event, source, stored, id } from "./recovery-fixture.js";
import { binary, bytes, input, invoke, persisted, usage } from "./tokens-support.js";
import { temporaryDirectory } from "./helpers.js";

const legacy = [
  ["listSources", "list-sources"], ["failures", "failures"], ["readRevisits", "read-revisits"],
  ["invocationOverlap", "invocation-overlap"], ["searchRecurrence", "search-recurrence"], ["recovery", "recovery"],
  ["retryOverhead", "retry-overhead"], ["activeTime", "active-time"], ["tokens", "tokens"], ["timeBreakdown", "time-breakdown"],
  ...displayCases.map(c => [c.prop, c.flag] as const),
] as const;
const disabled = Object.fromEntries(EVIDENCE_STATS_OPTIONS.map(([key]) => [key, false]));
const baseline = process.env["AGENTPROF_EVIDENCE_REPORT_BASELINE_BINARY"];
const installed = process.env["AGENTPROF_EVIDENCE_REPORT_INSTALLED_BINARY"];
const partialRecords = () => readFileSync(new URL("fixtures/providers/codex-real-shapes.jsonl", import.meta.url), "utf8")
  .trim().split("\n").map(line => JSON.parse(line) as unknown).concat([{ type: "FICTITIOUS_UNKNOWN_RECORD", payload: {} }]);

describe("evidence views coexist with all predecessor selections", () => {
  const conflicts = EVIDENCE_STATS_OPTIONS.flatMap(([current]) => legacy.map(([prior]) => [current, prior] as const));
  it.each(conflicts)("rejects %s / %s before store access", async (current, prior) => {
    const data = join(temporaryDirectory(), "absent");
    await expect(runStats({ dataDir: data, source: id("source", "selection"), [current]: true, [prior]: true }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(existsSync(data)).toBe(false);
  });
  it.each(legacy)("preserves omitted/false new options for %s", async (prop) => {
    const x = await stored(), before = await bytes(x.data);
    const selection = prop === "listSources" ? { listSources: true } : { source: x.sourceId, [prop]: true };
    const absent = await runStats({ dataDir: x.data, ...selection });
    const off = await runStats({ dataDir: x.data, ...selection, ...disabled });
    for (const json of [false, true]) expect(formatStatsResult(off, json)).toBe(formatStatsResult(absent, json));
    expect(await bytes(x.data)).toEqual(before);
  });
  it.each(EVIDENCE_STATS_OPTIONS)("accepts %s when inherited modes are explicitly false", async (key, view) => {
    const x = await stored(), off = Object.fromEntries(legacy.map(([prior]) => [prior, false]));
    const result = await runStats({ dataDir: x.data, source: x.sourceId, [key]: true, ...off });
    expect(result.mode).toBe("selected_source_evidence_view");
    if (result.mode !== "selected_source_evidence_view") throw Error("unexpected mode");
    expect(result.evidence.view.view).toBe(view);
  });
});

describe("new human context preserves complete native authority", () => {
  it("reports actual ordinary partial Codex context before its eligible 6/6 component fraction", async () => {
    const x = await stored(partialRecords()), before = await bytes(x.data);
    const r = await runStats({ dataDir: x.data, source: x.sourceId, tokenCompleteness: true });
    if (r.mode !== "selected_source_evidence_view") throw Error("unexpected mode");
    const native = summarizeSource(x.source), complete = JSON.stringify(r);
    expect(r.evidence.analysis).toEqual(native);
    expect(r.evidence.view).toEqual(buildSourceEvidenceView({ view: "token-completeness", analysis: native }));
    expect(native.capabilities).toMatchObject({ support: "shape_verified_only", coverage: "partial", unsupportedRecords: 2 });
    expect(r.evidence.view.rows?.[0]?.fractions.componentPresence).toEqual({ numerator: 6, denominator: 6, value: 1 });
    const human = formatStatsResult(r, false);
    for (const part of ["support=shape_verified_only", "Coverage: partial", "unsupported records=2", "ambiguous records=0",
      "state limited=false", "dropped diagnostics=0", "partial_shape_coverage", "aggregationReady=false", "parserResumeReady=false"])
      expect(human).toContain(part);
    expect(human.indexOf("Coverage: partial")).toBeLessThan(human.indexOf("componentPresence:"));
    expect(human).not.toMatch(/FICTITIOUS_|operationKey|errorFingerprint|sourceRef/);
    expect(JSON.stringify(r)).toBe(complete); expect(await bytes(x.data)).toEqual(before);
  });
  it.each(["failureAdmission", "failureTiming", "recoveryDistribution", "retryResolution", "slowCandidates", "slowCoverage"] as const)
    ("copies native support and source limitations for %s", async key => {
      const x = await stored(partialRecords()), r = await runStats({ dataDir: x.data, source: x.sourceId, [key]: true });
      if (r.mode !== "selected_source_evidence_view") throw Error("unexpected mode");
      const human = formatStatsResult(r, false);
      expect(human).toContain("support=shape_verified_only; coverage=partial; unsupported records=2");
      expect(human).toContain("partial_shape_coverage");
      expect(human.indexOf("Source limitations:")).toBeLessThan(human.indexOf("Rows:"));
    });
  it.each(["unavailable", "evidence_absent", "known_empty", "eligible_zero"] as const)
    ("keeps inventory and token evidence distinct for %s", async state => {
      const zero = usage("zero", { counts: { input: 0, output: 0, total: 0, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0 } });
      const snapshot = input(state === "eligible_zero" ? [zero] : []), { evidence: _evidence, ...withoutEvidence } = snapshot;
      const x = await persisted(state === "evidence_absent" ? withoutEvidence : snapshot, state === "unavailable");
      const r = await runStats({ dataDir: x.data, source: x.sourceId, tokenCompleteness: true });
      if (r.mode !== "selected_source_evidence_view") throw Error("unexpected mode");
      const human = formatStatsResult(r, false);
      expect(r.evidence.analysis).toEqual(summarizeSource(x.source));
      if (state === "evidence_absent") {
        expect(human).toContain("suppression=evidence_absent"); expect(human).toContain("stored usage rows=unknown");
        expect(human).toContain("Capabilities availability: unavailable");
      } else if (state === "unavailable") expect(human).toContain("suppression=source_unavailable");
      else expect(human).toContain(`stored usage rows=${state === "eligible_zero" ? 1 : 0}`);
      if (state === "eligible_zero") {
        expect(r.evidence.view.rows?.[0]?.fractions.componentPresence).toEqual({ numerator: 6, denominator: 6, value: 1 });
        expect(human).toContain("Projected row states: eligible_cohort=1");
        expect(summarizeSource(x.source).usage?.[0]?.counts.total).toBe(0);
      } else {
        expect(r.evidence.view.rows).toBeNull(); expect(human).toContain("Projected row states: unavailable");
        expect(human).not.toContain("componentPresence:");
      }
    });
  it("renders native absent capabilities as unavailable and a known empty projection as present_empty", () => {
    for (const absent of [true, false]) {
      const a = analyzeSourceFailures(absent ? { ...source(), evidence: null } : source());
      const human = formatEvidenceStatsResult({ view: buildSourceEvidenceView({ view: "failure-admission", analysis: a }), analysis: a });
      expect(human).toContain(absent ? "Capabilities: unavailable" : "unsupported records=0");
      expect(human).toContain(`Projected row states: ${absent ? "unavailable" : "present_empty"}`);
      expect(human).toContain(absent ? "Rows: unavailable" : "Rows: shown=0/0; omitted=0");
    }
  });
  it("counts every projected state and reason before clipping 4,096 native partitions", () => {
    const events = Array.from({ length: 4096 }, (_, i) => event(`whole-${i}`, i * 2, i * 2 + 1, {
      sessionId: id("session", `whole-${i}`), ...(i === 4095 ? { status: "unknown" as const, executionOutcome: "unknown" as const } : {}),
    }));
    const a = analyzeSourceFailures(source(events)), view = buildSourceEvidenceView({ view: "failure-admission", analysis: a });
    const before = JSON.stringify({ view, analysis: a }), human = formatEvidenceStatsResult({ view, analysis: a });
    expect(view.rows).toHaveLength(4096);
    expect(human).toContain("Projected row states: evaluated=4095; no_eligible_events=1");
    expect(human).toContain("Projected row reasons: unknown_status=1 (row occurrences=1)");
    expect(human.indexOf("Projected row reasons:")).toBeLessThan(human.indexOf("Rows:"));
    expect(human).toContain("Rows: shown=8/4096; omitted=4088");
    expect(human.split("\n").filter(line => line.startsWith("failure-partition-")).length).toBeLessThanOrEqual(8);
    expect(JSON.stringify({ view, analysis: a })).toBe(before);
  });
});

describe.skipIf(!baseline)("genuine immediate main compatibility", () => {
  it.each(legacy)("matches previous %s human and JSON bytes", async (prop, flag) => {
    const x = await stored(), before = await bytes(x.data);
    const selection = prop === "listSources" ? ["stats", `--${flag}`] : ["stats", "--source", x.sourceId, `--${flag}`];
    for (const format of [[], ["--json"]]) expect(invoke(binary, x.data, [...selection, ...format]))
      .toEqual(invoke(baseline!, x.data, [...selection, ...format]));
    expect(await bytes(x.data)).toEqual(before);
  });
});

describe.skipIf(!installed)("actual scripts-disabled installed evidence views", () => {
  it.each(EVIDENCE_STATS_OPTIONS)("matches built complete %s authority and human context", async (key, flag) => {
    const x = await stored(partialRecords()), before = await bytes(x.data);
    const direct = await runStats({ dataDir: x.data, source: x.sourceId, [key]: true });
    for (const format of [[], ["--json"]]) {
      const args = ["stats", "--source", x.sourceId, `--${flag}`, ...format], actual = invoke(installed!, x.data, args);
      expect(actual).toEqual(invoke(binary, x.data, args)); expect(actual.status).toBe(0);
      if (format.length) expect(JSON.parse(actual.stdout).result).toEqual(direct);
      else expect(actual.stdout).toContain("unsupported records=2");
    }
    expect(await bytes(x.data)).toEqual(before);
  });
});
