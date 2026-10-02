import { createHmac, createHash } from "node:crypto";
import { writeFile, rm, readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createClaudeAdapter } from "../src/parsers/claude/index.js";
import { openDatabase } from "../src/db/database.js";
import { withReadOnlyStore } from "../src/db/read-only.js";
import { createSourceStore } from "../src/db/source-store.js";
import { ingestSourceFile } from "../src/scanner/source-ingest.js";
import { analyzeSourceFailures } from "../src/analysis/source-failures.js";
import { temporaryDirectory } from "./helpers.js";

// Independent pre-production evidence oracle. Never uses the future recurrence analyzer.
// Install this file in tests/ of a verified PR36-based tree before any production edit.
const secret = Buffer.alloc(32, 67), keyId = "8".repeat(32), context = createIdentityContext(secret, keyId);
const project = "/FICTITIOUS_RECURRENCE_PROJECT", session = "FICTITIOUS_RECURRENCE_SESSION", version = "2.1.241";
const h = (domain: string, ...parts: unknown[]) => `h1:${keyId}:${domain}:${createHmac("sha256", secret).update(JSON.stringify([1, 1, domain, ...parts])).digest("hex")}`;
const sessionId = h("session", "claude", session, null);
const eventId = (id: string) => h("event", "claude", sessionId, id);
const lookup = (query: string, root: readonly string[] = ["explicit_path", "src"], options = "{}", v = version, tool = "Grep", cwd = project) => h("lookup", "search", "claude", h("file", "claude_project", cwd), query, JSON.stringify(root), ["claude_native_search/v1", tool, v, options]);
function call(id: string, pattern = "FICTITIOUS_QUERY_A", input: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}, tool = "Grep") {
  return { type: "assistant", uuid: `call-${id}`, sessionId: session, isSidechain: false, cwd: project, version,
    message: { id: `message-${id}`, role: "assistant", content: [{ type: "tool_use", id, name: tool, input: { pattern, path: "src", ...input } }] }, ...metadata };
}
function result(id: string) { return { type: "user", uuid: `result-${id}`, sessionId: session, isSidechain: false,
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: "FICTITIOUS_RESULT_SENTINEL" }] } }; }
const four = [call("a1"), result("a1"), call("a2"), result("a2"), call("b1", "FICTITIOUS_QUERY_B"), result("b1"), call("a3"), result("a3")];
async function stored(records: readonly unknown[]) {
  const root = temporaryDirectory(), path = join(root, "source.jsonl"), data = join(root, "data");
  const raw = records.map(r => JSON.stringify(r) + "\n").join(""); await writeFile(path, raw);
  const adapter = createClaudeAdapter(context); let offset = 0;
  records.forEach((r, ordinal) => { adapter.ingest(r, { fileIdentity: resolve(path), byteOffset: offset, ordinal, sourceAlias: "source-1" }); offset += Buffer.byteLength(JSON.stringify(r) + "\n"); });
  let db = await openDatabase(data);
  try { expect(await ingestSourceFile(createSourceStore(db, keyId), context, { path, provider: "claude", expectedRevision: null })).toMatchObject({ status: "committed", revision: 1 }); } finally { db.close(); }
  db = await openDatabase(data); const sourceId = h("source", "claude", resolve(path));
  const source = createSourceStore(db, keyId).readSource(sourceId)!; db.close();
  const byId = <T extends { id: string }>(rows: readonly T[]) => [...rows].sort((a,b) => a.id.localeCompare(b.id));
  expect(byId(source.events)).toEqual(byId(adapter.snapshot().events));
  expect(byId(source.evidence!.observations)).toEqual(byId(adapter.snapshot().observations));
  expect(source.completedOffset).toBe(Buffer.byteLength(raw)); expect(source.parserVersion).toBe(2);
  const gate = analyzeSourceFailures(source); expect(gate.suppressionReason).toBeNull(); expect(gate.provenance.unresolvedEvents).toBe(0);
  const admittedIds = new Set(gate.partitions.flatMap(p => p.completedEventIds));
  const admitted = source.events.filter(e => admittedIds.has(e.id) && e.kind === "search" && e.category === "search" && (e.toolName === "Grep" || e.toolName === "Glob"));
  return { source, path, data, admitted, raw };
}
function count(rows: readonly { id: string; lookupKey: string | null }[]) {
  const ids = new Set(rows.map(e => e.id)); expect(ids.size).toBe(rows.length);
  if (!rows.length || rows.some(e => e.lookupKey === null)) return null;
  const n = ids.size, u = new Set(rows.map(e => e.lookupKey)).size;
  return [n, u, n - u, (n - u) / n];
}
describe("ordinary completed native search gate frozen before analyzer", () => {
  it("separately frames A,A,B,A event and lookup identities through reopen", async () => {
    const x = await stored(four);
    expect(Object.fromEntries(x.admitted.map(e => [e.id, e.lookupKey]))).toEqual({ [eventId("a1")]: lookup("FICTITIOUS_QUERY_A"), [eventId("a2")]: lookup("FICTITIOUS_QUERY_A"), [eventId("b1")]: lookup("FICTITIOUS_QUERY_B"), [eventId("a3")]: lookup("FICTITIOUS_QUERY_A") });
    expect(count(x.admitted)).toEqual([4, 2, 2, 0.5]); expect(x.admitted.every(e => e.durationMs === null)).toBe(true);
    let offset = 0; const expected = four.map((r, i) => { const id = ["a1","a1","a2","a2","b1","b1","a3","a3"][i]!;
      const value = h("source", "claude_observation", x.source.sourceId, offset, i % 2 ? "result" : "call", eventId(id), null, null); offset += Buffer.byteLength(JSON.stringify(r) + "\n"); return value; });
    expect(x.source.evidence!.observations.filter(o => o.representation === "call" || o.representation === "result").map(o => o.id).sort()).toEqual(expected.sort());
  });
  it("deduplicates replay without collapsing a genuinely separate fifth invocation", async () => {
    expect(count((await stored([...four, ...four])).admitted)).toEqual([4,2,2,0.5]);
    expect(count((await stored([...four, call("a4"), result("a4")])).admitted)).toEqual([5,2,3,0.6]);
  });
  it("preserves present options, version, root and tool distinctions", async () => {
    const cases = [call("base"), call("option", undefined, { "-i": false }), call("version", undefined, {}, { version: "2.1.242" }), call("root", undefined, { path: "./src" }), call("glob", undefined, {}, {}, "Glob")];
    const ids = ["base","option","version","root","glob"];
    const x = await stored(cases.flatMap((c,i) => [c, result(ids[i]!)]));
    expect(count(x.admitted)).toEqual([5,5,0,0]);
    expect(new Set(x.admitted.map(e => e.lookupKey))).toEqual(new Set([lookup("FICTITIOUS_QUERY_A"), lookup("FICTITIOUS_QUERY_A", undefined, '{"-i":false}'), lookup("FICTITIOUS_QUERY_A", undefined, undefined, "2.1.242"), lookup("FICTITIOUS_QUERY_A", ["explicit_path","./src"]), lookup("FICTITIOUS_QUERY_A", undefined, undefined, undefined, "Glob")]));
  });
  it("keeps missing version as null with no known-only ratio", async () => {
    const x = await stored([call("known"),result("known"),call("missing", undefined, {}, { version: undefined }),result("missing")]);
    expect(x.admitted).toHaveLength(2); expect(x.admitted.find(e => e.id === eventId("missing"))!.lookupKey).toBeNull(); expect(count(x.admitted)).toBeNull();
  });
  it("distinguishes omitted roots, changed projects and canonical option member order", async () => {
    const omitted = call("omitted"); delete (omitted.message.content[0]!.input as Record<string, unknown>).path;
    const x = await stored([omitted,result("omitted"),call("project",undefined,{}, {cwd:project+"2"}),result("project"),call("o1",undefined,{ "-i":false, multiline:false }),result("o1"),call("o2",undefined,{ multiline:false,"-i":false }),result("o2")]);
    expect(Object.fromEntries(x.admitted.map(e => [e.id,e.lookupKey]))).toEqual({[eventId("omitted")]:lookup("FICTITIOUS_QUERY_A",["record_cwd"]),[eventId("project")]:lookup("FICTITIOUS_QUERY_A",undefined,undefined,undefined,undefined,project+"2"),[eventId("o1")]:lookup("FICTITIOUS_QUERY_A",undefined,'{"-i":false,"multiline":false}'),[eventId("o2")]:lookup("FICTITIOUS_QUERY_A",undefined,'{"-i":false,"multiline":false}')});
    expect(count(x.admitted)).toEqual([4,3,1,0.25]);
  });
  it("preserves an initial project-absent call as unknown before a known call", async () => {
    const x = await stored([call("missing",undefined,{}, {cwd:undefined}),result("missing"),call("known"),result("known")]);
    expect(x.admitted.find(e=>e.id===eventId("missing"))!.lookupKey).toBeNull();
    expect(x.admitted.find(e=>e.id===eventId("known"))!.lookupKey).toBe(lookup("FICTITIOUS_QUERY_A"));
    expect(count(x.admitted)).toBeNull();
  });
  it("reopens persisted evidence after raw deletion without file mutation", async () => {
    const x = await stored(four); await rm(x.path);
    await writeFile(join(x.data, "identity-key.json"), JSON.stringify({ keyVersion: 1, keyId, secret: secret.toString("hex") }) + "\n", { mode: 0o600 });
    const snapshot = async () => Promise.all((await readdir(x.data)).sort().map(async name => { const path = join(x.data,name), s = await stat(path); return {name, mode:s.mode, digest:createHash("sha256").update(await readFile(path)).digest("hex")}; }));
    const before = await snapshot();
    // The production CLI test must additionally use withReadOnlyStore through runStats.
    await withReadOnlyStore(x.data, (db, storedKeyId) => { expect(storedKeyId).toBe(keyId); expect(createSourceStore(db,storedKeyId).readSource(x.source.sourceId)!.events).toEqual(x.source.events); });
    expect(await snapshot()).toEqual(before);
  });
});
