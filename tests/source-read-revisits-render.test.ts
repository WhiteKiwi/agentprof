import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { analyzeSourceReadRevisits } from "../src/analysis/source-read-revisits.js";
import { formatStatsResult } from "../src/cli/stats.js";
import { formatSourceReadRevisits } from "../src/cli/read-revisits.js";
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
function event(name: string, file = "A", extra: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return { ...normalizeEvent({ provider: "claude", eventIdentity: name, sessionIdentity: "session-one", projectIdentity: "project-one", filePath: file,
    kind: "file_read", toolName: "Read", status: "completed", statusEvidence: "explicit", sourceRef: { fileIdentity: "source", byteOffset: 10, recordType: "user" } }, identity).event!, ...extra };
}
function observations(e: NormalizedEvent): ClaudeSourceObservation[] {
  const base = { eventId: e.id, sessionId: e.sessionId, messageId: null, usageId: null, turnId: null, origin: "ordinary" as const, observedUsage: null };
  return [{ ...base, id: id("source", `call-${e.id}`), representation: "call", observedResult: null, sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 1 } },
    { ...base, id: id("source", `result-${e.id}`), representation: "result", sourceRef: { fileId: e.sourceRef.fileId, byteOffset: 10 }, observedResult: {
      isError: e.status === "failed", completionKind: "invocation_result", unassignedAcknowledgement: false, observedAt: null, acknowledgementLatencyMs: null, durationMs: null, durationScope: "unknown" } }];
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

function render(s: StoredSource, label: string) {
  const analysis = analyzeSourceReadRevisits(s), before = JSON.stringify(analysis);
  const human = formatSourceReadRevisits(analysis);
  const json = formatStatsResult({ mode: "selected_source_read_revisits", analysis }, true);
  const lines = human.trimEnd().split("\n").length, humanBytes = Buffer.byteLength(human), jsonBytes = Buffer.byteLength(json);
  expect(lines).toBeLessThanOrEqual(160); expect(humanBytes).toBeLessThanOrEqual(32768); expect(jsonBytes).toBeLessThanOrEqual(8388608);
  expect(JSON.stringify(analysis)).toBe(before);
  expect(human).not.toMatch(/fileFingerprint|operationKey|contentFingerprint|sourceRef|project-one|FICTITIOUS/);
  if (process.env["AGENTPROF_READ_REVISITS_RECEIPTS"]) {
    const dir = process.env["AGENTPROF_READ_REVISITS_RECEIPTS"]!;
    writeFileSync(join(dir, `${label}-human.txt`), human);
    writeFileSync(join(dir, `${label}-render-bounds.json`), JSON.stringify({ lines, humanBytes, jsonBytes }) + "\n");
  }
  return { human, json, analysis, lines, humanBytes };
}
it("shows full identities and exact N/U/fraction for ordinary four-read output under35lines/4096bytes", () => {
  const r = render(validated(source([event("a1"), event("a2"), event("b1", "B"), event("a3")])), "ordinary");
  expect(r.human).toContain("N=4; U=2; revisits=2; ratio=0.5 (2/4)");
  expect(r.human).toContain(r.analysis.sourceId); expect(r.human).toContain(r.analysis.partitions[0]!.sessionId);
  expect(r.human).toContain("Sessions shown=1/1; omitted=0; file cohorts shown=2/2; omitted=0");
  expect(r.human).toContain("proof IDs not displayed: events="); expect(r.human).toContain("see --json");
  expect(r.lines).toBeLessThanOrEqual(35); expect(r.humanBytes).toBeLessThanOrEqual(4096);
  for (const label of ["Necessary-reread counterexample:", "Investigative action:", "Optional matched experiment:", "Quality guardrail:"]) expect(r.human.split(label)).toHaveLength(2);
  expect(JSON.parse(r.json).result.analysis).toEqual(r.analysis);
});
it("preserves exact 53/91, zero, null and unsupported distinction", () => {
  expect(render(validated(source(Array.from({ length: 91 }, (_, i) => event(`n${i}`, `f${i % 38}`)))), "fraction").human).toContain(`ratio=${String(53 / 91)} (53/91)`);
  expect(render(validated(source([event("one")])), "zero").human).toContain("ratio=0 (0/1)");
  expect(render(validated(source([event("missing", "A", { fileFingerprint: null })])), "null").human).toContain("ratio=null (null/null)");
  const s = source(); const codex = { ...s, provider: "codex" as const, evidence: { ...s.evidence!, capabilities: { ...s.evidence!.capabilities, provider: "codex" as const, observedShapes: [] } } };
  expect(render(codex, "unsupported").human).toContain("suppression=unsupported_provider");
  expect(render(source(), "empty").human).toContain("Assessment=unavailable");
});
it.each(["six-large-sessions", "4096-sessions", "all-missing"])("keeps deterministic caps/omissions and complete JSON for validated max shape %s", shape => {
  const rows = Array.from({ length: 4096 }, (_, i) => event(`max-${i}`, `file-${i}`, { sessionId: id("session", shape === "4096-sessions" ? `s-${i}` : `s-${i % 6}`), ...(shape === "all-missing" ? { fileFingerprint: null } : {}) }));
  const r = render(validated(source(rows)), shape);
  const p = r.analysis.partitions, selected = p.slice(0, 6);
  expect(r.human).toContain(`Sessions shown=${selected.length}/${p.length}; omitted=${p.length - selected.length}`);
  const total = p.reduce((n, x) => n + (x.cohorts?.length ?? 0), 0), shownN = selected.reduce((n, x) => n + Math.min(x.cohorts?.length ?? 0, 10), 0);
  expect(r.human).toContain(`file cohorts shown=${shownN}/${total}; omitted=${total - shownN}`);
  for (const x of selected) {
    expect(r.human).toContain(x.sessionId);
    if (x.cohorts !== null) expect(r.human).toContain(`File cohorts shown=${Math.min(x.cohorts.length, 10)}/${x.cohorts.length}; omitted=${Math.max(0, x.cohorts.length - 10)}`);
  }
  expect(JSON.parse(r.json).result.analysis.partitions.reduce((n: number, x: { candidateEventIds: string[] }) => n + x.candidateEventIds.length, 0)).toBe(4096);
});
