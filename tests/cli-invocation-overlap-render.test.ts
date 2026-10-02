import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { analyzeSourceInvocationOverlap } from "../src/analysis/source-invocation-overlap.js";
import { formatStatsResult } from "../src/cli/stats.js";
import { formatSourceInvocationOverlap } from "../src/cli/invocation-overlap.js";
import { migrate } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import type { MetricEvidence, StoredSource } from "../src/db/source-store.js";
import { HEADER_FIELDS } from "../src/db/source-validation.js";
import { normalizeEvent } from "../src/normalize/event.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import type { NormalizedEvent } from "../src/normalize/types.js";
import type { ClaudeSourceObservation } from "../src/parsers/claude/types.js";

const identity = createIdentityContext(Buffer.alloc(32, 91), "8".repeat(32));
const id = (domain: "event" | "session" | "source" | "file" | "content", value: string) => identity.fingerprint(domain, [value]);
const epoch = Date.UTC(2026, 9, 2), at = (ms: number) => new Date(epoch + ms).toISOString();
function event(name: string, start = 0, end = 10000, extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { ...normalizeEvent({ provider: "claude", eventIdentity: name, sessionIdentity: "session-one", projectIdentity: "project-one", filePath: "FICTITIOUS_FILE.ts",
    kind: "file_read", toolName: "Read", status: "completed", statusEvidence: "explicit", sourceRef: { fileIdentity: "source", byteOffset: 10, recordType: "user" } }, identity).event!, startAt: at(start), endAt: at(end), intervalScope: "invocation_latency", intervalTimingEvidence: "paired_timestamps", ...extra };
}
function observations(e: NormalizedEvent): ClaudeSourceObservation[] {
  const base = { eventId: e.id, sessionId: e.sessionId, messageId: null, usageId: null, turnId: null, origin: "ordinary" as const, observedUsage: null };
  return [{ ...base, id: id("source", `call-${e.id}`), representation: "call", observedResult: null, sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 1 } },
    { ...base, id: id("source", `result-${e.id}`), representation: "result", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 10 }, observedResult: {
      isError: e.status === "failed", completionKind: "invocation_result", unassignedAcknowledgement: false, observedAt: e.endAt, acknowledgementLatencyMs: null, durationMs: null, durationScope: "unknown" } }];
}
function source(events: NormalizedEvent[] = [], obs?: MetricEvidence["observations"]): StoredSource {
  return { sourceId: identity.fingerprint("source", ["claude", "source"]), provider: "claude", parserVersion: 1, normalizationVersion: 1, keyVersion: 1, keyId: identity.keyId,
    revision: 1, availability: "available", completedOffset: 100, observedSize: 101, boundaryFingerprint: id("content", "boundary"), cacheEvidence: null,
    relationshipEvidence: null, events, persistedScope: "events_and_metric_evidence", aggregationReady: false, parserResumeReady: false,
    evidence: { turns: [], usage: [], observations: obs ?? events.flatMap(observations), diagnostics: [], capabilities: {
      provider: "claude", parserVersion: 1, support: "shape_verified_only", coverage: "recognized_shapes", observedShapes: ["tool_use", "tool_result"], unsupportedRecords: 0, ambiguousRecords: 0, stateLimited: false, diagnosticsDropped: 0 } } };
}
function validated(s: StoredSource): StoredSource {
  const db = new DatabaseSync(":memory:");
  try {
    migrate(db); const store = createSourceStore(db, identity.keyId);
    expect(store.replaceSourceSnapshot({ ...Object.fromEntries(HEADER_FIELDS.map(k => [k, s[k]])), events: s.events, evidence: s.evidence!, relationshipEvidence: s.relationshipEvidence } as never, null).status).toBe("committed");
    return store.readSource(s.sourceId)!;
  } finally { db.close(); }
}
function render(s: StoredSource, label = "sample") {
  const analysis = analyzeSourceInvocationOverlap(s), before = JSON.stringify(analysis);
  const human = formatSourceInvocationOverlap(analysis), json = formatStatsResult({ mode: "selected_source_invocation_overlap", analysis }, true);
  const lines = human.trimEnd().split("\n").length, humanBytes = Buffer.byteLength(human), jsonBytes = Buffer.byteLength(json);
  expect(lines).toBeLessThanOrEqual(160); expect(humanBytes).toBeLessThanOrEqual(32768); expect(jsonBytes).toBeLessThanOrEqual(8388608);
  expect(JSON.stringify(analysis)).toBe(before); expect(JSON.parse(json).result.analysis).toEqual(analysis);
  expect(human).not.toMatch(/fileFingerprint|operationKey|contentFingerprint|sourceRef|project-one|FICTITIOUS/);
  if (process.env["AGENTPROF_INVOCATION_RECEIPTS"]) {
    const directory = process.env["AGENTPROF_INVOCATION_RECEIPTS"]!;
    writeFileSync(join(directory, `${label}-human.txt`), human);
    writeFileSync(join(directory, `${label}-bounds.json`), JSON.stringify({ lines, humanBytes, jsonBytes }) + "\n");
  }
  return { analysis, human, json, lines, humanBytes, jsonBytes };
}
it("renders exact ordinary 20000/15000/5000 under35lines/4096bytes", () => {
  const r = render(validated(source([event("a"), event("b", 5000, 15000)])), "ordinary");
  expect(r.human).toContain("Length sum=20000 ms; union=15000 ms; excess=sum-union=5000 ms");
  expect(r.human).toContain(r.analysis.sourceId); expect(r.human).toContain(r.analysis.partitions[0]!.sessionId);
  expect(r.human).toContain("Sessions shown=1/1; omitted=0"); expect(r.human).toContain("contributing events=2; observations=4");
  expect(r.human).toContain("relative to admitted terminals only"); expect(r.lines).toBeLessThanOrEqual(35); expect(r.humanBytes).toBeLessThanOrEqual(4096);
  for (const label of ["Necessary-overlap counterexample:", "Investigative action:", "Optional matched experiment:", "Quality guardrail:"]) expect(r.human.split(label)).toHaveLength(2);
});
it("preserves zero, null, unsupported and partial coverage", () => {
  expect(render(source([event("zero", 0, 0)])).human).toContain("Length sum=0 ms; union=0 ms; excess=sum-union=0 ms");
  const missing = event("missing", 0, 1, { startAt: null, endAt: null });
  expect(render(source([missing])).human).toContain("Length sum=null ms; union=null ms; excess=sum-union=null ms");
  expect(render(source([event("timed"), missing])).human).toContain("positioned=1; excluded=1; unsafe differences=0; complete=false");
  const s = source(), codex = { ...s, provider: "codex" as const, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, provider: "codex" as const, observedShapes: [] } } };
  expect(render(codex).human).toContain("suppression=unsupported_provider");
});
it.each(["one-session", "4096-sessions", "all-missing"])("keeps bounded output and complete JSON for validated synthetic %s", shape => {
  const rows = Array.from({ length: 4096 }, (_, i) => event(`max-${i}`, i, i + 10, { sessionId: id("session", shape === "4096-sessions" ? `s-${i}` : "one"), ...(shape === "all-missing" ? { startAt: null, endAt: null, intervalScope: "unknown", intervalTimingEvidence: "unknown" } : {}) }));
  const r = render(validated(source(rows)), shape), p = r.analysis.partitions;
  expect(r.human).toContain(`Sessions shown=${Math.min(p.length, 6)}/${p.length}; omitted=${Math.max(p.length - 6, 0)}`);
  expect(p.reduce((n, x) => n + x.coverage.admittedTerminalN, 0)).toBe(4096);
  expect(p.reduce((n, x) => n + x.contributingEventIds.length, 0)).toBe(shape === "all-missing" ? 0 : 4096);
});
