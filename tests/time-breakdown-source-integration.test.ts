import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { summarizeSource } from "../src/analysis/source-summary.js";
import type { SourceInput, SourceSnapshotInput } from "../src/db/source-store.js";
import { binary, bytes, capabilities, commandFlags, distributions, event, id, input, invoke, mixedBuckets, persisted, read, reasons, scanned } from "./time-breakdown-support.js";

async function outputs(x: Awaited<ReturnType<typeof persisted>>) {
  const before = await bytes(x.data), json = invoke(binary, x.data, ["--json", "stats", "--source", x.sourceId, "--time-breakdown"]), human = invoke(binary, x.data, ["stats", "--time-breakdown", "--source", x.sourceId]);
  expect(json.status).toBe(0); expect(json.stderr).toBe(""); expect(human.status).toBe(0); expect(human.stderr).toBe(""); const dto = JSON.parse(json.stdout);
  expect(dto).toEqual({ schema: "agentprof.cli/v1", ok: true, command: "stats", result: { mode: "selected_source_time_breakdown", summary: summarizeSource(x.source) } }); expect(Object.keys(dto.result)).toEqual(["mode", "summary"]);
  expect(JSON.parse(invoke(binary, x.data, ["stats", "--source", x.sourceId, "--json"]).stdout).result.summary).toEqual(dto.result.summary);
  expect(human.stdout).toContain("sourceFreshnessChecked=false; crossSourceReconciled=false; aggregationReady=false; parserResumeReady=false");
  const exclusions = human.stdout.split("\n").find(line => line.startsWith("Exclusions:"))!; expect(exclusions.split("; ")).toHaveLength(9); reasons.forEach(reason => expect(exclusions).toContain(`${reason}=${dto.result.summary.durationEligibility.exclusions[reason]}`));
  expect(json.stdout + human.stdout).not.toMatch(/FICTITIOUS_|sourceRef|boundaryFingerprint|secret|synthetic.jsonl/); expect(await read(x.data, x.sourceId)).toEqual(x.source); expect(await bytes(x.data)).toEqual(before);
  return { summary: dto.result.summary, json: json.stdout, human: human.stdout };
}

it("ordinary built Codex scan/store/raw deletion/reopen keeps2250/1400 duration partitions and partial support", async () => {
  const x = await scanned(), before = await bytes(x.data); expect(existsSync(x.rawRoot)).toBe(false); expect(before.map(f => f.name)).toEqual(["agentprof.sqlite", "identity-key.json"]); expect(before.every(f => (f.mode & 0o777) === 0o600)).toBe(true);
  const out = await outputs(x); expect(out.summary.durationEligibility).toMatchObject({ terminalCandidates: 2, included: 2 }); expect(out.summary.durations).toHaveLength(2);
  expect(out.summary.durations).toEqual(expect.arrayContaining([expect.objectContaining({ category: "search", durationScope: "process_runtime", timingEvidence: "source_reported", n: 1, sumMs: 2250, meanMs: 2250, maxMs: 2250, p50Ms: 2250, p95Ms: 2250, lowSampleP95: true }), expect.objectContaining({ category: "mcp", durationScope: "invocation_latency", timingEvidence: "source_reported", n: 1, sumMs: 1400, p95Ms: 1400 })]));
  expect(out.human).toContain("Coverage: partial"); expect(out.human).toContain("unsupported records=1"); expect(out.human).toContain("partial_shape_coverage"); expect(out.human).toContain("Duration partitions: shown=2; total=2; omitted=0"); expect(out.human).not.toContain("sum=3650"); expect(await bytes(x.data)).toEqual(before);
});

const excluded = () => [event("cancelled", { status: "cancelled", executionOutcome: "unknown" }), event("pending", { status: "pending", executionOutcome: "unknown", durationMs: null, durationScope: "unknown", timingEvidence: "unknown" }), event("unknown", { status: "unknown", executionOutcome: "unknown" }), event("missing", { durationMs: null, durationScope: "unknown", timingEvidence: "unknown" }), event("estimated", { timingEvidence: "estimated" })];
it.each([
  { name: "present empty", snapshot: input([]), state: "present_empty", events: 0, included: 0 },
  { name: "all excluded", snapshot: input(excluded()), state: "no_eligible_observations", events: 5, included: 0 },
  { name: "eligible zero", snapshot: input([event("zero", { durationMs: 0 })]), state: "eligible_observed_subset", events: 1, included: 1 },
  { name: "state limited", snapshot: input([event()], { ...capabilities, stateLimited: true }), state: "unavailable (state_limited)", events: 1, included: 0 },
])("actual validated persisted $name retains its independent evidence meaning", async test => {
  const out = await outputs(await persisted(test.snapshot)); expect(out.summary.inventory.events).toBe(test.events); expect(out.summary.durationEligibility.included).toBe(test.included); expect(out.human).toContain(`Duration evidence: ${test.state}`);
  if (test.name === "eligible zero") { expect(out.summary.durations[0]).toMatchObject({ n: 1, sumMs: 0, meanMs: 0, maxMs: 0, p50Ms: 0, p95Ms: 0 }); expect(out.human).toContain("n=1; sum=0 ms; mean=0 ms; max=0 ms; p50=0 ms; p95=0 ms (low-N)"); }
  else { expect(out.summary.durations).toBeNull(); expect(out.human).not.toContain("Session:"); }
  if (test.name === "all excluded") expect(out.summary.durationEligibility).toEqual({ terminalCandidates: 2, included: 0, exclusions: { source_suppressed: 0, cancelled: 1, pending: 1, unknown_status: 1, missing_duration: 1, invalid_duration: 0, unknown_scope: 0, estimated_timing: 1, unknown_timing: 0 } });
  if (test.name === "state limited") { expect(out.summary.durationEligibility.exclusions.source_suppressed).toBe(1); expect(out.human).toContain("Duration partitions: unknown (source suppressed)"); } else expect(out.human).toContain(`Duration partitions: shown=${test.included}; total=${test.included}; omitted=0`);
});
it.each([false, true])("source unavailable and evidence absent retain nonzero inventory, unavailable=%s", async unavailable => {
  const { evidence: _evidence, ...eventsOnly } = input(), out = await outputs(await persisted(unavailable ? input() : eventsOnly, unavailable));
  expect(out.summary.suppressionReason).toBe(unavailable ? "source_unavailable" : "evidence_absent"); expect(out.summary.inventory.events).toBe(1); expect(out.summary.durations).toBeNull(); expect(out.summary.durationEligibility.exclusions.source_suppressed).toBe(1);
  expect(out.human).toContain(`Duration evidence: unavailable (${unavailable ? "source_unavailable" : "evidence_absent"})`); expect(out.human).toContain("Duration cohort detail: unknown (source suppressed)");
  if (!unavailable) { expect(out.summary.capabilities).toBeNull(); expect(out.human).toContain("Capabilities: unknown"); expect(out.human).toContain("Usage selection inventory: unknown"); }
});

it("validated fractional/overflow/N19/N20 values preserve statistics and separate scope/evidence", async () => {
  const out = await outputs(await persisted(input(distributions()))); expect(out.summary.durationEligibility.included).toBe(45); expect(out.summary.durations).toHaveLength(6); expect(out.human).toContain("Duration partitions: shown=3; total=3; omitted=0"); expect(out.human).toContain("Duration cohort detail: shown=6; total=6; omitted=0");
  const cohort = (category: string) => out.summary.durations.find((c: { category: string; durationScope: string; timingEvidence: string }) => c.category === category && c.durationScope === "process_runtime" && c.timingEvidence === "source_reported");
  expect(cohort("test")).toMatchObject({ n: 2, sumMs: 0.30000000000000004, meanMs: 0.15000000000000002, maxMs: 0.2, p50Ms: 0.1, p95Ms: 0.2, lowSampleP95: true }); expect(out.human).toContain("sum=0.30000000000000004 ms; mean=0.15000000000000002 ms");
  expect(cohort("build")).toMatchObject({ n: 2, sumMs: null, meanMs: null, maxMs: Number.MAX_SAFE_INTEGER, p50Ms: 1, p95Ms: Number.MAX_SAFE_INTEGER, lowSampleP95: true, limitations: ["numeric_overflow"] }); expect(out.human).toContain("sum=unavailable ms; mean=unavailable ms");
  expect(cohort("search")).toMatchObject({ n: 19, p95Ms: 19, lowSampleP95: true }); expect(cohort("read")).toMatchObject({ n: 20, p95Ms: 19, lowSampleP95: false });
  const rows = out.human.split("\n").filter(line => line.startsWith("    category=")); expect(rows.find(line => line.includes("category=search;"))).toContain("p95=19 ms (low-N)"); expect(rows.find(line => line.includes("category=read;"))).not.toContain("low-N");
  expect(out.human).toContain("scope=item_lifecycle; evidence=source_reported"); expect(out.human).toContain("scope=process_runtime; evidence=paired_timestamps");
});
it("validated mixed known/unknown buckets preserve all13 samples and9 complete cohorts after clipping", async () => {
  const out = await outputs(await persisted(input(mixedBuckets()))); expect(out.summary.durationEligibility.included).toBe(13); expect(out.summary.durations).toHaveLength(9); expect(out.summary.durations.flatMap((c: { eventIds: string[] }) => c.eventIds).sort()).toEqual(mixedBuckets().map(e => e.id).sort());
  expect(out.human).toContain("Duration cohort detail: shown=6; total=9; omitted=3"); expect(out.human).toContain("Known sums: shown=3; total=5; omitted=2"); expect(out.human).toContain("Unknown sums: shown=3; total=4; omitted=1");
});

it("combined persisted8-partition mixed-bucket boundary retains exact omissions, nonzero exclusions and deterministic full JSON", async () => {
  const sessions = Array.from({ length: 8 }, (_, i) => id("session", `time-compound-${i}`)).sort();
  const included = [...mixedBuckets().map(e => ({ ...e, sessionId: sessions[0]! })), ...sessions.slice(1).map((sessionId, i) => event(`compound-${i}`, { sessionId }))];
  const rows = [...included, event("compound-pending", { sessionId: sessions[7]!, status: "pending", executionOutcome: "unknown", durationMs: null, durationScope: "unknown", timingEvidence: "unknown" }), event("compound-estimated", { sessionId: sessions[7]!, timingEvidence: "estimated" })];
  let previous: Awaited<ReturnType<typeof outputs>> | undefined;
  for (const events of [rows, [...rows].reverse()]) {
    const out = await outputs(await persisted(input(events))); expect(out.summary.inventory.events).toBe(22); expect(out.summary.durationEligibility).toEqual({ terminalCandidates: 21, included: 20, exclusions: { source_suppressed: 0, cancelled: 0, pending: 1, unknown_status: 0, missing_duration: 0, invalid_duration: 0, unknown_scope: 0, estimated_timing: 1, unknown_timing: 0 } });
    expect(out.summary.durations).toHaveLength(16); expect(out.summary.durations.flatMap((c: { eventIds: string[] }) => c.eventIds).sort()).toEqual(included.map(e => e.id).sort());
    expect(out.human).toContain("Duration partitions: shown=6; total=8; omitted=2"); expect(out.human).toContain("Duration cohort detail: shown=11; total=16; omitted=5"); expect(out.human).toContain("Known sums: shown=3; total=5; omitted=2"); expect(out.human).toContain("Unknown sums: shown=3; total=4; omitted=1; unranked");
    expect(out.human.split("\n").filter(line => line.startsWith("Session:")).map(line => line.match(/^Session: (.*?); scope=/)![1])).toEqual(sessions.slice(0, 6)); expect(out.human.split("\n").filter(line => line.startsWith("    category="))).toHaveLength(11);
    if (previous) { expect(out.json).toBe(previous.json); expect(out.human).toBe(previous.human); } previous = out;
  }
});

it.each(["many partitions", "one partition"])("actual validated4096event %s keeps full JSON/IDs and exact bounded omissions", async variant => {
  const rows = Array.from({ length: 4096 }, (_, i) => event(`maximum-${i}`, variant === "many partitions" ? { sessionId: id("session", `time-maximum-${i}`) } : { commandPattern: ["npm", "test", ...commandFlags.filter((_, j) => i & (1 << j))].join(" ") }));
  const out = await outputs(await persisted(input(rows))); expect(out.summary.inventory.events).toBe(4096); expect(out.summary.durationEligibility).toMatchObject({ included: 4096, terminalCandidates: 4096 }); expect(out.summary.durations).toHaveLength(4096);
  expect(out.summary.durations.flatMap((c: { eventIds: string[] }) => c.eventIds).sort()).toEqual(rows.map(e => e.id).sort()); for (const c of out.summary.durations) expect(c).toMatchObject({ n: 1, sumMs: 1, meanMs: 1, maxMs: 1, p50Ms: 1, p95Ms: 1 });
  const shown = variant === "many partitions" ? 6 : 3; expect(out.human).toContain(`Duration cohort detail: shown=${shown}; total=4096; omitted=${4096 - shown}`); expect(out.human.split("\n").filter(line => line.startsWith("    category="))).toHaveLength(shown);
  if (variant === "many partitions") { expect(new Set(out.summary.durations.map((c: { sessionId: string }) => c.sessionId)).size).toBe(4096); expect(out.human).toContain("Duration partitions: shown=6; total=4096; omitted=4090"); expect(out.human.split("\n").filter(line => line.startsWith("Session:"))).toHaveLength(6); }
  else { expect(new Set(out.summary.durations.map((c: { commandPattern: string }) => c.commandPattern)).size).toBe(4096); expect(out.human).toContain("Duration partitions: shown=1; total=1; omitted=0"); expect(out.human).toContain("Known sums: shown=3; total=4096; omitted=4093"); }
  expect(out.human.indexOf("Exclusions:")).toBeLessThan(out.human.indexOf("Duration partitions:")); expect(Buffer.byteLength(out.human)).toBeLessThan(32 * 1024); expect(out.human.trimEnd().split("\n").length).toBeLessThan(160); expect(Buffer.byteLength(out.json)).toBeLessThan(8 * 1024 * 1024);
}, 30000);

const baseline = process.env["AGENTPROF_TIME_BREAKDOWN_BASELINE_BINARY"], installed = process.env["AGENTPROF_TIME_BREAKDOWN_INSTALLED_BINARY"];
describe.skipIf(!baseline)("genuine immediate PR61 report/open", () => {
  it("preserves complete report bytes/modes and open validation for ordinary raw-deleted data", async () => {
    const x = await scanned(), output = join(x.root, "report.html"), before = await bytes(x.data);
    for (const format of [[], ["--json"]]) { const args = ["report", "--source", x.sourceId, "--output", output, ...format], old = invoke(baseline!, x.data, args); expect(old.status).toBe(0); const html = readFileSync(output), mode = statSync(output).mode; expect(mode & 0o777).toBe(0o600); unlinkSync(output); expect(invoke(binary, x.data, args)).toEqual(old); expect(readFileSync(output)).toEqual(html); expect(statSync(output).mode).toBe(mode); unlinkSync(output); }
    for (const format of [[], ["--json"]]) expect(invoke(binary, x.data, ["open", join(x.root, "absent.html"), ...format])).toEqual(invoke(baseline!, x.data, ["open", join(x.root, "absent.html"), ...format])); expect(await bytes(x.data)).toEqual(before);
  });
});
describe.skipIf(!installed)("real scripts-disabled installed duration artifact", () => {
  it("matches built ordinary/empty/suppressed/distribution/mixed human and full JSON on immutable stores", async () => {
    const { evidence: _evidence, ...eventsOnly } = input(); const snapshots: (SourceSnapshotInput | SourceInput)[] = [input([]), eventsOnly, input(distributions()), input(mixedBuckets())];
    for (const x of [await scanned(installed!), ...await Promise.all(snapshots.map(s => persisted(s)))]) { const before = await bytes(x.data); for (const format of [[], ["--json"]]) expect(invoke(installed!, x.data, ["stats", "--source", x.sourceId, "--time-breakdown", ...format])).toEqual(invoke(binary, x.data, ["stats", "--source", x.sourceId, "--time-breakdown", ...format])); expect(await bytes(x.data)).toEqual(before); }
  });
});
