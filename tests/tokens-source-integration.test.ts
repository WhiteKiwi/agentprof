import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { summarizeSource } from "../src/analysis/source-summary.js";
import type { SourceInput, SourceSnapshotInput } from "../src/db/source-store.js";
import { binary, bytes, capabilities, id, input, invoke, parsedFixture, persisted, read, reasons, scanned, usage } from "./tokens-support.js";

async function outputs(x: Awaited<ReturnType<typeof persisted>>) {
  const before = await bytes(x.data), json = invoke(binary, x.data, ["--json", "stats", "--source", x.sourceId, "--tokens"]), human = invoke(binary, x.data, ["stats", "--tokens", "--source", x.sourceId]);
  expect(json.status).toBe(0); expect(json.stderr).toBe(""); expect(human.status).toBe(0); expect(human.stderr).toBe(""); const dto = JSON.parse(json.stdout);
  expect(dto).toEqual({ schema: "agentprof.cli/v1", ok: true, command: "stats", result: { mode: "selected_source_tokens", summary: summarizeSource(x.source) } });
  expect(Object.keys(dto.result)).toEqual(["mode", "summary"]); expect(dto.result.summary).toMatchObject({ crossSourceReconciled: false, aggregationReady: false, parserResumeReady: false }); expect(human.stdout).toContain("sourceFreshnessChecked=false");
  expect(JSON.parse(invoke(binary, x.data, ["stats", "--source", x.sourceId, "--json"]).stdout).result.summary).toEqual(dto.result.summary);
  if (dto.result.summary.usageEligibility !== null) { const line = human.stdout.split("\n").find(line => line.startsWith("Exclusions:"))!; expect(line.split("; ")).toHaveLength(13); for (const reason of reasons) expect(line).toContain(`${reason}=${dto.result.summary.usageEligibility.exclusions[reason]}`); }
  expect(json.stdout + human.stdout).not.toMatch(/FICTITIOUS_|sourceRef|boundaryFingerprint|secret|synthetic.jsonl/); expect(await read(x.data, x.sourceId)).toEqual(x.source); expect(await bytes(x.data)).toEqual(before);
  return { summary: dto.result.summary, json: json.stdout, human: human.stdout };
}

it("ordinary Codex built scan/store/raw deletion/reopen preserves92 observed tokens and partial coverage", async () => {
  const x = await scanned(), before = await bytes(x.data); expect(existsSync(x.rawRoot)).toBe(false); expect(before.map(f => f.name)).toEqual(["agentprof.sqlite", "identity-key.json"]); expect(before.every(f => (f.mode & 0o777) === 0o600)).toBe(true);
  const out = await outputs(x); expect(out.summary.usage).toHaveLength(1); expect(out.summary.usage[0]).toMatchObject({ finality: "source_terminal", observedResponses: 1, counts: { input: 80, output: 12, total: 92, cachedInput: 20, cacheWriteInput: 5, reasoningOutput: 4, uncachedInput: null } });
  expect(out.summary.usageEligibility).toMatchObject({ selectedRows: 1, deduplicatedRows: 0, excludedRows: 2, exclusions: { cumulative_snapshot: 2 } }); expect(out.summary.capabilities).toMatchObject({ coverage: "partial", unsupportedRecords: 1 });
  expect(out.human).toContain("Coverage: partial"); expect(out.human).toContain("partial_shape_coverage"); expect(out.human).toContain("stored usage rows=3"); expect(out.human).toContain("shown=1; total=1; omitted=0"); expect(await bytes(x.data)).toEqual(before);
});

it("explicitly trusted Claude fixture preserves cache mapping and unknown reasoning without asserting ordinary finality", async () => {
  const x = await persisted(await parsedFixture("claude-real-shapes.jsonl", true)), out = await outputs(x);
  expect(out.summary.usage).toHaveLength(1); expect(out.summary.usage[0]).toMatchObject({ provider: "claude", mapping: "anthropic_messages", finality: "trusted_final", observedResponses: 1, counts: { input: 150, output: 10, total: 160, cachedInput: 30, cacheWriteInput: 20, reasoningOutput: null, uncachedInput: 100 } });
  expect(out.human).toContain("provider=claude; mapping=anthropic_messages; finality=trusted_final"); expect(out.human).toContain("input=150; output=10; total=160; cached input=30; cache write=20; reasoning output=unknown; uncached input=100");
});
it("ordinary Claude usage remains unverified rather than borrowing trusted fixture finality", async () => {
  const out = await outputs(await persisted(await parsedFixture("claude-real-shapes.jsonl"))); expect(out.summary.usage).toBeNull(); expect(out.summary.usageEligibility.observedResponses).toBe(0); expect(out.summary.usageEligibility.exclusions.provisional).toBeGreaterThan(0); expect(out.human).toContain("Token evidence: no_eligible_responses"); expect(out.human).not.toContain("finality=trusted_final; observed responses=1");
});

const zero = { input: 0, output: 0, total: 0, cachedInput: 0, cacheWriteInput: 0, reasoningOutput: 0 };
const controls = [
  { name: "present empty", snapshot: input([]), state: "present_empty", rows: 0, excluded: 0, selected: 0 },
  { name: "all excluded", snapshot: input([usage("snapshot", { source: "thread_snapshot", scope: "thread_cumulative", finality: "unknown", selection: "snapshot_only", limitations: ["snapshot_only"] })]), state: "no_eligible_responses", rows: 1, excluded: 1, selected: 0, reason: "cumulative_snapshot" },
  { name: "eligible zero", snapshot: input([usage("zero", { counts: zero, limitations: ["zero_or_source_default"] })]), state: "eligible_observed_subset", rows: 1, excluded: 0, selected: 1, total: 0 },
  { name: "partial capabilities", snapshot: input([usage()], { ...capabilities, coverage: "partial", unsupportedRecords: 1 }), state: "eligible_observed_subset", rows: 1, excluded: 0, selected: 1, total: 92 },
  { name: "incomplete cached component", snapshot: input([usage("incomplete", { counts: { ...usage().counts!, cachedInput: null }, countStatus: "partial", limitations: ["partial_counts"] })]), state: "no_eligible_responses", rows: 1, excluded: 1, selected: 0, reason: "incomplete_components" },
  { name: "state limited", snapshot: input([usage()], { ...capabilities, stateLimited: true }), state: "unavailable (state_limited)", rows: 1, excluded: 1, selected: 0, reason: "source_suppressed" },
  { name: "dropped diagnostics", snapshot: input([usage()], { ...capabilities, diagnosticsDropped: 1 }), state: "unavailable (state_limited)", rows: 1, excluded: 1, selected: 0, reason: "source_suppressed" },
  { name: "ambiguous source", snapshot: input([usage()], { ...capabilities, ambiguousRecords: 1 }), state: "unavailable (ambiguous_origin)", rows: 1, excluded: 1, selected: 0, reason: "source_suppressed" },
] as const;
it.each(controls)("actual validated persisted $name retains independent eligibility/state", async test => {
  const out = await outputs(await persisted(test.snapshot)); expect(out.summary.inventory.usage).toBe(test.rows); expect(out.summary.usageEligibility).toMatchObject({ observedResponses: test.selected, selectedRows: test.selected, excludedRows: test.excluded }); expect(out.human).toContain(`Token evidence: ${test.state}`);
  if ("reason" in test) expect(out.summary.usageEligibility.exclusions[test.reason]).toBe(1); if ("total" in test) expect(out.summary.usage[0].counts.total).toBe(test.total); else expect(out.summary.usage).toBeNull();
  if (test.name === "partial capabilities") { expect(out.human).toContain("Coverage: partial"); expect(out.human).toContain("partial_shape_coverage"); }
});
it.each([false, true])("native source unavailability/absent evidence remains distinct, unavailable=%s", async unavailable => {
  const { evidence: _evidence, ...eventsOnly } = input(), x = await persisted(unavailable ? input() : eventsOnly, unavailable), out = await outputs(x);
  expect(out.summary.suppressionReason).toBe(unavailable ? "source_unavailable" : "evidence_absent"); expect(out.summary.usage).toBeNull(); expect(out.human).toContain(`Token evidence: unavailable (${unavailable ? "source_unavailable" : "evidence_absent"})`); expect(out.summary.inventory.usage).toBe(unavailable ? 1 : null);
  if (!unavailable) { expect(out.summary.usageEligibility).toBeNull(); expect(out.human).toContain("Usage eligibility: unknown"); expect(out.human).toContain("Exclusions: unknown"); } else expect(out.summary.usageEligibility.exclusions.source_suppressed).toBe(1);
});
it("actual persisted duplicate response replay counts once and a conflict excludes every member", async () => {
  const a = usage("a"), replay = { ...a, id: id("event", "replay"), sourceRef: { ...a.sourceRef, byteOffset: 2 } };
  for (const conflict of [false, true]) { const out = await outputs(await persisted(input([a, { ...replay, ...(conflict ? { finality: "trusted_final" as const } : {}) }])));
    expect(out.summary.usageEligibility).toMatchObject(conflict ? { observedResponses: 0, selectedRows: 0, deduplicatedRows: 0, excludedRows: 2, excludedResponseGroups: 1, exclusions: { duplicate_response_conflict: 2 } } : { observedResponses: 1, selectedRows: 1, deduplicatedRows: 1, excludedRows: 0, excludedResponseGroups: 0 }); if (conflict) expect(out.summary.usage).toBeNull(); else expect(out.summary.usage[0].counts.total).toBe(92);
  }
});
it("actual validated overflow keeps input/total null while recorded output remains zero", async () => {
  const out = await outputs(await persisted(input([usage("max", { counts: { ...zero, input: Number.MAX_SAFE_INTEGER, total: Number.MAX_SAFE_INTEGER } }), usage("one", { counts: { ...zero, input: 1, total: 1 } })])));
  expect(out.summary.usage[0]).toMatchObject({ observedResponses: 2, counts: { input: null, output: 0, total: null }, overflowComponents: ["input", "total"], limitations: ["numeric_overflow"] }); expect(out.human).toContain("input=unknown; output=0; total=unknown");
});
it("actual4096 distinct cohort CLI preserves complete bounded JSON and exact6/4096/4090 human detail", async () => {
  const rows = Array.from({ length: 4096 }, (_, i) => usage(`maximum-${i}`, { sessionId: id("session", `maximum-${i}`), counts: { ...zero, input: Number.MAX_SAFE_INTEGER, total: Number.MAX_SAFE_INTEGER } })), out = await outputs(await persisted(input(rows)));
  expect(out.summary.usageEligibility).toMatchObject({ observedResponses: 4096, selectedRows: 4096, deduplicatedRows: 0, excludedRows: 0, excludedResponseGroups: 0 }); expect(out.summary.inventory.usage).toBe(4096); expect(out.summary.usage).toHaveLength(4096);
  expect(out.summary.usage.flatMap((c: { usageIds: string[] }) => c.usageIds).sort()).toEqual(rows.map(u => u.id).sort()); for (const c of out.summary.usage) expect(c.counts).toEqual({ ...zero, input: Number.MAX_SAFE_INTEGER, total: Number.MAX_SAFE_INTEGER, uncachedInput: null });
  expect(out.human).toContain("Token cohort detail: shown=6; total=4096; omitted=4090"); expect(out.human.split("\n").filter(line => line.startsWith("Session:"))).toHaveLength(6); expect(out.human.indexOf("Exclusions:")).toBeLessThan(out.human.indexOf("Token cohort detail:")); expect(Buffer.byteLength(out.human)).toBeLessThan(32 * 1024); expect(out.human.trimEnd().split("\n").length).toBeLessThan(160); expect(Buffer.byteLength(out.json)).toBeLessThan(8 * 1024 * 1024);
}, 30000);

const baseline = process.env["AGENTPROF_TOKENS_BASELINE_BINARY"], installed = process.env["AGENTPROF_TOKENS_INSTALLED_BINARY"];
describe.skipIf(!baseline)("authentic immediate PR59 report/open", () => {
  it("preserves full report bytes/modes and open validation on ordinary raw-deleted source", async () => {
    const x = await scanned(), output = join(x.root, "report.html"), before = await bytes(x.data);
    for (const format of [[], ["--json"]]) { const args = ["report", "--source", x.sourceId, "--output", output, ...format], old = invoke(baseline!, x.data, args); expect(old.status).toBe(0); const html = readFileSync(output), mode = statSync(output).mode; expect(mode & 0o777).toBe(0o600); unlinkSync(output); expect(invoke(binary, x.data, args)).toEqual(old); expect(readFileSync(output)).toEqual(html); expect(statSync(output).mode).toBe(mode); unlinkSync(output); }
    for (const format of [[], ["--json"]]) expect(invoke(binary, x.data, ["open", join(x.root, "absent.html"), ...format])).toEqual(invoke(baseline!, x.data, ["open", join(x.root, "absent.html"), ...format])); expect(await bytes(x.data)).toEqual(before);
  });
});
describe.skipIf(!installed)("real scripts-disabled installed tokens artifact", () => {
  it("matches built ordinary/trusted/zero/overflow human/JSON on immutable sources", async () => {
    const snapshots: (SourceSnapshotInput | SourceInput)[] = [await parsedFixture("claude-real-shapes.jsonl", true), input([usage("zero", { counts: zero })]), input([usage("max", { counts: { ...zero, input: Number.MAX_SAFE_INTEGER, total: Number.MAX_SAFE_INTEGER } }), usage("one", { counts: { ...zero, input: 1, total: 1 } })])];
    const ordinary = await scanned(); for (const x of [ordinary, ...await Promise.all(snapshots.map(s => persisted(s)))]) { const before = await bytes(x.data); for (const format of [[], ["--json"]]) expect(invoke(installed!, x.data, ["stats", "--source", x.sourceId, "--tokens", ...format])).toEqual(invoke(binary, x.data, ["stats", "--source", x.sourceId, "--tokens", ...format])); expect(await bytes(x.data)).toEqual(before); }
  });
});
