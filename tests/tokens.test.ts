import { expect, it } from "vitest";
import { summarizeSource } from "../src/analysis/source-summary.js";
import { formatSourceTokens } from "../src/cli/tokens.js";
import { formatStatsResult } from "../src/cli/stats.js";
import { capabilities, id, reasons, source, usage } from "./tokens-support.js";

it("shows inherited generation, partial capability, source inventory and false readiness without changing tokens", () => {
  const s = summarizeSource(source([usage()], { ...capabilities, coverage: "partial", unsupportedRecords: 7 })), before = JSON.stringify(s), human = formatSourceTokens(s);
  expect(human).toContain(`Source: ${s.sourceId}`); expect(human).toContain("revision=3; source bytes [0,100)/105"); expect(human).toContain("availability=available; evidence=events_and_metric_evidence; suppression=none");
  expect(human).toContain("Coverage: partial; support=shape_verified_only; parser version=1"); expect(human).toContain("unsupported records=7"); expect(human).toContain("stored usage rows=1"); expect(human).toContain("partial_shape_coverage"); expect(human).toContain("sourceFreshnessChecked=false; crossSourceReconciled=false; aggregationReady=false; parserResumeReady=false");
  expect(human).toContain("input=80; output=12; total=92; cached input=20; cache write=5; reasoning output=4; uncached input=unknown"); expect(human).toContain("subset of input and is not added again"); expect(human).toContain("Reasoning output is not added again to output");
  expect(JSON.parse(formatStatsResult({ mode: "selected_source_tokens", summary: s }, true))).toEqual({ schema: "agentprof.cli/v1", ok: true, command: "stats", result: { mode: "selected_source_tokens", summary: s } }); expect(JSON.stringify(s)).toBe(before);
});

it("prints all thirteen source-wide reasons including zeros before cohort detail", () => {
  const selected = usage("a"), replay = { ...selected, id: id("event", "replay") }, conflict = usage("conflict"), contradict = { ...conflict, id: id("event", "conflict-duplicate"), finality: "trusted_final" as const };
  const s = summarizeSource(source([selected, replay, conflict, contradict, usage("snapshot", { scope: "thread_cumulative", source: "thread_snapshot", finality: "unknown", selection: "snapshot_only", limitations: ["snapshot_only"] })])), human = formatSourceTokens(s);
  expect(s.usageEligibility).toMatchObject({ observedResponses: 1, selectedRows: 1, deduplicatedRows: 1, excludedRows: 3, excludedResponseGroups: 1 });
  expect(human).toContain("observed responses=1; selected rows=1; deduplicated rows=1; excluded rows=3; excluded response groups=1");
  const exclusions = human.split("\n").find(line => line.startsWith("Exclusions:"))!;
  expect(exclusions.split("; ")).toHaveLength(13); for (const reason of reasons) expect(exclusions).toContain(`${reason}=${reason === "cumulative_snapshot" ? 1 : reason === "duplicate_response_conflict" ? 2 : 0}`);
  expect(human.indexOf("Exclusions:")).toBeLessThan(human.indexOf("Token cohort detail:")); expect(s.usage![0]!.counts.total).toBe(92);
});

it("caps identity-ordered cohort detail without modifying counters, full membership or input order", () => {
  const rows = Array.from({ length: 8 }, (_, i) => usage(String(i), { sessionId: id("session", `session-${i}`) })), s = summarizeSource(source(rows)), reversed = { ...s, usage: [...s.usage!].reverse() }, before = JSON.stringify(reversed);
  const human = formatSourceTokens(reversed); expect(human).toBe(formatSourceTokens(s)); expect(human).toContain("shown=6; total=8; omitted=2; identity order, no ranking"); expect(human.split("\n").filter(line => line.startsWith("Session:"))).toHaveLength(6);
  expect(human).toContain("observed responses=8; selected rows=8"); expect(s.usage).toHaveLength(8); expect(s.usage!.flatMap(c => c.usageIds)).toHaveLength(8); expect(JSON.stringify(reversed)).toBe(before);
});

it("separates provider mapping and finality without pooling independent cohort values", () => {
  const ordinary = usage("ordinary"), trusted = usage("trusted", { finality: "trusted_final" });
  const s = summarizeSource(source([ordinary, trusted])), human = formatSourceTokens(s);
  expect(s.usage).toHaveLength(2); expect(human).toContain("mapping=openai_responses; finality=source_terminal"); expect(human).toContain("mapping=openai_responses; finality=trusted_final"); expect(human.match(/input=80; output=12; total=92/g)).toHaveLength(2); expect(human).not.toContain("total=184");
});

it.each([
  ["empty", source([]), "present_empty", "stored usage rows=0"],
  ["all excluded", source([usage("snapshot", { scope: "thread_cumulative", source: "thread_snapshot", finality: "unknown", selection: "snapshot_only", limitations: ["snapshot_only"] })]), "no_eligible_responses", "excluded rows=1"],
  ["eligible zero", source([usage("zero", { counts: { input: 0, output: 0, total: 0, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0 }, limitations: ["zero_or_source_default"] })]), "eligible_observed_subset", "input=0; output=0; total=0"],
  ["evidence absent", { ...source(), evidence: null, persistedScope: "events_only" as const }, "unavailable (evidence_absent)", "stored usage rows=unknown"],
  ["native unavailable", { ...source(), availability: "unavailable" as const }, "unavailable (source_unavailable)", "stored usage rows=1"],
  ["state limited", source([usage()], { ...capabilities, stateLimited: true }), "unavailable (state_limited)", "state limited=true"],
  ["dropped diagnostics", source([usage()], { ...capabilities, diagnosticsDropped: 1 }), "unavailable (state_limited)", "dropped diagnostics=1"],
  ["ambiguous origin", source([usage()], { ...capabilities, ambiguousRecords: 1 }), "unavailable (ambiguous_origin)", "ambiguous records=1"],
] as const)("preserves %s evidence distinction", (_name, input, state, detail) => {
  const s = summarizeSource(input), human = formatSourceTokens(s); expect(human).toContain(`Token evidence: ${state}`); expect(human).toContain(detail);
  if (state === "eligible_observed_subset") expect(human).not.toContain("Token totals: unknown"); else { expect(human).not.toContain("total=0; cached input=0"); expect(human).not.toContain("Session:"); }
  if (state.startsWith("unavailable")) expect(human).toContain("Token cohort detail: unknown (source suppressed)");
});

it("retains null overflow components independently from known zero output", () => {
  const s = summarizeSource(source([usage("max", { counts: { input: Number.MAX_SAFE_INTEGER, output: 0, total: Number.MAX_SAFE_INTEGER, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0 } }), usage("one", { counts: { input: 1, output: 0, total: 1, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0 } })])), human = formatSourceTokens(s);
  expect(s.usage![0]!.counts).toMatchObject({ input: null, output: 0, total: null }); expect(human).toContain("input=unknown; output=0; total=unknown"); expect(human).toContain("overflow=input, total; limitations=numeric_overflow"); expect(human).not.toContain("input=0; output=0; total=0");
});
