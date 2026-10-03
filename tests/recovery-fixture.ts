import { mkdir, writeFile, rm, readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { normalizeEvent } from "../src/normalize/event.js";
import type { NormalizedEvent } from "../src/normalize/types.js";
import type { MetricEvidence, StoredSource } from "../src/db/source-store.js";
import type { SourceObservation } from "../src/parsers/types.js";
import { runScan } from "../src/cli/scan.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { createSourceStore } from "../src/db/source-store.js";
import { temporaryDirectory } from "./helpers.js";

export const keyId = "6".repeat(32), secret = Buffer.alloc(32, 73), identity = createIdentityContext(secret, keyId);
export const id = (domain: Parameters<typeof identity.fingerprint>[0], value: string) => identity.fingerprint(domain, [value]);
let offset = 10;
export function event(name: string, start: number, end: number, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  offset += 4;
  const normalized = normalizeEvent({ provider: "codex", eventIdentity: name, sessionIdentity: "recovery-unit", kind: "shell", toolName: "exec_command", command: "rg FICTITIOUS_RECOVERY_PRIVATE src", status: "failed", statusEvidence: "explicit", exitCode: 2,
    startAt: start, endAt: end, intervalTimingEvidence: "source_reported", intervalScope: "item_lifecycle", durationMs: 20, timingEvidence: "source_reported", durationScope: "process_runtime", sourceRef: { fileIdentity: "recovery-unit", byteOffset: offset, recordType: "event_msg" } }, identity).event!;
  return { ...normalized, status: "failed", executionOutcome: "error", operationKey: id("operation", "same-work"), turnId: id("turn", "turn-one"), ...extra };
}
export const success = { status: "completed", executionOutcome: "success" } as const;
export function paired(e: NormalizedEvent): NormalizedEvent {
  return { ...e, intervalScope: "invocation_latency", intervalTimingEvidence: "paired_timestamps", timingEvidence: "paired_timestamps", durationScope: "invocation_latency", durationMs: e.startAt === null || e.endAt === null ? null : Date.parse(e.endAt) - Date.parse(e.startAt), sourceRef: { ...e.sourceRef, recordType: "response_item" } };
}
export function observation(e: NormalizedEvent, extra: Partial<SourceObservation> = {}): SourceObservation {
  return { id: id("source", `observation-${e.id}`), eventId: e.id, turnId: e.turnId, usageId: null, representation: "structured", origin: "ordinary", transportStatus: e.executionOutcome === "no_match" || e.executionOutcome === "change_detected" ? "failed" : e.status, observedUsage: null, sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset }, ...extra };
}
export function proofs(e: NormalizedEvent): SourceObservation[] {
  return e.sourceRef.recordType === "event_msg" ? [observation(e)] : [observation(e, { id: id("source", `call-${e.id}`), representation: "call", transportStatus: "unknown", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: e.sourceRef.byteOffset - 1 } }), observation(e, { representation: "result", turnId: null, transportStatus: "unknown" })];
}
export function source(events: readonly NormalizedEvent[] = [], observations: MetricEvidence["observations"] = events.flatMap(proofs)): StoredSource {
  return { sourceId: identity.fingerprint("source", ["codex", "recovery-unit"]), provider: "codex", parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId, revision: 2, availability: "available", completedOffset: 1_000_000_000, observedSize: 1_000_000_005, boundaryFingerprint: id("content", "boundary"), cacheEvidence: null,
    events, persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false, evidence: { turns: [], usage: [], observations, diagnostics: [], capabilities: { provider: "codex", parserVersion: 1, support: "shape_verified_only", coverage: "recognized_shapes", observedShapes: [], unsupportedRecords: 0, ambiguousRecords: 0, stateLimited: false, diagnosticsDropped: 0 } } };
}

export const epoch = Date.UTC(2026, 9, 3), at = (n: number) => new Date(epoch + n).toISOString();
export const record = (payload: unknown, n = 0, type = "response_item") => ({ timestamp: at(n), type, payload });
export const meta = (cwd = true) => record({ id: "FICTITIOUS_RECOVERY_SESSION", ...(cwd ? { cwd: "/FICTITIOUS_RECOVERY_ROOT" } : {}) }, 0, "session_meta");
export const turn = (turnId = "turn-one") => record({ turn_id: turnId }, 0, "turn_context");
export const call = (name: string, n: number, cmd = "rg FICTITIOUS_RECOVERY_QUERY src") => record({ type: "function_call", call_id: name, name: "exec_command", arguments: JSON.stringify({ cmd }) }, n);
export const output = (name: string, n: number, value: unknown) => record({ type: "function_call_output", call_id: name, output: value }, n);
export const result = (name: string, n: number, exit = 0) => output(name, n, { exit_code: exit, output: "FICTITIOUS_RECOVERY_OUTPUT" });
export const structured = (name: string, start: number, end: number, exit = 0) => record({ type: "item_completed", thread_id: "FICTITIOUS_RECOVERY_SESSION", turn_id: "turn-one", started_at_ms: epoch + start, completed_at_ms: epoch + end,
  item: { type: "CommandExecution", id: name, source: "unified_exec_startup", command: "rg FICTITIOUS_RECOVERY_QUERY src", status: exit === 0 ? "completed" : "failed", exit_code: exit, duration: { secs: 0, nanos: 20_000_000 }, output: "FICTITIOUS_RECOVERY_OUTPUT" } }, end, "event_msg");
export const mcp = (name: string, n: number) => record({ type: "function_call", call_id: name, name: "mcp__synthetic__lookup", arguments: '{"key":"FICTITIOUS_RECOVERY_ARGUMENT"}' }, n);
export const poll = (name: string, n: number, process: number) => record({ type: "function_call", call_id: name, name: "write_stdin", arguments: JSON.stringify({ session_id: process, chars: "" }) }, n);
export const positive = [meta(), turn(), call("failure", 0), result("failure", 1000, 2), call("success", 5000), result("success", 6000)];
export async function stored(records: readonly unknown[] = positive, provider: "codex" | "claude" = "codex") {
  const root = temporaryDirectory(), input = join(root, "input"), data = join(root, "data");
  await mkdir(input); await mkdir(data, { mode: 0o700 });
  await writeFile(join(data, "identity-key.json"), JSON.stringify({ keyVersion: 1, keyId, secret: secret.toString("hex") }) + "\n", { mode: 0o600 });
  const raw = records.map(r => JSON.stringify(r) + "\n").join(""); await writeFile(join(input, "synthetic.jsonl"), raw);
  const scan = await runScan({ dataDir: data, codexRoot: provider === "codex" ? [input] : [], claudeRoot: provider === "claude" ? [input] : [] }); expect(scan.counts.committed).toBe(1);
  const snapshot = await withReadOnlyStore(data, (db, key) => { const store = createSourceStore(db, key), selected = store.listSources().items[0]!.sourceId; return store.readSource(selected)!; });
  await rm(input, { recursive: true });
  return { root, data, source: snapshot, raw, sourceId: snapshot.sourceId };
}
export async function bytes(data: string) {
  return Promise.all((await readdir(data)).sort().map(async name => ({ name, mode: (await stat(join(data, name))).mode, sha256: createHash("sha256").update(await readFile(join(data, name))).digest("hex") })));
}
