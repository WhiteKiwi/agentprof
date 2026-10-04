import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertScanHelpEnrollmentDelta } from "./scan-help-compatibility.js";
import { summarizeSource } from "../src/analysis/source-summary.js";
import { runStats, formatStatsResult } from "../src/cli/stats.js";
import { nativeContext } from "../src/cli/source-native-context.js";
import { analyzeSourceToolBusy } from "../src/analysis/source-tool-busy.js";
import { busyEvent, busySource } from "./display-batch-busy-support.js";
import { input, usage, parsedFixture, persisted, bytes, binary, invoke, scanned, id } from "./tokens-support.js";
import { event } from "./time-breakdown-support.js";
import { stored as retryStored } from "./retry-overhead-fixture.js";
import { stored as activeStored } from "./active-time-fixture.js";
import { temporaryDirectory } from "./helpers.js";
import { displayCases } from "./display-batch-cases.js";

const usageFlags = ["cacheShare", "cacheWriteShare", "reasoningShare", "cacheComponents", "outputComposition"];
const cliFlags = displayCases.map(c => `--${c.flag}`);
async function selected(data: string, sourceId: string, prop: string) { return runStats({ dataDir: data, source: sourceId, [prop]: true }); }

it.each([
  ["known", { input: 80, output: 12, total: 92, cachedInput: 20, cacheWriteInput: 5, reasoningOutput: 4 }, ["cache read share=0.25", "cache write share=0.0625", "reasoning share=0.3333333333333333", "non-reasoning derived=8"]],
  ["zero_denominators", { input: 0, output: 0, total: 0, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0 }, ["cache read share=unavailable", "cache write share=unavailable", "reasoning share=unavailable", "non-reasoning derived=0"]],
  ["observed_zero", { input: 80, output: 12, total: 92, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0 }, ["cache read share=0", "cache write share=0", "reasoning share=0", "non-reasoning derived=12"]],
  ["positive_fraction", { input: 1000, output: 1000, total: 2000, cachedInput: 1, cacheWriteInput: 1, reasoningOutput: 1 }, ["cache read share=0.001", "cache write share=0.001", "reasoning share=0.001", "non-reasoning derived=999"]],
  ["missing_optional", { input: 80, output: 12, total: 92, cachedInput: null, cacheWriteInput: null, reasoningOutput: null }, ["no_eligible_observations", "incomplete_components=1"]],
] as const)("shared usage component and ratio oracle: %s", async (_label, counts, expected) => {
  const x = await persisted(input([usage("component", { counts, ...(_label === "missing_optional" ? { countStatus: "partial" as const, limitations: ["partial_counts" as const] } : {}) })])), before = await bytes(x.data), results = await Promise.all(usageFlags.map(flag => selected(x.data, x.sourceId, flag))), text = results.map(r => formatStatsResult(r, false)).join("\n");
  for (const fragment of expected) expect(text).toContain(fragment);
  if (_label !== "missing_optional") expect(text).toContain("uncached input=unavailable");
  else for (const r of results) expect(JSON.parse(formatStatsResult(r, true)).result.summary.usage).toBeNull();
  for (const r of results) expect(JSON.parse(formatStatsResult(r, true)).result.summary).toEqual(summarizeSource(x.source));
  expect(await bytes(x.data)).toEqual(before);
});
it("component overflow remains unavailable with complete source eligibility", async () => {
  const x = await persisted(input([usage("max", { counts: { input: Number.MAX_SAFE_INTEGER, output: 0, total: Number.MAX_SAFE_INTEGER, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0 } }), usage("one", { counts: { input: 1, output: 0, total: 1, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0 } })]));
  for (const prop of usageFlags) { const r = await selected(x.data, x.sourceId, prop), text = formatStatsResult(r, false); expect(text).toContain("numeric_overflow"); expect(text).toContain("observed responses=2"); expect(JSON.parse(formatStatsResult(r, true)).result.summary.usage[0].counts.input).toBeNull(); }
});
it("trusted synthetic Claude normalized cache composition is one input total150, not350", async () => {
  const x = await persisted(await parsedFixture("claude-real-shapes.jsonl", true));
  const r = await selected(x.data, x.sourceId, "cacheComponents"), text = formatStatsResult(r, false);
  expect(text).toContain("input=150; cached input=30; cache write input=20; uncached input=100");
  expect(JSON.parse(formatStatsResult(r, true)).result.summary.usage[0].counts).toMatchObject({ input: 150, output: 10, total: 160, reasoningOutput: null });
});
it.each(["empty", "all_excluded", "eligible_zero", "absent", "suppressed"] as const)("all summary views retain distinct duration and usage state: %s", async label => {
  const snapshot = { ...input(label === "empty" || label === "absent" ? [] : label === "all_excluded" ? [usage("provisional", { selection: "provisional" })] : [usage("zero", { counts: { input: 0, output: 0, total: 0, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0 } })]), events: label === "empty" || label === "absent" ? [] : [event(label, label === "all_excluded" ? { status: "cancelled" } : { durationMs: 0 })] };
  const x = await persisted(label === "absent" ? { ...Object.fromEntries(["sourceId", "provider", "parserVersion", "normalizationVersion", "keyVersion", "keyId", "completedOffset", "observedSize", "boundaryFingerprint", "events"].map(k => [k, snapshot[k as keyof typeof snapshot]])) } as never : snapshot, label === "suppressed");
  const before = await bytes(x.data);
  for (const c of displayCases.filter(c => ![71, 81, 82, 83].includes(c.pr))) {
    const r = await selected(x.data, x.sourceId, c.prop), text = formatStatsResult(r, false), expected = label === "empty" ? "present_empty" : label === "all_excluded" ? "no_eligible_observations" : label === "eligible_zero" ? "eligible_observed_subset" : label === "absent" ? "evidence_absent" : "source_unavailable";
    expect(text, c.flag).toContain(expected); expect(JSON.parse(formatStatsResult(r, true)).result.summary).toEqual(summarizeSource(x.source));
    if (label === "suppressed" && c.prop === "durationCoverage") expect(text).toContain("Duration coverage=unavailable");
    if (c.prop === "timingEvidence" || c.prop === "durationScope") {
      const title = c.prop === "timingEvidence" ? "Eligible duration timing samples" : "Eligible duration scope samples";
      expect(text).toContain(`${title}: ${label === "absent" || label === "suppressed" ? "unavailable" : `population=${label === "eligible_zero" ? 1 : 0}`}`);
      expect(text).toContain(`included=${label === "eligible_zero" ? 1 : 0}`);
      if (label === "absent" || label === "suppressed") expect(text).not.toContain(`${title}: population=0`);
    }
  }
  expect(await bytes(x.data)).toEqual(before);
});
it("native absent capabilities distinguish unknown shapes and preserve source outcome inventory", () => {
  const absent = analyzeSourceToolBusy({ ...busySource([busyEvent("absent")]), evidence: null }), lines = nativeContext("absent", absent).join("\n");
  expect(lines).toContain("Capabilities: unavailable"); expect(lines).toContain("Observed shapes: unavailable"); expect(lines).not.toContain("Observed shapes: none"); expect(lines).toContain("Event outcome inventory: success=1");
});
it.each(["readRatio", "searchRatio", "overlapSummary"] as const)("positive native %s oracle and identity/provider limitations", async prop => {
  let events = [busyEvent("one", 0, 10000, { fileFingerprint: id("file", "same") }), busyEvent("two", 5000, 15000, { fileFingerprint: id("file", "same") }), busyEvent("three", 20000, 20000, { fileFingerprint: id("file", "other") })];
  if (prop === "searchRatio") events = events.map((e, i) => ({ ...e, kind: "search", category: "search", toolName: "Grep", commandPattern: null, lookupKey: id("lookup", i < 2 ? "same" : "other"), fileFingerprint: null }));
  const s = busySource(events), caps = { ...s.evidence!.capabilities, parserVersion: 2 }, snapshot = { ...Object.fromEntries(["sourceId", "provider", "normalizationVersion", "keyVersion", "keyId", "completedOffset", "observedSize", "boundaryFingerprint"].map(k => [k, s[k as keyof typeof s]])), parserVersion: 2, events, evidence: { ...s.evidence!, capabilities: caps } }, x = await persisted(snapshot as never), r = await selected(x.data, x.sourceId, prop), a = JSON.parse(formatStatsResult(r, true)).result.analysis, text = formatStatsResult(r, false);
  if (prop === "readRatio") expect(a.partitions[0]).toMatchObject({ validReadN: 3, uniqueFileN: 2, revisitN: 1, revisitRatio: 1 / 3 });
  else if (prop === "searchRatio") expect(a.partitions[0]).toMatchObject({ validSearchN: 3, uniqueLookupN: 2, repeatN: 1, repeatRatio: 1 / 3 });
  else expect(a.partitions[0]).toMatchObject({ intervalLengthSumMs: 20000, intervalUnionMs: 15000, excessMs: 5000 });
  expect(text).toContain(prop === "overlapSummary" ? "union=15000 ms" : "ratio=0.3333333333333333");
  expect(text).toContain("Partition reasons: none=1");
});
it.each(cliFlags)("%s rejects other commands and CLI conflicts before store creation", flag => {
  const data = join(temporaryDirectory(), "absent");
  for (const command of ["scan", "insights", "report", "open"]) {
    const r = invoke(binary, data, ["--json", command, flag]);
    expect(r.status).toBe(2); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false);
  }
  const r = invoke(binary, data, ["--json", "stats", flag]);
  expect(r.status).toBe(2); expect(JSON.parse(r.stderr).error.code).toBe("INVALID_ARGUMENT"); expect(existsSync(data)).toBe(false);
});

const baseline = process.env["AGENTPROF_DISPLAY_BATCH_BASELINE_BINARY"], installed = process.env["AGENTPROF_DISPLAY_BATCH_INSTALLED_BINARY"];
describe.skipIf(!baseline)("genuine immediate PR63 parity", () => {
  it("matches every previous human/JSON command and allows only new help rows and mechanical padding", async () => {
    const x = await scanned(), before = await bytes(x.data);
    for (const args of [["--help"], ["--version"], ["scan", "--help"], ["insights", "--help"], ["report", "--help"], ["open", "--help"]]) {
      if (args[0] === "scan") assertScanHelpEnrollmentDelta(invoke(binary, x.data, args), invoke(baseline!, x.data, args));
      else expect(invoke(binary, x.data, args)).toEqual(invoke(baseline!, x.data, args));
    }
    const flags = ["--failures", "--read-revisits", "--invocation-overlap", "--search-recurrence", "--recovery", "--retry-overhead", "--active-time", "--tokens", "--time-breakdown"];
    for (const args of [["stats", "--list-sources"], ["stats", "--source", x.sourceId], ["insights", "--source", x.sourceId], ...flags.map(flag => ["stats", "--source", x.sourceId, flag])]) for (const format of [[], ["--json"]]) expect(invoke(binary, x.data, [...args, ...format])).toEqual(invoke(baseline!, x.data, [...args, ...format]));
    const current = invoke(binary, x.data, ["stats", "--help"]), prior = invoke(baseline!, x.data, ["stats", "--help"]);
    const normalize = (s: string) => s.split("\n").filter(line => !displayCases.some(c => new RegExp(`^  --${c.flag}(?: +|$)`).test(line))).map(line => line.startsWith("  ") ? line.trimStart().replace(/ {2,}/g, " ") : line).join("\n");
    expect(normalize(current.stdout)).toBe(normalize(prior.stdout)); expect(current.stdout).not.toContain("undefined"); expect(current.status).toBe(0); expect(current.stderr).toBe(""); expect(await bytes(x.data)).toEqual(before);
    const retry = await retryStored(), active = await activeStored();
    for (const [y, flag] of [[retry, "--recovery"], [retry, "--retry-overhead"], [active, "--active-time"]] as const) for (const format of [[], ["--json"]]) expect(invoke(binary, y.data, ["stats", "--source", y.sourceId, flag, ...format])).toEqual(invoke(baseline!, y.data, ["stats", "--source", y.sourceId, flag, ...format]));
  });
  it("preserves report bytes/modes and open validation on raw-deleted ordinary evidence", async () => {
    const x = await scanned(), output = join(x.root, "report.html"), before = await bytes(x.data);
    for (const format of [[], ["--json"]]) {
      const args = ["report", "--source", x.sourceId, "--output", output, ...format], old = invoke(baseline!, x.data, args); expect(old.status).toBe(0);
      const html = readFileSync(output), mode = statSync(output).mode; expect(mode & 0o777).toBe(0o600); unlinkSync(output);
      expect(invoke(binary, x.data, args)).toEqual(old); expect(readFileSync(output)).toEqual(html); expect(statSync(output).mode).toBe(mode); unlinkSync(output);
    }
    for (const format of [[], ["--json"]]) expect(invoke(binary, x.data, ["open", join(x.root, "absent.html"), ...format])).toEqual(invoke(baseline!, x.data, ["open", join(x.root, "absent.html"), ...format]));
    expect(await bytes(x.data)).toEqual(before);
  });
});
describe.skipIf(!installed)("actual scripts-disabled installed batch", () => {
  it("matches every flag's built human and complete JSON from reopened stored evidence", async () => {
    const x = await persisted({ ...input(), events: [event("installed")] }), before = await bytes(x.data);
    for (const flag of cliFlags) for (const format of [[], ["--json"]]) expect(invoke(installed!, x.data, ["stats", "--source", x.sourceId, flag, ...format])).toEqual(invoke(binary, x.data, ["stats", "--source", x.sourceId, flag, ...format]));
    expect(await bytes(x.data)).toEqual(before);
  });
});
