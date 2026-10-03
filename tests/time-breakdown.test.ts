import { expect, it } from "vitest";
import { summarizeSource } from "../src/analysis/source-summary.js";
import { formatSourceTimeBreakdown } from "../src/cli/time-breakdown.js";
import { formatStatsResult } from "../src/cli/stats.js";
import { capabilities, event, id, mixedBuckets, reasons, source } from "./time-breakdown-support.js";

it("copies every inherited context field and keeps the original complete time JSON without mutating input", () => {
  const s = summarizeSource(source([event()], { ...capabilities, coverage: "partial", unsupportedRecords: 7 })), before = JSON.stringify(s), human = formatSourceTimeBreakdown(s);
  expect(human).toContain(`Source: ${s.sourceId}`); expect(human).toContain("revision=3; source bytes [0,100)/105"); expect(human).toContain("availability=available; evidence=events_and_metric_evidence; suppression=none");
  expect(human).toContain("Coverage: partial; support=shape_verified_only; parser version=1"); expect(human).toContain("Inventory: events=1; turns=0; stored usage rows=0; observations=0; diagnostics=0");
  expect(human).toContain("Event status inventory: completed=1; failed=0; cancelled=0; pending=0; unknown=0"); expect(human).toContain("Event outcome inventory: success=1; no_match=0; change_detected=0; error=0; unknown=0");
  expect(human).toContain("Usage selection inventory: eligible=0; provisional=0; snapshot_only=0; conflicted=0; invalid=0"); expect(human).toContain("Usage finality inventory: source_terminal=0; trusted_final=0; trusted_partial=0; unknown=0");
  expect(human).toContain("unsupported records=7"); expect(human).toContain("partial_shape_coverage"); expect(human).toContain("sourceFreshnessChecked=false; crossSourceReconciled=false; aggregationReady=false; parserResumeReady=false");
  expect(JSON.parse(formatStatsResult({ mode: "selected_source_time_breakdown", summary: s }, true))).toEqual({ schema: "agentprof.cli/v1", ok: true, command: "stats", result: { mode: "selected_source_time_breakdown", summary: s } }); expect(JSON.stringify(s)).toBe(before);
});

it("separates local known ranking and unranked null sums with exact independent bucket/source omissions", () => {
  const s = summarizeSource(source(mixedBuckets())), reversed = { ...s, durations: [...s.durations!].reverse() }, before = JSON.stringify(reversed), human = formatSourceTimeBreakdown(reversed);
  expect(human).toBe(formatSourceTimeBreakdown(s)); expect(JSON.stringify(reversed)).toBe(before); expect(s.durations).toHaveLength(9);
  expect(human).toContain("Duration cohort detail: shown=6; total=9; omitted=3"); expect(human).toContain("Known sums: shown=3; total=5; omitted=2; recorded sum descending, within this partition only"); expect(human).toContain("Unknown sums: shown=3; total=4; omitted=1; unranked, identity order");
  const rows = human.split("\n").filter(line => line.startsWith("    category=")); expect(rows).toHaveLength(6);
  expect(rows.map(line => line.match(/pattern=(.*?); n=/)![1])).toEqual(["npm test --json", "npm test --quiet", "npm test --verbose", "npm test --files", "npm test --glob", "npm test --runInBand"]);
  expect(rows.slice(0, 3).map(line => line.match(/sum=(.*?) ms/)![1])).toEqual(["9", "8", "8"]); for (const row of rows.slice(3)) expect(row).toContain(`n=2; sum=unavailable ms; mean=unavailable ms; max=${Number.MAX_SAFE_INTEGER} ms; p50=1 ms; p95=${Number.MAX_SAFE_INTEGER} ms (low-N); limitations=numeric_overflow`);
  expect(human).toContain("terminal candidates=13; included=13"); const exclusions = human.split("\n").find(line => line.startsWith("Exclusions:"))!; expect(exclusions.split("; ")).toHaveLength(9); reasons.forEach(reason => expect(exclusions).toContain(`${reason}=0`));
  expect(human.indexOf("Exclusions:")).toBeLessThan(human.indexOf("Duration partitions:")); expect(human).toContain("not elapsed time, busy time, time share, waste or savings");
});

it("orders six compatible partitions by identity without pooling or ranking their different duration values", () => {
  const rows = Array.from({ length: 8 }, (_, i) => event(`partition-${i}`, { sessionId: id("session", `time-partition-${i}`), durationMs: 1000 - i })), s = summarizeSource(source(rows)), human = formatSourceTimeBreakdown(s);
  expect(human).toContain("Duration partitions: shown=6; total=8; omitted=2; identity order, no partition ranking"); expect(human).toContain("Duration cohort detail: shown=6; total=8; omitted=2");
  const sessions = human.split("\n").filter(line => line.startsWith("Session:")).map(line => line.match(/^Session: (.*?); scope=/)![1]); expect(sessions).toEqual(rows.map(row => row.sessionId).sort().slice(0, 6));
  expect(human).toContain("included=8"); expect(s.durations).toHaveLength(8); expect(s.durations!.flatMap(c => c.eventIds).sort()).toEqual(rows.map(row => row.id).sort()); expect(human).not.toContain("sum=7972");
});
