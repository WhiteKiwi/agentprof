import { spawnSync } from "node:child_process";
import { appendFile, readFile, rm, unlink, writeFile } from "node:fs/promises";
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
import { bytes, codexMeta, context, disk, encode, record, window } from "./usage-timing-fixture.js";
import type { Provider } from "./usage-timing-fixture.js";

const providers = ["codex", "claude"] as const;
const current = resolve("dist/agentprof.cjs");
const baseline = process.env.AGENTPROF_USAGE_TIMING_COMPOSITION_BASELINE_BINARY;
const installed = process.env.AGENTPROF_USAGE_TIMING_COMPOSITION_INSTALLED_BINARY;
const epoch = Date.UTC(2026, 9, 3);
const at = (n: number) => new Date(epoch + n).toISOString();
const query = parseHistoryQuery(window);

/** Ordinary inert records: one positioned native call, one native turn and one usage response. */
function nativeRows(provider: Provider): unknown[] {
  if (provider === "codex") return [
    { ...codexMeta, payload: { ...codexMeta.payload, cwd: "/FICTITIOUS_COMPOSITION_ROOT" } },
    { type: "turn_context", payload: { turn_id: "FICTITIOUS_TURN" } },
    { type: "response_item", timestamp: at(0), payload: { type: "function_call", call_id: "FICTITIOUS_CALL", name: "exec_command", arguments: JSON.stringify({ cmd: "rg FICTITIOUS_INERT_QUERY src" }) } },
    { type: "response_item", timestamp: at(1000), payload: { type: "function_call_output", call_id: "FICTITIOUS_CALL", output: { exit_code: 0, output: "FICTITIOUS_INERT_OUTPUT" } } },
    { type: "event_msg", timestamp: at(10000), payload: { type: "task_complete", thread_id: "FICTITIOUS_USAGE_SESSION", turn_id: "FICTITIOUS_TURN", started_at: epoch / 1000, completed_at: (epoch + 10000) / 1000, duration_ms: 8150 } },
    record(provider),
  ];
  return [
    { type: "assistant", uuid: "FICTITIOUS_CALL_UUID", sessionId: "FICTITIOUS_USAGE_SESSION", cwd: "/FICTITIOUS_COMPOSITION_ROOT", timestamp: at(0), message: { id: "FICTITIOUS_MESSAGE", role: "assistant", content: [{ type: "tool_use", id: "FICTITIOUS_CALL", name: "Bash", input: { command: "rg FICTITIOUS_INERT_QUERY src" } }] } },
    { type: "user", uuid: "FICTITIOUS_RESULT_UUID", sessionId: "FICTITIOUS_USAGE_SESSION", cwd: "/FICTITIOUS_COMPOSITION_ROOT", timestamp: at(1000), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "FICTITIOUS_CALL", is_error: false, content: "FICTITIOUS_INERT_OUTPUT" }] } },
    record(provider),
  ];
}
async function fixture(provider: Provider) {
  const x = await disk(provider), rows = nativeRows(provider), copy = join(x.inputRoot, "FICTITIOUS_COPY.jsonl");
  await writeFile(x.path, encode(rows)); await writeFile(copy, encode(rows));
  return { ...x, rows, copy, copyId: context.fingerprint("source", [provider, copy]), provider };
}
async function readSource(data: string, sourceId: string): Promise<StoredSource> {
  return withReadOnlyStore(data, (db, key) => createSourceStore(db, key).readSource(sourceId)!);
}
async function pair(provider: Provider) {
  const x = await fixture(provider);
  expect((await runScan({ ...x.options, [`${provider}Root`]: [x.path, x.copy] })).counts.committed).toBe(2);
  const legacy = await readSource(x.data, x.sourceId), legacyCopy = await readSource(x.data, x.copyId);
  expect((await runScan({ ...x.options, usageTiming: true })).sources[0]!.committedRevision).toBe(2);
  return { ...x, legacy, legacyCopy, timed: await readSource(x.data, x.sourceId) };
}
/** Deliberately malformed consumer inputs; these are never written as future stored contracts. */
function contract(source: StoredSource, parserVersion: number, capabilityVersion = parserVersion): StoredSource {
  return { ...source, parserVersion, evidence: { ...source.evidence!, capabilities: { ...source.evidence!.capabilities, parserVersion: capabilityVersion } } } as StoredSource;
}
function nativeProofIds(source: StoredSource): string[] {
  return source.evidence!.observations.filter(o => o.eventId === source.events[0]!.id && ["call", "result", "poll", "structured"].includes(o.representation)).map(o => o.id).sort();
}
function turnProofIds(source: StoredSource): string[] {
  return source.evidence!.observations.filter(o => o.turnId === source.evidence!.turns[0]!.id && o.representation === "turn").map(o => o.id).sort();
}
function invoke(binary: string, args: string[]) {
  const r = spawnSync(process.execPath, [binary, ...args], { env: { ...process.env, NODE_NO_WARNINGS: "1" }, encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
  expect(r.error, `${binary}: ${r.stderr}`).toBeUndefined();
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const scanArgs = (x: Awaited<ReturnType<typeof fixture>>, paths = [x.path], timing = false) => ["scan", "--data-dir", x.data, ...paths.flatMap(p => [`--${x.provider}-root`, p]), ...(timing ? ["--usage-timing"] : []), "--json"];
const historyArgs = (x: Awaited<ReturnType<typeof fixture>>) => ["history", "--data-dir", x.data, "--source", x.sourceId, "--source", x.copyId, "--from", window.from, "--to", window.to, "--offset", window.offset];

it.each(providers)("%s ordinary replay preserves one mixed-mode execution and every native proof", async provider => {
  const x = await pair(provider), before = await bytes(x.data);
  expect([x.legacy.parserVersion, x.timed.parserVersion]).toEqual(provider === "codex" ? [1, 2] : [2, 3]);
  expect(x.timed.events).toEqual(x.legacy.events);
  expect(x.timed.evidence!.turns).toEqual(x.legacy.evidence!.turns);
  expect(x.timed.evidence!.usage).toEqual(x.legacy.evidence!.usage);
  const history = analyzeSelectedHistory([x.timed, x.legacyCopy], query), r = history.reconciliation;
  expect(r.counts).toEqual({ eventCopies: 2, canonicalExecutions: 1, duplicateCopies: 1, admittedExecutions: 1, conflictingExecutions: 0, excludedExecutions: 0, unpositionedExecutions: 0 });
  expect(r.sources.map(s => s.parserVersion).sort()).toEqual(provider === "codex" ? [1, 2] : [2, 3]);
  const copies = r.executions[0]!.copies;
  for (const source of [x.timed, x.legacyCopy]) expect(copies.find(c => c.sourceId === source.sourceId)).toMatchObject({ revision: source.revision, admitted: true, positioned: true, proofIds: nativeProofIds(source), reason: null });
  expect(history.days).toHaveLength(1);
  expect(history.days[0]).toMatchObject({ terminalCompletions: 1, completedN: 1, toolBusyMs: 1000 });
  expect(analyzeSelectedHistory([x.legacyCopy, x.timed], query)).toEqual(history);
  await rm(x.inputRoot, { recursive: true });
  expect(analyzeSelectedHistory([await readSource(x.data, x.sourceId), await readSource(x.data, x.copyId)], query)).toEqual(history);
  expect(await bytes(x.data)).toEqual(before);
});

it("Codex1/2 replay retains the exact native 10000ms union/span and full turn membership", async () => {
  const x = await pair("codex"), legacy = analyzeSourceActiveTime(x.legacy), timed = analyzeSourceActiveTime(x.timed);
  expect(legacy.partitions).toEqual(timed.partitions);
  expect(timed).toMatchObject({ assessment: "evaluated", summary: { eligibleTurns: 1, excludedTurns: 0, partitions: 1 }, partitions: [{ turnN: 1, activeTimeMs: 10000, observedSpanMs: 10000, turnIds: [x.timed.evidence!.turns[0]!.id], turnEvidence: [{ evidenceObservationIds: turnProofIds(x.timed) }] }] });
  expect(x.timed.evidence!.turns[0]!.durationMs).toBe(8150);
  const changedUsage = { ...x.timed, evidence: { ...x.timed.evidence!, observations: x.timed.evidence!.observations.map(o => o.representation === "usage" ? { ...o, usageObservedAt: "2099-01-01T00:00:00.000Z" } : o) } };
  expect(analyzeSourceActiveTime(changedUsage).partitions).toEqual(timed.partitions);
});

it.each(providers)("%s future native contract does not become a timestamp alias", async provider => {
  const x = await pair(provider), future = contract(x.timed, provider === "codex" ? 3 : 4);
  const r = analyzeSelectedHistory([x.legacyCopy, future], query);
  expect(r.reconciliation.executions[0]).toMatchObject({ state: "conflict", interval: null });
  expect(r.reconciliation.executions[0]!.reasons).toContain("semantic_or_contract_conflict");
  expect(r.reconciliation.sources.find(s => s.sourceId === future.sourceId)!.parserVersion).toBe(future.parserVersion);
  expect(r.days).toEqual([]);
});
it("Claude1 remains distinct from the explicit Claude2/3 native pair", async () => {
  const x = await pair("claude"), r = reconcileHistorySources([x.legacyCopy, contract(x.timed, 1)]);
  expect(r.counts.conflictingExecutions).toBe(1);
  expect(r.executions[0]!.reasons).toContain("semantic_or_contract_conflict");
});
it.each(providers)("%s matching native signature cannot rescue a header/capability mismatch", async provider => {
  const x = await pair(provider), malformed = contract(x.timed, x.timed.parserVersion, x.legacy.parserVersion);
  const r = analyzeSelectedHistory([x.legacyCopy, malformed], query);
  expect(r.reconciliation.executions[0]!.reasons).toContain("copy_admission_disagreement");
  expect(r.reconciliation.executions[0]!.copies.find(c => c.sourceId === malformed.sourceId)!.admitted).toBe(false);
  expect(r.days).toEqual([]);
});
for (const provider of providers) it.each(["duration", "status", "session", "provider"] as const)(`${provider} alias still withholds changed %s event fields before query filtering`, async field => {
  const x = await pair(provider), e = x.timed.events[0]!;
  const changed = { ...x.timed, events: [{ ...e, ...(field === "duration" ? { durationMs: e.durationMs! + 1 }
    : field === "status" ? { status: "failed" as const, executionOutcome: "error" as const }
    : field === "provider" ? { provider: provider === "codex" ? "claude" as const : "codex" as const }
    : { sessionId: context.fingerprint("session", ["FICTITIOUS_OTHER_SESSION"]) }) }] };
  const r = analyzeSelectedHistory([x.legacyCopy, changed], { ...query, sessionId: x.legacyCopy.events[0]!.sessionId });
  expect(r.reconciliation.counts.conflictingExecutions).toBe(1);
  expect(r.reconciliation.executions[0]!.reasons).toContain("semantic_or_contract_conflict");
  expect(r.days).toEqual([]);
});
for (const provider of providers) it.each(["missing proof", "contradictory proof", "unavailable"] as const)(`${provider} alias keeps %s admission disagreement withheld`, async kind => {
  const x = await pair(provider), id = x.timed.events[0]!.id;
  const changed = kind === "unavailable" ? { ...x.timed, availability: "unavailable" as const }
    : { ...x.timed, evidence: { ...x.timed.evidence!, observations: kind === "missing proof"
      ? x.timed.evidence!.observations.filter(o => o.eventId !== id)
      : x.timed.evidence!.observations.map(o => o.eventId === id ? { ...o, origin: "wrapper" as const } : o) } };
  const r = analyzeSelectedHistory([x.legacyCopy, changed], query);
  expect(r.reconciliation.counts.conflictingExecutions).toBe(1);
  expect(r.reconciliation.executions[0]!.reasons).toContain("copy_admission_disagreement");
  expect(r.days).toEqual([]);
});
it.each(providers)("%s alias retains admission while contradictory call-position proof stays unpositioned", async provider => {
  const x = await pair(provider);
  const changed = { ...x.timed, evidence: { ...x.timed.evidence!, observations: x.timed.evidence!.observations.map(o => o.representation === "call" ? { ...o, turnId: context.fingerprint("turn", ["FICTITIOUS_OTHER_TURN"]) } : o) } };
  const r = analyzeSelectedHistory([x.legacyCopy, changed], query), execution = r.reconciliation.executions[0]!;
  expect(execution.copies.every(c => c.admitted)).toBe(true);
  expect(execution).toMatchObject({ state: "unpositioned", interval: null });
  expect(execution.reasons).toContain("contradictory_turn_proof");
  expect(r.days).toEqual([]);
});
it.each(["normalizationVersion", "keyVersion", "keyId"] as const)("native alias never bypasses mixed %s selection rejection", async field => {
  const x = await pair("codex"), changed = { ...x.timed, [field]: field === "keyId" ? "8".repeat(32) : 2 };
  expect(() => reconcileHistorySources([x.legacyCopy, changed])).toThrow(HistoryQueryError);
});
it.each([[3, 3], [2, 1], [1, 2]] as const)("Active Time rejects Codex header%i/capability%i instead of inferring supported timing", async (header, capability) => {
  const x = await pair("codex"), r = analyzeSourceActiveTime(contract(x.timed, header, capability));
  expect(r).toMatchObject({ assessment: "unavailable", activeTimeAssessmentReason: "unsupported_parser_contract", summary: { eligibleTurns: null, excludedTurns: null, partitions: null }, partitions: null });
});
it("Claude3 remains unsupported for native turn Active Time", async () => {
  const x = await pair("claude");
  expect(analyzeSourceActiveTime(x.timed)).toMatchObject({ assessment: "unavailable", activeTimeAssessmentReason: "unsupported_provider", partitions: null });
});
it.each(["missing", "contradictory"] as const)("Codex2 keeps %s native terminal turn proof excluded", async kind => {
  const x = await pair("codex"), changed = { ...x.timed, evidence: { ...x.timed.evidence!, observations: kind === "missing"
    ? x.timed.evidence!.observations.filter(o => o.representation !== "turn")
    : x.timed.evidence!.observations.map(o => o.representation === "turn" ? { ...o, transportStatus: "cancelled" as const } : o) } };
  expect(analyzeSourceActiveTime(changed)).toMatchObject({ assessment: "no_eligible_turns", summary: { eligibleTurns: 0, excludedTurns: 1, partitions: 0 }, exclusions: { [kind === "missing" ? "missingTerminalProof" : "contradictoryTerminalProof"]: 1 }, partitions: [] });
});

/** These controls need authentic external artifacts; core semantic regressions above always run in CI. */
it.runIf(Boolean(baseline)).each(providers)("%s genuine current-main sealed generation keeps default bytes and real replay semantics", async provider => {
  const x = await fixture(provider), originalArgs = scanArgs(x, [x.path, x.copy]);
  const first = invoke(baseline!, originalArgs);
  expect(first.status, first.stderr).toBe(provider === "codex" ? 0 : 1);
  expect(JSON.parse(first.stdout).result.counts.committed).toBe(2);
  const legacy = await readSource(x.data, x.sourceId);
  expect(legacy.parserVersion).toBe(provider === "codex" ? 1 : 2);
  expect(legacy.evidence!.observations.every(o => !Object.hasOwn(o, "usageObservedAt"))).toBe(true);
  const db = await openDatabase(x.data);
  try { expect(createSourceStore(db, legacy.keyId).readSourceForIngestion(x.sourceId, context).checkpoint).not.toBeNull(); }
  finally { db.close(); }
  const before = await bytes(x.data);
  expect(invoke(current, originalArgs)).toEqual(invoke(baseline!, originalArgs));
  const help = invoke(baseline!, ["stats", "--help"]);
  expect(help.status).toBe(0); expect(invoke(current, ["stats", "--help"])).toEqual(help);
  const flags = [...help.stdout.matchAll(/^\s{2}--([a-z-]+)\s{2,}/gm)].map(m => m[1]!).filter(f => f !== "list-sources");
  const selections = [null, ...flags]; // The default summary plus45 explicit views make46 selections.
  expect(selections).toHaveLength(46);
  for (const flag of selections) for (const json of [false, true]) {
    const args = ["stats", "--data-dir", x.data, "--source", x.sourceId, ...(flag === null ? [] : [`--${flag}`]), ...(json ? ["--json"] : [])];
    const old = invoke(baseline!, args); expect(old.status, old.stderr).toBe(0); expect(invoke(current, args)).toEqual(old);
  }
  for (const json of [false, true]) {
    const args = ["stats", "--data-dir", x.data, "--list-sources", ...(json ? ["--json"] : [])];
    expect(invoke(current, args)).toEqual(invoke(baseline!, args));
  }
  for (const command of ["insights", "patterns"]) for (const json of [false, true]) {
    const args = [command, "--data-dir", x.data, "--source", x.sourceId, ...(json ? ["--json"] : [])];
    const old = invoke(baseline!, args); expect(old.status, old.stderr).toBe(0); expect(invoke(current, args)).toEqual(old);
  }
  for (const json of [false, true]) expect(invoke(current, [...historyArgs(x), ...(json ? ["--json"] : [])])).toEqual(invoke(baseline!, [...historyArgs(x), ...(json ? ["--json"] : [])]));
  for (const fresh of [false, true]) for (const unified of [false, true]) {
    const output = join(x.root, `preserved-${fresh}-${unified}.html`);
    const args = ["report", "--data-dir", x.data, ...(fresh ? ["--provider", provider, "--input", x.path] : ["--source", x.sourceId]), ...(unified ? ["--unified"] : []), "--output", output, "--json"];
    const old = invoke(baseline!, args); expect([0, 1]).toContain(old.status);
    const html = await readFile(output); await unlink(output);
    expect(invoke(current, args)).toEqual(old); expect(await readFile(output)).toEqual(html);
  }
  expect(await bytes(x.data)).toEqual(before);
  expect(JSON.parse(invoke(current, scanArgs(x, [x.path], true)).stdout).result.sources[0].committedRevision).toBe(2);
  const timed = await readSource(x.data, x.sourceId);
  expect(timed.events).toEqual(legacy.events); expect(timed.evidence!.turns).toEqual(legacy.evidence!.turns); expect(timed.evidence!.usage).toEqual(legacy.evidence!.usage);
  expect(timed.evidence!.observations.map(({ usageObservedAt: _, ...o }) => o)).toEqual(legacy.evidence!.observations);
  const r = analyzeSelectedHistory([timed, await readSource(x.data, x.copyId)], query);
  expect(r.reconciliation.counts.admittedExecutions).toBe(1); expect(r.reconciliation.counts.conflictingExecutions).toBe(0);
  if (provider === "codex") expect(analyzeSourceActiveTime(timed).partitions).toEqual(analyzeSourceActiveTime(legacy).partitions);
  const unchanged = await bytes(x.data);
  expect(JSON.parse(invoke(current, scanArgs(x, [x.path], true)).stdout).result.counts.unchanged).toBe(1); expect(await bytes(x.data)).toEqual(unchanged);
  await appendFile(x.path, encode([record(provider, "FICTITIOUS_APPEND_RESPONSE", "2026-10-03T15:00:00.000Z", 20)]));
  expect(JSON.parse(invoke(current, scanArgs(x, [x.path], true)).stdout).result.sources[0].committedRevision).toBe(3);
  expect((await readSource(x.data, x.sourceId)).evidence!.observations.filter(o => o.representation === "usage").map(o => o.usageObservedAt)).toEqual(["2026-10-03T14:59:59.000Z", "2026-10-03T15:00:00.000Z"]);
  expect(JSON.parse(invoke(current, scanArgs(x)).stdout).result.sources[0].committedRevision).toBe(4);
  expect((await readSource(x.data, x.sourceId)).evidence!.observations.every(o => !Object.hasOwn(o, "usageObservedAt"))).toBe(true);
}, 60000);

it.runIf(Boolean(installed))("actual installed artifact preserves both providers' mixed native copies and Codex Active Time", async () => {
  for (const provider of providers) {
    const x = await fixture(provider);
    expect(JSON.parse(invoke(current, scanArgs(x, [x.path, x.copy])).stdout).result.counts.committed).toBe(2);
    const before = await bytes(x.data);
    expect(invoke(installed!, scanArgs(x, [x.path, x.copy]))).toEqual(invoke(current, scanArgs(x, [x.path, x.copy])));
    expect(await bytes(x.data)).toEqual(before);
    expect(JSON.parse(invoke(installed!, scanArgs(x, [x.path], true)).stdout).result.sources[0].committedRevision).toBe(2);
    const sealed = await bytes(x.data), args = [...historyArgs(x), "--json"];
    const native = invoke(installed!, args); expect(native.status, native.stderr).toBe(0); expect(native).toEqual(invoke(current, args));
    expect(JSON.parse(native.stdout).result.reconciliation.counts).toMatchObject({ admittedExecutions: 1, conflictingExecutions: 0 });
    const tokens = invoke(installed!, [...args, "--tokens"]); expect(tokens.status, tokens.stderr).toBe(0); expect(tokens).toEqual(invoke(current, [...args, "--tokens"]));
    expect(JSON.parse(tokens.stdout).result.days).toHaveLength(1);
    if (provider === "codex") {
      const activeArgs = ["stats", "--data-dir", x.data, "--source", x.sourceId, "--active-time", "--json"];
      const active = invoke(installed!, activeArgs); expect(active.status, active.stderr).toBe(0); expect(active).toEqual(invoke(current, activeArgs));
      expect(JSON.parse(active.stdout).result.analysis.partitions[0]).toMatchObject({ activeTimeMs: 10000, observedSpanMs: 10000, turnN: 1 });
    }
    await rm(x.inputRoot, { recursive: true }); expect(invoke(installed!, args)).toEqual(native); expect(await bytes(x.data)).toEqual(sealed);
  }
}, 60000);
