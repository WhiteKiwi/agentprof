import { spawnSync } from "node:child_process";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import type { StoredSource } from "../src/db/source-store.js";
import { createSourceStore } from "../src/db/source-store.js";
import { openDatabase } from "../src/db/database.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { runScan } from "../src/cli/scan.js";
import { analyzeSourceActiveTime } from "../src/analysis/source-active-time.js";
import { analyzeSelectedHistory } from "../src/analysis/source-history.js";
import { reconcileHistorySources } from "../src/analysis/history-reconcile.js";
import { parseHistoryQuery, HistoryQueryError } from "../src/analysis/history-query.js";
import { bytes, codexMeta, context, disk, encode, keyId, record, window } from "./usage-timing-fixture.js";
import type { Provider } from "./usage-timing-fixture.js";
import { claudePair, codexRows, errorText, filePath, patchRoot, readRoot } from "./provider-evidence-fixture.js";

const providers = ["codex", "claude"] as const;
type Mode = "legacy" | "timing" | "patterns";
const modes = [["legacy", "legacy"], ["legacy", "timing"], ["legacy", "patterns"],
  ["timing", "timing"], ["timing", "patterns"], ["patterns", "patterns"]] as const;
const current = resolve("dist/agentprof.cjs");
const baseline = process.env.AGENTPROF_PROVIDER_EVIDENCE_COMPOSITION_BASELINE_BINARY;
const installed = process.env.AGENTPROF_PROVIDER_EVIDENCE_COMPOSITION_INSTALLED_BINARY;
const epoch = Date.UTC(2026, 9, 3), at = (n: number) => new Date(epoch + n).toISOString();
const query = parseHistoryQuery(window);
const modeOptions = (mode: Mode) => mode === "patterns" ? { patternEvidence: true }
  : mode === "timing" ? { usageTiming: true } : {};
const version = (provider: Provider, mode: Mode) => (provider === "codex" ? 1 : 2) + (mode === "legacy" ? 0 : mode === "timing" ? 1 : 2);

/** Ordinary records independently fix a 1s invocation and a 10s native turn with an 8150ms supplied duration. */
function nativeRows(provider: Provider): unknown[] {
  if (provider === "codex") return [
    { ...codexMeta, payload: { ...codexMeta.payload, cwd: "/FICTITIOUS_PROVIDER_ROOT" } },
    { type: "turn_context", payload: { turn_id: "FICTITIOUS_TURN" } },
    { type: "response_item", timestamp: at(0), payload: { type: "function_call", call_id: "FICTITIOUS_CALL", name: "exec_command", arguments: JSON.stringify({ cmd: "rg FICTITIOUS_QUERY src" }) } },
    { type: "response_item", timestamp: at(1000), payload: { type: "function_call_output", call_id: "FICTITIOUS_CALL", output: { exit_code: 0, output: "FICTITIOUS_OUTPUT" } } },
    { type: "event_msg", timestamp: at(10000), payload: { type: "task_complete", thread_id: "FICTITIOUS_USAGE_SESSION", turn_id: "FICTITIOUS_TURN", started_at: epoch / 1000, completed_at: (epoch + 10000) / 1000, duration_ms: 8150 } },
    record(provider),
  ];
  return [
    { type: "assistant", uuid: "FICTITIOUS_CALL_UUID", sessionId: "FICTITIOUS_USAGE_SESSION", cwd: "/FICTITIOUS_PROVIDER_ROOT", version: "2.1.63", timestamp: at(0), message: { id: "FICTITIOUS_MESSAGE", role: "assistant", content: [{ type: "tool_use", id: "FICTITIOUS_CALL", name: "Bash", input: { command: "rg FICTITIOUS_QUERY src" } }] } },
    { type: "user", uuid: "FICTITIOUS_RESULT_UUID", sessionId: "FICTITIOUS_USAGE_SESSION", cwd: "/FICTITIOUS_PROVIDER_ROOT", version: "2.1.63", timestamp: at(1000), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "FICTITIOUS_CALL", is_error: false, content: "FICTITIOUS_OUTPUT" }] } },
    { type: "system", subtype: "turn_duration", uuid: "FICTITIOUS_DURATION_UUID", sessionId: "FICTITIOUS_USAGE_SESSION", version: "2.1.63", timestamp: at(10000), durationMs: 8150 },
    record(provider),
  ];
}
async function fixture(provider: Provider, rows = nativeRows(provider)) {
  const x = await disk(provider, rows as never), copy = join(x.inputRoot, "FICTITIOUS_COPY.jsonl");
  await writeFile(copy, encode(rows));
  return { ...x, rows, copy, copyId: context.fingerprint("source", [provider, copy]), provider };
}
async function readSource(data: string, sourceId: string): Promise<StoredSource> {
  return withReadOnlyStore(data, (db, key) => createSourceStore(db, key).readSource(sourceId)!);
}
async function checkpoint(data: string, sourceId: string) {
  const db = await openDatabase(data);
  try { return createSourceStore(db, keyId).readSourceForIngestion(sourceId, context); }
  finally { db.close(); }
}
async function pair(provider: Provider, left: Mode = "legacy", right: Mode = "patterns", rows = nativeRows(provider)) {
  const x = await fixture(provider, rows);
  expect((await runScan({ ...x.options, ...modeOptions(left) })).counts.committed).toBe(1);
  expect((await runScan({ ...x.options, [`${provider}Root`]: [x.copy], ...modeOptions(right) })).counts.committed).toBe(1);
  return { ...x, left: await readSource(x.data, x.sourceId), right: await readSource(x.data, x.copyId) };
}
function nativeProofIds(source: StoredSource): string[] {
  return source.evidence!.observations.filter(o => o.eventId === source.events[0]!.id
    && ["call", "result", "poll", "structured"].includes(o.representation)).map(o => o.id).sort();
}
function turnProofIds(source: StoredSource): string[] {
  return source.evidence!.observations.filter(o => o.turnId === source.evidence!.turns[0]!.id
    && o.representation === "turn").map(o => o.id).sort();
}
/** Malformed consumer inputs only; no future or relabelled contract is persisted. */
function contract(source: StoredSource, header: number, capability = header): StoredSource {
  return { ...source, parserVersion: header, evidence: { ...source.evidence!, capabilities: { ...source.evidence!.capabilities, parserVersion: capability } } } as StoredSource;
}
function invoke(binary: string, args: string[]) {
  const r = spawnSync(process.execPath, [binary, ...args], { env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
  expect(r.error, `${binary}: ${r.stderr}`).toBeUndefined();
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const scanArgs = (x: Awaited<ReturnType<typeof fixture>>, paths = [x.path], mode: Mode = "legacy") => ["scan", "--data-dir", x.data,
  ...paths.flatMap(p => [`--${x.provider}-root`, p]), ...(mode === "timing" ? ["--usage-timing"] : mode === "patterns" ? ["--pattern-evidence"] : []), "--json"];
const historyArgs = (x: Awaited<ReturnType<typeof fixture>>) => ["history", "--data-dir", x.data, "--source", x.sourceId, "--source", x.copyId,
  "--from", window.from, "--to", window.to, "--offset", window.offset, "--json"];

for (const provider of providers) it.each(modes)(`${provider} %s/%s native copies admit one execution with exact stored contracts and proof`, async (left, right) => {
  const x = await pair(provider, left, right), before = await bytes(x.data);
  expect([x.left.parserVersion, x.right.parserVersion]).toEqual([version(provider, left), version(provider, right)]);
  const nativeEvent = (s: StoredSource) => s.events.map(({ sourceRef: _, ...e }) => e);
  expect(nativeEvent(x.left)).toEqual(nativeEvent(x.right));
  expect(nativeProofIds(x.left)).toHaveLength(2); expect(nativeProofIds(x.right)).toHaveLength(2);
  const h = analyzeSelectedHistory([x.left, x.right], query);
  expect(h.reconciliation.counts).toEqual({ eventCopies: 2, canonicalExecutions: 1, duplicateCopies: 1, admittedExecutions: 1,
    conflictingExecutions: 0, excludedExecutions: 0, unpositionedExecutions: 0 });
  for (const s of [x.left, x.right]) expect(h.reconciliation.executions[0]!.copies.find(c => c.sourceId === s.sourceId))
    .toEqual({ sourceId: s.sourceId, revision: 1, admitted: true, positioned: true, proofIds: nativeProofIds(s), reason: null });
  expect(h.reconciliation.sources.map(s => s.parserVersion).sort()).toEqual([version(provider, left), version(provider, right)].sort());
  expect(h.days).toHaveLength(1); expect(h.days[0]).toMatchObject({ terminalCompletions: 1, completedN: 1, toolBusyMs: 1000 });
  expect(analyzeSelectedHistory([x.right, x.left], query)).toEqual(h);
  await rm(x.inputRoot, { recursive: true });
  expect(analyzeSelectedHistory([await readSource(x.data, x.sourceId), await readSource(x.data, x.copyId)], query)).toEqual(h);
  expect(await bytes(x.data)).toEqual(before);
});

it("Codex3 preserves the full native 10000ms union/span and proof independently of 8150ms duration and usage dates", async () => {
  const x = await pair("codex"), prior = analyzeSourceActiveTime(x.left), enriched = analyzeSourceActiveTime(x.right), turn = x.right.evidence!.turns[0]!;
  expect(turn).toMatchObject({ durationMs: 8150, startAt: "2026-10-03T00:00:00.000Z", endAt: "2026-10-03T00:00:10.000Z", intervalScope: "turn_wall", intervalTimingEvidence: "source_reported", status: "completed" });
  expect(turnProofIds(x.right)).toHaveLength(1);
  expect(enriched).toMatchObject({ parserVersion: 3, assessment: "evaluated", summary: { eligibleTurns: 1, excludedTurns: 0, partitions: 1 },
    partitions: [{ turnN: 1, activeTimeMs: 10000, observedSpanMs: 10000, turnIds: [turn.id], turnEvidence: [{ turnId: turn.id, status: "completed", startAt: turn.startAt, endAt: turn.endAt, evidenceObservationIds: turnProofIds(x.right) }] }] });
  const comparable = (s: StoredSource) => analyzeSourceActiveTime(s).partitions!.map(p => ({ ...p,
    turnEvidence: p.turnEvidence.map(({ evidenceObservationIds: _, ...t }) => t) }));
  expect(prior.partitions![0]).toMatchObject({ activeTimeMs: 10000, observedSpanMs: 10000 });
  expect(comparable(x.right)).toEqual(comparable(x.left));
  const altered = { ...x.right, evidence: { ...x.right.evidence!, observations: x.right.evidence!.observations.map(o => o.representation === "usage" ? { ...o, usageObservedAt: "2099-01-01T00:00:00.000Z" } : o) } };
  expect(analyzeSourceActiveTime(altered).partitions).toEqual(enriched.partitions);
});
it("Claude4 duration-only 8150ms turn remains unsupported for native Active Time", async () => {
  const x = await pair("claude");
  expect(x.right.evidence!.turns).toHaveLength(1);
  expect(x.right.evidence!.turns[0]).toMatchObject({ durationMs: 8150, startAt: null, endAt: null, intervalScope: "unknown", intervalTimingEvidence: "unknown" });
  expect(analyzeSourceActiveTime(x.right)).toMatchObject({ assessment: "unavailable", activeTimeAssessmentReason: "unsupported_provider", partitions: null });
});

for (const provider of providers) it.each(["future", "unknown", "header mismatch", "capability mismatch"] as const)(`${provider} enriched native aliases reject %s contracts`, async kind => {
  const x = await pair(provider), old = provider === "codex" ? 1 : 2, rich = provider === "codex" ? 3 : 4;
  const changed = kind === "future" ? contract(x.right, rich + 1) : kind === "unknown" ? contract(x.right, 77)
    : kind === "header mismatch" ? contract(x.right, old, rich) : contract(x.right, rich, old);
  const h = analyzeSelectedHistory([x.left, changed], query);
  expect(h.reconciliation.counts.conflictingExecutions).toBe(1);
  expect(h.reconciliation.executions[0]!.reasons).toContain(kind === "future" || kind === "unknown" ? "semantic_or_contract_conflict" : "copy_admission_disagreement");
  expect(h.reconciliation.executions[0]!.interval).toBeNull(); expect(h.days).toEqual([]);
});
it("Claude1 is not an alias for the supported Claude4 native contract", async () => {
  const x = await pair("claude"), h = reconcileHistorySources([contract(x.left, 1), x.right]);
  expect(h.counts.conflictingExecutions).toBe(1); expect(h.executions[0]!.reasons).toContain("semantic_or_contract_conflict");
});
for (const provider of providers) it.each(["duration", "status", "session", "provider"] as const)(`${provider} enriched alias still conflicts on changed %s event fields before filtering`, async field => {
  const x = await pair(provider), e = x.right.events[0]!;
  const changed = { ...x.right, events: [{ ...e, ...(field === "duration" ? { durationMs: 1001 }
    : field === "status" ? { status: "failed" as const, executionOutcome: "error" as const }
    : field === "provider" ? { provider: provider === "codex" ? "claude" as const : "codex" as const }
    : { sessionId: context.fingerprint("session", ["FICTITIOUS_OTHER_SESSION"]) }) }] };
  const h = analyzeSelectedHistory([x.left, changed], { ...query, sessionId: x.left.events[0]!.sessionId });
  expect(h.reconciliation.counts.conflictingExecutions).toBe(1); expect(h.reconciliation.executions[0]!.reasons).toContain("semantic_or_contract_conflict");
  expect(h.days).toEqual([]);
});
for (const provider of providers) it.each(["missing", "wrapper", "unavailable"] as const)(`${provider} enriched alias cannot repair %s native admission`, async kind => {
  const x = await pair(provider), id = x.right.events[0]!.id;
  const changed = kind === "unavailable" ? { ...x.right, availability: "unavailable" as const }
    : { ...x.right, evidence: { ...x.right.evidence!, observations: kind === "missing" ? x.right.evidence!.observations.filter(o => o.eventId !== id)
      : x.right.evidence!.observations.map(o => o.eventId === id ? { ...o, origin: "wrapper" as const } : o) } };
  const h = analyzeSelectedHistory([x.left, changed], query);
  expect(h.reconciliation.counts.conflictingExecutions).toBe(1); expect(h.reconciliation.executions[0]!.reasons).toContain("copy_admission_disagreement");
  expect(h.days).toEqual([]);
});
it.each(providers)("%s enriched native alias preserves contradictory call-position withholding", async provider => {
  const x = await pair(provider), changed = { ...x.right, evidence: { ...x.right.evidence!, observations: x.right.evidence!.observations.map(o => o.representation === "call"
    ? { ...o, turnId: context.fingerprint("turn", ["FICTITIOUS_OTHER_TURN"]) } : o) } };
  const h = analyzeSelectedHistory([x.left, changed], query), e = h.reconciliation.executions[0]!;
  expect(e.copies.every(c => c.admitted)).toBe(true); expect(e).toMatchObject({ state: "unpositioned", interval: null });
  expect(e.reasons).toContain("contradictory_turn_proof"); expect(h.days).toEqual([]);
});
it.each(["normalizationVersion", "keyVersion", "keyId"] as const)("enriched native aliases preserve mixed %s selection rejection", async field => {
  const x = await pair("codex"), changed = { ...x.right, [field]: field === "keyId" ? "8".repeat(32) : 2 };
  expect(() => reconcileHistorySources([x.left, changed])).toThrow(HistoryQueryError);
});
it.each([[4, 4], [3, 2], [2, 3]] as const)("Codex3 Active Time retains rejection of header%i/capability%i", async (header, capability) => {
  const x = await pair("codex");
  expect(analyzeSourceActiveTime(contract(x.right, header, capability))).toMatchObject({ assessment: "unavailable", activeTimeAssessmentReason: "unsupported_parser_contract", summary: { eligibleTurns: null, excludedTurns: null, partitions: null }, partitions: null });
});
it.each(["missing", "contradictory", "pending", "unknown boundaries", "estimated"] as const)("Codex3 Active Time keeps %s native turn evidence excluded", async kind => {
  const x = await pair("codex"), turn = x.right.evidence!.turns[0]!;
  const changed = { ...x.right, evidence: { ...x.right.evidence!,
    observations: kind === "missing" ? x.right.evidence!.observations.filter(o => o.representation !== "turn")
      : kind === "contradictory" ? x.right.evidence!.observations.map(o => o.representation === "turn" ? { ...o, transportStatus: "cancelled" as const } : o) : x.right.evidence!.observations,
    turns: [{ ...turn, ...(kind === "pending" ? { status: "pending" as const } : kind === "unknown boundaries" ? { startAt: null }
      : kind === "estimated" ? { intervalTimingEvidence: "estimated" as const } : {}) }] } };
  const reason = kind === "missing" ? "missingTerminalProof" : kind === "contradictory" ? "contradictoryTerminalProof"
    : kind === "pending" ? "pending" : kind === "unknown boundaries" ? "missingBoundaries" : "estimatedTiming";
  expect(analyzeSourceActiveTime(changed)).toMatchObject({ assessment: "no_eligible_turns", summary: { eligibleTurns: 0, excludedTurns: 1, partitions: 0 }, exclusions: { [reason]: 1 }, excludedTurnEvidence: [{ turnId: turn.id, reason }], partitions: [] });
});

it.each(["codex error", "claude error", "claude Read", "claude patch"] as const)("actual %s enriched fields remain whole-event copy conflicts", async kind => {
  const provider = kind === "codex error" ? "codex" : "claude";
  const rows = kind === "codex error" ? codexRows().slice(0, 4) : kind === "claude error" ? claudePair("error", "Bash", undefined, errorText, true, errorText)
    : kind === "claude Read" ? claudePair("read", "Read", { file_path: filePath }, "1 alpha\n2 beta", false, readRoot())
    : claudePair("patch", "Edit", { file_path: filePath, old_string: "alpha", new_string: "beta" }, "success", false, patchRoot());
  const x = await pair(provider, "legacy", "patterns", rows), old = x.left.events[0]!, rich = x.right.events[0]!;
  expect(x.left.events).toHaveLength(1); expect(x.right.events).toHaveLength(1); expect(rich.id).toBe(old.id);
  if (kind.endsWith("error")) { expect(old.errorFingerprint).toBeNull(); expect(rich.errorFingerprint).not.toBeNull(); }
  else if (kind === "claude Read") { expect(old.contentState).toBe("unknown"); expect(rich).toMatchObject({ contentState: "complete", lookupRange: { startLine: 1, endLine: 2 } }); expect(rich.contentFingerprint).not.toBeNull(); }
  else { expect(old.changeState).toBe("unknown"); expect(rich.changeState).toBe("changed"); }
  expect(rich.validationScope).toBe("unknown");
  const h = analyzeSelectedHistory([x.left, x.right], query);
  expect(h.reconciliation.counts).toMatchObject({ eventCopies: 2, canonicalExecutions: 1, admittedExecutions: 0, conflictingExecutions: 1 });
  expect(h.reconciliation.executions[0]!.reasons).toContain("semantic_or_contract_conflict"); expect(h.days).toEqual([]);
  expect(JSON.stringify(h)).not.toContain("FICTITIOUS_");
});

/** External cases require actual preceding-main/installed artifacts; no replacement binary is manufactured. */
for (const provider of providers) it.runIf(Boolean(baseline)).each(["legacy", "timing"] as const)(`${provider} genuine preceding-main %s sealed generation preserves bytes before enriched replay`, async mode => {
  const x = await fixture(provider), args = scanArgs(x, [x.path, x.copy], mode), first = invoke(baseline!, args);
  expect([0, 1]).toContain(first.status); expect(JSON.parse(first.stdout).result.counts.committed).toBe(2);
  const old = await readSource(x.data, x.sourceId), authenticated = await checkpoint(x.data, x.sourceId), before = await bytes(x.data);
  expect(old.parserVersion).toBe(version(provider, mode)); expect(authenticated.checkpoint).not.toBeNull();
  expect(invoke(current, args)).toEqual(invoke(baseline!, args)); expect(await bytes(x.data)).toEqual(before);
  expect(await checkpoint(x.data, x.sourceId)).toEqual(authenticated);
  const enriched = invoke(current, scanArgs(x, [x.path], "patterns")); expect([0, 1]).toContain(enriched.status);
  expect(JSON.parse(enriched.stdout).result.sources[0].committedRevision).toBe(2);
  const rich = await readSource(x.data, x.sourceId), sealed = await checkpoint(x.data, x.sourceId);
  expect(rich.parserVersion).toBe(version(provider, "patterns")); expect(sealed.checkpoint).not.toBeNull();
  expect(JSON.parse(JSON.parse(sealed.checkpoint!.checkpoint).payload)).toMatchObject({ parserVersion: rich.parserVersion, patternEvidencePolicyVersion: 1 });
  expect(rich.events).toEqual(old.events); expect(rich.evidence!.turns).toEqual(old.evidence!.turns); expect(rich.evidence!.usage).toEqual(old.evidence!.usage);
  const h = analyzeSelectedHistory([rich, await readSource(x.data, x.copyId)], query);
  expect(h.reconciliation.counts).toMatchObject({ admittedExecutions: 1, conflictingExecutions: 0 });
  if (provider === "codex") expect(analyzeSourceActiveTime(rich).partitions![0]).toMatchObject({ activeTimeMs: 10000, observedSpanMs: 10000 });
  const unchanged = await bytes(x.data);
  expect(JSON.parse(invoke(current, scanArgs(x, [x.path], "patterns")).stdout).result.counts.unchanged).toBe(1);
  expect(await bytes(x.data)).toEqual(unchanged); expect(await checkpoint(x.data, x.sourceId)).toEqual(sealed);
  await appendFile(x.path, encode([record(provider, "FICTITIOUS_APPEND_RESPONSE", "2026-10-03T15:00:00.000Z", 20)]));
  expect(JSON.parse(invoke(current, scanArgs(x, [x.path], "patterns")).stdout).result.sources[0].committedRevision).toBe(3);
  expect((await readSource(x.data, x.sourceId)).evidence!.observations.filter(o => o.representation === "usage").map(o => o.usageObservedAt)).toEqual(["2026-10-03T14:59:59.000Z", "2026-10-03T15:00:00.000Z"]);
  expect(JSON.parse(invoke(current, scanArgs(x, [x.path], mode)).stdout).result.sources[0].committedRevision).toBe(4);
  const restored = await readSource(x.data, x.sourceId);
  expect(restored.parserVersion).toBe(old.parserVersion); expect(restored.events).toEqual(old.events); expect(restored.evidence!.turns).toEqual(old.evidence!.turns);
  if (mode === "legacy") expect(restored.evidence!.observations.every(o => !Object.hasOwn(o, "usageObservedAt"))).toBe(true);
}, 60000);

it.runIf(Boolean(baseline)).each(providers)("%s genuine preceding-main corrupted generation rejects richer replay without repair", async provider => {
  const x = await fixture(provider); expect(JSON.parse(invoke(baseline!, scanArgs(x)).stdout).result.counts.committed).toBe(1);
  const db = await openDatabase(x.data);
  try { db.prepare("UPDATE source_parser_checkpoints SET generation_seal=? WHERE source_id=?").run(context.fingerprint("source", ["FICTITIOUS_CORRUPTED_SEAL"]), x.sourceId); }
  finally { db.close(); }
  const before = await bytes(x.data), failed = invoke(current, scanArgs(x, [x.path], "patterns"));
  expect(failed.status).toBe(1); expect(JSON.parse(failed.stdout).result).toMatchObject({ stopReason: "storage_failure", counts: { committed: 0, failed: 1 }, sources: [{ status: "failed", committedRevision: null }] });
  expect(await bytes(x.data)).toEqual(before);
});

it.runIf(Boolean(installed))("actual installed artifact preserves enriched copies, native Active Time and raw-deleted consumers", async () => {
  for (const provider of providers) {
    const x = await fixture(provider);
    expect(JSON.parse(invoke(current, scanArgs(x, [x.path, x.copy], "timing")).stdout).result.counts.committed).toBe(2);
    expect(JSON.parse(invoke(installed!, scanArgs(x, [x.path], "patterns")).stdout).result.sources[0].committedRevision).toBe(2);
    const before = await bytes(x.data);
    expect(invoke(installed!, scanArgs(x, [x.path], "patterns"))).toEqual(invoke(current, scanArgs(x, [x.path], "patterns")));
    const history = invoke(installed!, historyArgs(x)); expect(history.status).toBe(0); expect(history).toEqual(invoke(current, historyArgs(x)));
    expect(JSON.parse(history.stdout).result.reconciliation.counts).toMatchObject({ admittedExecutions: 1, conflictingExecutions: 0 });
    const tokens = invoke(installed!, [...historyArgs(x), "--tokens"]); expect(tokens.status).toBe(0); expect(tokens).toEqual(invoke(current, [...historyArgs(x), "--tokens"]));
    expect(JSON.parse(tokens.stdout).result.days).toHaveLength(1);
    const activeArgs = ["stats", "--data-dir", x.data, "--source", x.sourceId, "--active-time", "--json"], active = invoke(installed!, activeArgs);
    expect(active.status).toBe(0); expect(active).toEqual(invoke(current, activeArgs));
    const a = JSON.parse(active.stdout).result.analysis;
    if (provider === "codex") expect(a.partitions[0]).toMatchObject({ activeTimeMs: 10000, observedSpanMs: 10000, turnN: 1 });
    else expect(a).toMatchObject({ activeTimeAssessmentReason: "unsupported_provider", partitions: null });
    const outputs = new Map<string, ReturnType<typeof invoke>>();
    for (const command of ["patterns", "insights"]) {
      const args = [command, "--data-dir", x.data, "--source", x.sourceId, "--json"], result = invoke(installed!, args);
      expect(result.status).toBe(0); expect(result).toEqual(invoke(current, args)); outputs.set(command, result);
    }
    const output = join(x.root, "FICTITIOUS_ENRICHED.html"), reportArgs = ["report", "--data-dir", x.data, "--source", x.sourceId, "--unified", "--output", output, "--json"];
    const report = invoke(installed!, reportArgs); expect(report.status).toBe(0); const html = await readFile(output);
    await rm(output); expect(invoke(current, reportArgs)).toEqual(report); expect(await readFile(output)).toEqual(html);
    expect(html.toString()).not.toContain("FICTITIOUS_");
    await rm(x.inputRoot, { recursive: true });
    expect(invoke(installed!, historyArgs(x))).toEqual(history); expect(invoke(installed!, activeArgs)).toEqual(active);
    for (const [command, result] of outputs) expect(invoke(installed!, [command, "--data-dir", x.data, "--source", x.sourceId, "--json"])).toEqual(result);
    expect(await bytes(x.data)).toEqual(before);
  }
}, 60000);
