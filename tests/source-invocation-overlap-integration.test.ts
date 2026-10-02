import { createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSourceFailures } from "../src/analysis/source-failures.js";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import type { StoredSource } from "../src/db/source-store.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createClaudeAdapter } from "../src/parsers/claude/index.js";
import { ingestSourceFile } from "../src/scanner/source-ingest.js";
import { temporaryDirectory } from "./helpers.js";

// Frozen before production implementation. Independent raw boundary/identity oracle.
// No trustedFixtureContext and no new analyzer import or computed production expectations.
const secret = Buffer.alloc(32, 67), keyId = "9".repeat(32);
const identity = createIdentityContext(secret, keyId), session = "FICTITIOUS_INTERVAL_SESSION";
const epoch = Date.UTC(2026, 9, 2), at = (seconds: number) => new Date(epoch + seconds * 1000).toISOString();
function keyed(domain: string, ...parts: unknown[]): string {
  return `h1:${keyId}:${domain}:${createHmac("sha256", secret).update(JSON.stringify([1, 1, domain, ...parts])).digest("hex")}`;
}
const sessionId = (name = session) => keyed("session", "claude", name, null);
const eventId = (id: string, name = session) => keyed("event", "claude", sessionId(name), id);
function call(id: string, start: number | null, name = session, tool = "Read", input: Record<string, unknown> = { file_path: "FICTITIOUS_FILE.ts" }) {
  return { type: "assistant", uuid: `call-${id}`, sessionId: name, isSidechain: false, cwd: "/FICTITIOUS_PROJECT", ...(start === null ? {} : { timestamp: at(start) }),
    message: { id: `response-${id}`, role: "assistant", content: [{ type: "tool_use", id, name: tool, input }] } };
}
function result(id: string, end: number | null, error = false, name = session) {
  return { type: "user", uuid: `result-${id}`, sessionId: name, isSidechain: false, ...(end === null ? {} : { timestamp: at(end) }),
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: error, content: "FICTITIOUS_TOOL_OUTPUT" }] } };
}
type Case = { label: string; intervals: readonly (readonly [number, number])[]; expected: readonly [number, number, number] };
const cases: Case[] = [
  { label: "overlap", intervals: [[0, 10], [5, 15]], expected: [20000, 15000, 5000] },
  { label: "disjoint", intervals: [[0, 10], [20, 30]], expected: [20000, 20000, 0] },
  { label: "touching", intervals: [[0, 10], [10, 20]], expected: [20000, 20000, 0] },
  { label: "nested", intervals: [[0, 10], [2, 8]], expected: [16000, 10000, 6000] },
  { label: "three-identical", intervals: [[0, 10], [0, 10], [0, 10]], expected: [30000, 10000, 20000] },
  { label: "zero", intervals: [[5, 5]], expected: [0, 0, 0] },
];
const recordsFor = (c: Case) => c.intervals.flatMap(([start, end], i) => [call(`i${i}`, start), result(`i${i}`, end)]);
async function stored(records: readonly unknown[], expectOrdinary = true) {
  const root = temporaryDirectory(), path = join(root, "FICTITIOUS_INPUT.jsonl"), data = join(root, "data");
  const lines = records.map(r => JSON.stringify(r) + "\n"), raw = lines.join(""); await writeFile(path, raw);
  const adapter = createClaudeAdapter(identity); let offset = 0;
  records.forEach((record, ordinal) => { adapter.ingest(record, { fileIdentity: resolve(path), sourceAlias: "source-1", byteOffset: offset, ordinal }); offset += Buffer.byteLength(lines[ordinal]!); });
  const snapshot = adapter.snapshot(); let db = await openDatabase(data);
  try { expect(await ingestSourceFile(createSourceStore(db, keyId), identity, { path, provider: "claude", expectedRevision: null })).toMatchObject({ status: "committed", revision: 1 }); }
  finally { db.close(); }
  const sourceId = keyed("source", "claude", resolve(path)); db = await openDatabase(data); let source: StoredSource;
  try { source = createSourceStore(db, keyId).readSource(sourceId)!; } finally { db.close(); }
  const byId = <T extends { id: string }>(rows: readonly T[]) => [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  expect(byId(source!.events)).toEqual(byId(snapshot.events));
  expect(byId(source!.evidence!.observations)).toEqual(byId(snapshot.observations));
  expect(source!.completedOffset).toBe(Buffer.byteLength(raw));
  if (expectOrdinary) expect(source!.evidence!.observations.every(o => o.origin === "ordinary")).toBe(true);
  return { source: source!, sourceId, path, data, snapshot, lines };
}
function terminal(s: StoredSource) {
  const gate = analyzeSourceFailures(s); expect(gate.suppressionReason).toBeNull(); expect(gate.provenance.unresolvedEvents).toBe(0);
  const ids = new Set(gate.partitions.flatMap(p => p.terminalEventIds)); return s.events.filter(e => ids.has(e.id));
}

describe("pre-production ordinary positioned interval evidence", () => {
  it.each(cases)("freezes $label raw boundaries and hand arithmetic", async c => {
    const records = recordsFor(c), x = await stored(records), rows = terminal(x.source);
    expect(rows).toHaveLength(c.intervals.length);
    let offset = 0; const expectedObservations: string[] = [], resultOffsets = new Map<string, number>();
    records.forEach((_, ordinal) => {
      const id = eventId(`i${Math.floor(ordinal / 2)}`), representation = ordinal % 2 ? "result" : "call";
      expectedObservations.push(keyed("source", "claude_observation", x.sourceId, offset, representation, id, null, null));
      if (representation === "result") resultOffsets.set(id, offset);
      offset += Buffer.byteLength(x.lines[ordinal]!);
    });
    expect(x.source.evidence!.observations.filter(o => o.representation === "call" || o.representation === "result").map(o => o.id).sort()).toEqual(expectedObservations.sort());
    expect(rows.map(e => e.id).sort()).toEqual(c.intervals.map((_, i) => eventId(`i${i}`)).sort());
    c.intervals.forEach(([start, end], i) => {
      const row = rows.find(e => e.id === eventId(`i${i}`))!;
      expect(row).toMatchObject({ sessionId: sessionId(), startAt: at(start), endAt: at(end), intervalScope: "invocation_latency", intervalTimingEvidence: "paired_timestamps", status: "completed", durationMs: (end - start) * 1000 });
      expect(row.sourceRef.byteOffset).toBe(resultOffsets.get(row.id));
      const proof = x.source.evidence!.observations.find(o => o.eventId === row.id && o.representation === "result")!;
      expect(proof).toMatchObject({ observedResult: { observedAt: at(end), completionKind: "invocation_result", isError: false }, sourceRef: { byteOffset: resultOffsets.get(row.id) } });
    });
    // Constants are manually specified geometry, not outputs from a production union.
    expect(c.intervals.reduce((n, [a, b]) => n + (b - a) * 1000, 0)).toBe(c.expected[0]);
    expect(c.expected[0] - c.expected[1]).toBe(c.expected[2]);
  });
  it("normalizes replay once but retains a distinct identical operation/interval", async () => {
    const original = [call("one", 0), result("one", 10)];
    expect(terminal((await stored([...original, ...original])).source)).toHaveLength(1);
    const rows = terminal((await stored([...original, call("two", 0), result("two", 10)])).source);
    expect(rows.map(e => e.id).sort()).toEqual([eventId("one"), eventId("two")].sort());
    expect(rows[0]!.operationKey).toBe(rows[1]!.operationKey);
  });
  it("keeps untimed and one-sided terminal events unpositioned, and clears reversed end", async () => {
    const x = await stored([call("untimed", null), result("untimed", null), call("start-only", 0), result("start-only", null), call("end-only", null), result("end-only", 10), call("reversed", 10), result("reversed", 0)]);
    const rows = terminal(x.source); expect(rows).toHaveLength(4);
    expect(rows.every(e => e.intervalScope === "unknown" && e.intervalTimingEvidence === "unknown")).toBe(true);
    expect(rows.find(e => e.id === eventId("reversed"))).toMatchObject({ startAt: at(10), endAt: null, durationMs: null, status: "completed" });
  });
  it("admits failed terminal position but never a pending call or contradictory unknown result", async () => {
    const x = await stored([call("ok", 0), result("ok", 10), call("failed", 5), result("failed", 15, true), call("pending", 20), call("conflict", 0), result("conflict", 10), { ...result("conflict", 10, true), uuid: "conflicting-result" }]);
    expect(terminal(x.source).map(e => e.id).sort()).toEqual([eventId("ok"), eventId("failed")].sort());
    expect(x.source.events.find(e => e.id === eventId("failed"))).toMatchObject({ status: "failed", startAt: at(5), endAt: at(15), intervalScope: "invocation_latency" });
    expect(x.source.events.find(e => e.id === eventId("pending")))!.toMatchObject({ status: "pending", endAt: null });
    expect(x.source.events.find(e => e.id === eventId("conflict")))!.toMatchObject({ status: "unknown", intervalScope: "unknown" });
  });
  it("suppresses a raw source with conflicting root declarations rather than claiming ordinary multi-root support", async () => {
    const name = "FICTITIOUS_OTHER_SESSION";
    const x = await stored([call("one", 0), result("one", 10), call("two", 0, name), result("two", 10, false, name)], false);
    expect(x.source.evidence!.observations.some(o => o.origin === "ambiguous")).toBe(true);
    expect(analyzeSourceFailures(x.source)).toMatchObject({ assessment: "suppressed", suppressionReason: "ambiguous_origin" });
  });
});

// Stage two: the frozen raw oracle above stays intact; these are actual union assertions.
import { analyzeSourceInvocationOverlap } from "../src/analysis/source-invocation-overlap.js";
it.each(cases)("reopened ordinary $label evidence produces the independently frozen union", async c => {
  const { source } = await stored(recordsFor(c)); const p = analyzeSourceInvocationOverlap(source).partitions[0]!;
  expect([p.intervalLengthSumMs, p.intervalUnionMs, p.excessMs]).toEqual(c.expected);
  expect(p.coverage).toMatchObject({ admittedTerminalN: c.intervals.length, positionedN: c.intervals.length, complete: true });
});
it("reopened raw replay versus new ID changes multiplicity only for the new invocation", async () => {
  const raw = [call("one", 0), result("one", 10)];
  expect(analyzeSourceInvocationOverlap((await stored([...raw, ...raw])).source).partitions[0]).toMatchObject({ intervalLengthSumMs: 10000, intervalUnionMs: 10000, excessMs: 0 });
  expect(analyzeSourceInvocationOverlap((await stored([...raw, call("two", 0), result("two", 10)])).source).partitions[0]).toMatchObject({ intervalLengthSumMs: 20000, intervalUnionMs: 10000, excessMs: 10000 });
});
it("reopened valid plus untimed terminal records reports only the positioned subset", async () => {
  const x = await stored([call("timed", 0), result("timed", 10), call("untimed", null), result("untimed", null)]);
  expect(analyzeSourceInvocationOverlap(x.source).partitions[0]).toMatchObject({ status: "partial", intervalLengthSumMs: 10000, intervalUnionMs: 10000, excessMs: 0, coverage: { admittedTerminalN: 2, positionedN: 1, excludedN: 1, complete: false } });
});
it("ordinary background acknowledgement remains pending and never contributes a positioned interval", async () => {
  const x = await stored([call("done", 0), result("done", 10), call("background", 1, session, "Bash", { command: "npm test FICTITIOUS_BACKGROUND", run_in_background: true }), { ...result("background", 2), toolUseResult: { backgroundTaskId: "FICTITIOUS_BACKGROUND_ID" } }]);
  expect(x.source.events.find(e => e.id === eventId("background"))).toMatchObject({ status: "pending", endAt: null, intervalScope: "unknown" });
  expect(analyzeSourceInvocationOverlap(x.source)).toMatchObject({ inheritedAdmission: { exclusions: { pending: 1 } }, partitions: [{ intervalLengthSumMs: 10000, intervalUnionMs: 10000, excessMs: 0, coverage: { admittedTerminalN: 1, positionedN: 1 } }] });
});
