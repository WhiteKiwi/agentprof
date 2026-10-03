import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { buildSourceEvidenceView, evidenceFraction } from "../src/analysis/source-evidence-views.js";
import { EVIDENCE_STATS_OPTIONS, formatEvidenceStatsResult, validateEvidenceStatsOptions } from "../src/cli/evidence-stats.js";
import { runStats, formatStatsResult, validateStatsArguments } from "../src/cli/stats.js";
import { analyzeSourceRecovery } from "../src/analysis/source-recovery.js";
import { analyzeSourceFailures } from "../src/analysis/source-failures.js";
import { summarizeSource } from "../src/analysis/source-summary.js";
import * as recovery from "../src/analysis/source-recovery.js";
import * as stores from "../src/db/source-store.js";
import type { UsageCohort } from "../src/analysis/source-summary.js";
import { bytes, stored, source, event, success, id } from "./recovery-fixture.js";

const selector = id("source", "selected");
const selected = (key: string) => ({ source: selector, [key]: true });
const nativeFlags = ["failures", "readRevisits", "invocationOverlap", "searchRecurrence", "recovery", "listSources"];

describe("evidence fractions and validation", () => {
  it.each([
    [0, 4, 0], [1, 2, 0.5], [4, 4, 1], [0, 0, null], [null, 2, null], [1, null, null],
    [-1, 2, null], [3, 2, null], [0.5, 2, null], [1, Infinity, null], [NaN, 1, null],
    [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1, null],
  ])("retains fraction %s/%s as %s", (n, d, expected) => {
    expect(evidenceFraction(n, d).value).toBe(expected);
    expect(Object.isFrozen(evidenceFraction(n, d))).toBe(true);
  });
  it("retains counts while withholding an unavailable assessment", () => {
    expect(evidenceFraction(2, 2, false)).toEqual({ numerator: 2, denominator: 2, value: null });
  });
  it.each(EVIDENCE_STATS_OPTIONS)("selects %s and rejects a missing source", (key, view) => {
    expect(validateEvidenceStatsOptions(selected(key))).toBe(view);
    expect(() => validateStatsArguments({ [key]: true })).toThrow();
    expect(validateEvidenceStatsOptions({ [key]: false })).toBeNull();
  });
  const pairs = EVIDENCE_STATS_OPTIONS.flatMap(([a], i) => EVIDENCE_STATS_OPTIONS.slice(i + 1).map(([b]) => [a, b] as const));
  it.each(pairs)("rejects conflicting new options %s / %s", (a, b) => {
    expect(() => validateStatsArguments({ source: selector, [a]: true, [b]: true })).toThrow();
  });
  const inherited = EVIDENCE_STATS_OPTIONS.flatMap(([a]) => nativeFlags.map(b => [a, b] as const));
  it.each(inherited)("rejects inherited conflict %s / %s", (a, b) => {
    expect(() => validateStatsArguments({ source: selector, [a]: true, [b]: true })).toThrow();
  });
  it.each(EVIDENCE_STATS_OPTIONS)("rejects non-boolean %s before accessing storage", (key) => {
    for (const bad of [null, 1, "true", [], {}]) expect(() => validateStatsArguments({ source: selector, [key]: bad })).toThrow();
  });
});

describe("projections preserve native measurement meanings", () => {
  it("keeps resolved-only 5000 ms quantiles and a separate unresolved chain", () => {
    const a = analyzeSourceRecovery(source([event("f", 0, 1000), event("s", 5000, 6000, success), event("f2", 7000, 8000)]));
    const before = JSON.stringify(a), v = buildSourceEvidenceView({ view: "recovery-distribution", analysis: a });
    expect(v.summary).toMatchObject({ resolvedChains: 1, unresolvedChains: 1 });
    expect(v.rows?.[0]?.values).toMatchObject({ n: 1, p50Ms: 5000, p95Ms: 5000, lowSampleP95: true });
    const resolution = buildSourceEvidenceView({ view: "retry-resolution", analysis: a });
    expect(resolution.rows?.[0]?.fractions.observedResolution).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(JSON.stringify(a)).toBe(before); expect(Object.isFrozen(v.rows?.[0]?.values)).toBe(true);
  });
  it("does not turn provenance-unresolved native partitions into zero coverage", () => {
    const e = event("missing-proof", 0, 1000), a = analyzeSourceFailures(source([e], []));
    const v = buildSourceEvidenceView({ view: "failure-admission", analysis: a });
    expect(v.rows?.[0]?.fractions.admission.value).toBeNull();
    expect(v.rows?.[0]?.values.unresolvedProvenance).toBeGreaterThan(0);
  });
  it("preserves failure timing numerator and all untimed exclusions", () => {
    const a = analyzeSourceFailures(source([event("timed", 0, 1000), event("untimed", 2000, 3000,
      { durationMs: null, timingEvidence: "unknown", durationScope: "unknown" })]));
    const v = buildSourceEvidenceView({ view: "failure-timing", analysis: a });
    expect(v.rows?.[0]?.fractions.timing).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(v.rows?.[0]?.reasons).toContain("missing_duration=1");
  });
  it.each(["codex", "claude"] as const)("uses applicable %s token components, not a universal seven-field score", provider => {
    const c: UsageCohort = { sessionId: id("session", provider), provider,
      mapping: provider === "codex" ? "openai_responses" : "anthropic_messages", finality: "source_terminal",
      observedResponses: 1, usageIds: [id("event", "usage")], counts: { input: 100, output: 20, total: 120,
        cachedInput: 20, cacheWriteInput: 10, reasoningOutput: provider === "codex" ? 5 : null,
        uncachedInput: provider === "claude" ? 70 : null }, overflowComponents: [], limitations: [] };
    const a = { ...summarizeSource(source()), provider, usage: [c] };
    const v = buildSourceEvidenceView({ view: "token-completeness", analysis: a });
    expect(v.rows?.[0]?.fractions.componentPresence).toEqual({ numerator: 6, denominator: 6, value: 1 });
    expect(v.rows?.[0]?.values.inapplicableComponent).toBe(provider === "codex" ? "uncachedInput" : "reasoningOutput");
    const missing = { ...a, usage: [{ ...c, counts: { ...c.counts, cachedInput: null }, overflowComponents: ["cachedInput" as const] }] };
    const r = buildSourceEvidenceView({ view: "token-completeness", analysis: missing });
    expect(r.rows?.[0]?.fractions.componentPresence).toEqual({ numerator: 5, denominator: 6, value: 5 / 6 });
    expect(r.rows?.[0]?.values.overflowComponents).toBe("cachedInput");
  });
  it("keeps suppressed source rows unavailable", () => {
    const a = analyzeSourceFailures({ ...source([event("f", 0, 1000)]), availability: "unavailable" });
    const v = buildSourceEvidenceView({ view: "failure-admission", analysis: a });
    expect(v.rows).toBeNull(); expect(v.suppressionReason).toBe("source_unavailable");
    expect(formatEvidenceStatsResult({ view: v, analysis: a })).toContain("Rows: unavailable");
  });
  it("bounds human rows while retaining complete structured native evidence", () => {
    const es = Array.from({ length: 12 }, (_, i) => event(`f-${i}`, i * 2000, i * 2000 + 1000,
      { sessionId: id("session", `session-${i}`) }));
    const a = analyzeSourceFailures(source(es)), v = buildSourceEvidenceView({ view: "failure-admission", analysis: a });
    const r = { view: v, analysis: a }, human = formatEvidenceStatsResult(r);
    expect(v.rows).toHaveLength(12); expect(human).toContain("shown=8/12; omitted=4");
    expect(JSON.stringify(r)).toContain(a.partitions[0]!.terminalEventIds[0]!);
    expect(JSON.stringify(r)).not.toMatch(/FICTITIOUS_|operationKey|errorFingerprint|sourceRef/);
  });
  it("does not mutate caller-owned evidence arrays", () => {
    const a = analyzeSourceRecovery(source([event("f", 0, 1000), event("s", 5000, 6000, success)]));
    const native = structuredClone(a), before = JSON.stringify(native);
    const v = buildSourceEvidenceView({ view: "retry-resolution", analysis: native });
    expect(JSON.stringify(native)).toBe(before); expect(Object.isFrozen(native.groups)).toBe(false);
    expect(Object.isFrozen(v.rows)).toBe(true);
  });
});

function claudeRecords() {
  return ["Read", "Read", "Grep", "Grep"].flatMap((name, i) => [
    { type: "assistant", uuid: `a-${i}`, timestamp: `2026-10-03T00:00:0${i * 2}.000Z`, sessionId: "FICTITIOUS_EVIDENCE_SESSION",
      cwd: "/FICTITIOUS_EVIDENCE_ROOT", version: "2.1.241", isSidechain: false,
      message: { id: `m-${i}`, role: "assistant", content: [{ type: "tool_use", id: `t-${i}`, name,
        input: name === "Read" ? { file_path: "/FICTITIOUS_EVIDENCE_ROOT/a.ts" } : { pattern: "FICTITIOUS_QUERY", path: "/FICTITIOUS_EVIDENCE_ROOT", output_mode: "content" } }] } },
    { type: "user", uuid: `u-${i}`, timestamp: `2026-10-03T00:00:0${i * 2 + 1}.000Z`, sessionId: "FICTITIOUS_EVIDENCE_SESSION", isSidechain: false,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t-${i}`, is_error: false, content: "FICTITIOUS_RESULT" }] } },
  ]);
}

describe("stored inputs and real CLI integration", () => {
  it.each(EVIDENCE_STATS_OPTIONS)("reads a deleted-input snapshot through %s", async (key, view) => {
    const x = await stored(), before = await bytes(x.data);
    const r = await runStats({ dataDir: x.data, source: x.sourceId, [key]: true });
    expect(r.mode).toBe("selected_source_evidence_view");
    if (r.mode !== "selected_source_evidence_view") throw Error("unexpected mode");
    expect(r.evidence.view.view).toBe(view); expect(r.evidence.analysis.sourceId).toBe(x.sourceId);
    const json = formatStatsResult(r, true), human = formatStatsResult(r, false);
    expect(JSON.parse(json).result).toEqual(r); expect(json).not.toContain('"text":');
    expect(human).toContain(view); expect(json + human).not.toMatch(/FICTITIOUS_|operationKey|errorFingerprint|sourceRef/);
    expect(await bytes(x.data)).toEqual(before);
  });
  it("shows actual Claude Read/search identity and positioned invocation coverage", async () => {
    const x = await stored(claudeRecords(), "claude"), before = await bytes(x.data);
    for (const key of ["readIdentity", "searchIdentity", "boundaryCoverage"] as const) {
      const r = await runStats({ dataDir: x.data, source: x.sourceId, [key]: true });
      if (r.mode !== "selected_source_evidence_view") throw Error("unexpected mode");
      expect(r.evidence.view.rows?.length).toBeGreaterThan(0);
      const fraction = Object.values(r.evidence.view.rows![0]!.fractions)[0]!;
      expect(fraction.value).toBe(1);
    }
    expect(await bytes(x.data)).toEqual(before);
  });
  it("runs one selected analyzer inside one pinned source read", async () => {
    const x = await stored(), original = stores.createSourceStore; let reads = 0;
    const storeSpy = vi.spyOn(stores, "createSourceStore").mockImplementation((db, key) => {
      const s = original(db, key);
      return { ...s, readSource(sourceId) { reads++; expect(db.isTransaction).toBe(true); return s.readSource(sourceId); } };
    });
    const spy = vi.spyOn(recovery, "analyzeSourceRecovery");
    try {
      await runStats({ dataDir: x.data, source: x.sourceId, recoveryDistribution: true });
      expect(reads).toBe(1); expect(spy).toHaveBeenCalledTimes(1);
    } finally { storeSpy.mockRestore(); spy.mockRestore(); }
  });
  it("keeps all existing mode bytes when the ten new flags are false", async () => {
    const x = await stored(), disabled = Object.fromEntries(EVIDENCE_STATS_OPTIONS.map(([key]) => [key, false]));
    for (const selection of [{ listSources: true }, { source: x.sourceId }, ...nativeFlags.filter(k => k !== "listSources").map(key => ({ source: x.sourceId, [key]: true }))]) {
      const before = await runStats({ dataDir: x.data, ...selection });
      const after = await runStats({ dataDir: x.data, ...selection, ...disabled });
      for (const json of [false, true]) expect(formatStatsResult(after, json)).toBe(formatStatsResult(before, json));
    }
  });
  it("built CLI exercises all new modes and rejects duplicate flags", async () => {
    const binary = resolve("dist/agentprof.cjs"); expect(existsSync(binary)).toBe(true);
    const x = await stored();
    for (const [, flag] of EVIDENCE_STATS_OPTIONS) {
      const args = [binary, "stats", "--data-dir", x.data, "--source", x.sourceId, `--${flag}`, "--json"];
      const ok = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 15000, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
      expect(ok.status, ok.stderr).toBe(0);
      expect(JSON.parse(ok.stdout).result.evidence.view.view).toBe(flag);
      const bad = spawnSync(process.execPath, [...args, `--${flag}`], { encoding: "utf8", timeout: 15000, env: { ...process.env, NODE_NO_WARNINGS: "1" } });
      expect(bad.status).toBe(2); expect(bad.stdout).toBe("");
      expect(JSON.parse(bad.stderr).error.code).toBe("INVALID_ARGUMENT");
    }
  });
  it("keeps dynamic imports outside the pinned callback in source", () => {
    const code = readFileSync(resolve("src/cli/stats.ts"), "utf8");
    const callback = code.slice(code.indexOf("return withReadOnlyStore(directory,"), code.indexOf("function value("));
    expect(callback).not.toMatch(/\bawait\b/); expect(code).not.toContain("as unknown as {text:");
  });
});
