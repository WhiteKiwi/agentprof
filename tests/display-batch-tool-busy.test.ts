import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { analyzeSourceToolBusy } from "../src/analysis/source-tool-busy.js";
import * as overlap from "../src/analysis/source-invocation-overlap.js";
import * as failure from "../src/analysis/source-failures.js";
import { runScan } from "../src/cli/scan.js";
import { runStats, formatStatsResult } from "../src/cli/stats.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { createSourceStore } from "../src/db/source-store.js";
import { temporaryDirectory } from "./helpers.js";
import { bytes, id, persisted } from "./tokens-support.js";
import { at, epoch, busyEvent, busySource, codexEvent, proofs } from "./display-batch-busy-support.js";

const pairs = [["overlap", [[0, 10000], [5000, 15000]], [20000, 15000]], ["touching", [[0, 10000], [10000, 20000]], [20000, 20000]], ["disjoint", [[0, 10000], [20000, 30000]], [20000, 20000]], ["nested", [[0, 10000], [2000, 8000]], [16000, 10000]], ["triple", [[0, 10000], [0, 10000], [0, 10000]], [30000, 10000]], ["zero", [[1, 1]], [0, 0]]] as const;
describe("PR71 tool-busy independent contracts", () => {
  it.each(pairs)("%s exact union for Claude and Codex", (_name, intervals, expected) => {
    for (const make of [busyEvent, codexEvent]) {
      const source = busySource(intervals.map(([start, end], i) => make(`geometry-${i}`, start, end))), before = JSON.stringify(source), r = analyzeSourceToolBusy(source), p = r.partitions[0]!;
      expect([p.durationSumMs, p.toolBusyMs]).toEqual(expected); expect(p.eventN).toBe(intervals.length); expect(p.contributingEventIds).toHaveLength(intervals.length); expect(p.evidenceObservationIds).toHaveLength(2 * intervals.length);
      expect(JSON.stringify(source)).toBe(before); expect(Object.isFrozen(source)).toBe(false); expect(Object.isFrozen(r)).toBe(true); expect(Object.isFrozen(p)).toBe(true);
    }
  });
  it("uses exactly one inherited admission for each provider", () => {
    const a = vi.spyOn(overlap, "analyzeSourceInvocationOverlap"), b = vi.spyOn(failure, "analyzeSourceFailures");
    try { analyzeSourceToolBusy(busySource([busyEvent("claude")])); expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1); a.mockClear(); b.mockClear(); analyzeSourceToolBusy(busySource([codexEvent("codex")])); expect(a).not.toHaveBeenCalled(); expect(b).toHaveBeenCalledTimes(1); } finally { a.mockRestore(); b.mockRestore(); }
  });
  it.each(["state_limited", "ambiguous", "unavailable", "absent", "unsupported_contract", "missing_proof", "estimated", "scope", "model", "result_mismatch"])("preserves %s suppression/exclusion", kind => {
    for (const make of [busyEvent, codexEvent]) {
      let source = busySource([make("one"), make("two", 5000, 15000)]);
      if (kind === "state_limited" || kind === "ambiguous") source = { ...source, evidence: { ...source.evidence!, capabilities: { ...source.evidence!.capabilities, ...(kind === "state_limited" ? { stateLimited: true } : { ambiguousRecords: 1 }) } } };
      if (kind === "unavailable") source = { ...source, availability: "unavailable" };
      if (kind === "absent") source = { ...source, evidence: null };
      if (kind === "unsupported_contract") source = { ...source, parserVersion: 77 };
      if (kind === "missing_proof") source = { ...source, evidence: { ...source.evidence!, observations: source.evidence!.observations.filter(o => o.eventId !== source.events[1]!.id) } };
      if (kind === "estimated" || kind === "scope" || kind === "model") source = { ...source, events: source.events.map(e => ({ ...e, ...(kind === "estimated" ? { intervalTimingEvidence: "estimated" as const } : kind === "scope" ? { intervalScope: "process_runtime" as const } : { kind: "model" as const, category: "model" as const, toolName: null }) })) };
      if (kind === "result_mismatch") source = { ...source, evidence: { ...source.evidence!, observations: source.evidence!.observations.map(o => o.eventId === source.events[1]!.id && o.representation === "result" ? "observedResult" in o ? { ...o, observedResult: { ...o.observedResult!, observedAt: at(14999) } } : { ...o, sourceRef: { ...o.sourceRef, byteOffset: 9 } } : o) } };
      const r = analyzeSourceToolBusy(source);
      if (kind === "result_mismatch" && make === busyEvent) expect(r.partitions[0]!.toolBusyMs).toBe(10000);
      else expect(r.partitions.every(p => p.toolBusyMs === null)).toBe(true);
      if (kind === "missing_proof" || kind === "result_mismatch" && make === codexEvent) expect(r.inheritedAdmission.admittedTerminalCalls).toBe(0);
    }
  });
  it("keeps lifecycle and paired contracts separate; never substitutes duration", () => {
    const source = busySource([codexEvent("a"), codexEvent("b", 5000, 15000), codexEvent("lifecycle", 100, 200, true, { durationMs: 4, durationScope: "process_runtime", timingEvidence: "source_reported" })]);
    const r = analyzeSourceToolBusy(source); expect(r.partitions.map(p => [p.intervalScope, p.durationSumMs, p.toolBusyMs])).toEqual([["invocation_latency", 20000, 15000], ["item_lifecycle", 100, 100]]); expect(r).not.toHaveProperty("toolBusyMs");
  });
  it.each(["success", "no_match", "change_detected", "error"] as const)("admits supported structured outcome %s including transport status", executionOutcome => {
    const e = codexEvent(executionOutcome, 100, 200, true, { executionOutcome, status: executionOutcome === "error" ? "failed" : "completed", exitCode: executionOutcome === "success" ? 0 : 1 });
    expect(analyzeSourceToolBusy(busySource([e])).partitions[0]).toMatchObject({ durationSumMs: 100, toolBusyMs: 100, eventN: 1 });
  });
  it("supports admitted poll and excludes unsupported/nonterminal while keeping full counts", () => {
    const e = codexEvent("poll"), source = busySource([e, codexEvent("cancelled", 0, 10, false, { status: "cancelled" }), codexEvent("pending", 0, 10, false, { status: "pending" })], proofs(e).map(o => o.representation === "result" ? { ...o, representation: "poll" as const } : o));
    expect(analyzeSourceToolBusy(source)).toMatchObject({ excluded: 2, inheritedAdmission: { exclusions: { pending: 1, cancelled: 1 } }, partitions: [{ durationSumMs: 10000, toolBusyMs: 10000 }] });
  });
  it.each(["difference", "sum"])("retains numeric overflow nulls for %s", kind => {
    for (const make of [busyEvent, codexEvent]) {
      const rows = (kind === "sum" ? ["a", "b"] : ["a"]).map(name => (make === codexEvent ? codexEvent(name, 0, 1, false, { startAt: new Date(kind === "sum" ? 0 : -8e15).toISOString(), endAt: new Date(kind === "sum" ? 6e15 : 8e15).toISOString() }) : busyEvent(name, 0, 1, { startAt: new Date(kind === "sum" ? 0 : -8e15).toISOString(), endAt: new Date(kind === "sum" ? 6e15 : 8e15).toISOString() })));
      expect(analyzeSourceToolBusy(busySource(rows)).partitions[0]).toMatchObject({ durationSumMs: null, toolBusyMs: null, eventN: rows.length, reason: kind === "sum" ? "unsafe_interval_sum" : "unsafe_endpoint_difference" });
    }
  });
  it("keeps synthetic sessions separate and prints six partitions with exact omissions", async () => {
    const events = Array.from({ length: 8 }, (_, i) => busyEvent(`session-${i}`, 0, 10, { sessionId: id("session", `busy-${i}`) })), s = busySource(events), snapshot = { ...Object.fromEntries(["sourceId", "provider", "parserVersion", "normalizationVersion", "keyVersion", "keyId", "completedOffset", "observedSize", "boundaryFingerprint"].map(key => [key, s[key as keyof typeof s]])), events: s.events, evidence: s.evidence }, x = await persisted(snapshot as never), r = await runStats({ dataDir: x.data, source: x.sourceId, toolBusy: true });
    expect(formatStatsResult(r, false)).toContain("showing 6 of 8; omitted=2"); expect(JSON.parse(formatStatsResult(r, true)).result.analysis.partitions).toHaveLength(8);
  });
  it.each(["codex", "claude"] as const)("ordinary %s scan/store/raw-delete/reopen uses actual pinned endpoint tuples", async provider => {
    const root = temporaryDirectory(), rawRoot = join(root, "raw"), dataDir = join(root, "data"); await mkdir(rawRoot);
    const record = (payload: unknown, ms = 0, type = "response_item") => ({ timestamp: at(ms), type, payload });
    const lines = provider === "codex" ? [record({ id: "FICTITIOUS_BATCH", cwd: "/FICTITIOUS_PROJECT" }, 0, "session_meta"), record({ type: "function_call", call_id: "a", name: "exec_command", arguments: JSON.stringify({ cmd: "rg FICTITIOUS src" }) }), record({ type: "function_call_output", call_id: "a", output: { exit_code: 0, output: "FICTITIOUS" } }, 10000), record({ type: "function_call", call_id: "b", name: "exec_command", arguments: JSON.stringify({ cmd: "npm test" }) }, 5000), record({ type: "function_call_output", call_id: "b", output: { exit_code: 0, output: "FICTITIOUS" } }, 15000), record({ type: "item_completed", thread_id: "FICTITIOUS_BATCH", started_at_ms: epoch + 100, completed_at_ms: epoch + 200, item: { type: "CommandExecution", id: "structured", source: "unified_exec_startup", command: "npm test", status: "completed", exit_code: 0, duration: { secs: 0, nanos: 4e6 }, output: "FICTITIOUS" } }, 200, "event_msg")]
      : [{ type: "assistant", uuid: "FICTITIOUS_CALL_A", sessionId: "FICTITIOUS_BATCH", timestamp: at(0), message: { id: "FICTITIOUS_MSG_A", role: "assistant", content: [{ type: "tool_use", id: "FICTITIOUS_A", name: "Read", input: { file_path: "/FICTITIOUS_PROJECT/a.ts" } }] } }, { type: "user", uuid: "FICTITIOUS_RESULT_A", sessionId: "FICTITIOUS_BATCH", timestamp: at(10000), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "FICTITIOUS_A", is_error: false, content: "FICTITIOUS" }] } }, { type: "assistant", uuid: "FICTITIOUS_CALL_B", sessionId: "FICTITIOUS_BATCH", timestamp: at(5000), message: { id: "FICTITIOUS_MSG_B", role: "assistant", content: [{ type: "tool_use", id: "FICTITIOUS_B", name: "Read", input: { file_path: "/FICTITIOUS_PROJECT/b.ts" } }] } }, { type: "user", uuid: "FICTITIOUS_RESULT_B", sessionId: "FICTITIOUS_BATCH", timestamp: at(15000), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "FICTITIOUS_B", is_error: false, content: "FICTITIOUS" }] } }];
    await writeFile(join(rawRoot, "synthetic.jsonl"), lines.map(JSON.stringify).join("\n") + "\n"); const scan = await runScan({ dataDir, codexRoot: provider === "codex" ? [rawRoot] : [], claudeRoot: provider === "claude" ? [rawRoot] : [] }); expect(scan.counts.committed).toBe(1); await rm(rawRoot, { recursive: true });
    const selected = await withReadOnlyStore(dataDir, (db, key) => createSourceStore(db, key).listSources().items[0]!.sourceId), before = await bytes(dataDir), r = await runStats({ dataDir, source: selected, toolBusy: true });
    const a = JSON.parse(formatStatsResult(r, true)).result.analysis; expect(a.partitions.find((p: { intervalScope: string }) => p.intervalScope === "invocation_latency")).toMatchObject({ durationSumMs: 20000, toolBusyMs: 15000 }); if (provider === "codex") expect(a.partitions.find((p: { intervalScope: string }) => p.intervalScope === "item_lifecycle")).toMatchObject({ durationSumMs: 100, toolBusyMs: 100 }); expect(await bytes(dataDir)).toEqual(before);
  });
});
