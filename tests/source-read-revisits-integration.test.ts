import { createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSourceReadRevisits } from "../src/analysis/source-read-revisits.js";
import { analyzeSourceFailures } from "../src/analysis/source-failures.js";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import type { SourceSnapshotInput, StoredSource } from "../src/db/source-store.js";
import { HEADER_FIELDS } from "../src/db/source-validation.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createClaudeAdapter } from "../src/parsers/claude/index.js";
import { ingestSourceFile } from "../src/scanner/source-ingest.js";
import { temporaryDirectory } from "./helpers.js";

// Gate-one oracle frozen BEFORE any new production metric implementation.
// Ordinary raw synthetic records only: no trustedFixtureContext or complete-content hints.
// Expected IDs are separately framed HMACs, not copied from production adapter outputs.
const secret = Buffer.alloc(32, 53), keyId = "7".repeat(32);
const identity = createIdentityContext(secret, keyId);
const session = "FICTITIOUS_READ_SESSION", project = "/FICTITIOUS_PROJECT_ONE";
const pathA = "FICTITIOUS_A.ts", pathB = "FICTITIOUS_B.ts";
function keyed(domain: string, ...parts: unknown[]): string {
  return `h1:${keyId}:${domain}:${createHmac("sha256", secret).update(JSON.stringify([1, 1, domain, ...parts])).digest("hex")}`;
}
const sessionId = (name = session) => keyed("session", "claude", name, null);
const eventId = (id: string, name = session) => keyed("event", "claude", sessionId(name), id);
const fileId = (path: string, cwd = project) => keyed("file", "claude", keyed("file", "claude_project", cwd), path);
function call(id: string, path = pathA, cwd: string | null = project, name = session, extra: Record<string, unknown> = {}, tool = "Read") {
  return { type: "assistant", uuid: `call-${id}`, sessionId: name, isSidechain: false, ...(cwd === null ? {} : { cwd }),
    message: { id: `response-${id}`, role: "assistant", content: [{ type: "tool_use", id, name: tool, input: { file_path: path, ...extra } }] } };
}
function result(id: string, name = session, error = false) {
  return { type: "user", uuid: `result-${id}`, sessionId: name, isSidechain: false,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: error, content: "FICTITIOUS_READ_CONTENT" }] } };
}
const four = [call("a1"), result("a1"), call("a2"), result("a2"), call("b1", pathB), result("b1"), call("a3"), result("a3")];
function bytes(records: readonly unknown[]) { return records.map(r => JSON.stringify(r) + "\n").join(""); }
async function stored(records: readonly unknown[]) {
  const root = temporaryDirectory(), path = join(root, "FICTITIOUS_INPUT.jsonl"), data = join(root, "data");
  const raw = bytes(records); await writeFile(path, raw);
  // Exercise the ordinary adapter separately, then the actual ingestion/store path.
  const adapter = createClaudeAdapter(identity); let offset = 0;
  records.forEach((record, ordinal) => {
    adapter.ingest(record, { fileIdentity: resolve(path), sourceAlias: "source-1", byteOffset: offset, ordinal });
    offset += Buffer.byteLength(JSON.stringify(record) + "\n");
  });
  const snapshot = adapter.snapshot();
  let db = await openDatabase(data);
  try { expect(await ingestSourceFile(createSourceStore(db, keyId), identity, { path, provider: "claude", expectedRevision: null })).toMatchObject({ status: "committed", revision: 1 }); }
  finally { db.close(); }
  const sourceId = keyed("source", "claude", resolve(path));
  db = await openDatabase(data); let source: StoredSource;
  try { source = createSourceStore(db, keyId).readSource(sourceId)!; } finally { db.close(); }
  // Adapter insertion order and store ID order are different representations.
  const byId = <T extends { id: string }>(rows: readonly T[]) => [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  expect(byId(source!.events)).toEqual(byId(snapshot.events));
  expect(byId(source!.evidence!.observations)).toEqual(byId(snapshot.observations));
  expect(source!.completedOffset).toBe(Buffer.byteLength(raw));
  expect(source!.evidence!.observations.every(o => o.origin === "ordinary")).toBe(true);
  return { source: source!, data, path, snapshot };
}
function admitted(source: StoredSource) {
  const gate = analyzeSourceFailures(source);
  expect(gate.suppressionReason).toBeNull();
  expect(gate.provenance.unresolvedEvents).toBe(0);
  const ids = gate.partitions.flatMap(p => p.completedEventIds);
  return source.events.filter(e => ids.includes(e.id) && e.kind === "file_read" && e.category === "read" && e.toolName === "Read");
}
async function replaceEvidence(x: Awaited<ReturnType<typeof stored>>, evidence: NonNullable<StoredSource["evidence"]>) {
  let db = await openDatabase(x.data);
  const input = { ...Object.fromEntries(HEADER_FIELDS.map(name => [name, x.source[name]])), events: x.source.events, evidence,
    relationshipEvidence: x.source.relationshipEvidence } as SourceSnapshotInput;
  try { expect(createSourceStore(db, keyId).replaceSourceSnapshot(input, x.source.revision).status).toBe("committed"); } finally { db.close(); }
  db = await openDatabase(x.data);
  try { return createSourceStore(db, keyId).readSource(x.source.sourceId)!; } finally { db.close(); }
}

describe("pre-production ordinary Read evidence gate", () => {
  it("freezes four distinct A,A,B,A identities, ordinary completion proof and N=4 U=2", async () => {
    const x = await stored(four), rows = admitted(x.source);
    expect(rows.map(e => e.id).sort()).toEqual(["a1", "a2", "b1", "a3"].map(id => eventId(id)).sort());
    expect(Object.fromEntries(rows.map(e => [e.id, e.fileFingerprint]))).toEqual({
      [eventId("a1")]: fileId(pathA), [eventId("a2")]: fileId(pathA), [eventId("b1")]: fileId(pathB), [eventId("a3")]: fileId(pathA),
    });
    expect(rows).toHaveLength(4); expect(new Set(rows.map(e => e.fileFingerprint)).size).toBe(2);
    expect((4 - 2) / 4).toBe(0.5);
    expect(rows.every(e => e.startAt === null && e.endAt === null && e.durationMs === null && e.lookupKey === null && e.contentFingerprint === null && e.turnId === null)).toBe(true);
    const sourceIdentity = keyed("source", "claude", resolve(x.path)); let offset = 0;
    const expectedObservations = four.map((record, index) => {
      const id = ["a1", "a1", "a2", "a2", "b1", "b1", "a3", "a3"][index]!;
      const observation = keyed("source", "claude_observation", sourceIdentity, offset, index % 2 ? "result" : "call", eventId(id), null, null);
      offset += Buffer.byteLength(JSON.stringify(record) + "\n"); return observation;
    });
    expect(x.source.evidence!.observations.filter(o => o.representation === "call" || o.representation === "result").map(o => o.id).sort()).toEqual(expectedObservations.sort());
  });
  it("collapses repeated representations but preserves a fifth identical-operation invocation", async () => {
    const replay = admitted((await stored([...four, ...four])).source);
    expect(replay).toHaveLength(4);
    const fifth = admitted((await stored([...four, call("a4"), result("a4")])).source);
    expect(fifth).toHaveLength(5);
    expect(fifth.find(e => e.id === eventId("a4"))!.operationKey).toBe(fifth.find(e => e.id === eventId("a1"))!.operationKey);
    expect(new Set(fifth.map(e => e.fileFingerprint)).size).toBe(2);
  });
  it("retains file identity across range changes and an intervening write without claiming content equality", async () => {
    const x = await stored([call("a1", pathA, project, session, { offset: 1, limit: 10 }), result("a1"), call("write", pathA, project, session, { content: "FICTITIOUS_CHANGED" }, "Write"), result("write"), call("a2", pathA, project, session, { offset: 11, limit: 10 }), result("a2")]);
    const rows = admitted(x.source); expect(rows).toHaveLength(2);
    expect(rows.every(e => e.fileFingerprint === fileId(pathA) && e.contentFingerprint === null && e.lookupKey === null)).toBe(true);
  });
  it("separates the same textual path by observed project key", async () => {
    const other = "/FICTITIOUS_PROJECT_TWO";
    const rows = admitted((await stored([call("p1"), result("p1"), call("p2", pathA, other), result("p2")])).source);
    expect(rows.map(e => e.fileFingerprint).sort()).toEqual([fileId(pathA), fileId(pathA, other)].sort());
  });
  it("keeps a genuinely project-absent new source/session unresolved even alongside a known candidate", async () => {
    const name = "FICTITIOUS_NO_PROJECT_SESSION";
    const x = await stored([call("missing", pathA, null, name), result("missing", name), call("known", pathA, project, name), result("known", name)]);
    const rows = admitted(x.source); expect(rows).toHaveLength(2);
    expect(rows.find(e => e.id === eventId("missing", name))!.fileFingerprint).toBeNull();
    expect(rows.find(e => e.id === eventId("known", name))!.fileFingerprint).toBe(fileId(pathA));
    // Candidate N=2, missing identity N=1: later analyzer MUST suppress the whole ratio.
  });
  it("excludes an ordinary contradictory-result unknown invocation rather than treating it as completed", async () => {
    const conflicting = { ...result("conflict", session, true), uuid: "contradictory-result" };
    const x = await stored([...four, call("conflict"), result("conflict"), conflicting]);
    expect(x.source.events.find(e => e.id === eventId("conflict"))!.status).toBe("unknown");
    expect(admitted(x.source)).toHaveLength(4);
  });
  it.each(["missing", "contradictory"] as const)("preserves whole-session suppression for %s decisive proof after validated store/reopen", async kind => {
    const x = await stored(four), target = eventId("a1"), evidence = x.source.evidence!;
    const observations = kind === "missing" ? evidence.observations.filter(o => o.eventId !== target)
      : evidence.observations.map(o => o.eventId === target && o.representation === "result" && "observedResult" in o
        ? { ...o, observedResult: { ...o.observedResult!, isError: true } } : o);
    const source = await replaceEvidence(x, { ...evidence, observations });
    const gate = analyzeSourceFailures(source);
    expect(gate.partitions).toHaveLength(1);
    expect(gate.partitions[0]).toMatchObject({ status: "provenance_unresolved", completedEventIds: [], completedN: null, unresolvedEventIds: [target] });
    expect(gate.provenance.failures[kind === "missing" ? "missing_provenance" : "contradictory_provenance"]).toBe(1);
    expect(gate.eligibility.exclusions.provenance_unresolved_partition).toBe(4);
  });
});

// Additive stage-two assertions; the frozen gate above remains intact.
it("connects the ordinary reopened evidence to exact revisit arithmetic and identity suppression", async () => {
  const x = await stored(four), r = analyzeSourceReadRevisits(x.source);
  expect(r.partitions[0]).toMatchObject({ candidateReadN: 4, validReadN: 4, uniqueFileN: 2, revisitN: 2, revisitRatio: 0.5 });
  expect(r.partitions[0]!.cohorts!.flatMap(c => c.eventIds).sort()).toEqual(["a1", "a2", "b1", "a3"].map(id => eventId(id)).sort());
  const name = "FICTITIOUS_NEW_MISSING_SESSION";
  const y = await stored([call("missing", pathA, null, name), result("missing", name), call("known", pathA, project, name), result("known", name)]);
  expect(analyzeSourceReadRevisits(y.source).partitions[0]).toMatchObject({ reason: "identity_unresolved", candidateReadN: 2, missingFileIdentityN: 1,
    validReadN: null, uniqueFileN: null, revisitN: null, revisitRatio: null, cohorts: null });
});

it("ordinary canonical reversed timestamps retain independently completed Read status after reopen", async () => {
  const x = await stored([{ ...call("reversed"), timestamp: "2026-10-02T00:00:02.000Z" }, { ...result("reversed"), timestamp: "2026-10-02T00:00:01.000Z" }]);
  expect(x.source.events[0]).toMatchObject({ id: eventId("reversed"), status: "completed", durationMs: null });
  expect(analyzeSourceReadRevisits(x.source).partitions[0]).toMatchObject({ candidateReadN: 1, validReadN: 1, uniqueFileN: 1, revisitN: 0, revisitRatio: 0 });
});
