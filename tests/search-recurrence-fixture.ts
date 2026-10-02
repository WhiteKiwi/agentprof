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

export { stored, four, call, result, count, keyId, secret, h, eventId, lookup };
