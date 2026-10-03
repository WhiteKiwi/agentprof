import { createHmac } from "node:crypto";
import { appendFileSync } from "node:fs";
import fileSystem from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { appendFile, writeFile, readFile, rename, truncate, unlink, symlink, stat, utimes } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { scanSources } from "../src/scanner/scan-run.js";
import { CodexAdapter } from "../src/parsers/codex/index.js";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import { createIdentityContext } from "../src/normalize/identity.js";
import { ClaudeAdapter, createClaudeAdapter } from "../src/parsers/claude/index.js";
import * as ingestion from "../src/scanner/source-ingest.js";
import { temporaryDirectory } from "./helpers.js";

// Planning-frozen independent fixture. No expected semantic value is produced by
// the new persisted-checkpoint path. The reference never exports/restores state.
const secret = Buffer.alloc(32, 23), keyId = "2".repeat(32);
const context = createIdentityContext(secret, keyId);
const session = "FICTITIOUS_CLAUDE_RESUME_SESSION", rawCall = "FICTITIOUS_CLAUDE_RESUME_CALL", response = "FICTITIOUS_CLAUDE_RESUME_RESPONSE";
const hmac = (domain: string, ...parts: unknown[]) => `h1:${keyId}:${domain}:${createHmac("sha256", secret).update(JSON.stringify([1, 1, domain, ...parts])).digest("hex")}`;
const at = (n: number) => `2026-09-01T00:00:0${n}.000Z`;
const call = { type: "assistant", uuid: "call", sessionId: session, timestamp: at(0), message: { id: response, role: "assistant", content: [{ type: "tool_use", id: rawCall, name: "Bash", input: { command: "npm test FICTITIOUS_CLAUDE_RESUME_COMMAND" } }] } };
const usage = (uuid: string, output: number, second: number) => ({ type: "assistant", uuid, sessionId: session, timestamp: at(second), message: { id: response, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: output, cache_read_input_tokens: 30, cache_creation_input_tokens: 20 } } });
const result = { type: "user", uuid: "result", parentUuid: "call", sessionId: session, timestamp: at(4), message: { role: "user", content: [{ type: "tool_result", tool_use_id: rawCall, is_error: false, content: "FICTITIOUS_CLAUDE_RESUME_OUTPUT 한글" }] } };
const ordinary = [call, usage("six", 6, 1), usage("ten", 10, 2), result];
function encode(records: readonly unknown[], crlf = false, bom = false) { return Buffer.from((bom ? "\uFEFF" : "") + records.map(record => JSON.stringify(record) + (crlf ? "\r\n" : "\n")).join("")); }
function reference(bytes: Buffer, path: string) {
  const adapter = createClaudeAdapter(context); let offset = 0, ordinal = 0;
  while (offset < bytes.length) {
    const lf = bytes.indexOf(10, offset); if (lf < 0) break;
    let line = bytes.subarray(offset, lf).toString("utf8");
    if (offset === 0 && line.startsWith("\uFEFF")) line = line.slice(1);
    adapter.ingest(JSON.parse(line), { fileIdentity: path, sourceAlias: "source-1", byteOffset: offset, ordinal: ordinal++ }); offset = lf + 1;
  }
  return { snapshot: adapter.snapshot(), offset, ordinal };
}
function assertProjection(saved: any, expected: ReturnType<typeof reference>, size: number) {
  const s = expected.snapshot;
  expect(saved).toMatchObject({ provider: "claude", completedOffset: expected.offset, observedSize: size, aggregationReady: false, parserResumeReady: false });
  expect(saved.events).toEqual([...s.events].sort((a, b) => a.id.localeCompare(b.id)));
  expect(saved.evidence).toEqual({ turns: s.turns, usage: s.usage, observations: s.observations, diagnostics: s.diagnostics, capabilities: s.capabilities });
  expect(saved.relationshipEvidence).toMatchObject({ status: "captured", provider: "claude", metadata: s.metadata, messages: s.messages });
  expect(saved).not.toHaveProperty("checkpoint");
}
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); });

it("freezes independent ordinary IDs, 4000ms paired interval and 150/160 provisional usage", () => {
  const path = "/FICTITIOUS_CLAUDE_RESUME_SOURCE", { snapshot } = reference(encode(ordinary), path), stream = hmac("session", "claude", session, null);
  expect(snapshot.events).toHaveLength(1);
  expect(snapshot.events[0]).toMatchObject({ id: hmac("event", "claude", stream, rawCall), sessionId: stream, status: "completed", durationMs: 4000, durationScope: "invocation_latency", timingEvidence: "paired_timestamps", contentFingerprint: null, errorFingerprint: null });
  expect(snapshot.usage).toHaveLength(1);
  expect(snapshot.usage[0]).toMatchObject({ id: hmac("event", "claude", stream, "usage", response), selection: "provisional", finality: "unknown", counts: { input: 150, uncachedInput: 100, cachedInput: 30, cacheWriteInput: 20, output: 10, total: 160, reasoningOutput: null } });
});

describe("actual SQLite reopen and LF-bounded Claude continuation", () => {
  it.each([0, 1, 2, 3, 4])("continues split%i with no prefix ingestion and exact independent evidence", async split => {
    const root = temporaryDirectory(), path = join(root, "input.jsonl"), data = join(root, "data"), prefix = encode(ordinary.slice(0, split)), all = encode(ordinary), expected = reference(all, path);
    await writeFile(path, prefix); let db = await openDatabase(data);
    try {
      const cold = await ingestion.ingestSourceFile(createSourceStore(db, keyId), context, { path, provider: "claude", expectedRevision: null, chunkBytes: 17 });
      expect(cold).toMatchObject({ status: "committed", revision: 1 }); db.close(); db = await openDatabase(data);
      const store: any = createSourceStore(db, keyId), candidate = store.readSourceForIngestion(cold.sourceId, context);
      expect(candidate.checkpoint).not.toBeNull(); expect(candidate.checkpoint.nextOrdinal).toBe(split);
      await appendFile(path, all.subarray(prefix.length)); const spy = vi.spyOn(ClaudeAdapter.prototype, "ingest");
      const outcome = await (ingestion as any).ingestSourceFileFromCheckpoint(store, context, { path, provider: "claude", expectedRevision: 1, chunkBytes: 13 }, candidate);
      expect(outcome).toMatchObject({ status: "committed", revision: 2, aggregationReady: false, parserResumeReady: false });
      expect(spy).toHaveBeenCalledTimes(ordinary.length - split);
      expect(spy.mock.calls.every(([, descriptor]) => descriptor.byteOffset >= prefix.length && descriptor.ordinal >= split)).toBe(true);
      assertProjection(store.readSource(cold.sourceId), expected, all.length);
      expect(store.readSourceForIngestion(cold.sourceId, context).checkpoint.nextOrdinal).toBe(4);
      const exposed = JSON.stringify({ outcome, saved: store.readSource(cold.sourceId), rows: db.prepare("SELECT * FROM source_parser_checkpoints").all() });
      expect(exposed).not.toContain("FICTITIOUS_"); expect(exposed).not.toContain(path); expect(exposed).not.toContain(secret.toString("hex"));
    } finally { db.close(); }
  });

  it.each([1, 7, 19])("resumes unchanged pending JSON tail across chunk%i", async chunkBytes => {
    const root = temporaryDirectory(), path = join(root, "input.jsonl"), data = join(root, "data"), all = encode(ordinary, true, true), lfs = [...all.keys()].filter(i => all[i] === 10), split = lfs[1]! + 1;
    // End inside the third record; the old tail is verified but parsed again.
    const pendingEnd = split + 29, prefix = all.subarray(0, pendingEnd); await writeFile(path, prefix);
    let db = await openDatabase(data);
    try {
      const first = await ingestion.ingestSourceFile(createSourceStore(db, keyId), context, { path, provider: "claude", expectedRevision: null, chunkBytes });
      expect(first.status).toBe("committed"); db.close(); db = await openDatabase(data);
      const store: any = createSourceStore(db, keyId), candidate = store.readSourceForIngestion(first.sourceId, context);
      expect(candidate.source.completedOffset).toBe(split); expect(candidate.checkpoint.nextOrdinal).toBe(2);
      await appendFile(path, all.subarray(pendingEnd)); const spy = vi.spyOn(ClaudeAdapter.prototype, "ingest");
      const outcome = await (ingestion as any).ingestSourceFileFromCheckpoint(store, context, { path, provider: "claude", expectedRevision: 1, chunkBytes }, candidate);
      expect(outcome.status).toBe("committed"); expect(spy).toHaveBeenCalledTimes(2); assertProjection(store.readSource(first.sourceId), reference(all, path), all.length);
    } finally { db.close(); }
  });

  it.each(["prefix_rewrite", "tail_rewrite", "truncate"])("stable %s replays all current complete records with original CAS", async change => {
    const root = temporaryDirectory(), path = join(root, "input.jsonl"), data = join(root, "data"), old = Buffer.concat([encode(ordinary.slice(0, 2)), Buffer.from('{"private_tail":')]); await writeFile(path, old);
    const db = await openDatabase(data);
    try {
      const store: any = createSourceStore(db, keyId), first = await ingestion.ingestSourceFile(store, context, { path, provider: "claude", expectedRevision: null });
      const candidate = store.readSourceForIngestion(first.sourceId, context);
      const current = change === "truncate" ? encode([call]) : change === "prefix_rewrite" ? encode([{ ...call, uuid: "different" }, ...ordinary.slice(1)]) : encode(ordinary);
      await writeFile(path, current); const expected = reference(current, path), spy = vi.spyOn(ClaudeAdapter.prototype, "ingest");
      const outcome = await (ingestion as any).ingestSourceFileFromCheckpoint(store, context, { path, provider: "claude", expectedRevision: 1 }, candidate);
      expect(outcome).toMatchObject({ status: "committed", revision: 2 }); expect(spy).toHaveBeenCalledTimes(expected.ordinal); assertProjection(store.readSource(first.sourceId), expected, current.length);
    } finally { db.close(); }
  });
});


it.each([false, true])("saved tail ends after first UTF8 byte; premature LF=%s", async prematureLf => {
  const root = temporaryDirectory(), path = join(root, "input.jsonl"), data = join(root, "data"), all = encode(ordinary);
  const lead = all.indexOf(Buffer.from("한")); expect(lead).toBeGreaterThan(0);
  const split = lead + 1; expect(all[lead]).toBe(0xed); await writeFile(path, all.subarray(0, split));
  let db = await openDatabase(data);
  try {
    const first = await ingestion.ingestSourceFile(createSourceStore(db, keyId), context, { path, provider: "claude", expectedRevision: null, chunkBytes: 1 });
    expect(first.status).toBe("committed"); db.close(); db = await openDatabase(data);
    const store: any = createSourceStore(db, keyId), candidate = store.readSourceForIngestion(first.sourceId, context), before = store.readSource(first.sourceId), checkpoints = db.prepare("SELECT * FROM source_parser_checkpoints").all();
    expect(candidate.checkpoint.nextOrdinal).toBe(3);
    await appendFile(path, prematureLf ? Buffer.from("\n") : all.subarray(split));
    const spy = vi.spyOn(ClaudeAdapter.prototype, "ingest");
    const outcome = await (ingestion as any).ingestSourceFileFromCheckpoint(store, context, { path, provider: "claude", expectedRevision: 1, chunkBytes: 1 }, candidate);
    if (prematureLf) {
      expect(outcome).toMatchObject({ status: "rejected", reason: "reader_error", readerDiagnostics: [{ code: "INVALID_UTF8" }] });
      expect(spy).not.toHaveBeenCalled(); expect(store.readSource(first.sourceId)).toEqual(before); expect(db.prepare("SELECT * FROM source_parser_checkpoints").all()).toEqual(checkpoints);
    } else {
      expect(outcome.status).toBe("committed"); expect(spy).toHaveBeenCalledTimes(1); assertProjection(store.readSource(first.sourceId), reference(all, path), all.length);
    }
  } finally { db.close(); }
});

it("retains an oversized unfinished tail but rejects its appended LF without commit", async () => {
  const root = temporaryDirectory(), path = join(root, "input.jsonl"), data = join(root, "data"), maxLineBytes = 4096;
  const prefix = Buffer.concat([encode([call]), Buffer.from('"' + "x".repeat(maxLineBytes))]); await writeFile(path, prefix);
  let db = await openDatabase(data);
  try {
    const first = await ingestion.ingestSourceFile(createSourceStore(db, keyId), context, { path, provider: "claude", expectedRevision: null, maxLineBytes, chunkBytes: 17 });
    expect(first.status).toBe("committed"); db.close(); db = await openDatabase(data);
    const store: any = createSourceStore(db, keyId), candidate = store.readSourceForIngestion(first.sourceId, context), before = store.readSource(first.sourceId), checkpoints = db.prepare("SELECT * FROM source_parser_checkpoints").all();
    expect(candidate.checkpoint.nextOrdinal).toBe(1); await appendFile(path, '"\n'); const spy = vi.spyOn(ClaudeAdapter.prototype, "ingest");
    const outcome = await (ingestion as any).ingestSourceFileFromCheckpoint(store, context, { path, provider: "claude", expectedRevision: 1, maxLineBytes, chunkBytes: 13 }, candidate);
    expect(outcome).toMatchObject({ status: "rejected", reason: "reader_error", readerDiagnostics: [{ code: "RECORD_TOO_LARGE" }] });
    expect(spy).not.toHaveBeenCalled(); expect(store.readSource(first.sourceId)).toEqual(before); expect(db.prepare("SELECT * FROM source_parser_checkpoints").all()).toEqual(checkpoints);
  } finally { db.close(); }
});


async function seededPrefix(old: Buffer = encode(ordinary.slice(0, 2)), options: Record<string, unknown> = {}) {
  const root = temporaryDirectory(), path = join(root, "source.jsonl"), data = join(root, "data"); await writeFile(path, old); const db = await openDatabase(data);
  try {
    const store: any = createSourceStore(db, keyId); expect(typeof store.readSourceForIngestion, "missing resume read API").toBe("function");
    const first = await ingestion.ingestSourceFile(store, context, {path,provider:"claude",expectedRevision:null,...options}); expect(first.status).toBe("committed");
    return {root,path,data,db,store,id:first.sourceId,candidate:store.readSourceForIngestion(first.sourceId,context)};
  } catch (error) { db.close(); throw error; }
}
function savedGeneration(f: Awaited<ReturnType<typeof seededPrefix>>) { return { source:f.store.readSource(f.id), checkpoints:f.db.prepare("SELECT * FROM source_parser_checkpoints").all() }; }

it.each(["claude-message.jsonl", "claude-fork.jsonl", "claude-real-shapes.jsonl"])("immutable ordinary fixture %s resumes at every LF", async name => {
  const all = await readFile(new URL("./fixtures/providers/" + name, import.meta.url)), boundaries = [0, ...[...all.keys()].filter(i=>all[i]===10).map(i=>i+1)];
  for (const boundary of boundaries) {
    const f = await seededPrefix(all.subarray(0,boundary));
    try {
      const expected = reference(all,f.path), oldCount = reference(all.subarray(0,boundary),f.path).ordinal;
      await appendFile(f.path,all.subarray(boundary)); const spy = vi.spyOn(ClaudeAdapter.prototype,"ingest");
      const result = await (ingestion as any).ingestSourceFileFromCheckpoint(f.store,context,{path:f.path,provider:"claude",expectedRevision:1,chunkBytes:11},f.candidate);
      expect(result.status).toBe("committed"); expect(spy).toHaveBeenCalledTimes(expected.ordinal-oldCount); spy.mockRestore(); assertProjection(f.store.readSource(f.id),expected,all.length);
    } finally { f.db.close(); vi.restoreAllMocks(); }
  }
});

it.each(["deferred", "replay", "background"])("three persisted cycles retain %s private adapter state", async kind => {
  const bg = {...call,message:{...call.message,content:[{...call.message.content[0],input:{command:"npm test",run_in_background:true}}]}};
  const acknowledgement = {...result,toolUseResult:{backgroundTaskId:"FICTITIOUS_BACKGROUND"}};
  const records = kind === "deferred" ? [result, call, result] : kind === "replay" ? [ordinary[0],ordinary[1],ordinary[2],ordinary[1],ordinary[0],ordinary[3],ordinary[3]] : [bg,acknowledgement,{type:"system",subtype:"turn_duration",uuid:"turn",sessionId:session,timestamp:at(9),durationMs:9000}];
  const f = await seededPrefix(encode([])); let count=0, revision=1;
  try {
    for(const end of [1,Math.ceil(records.length/2),records.length]) {
      const expected = reference(encode(records.slice(0,end)),f.path), candidate=f.store.readSourceForIngestion(f.id,context); await appendFile(f.path,encode(records.slice(count,end)));
      expect(await (ingestion as any).ingestSourceFileFromCheckpoint(f.store,context,{path:f.path,provider:"claude",expectedRevision:revision},candidate)).toMatchObject({status:"committed",revision:++revision});
      count=end; assertProjection(f.store.readSource(f.id),expected,encode(records.slice(0,end)).length);
    }
  } finally { f.db.close(); }
});

it.each(["append","truncate","rewrite","replace","unlink","symlink","short","abort","read_error","close_error"])("prefix probe %s rejects and closes actual descriptor without commit", async change => {
  const f = await seededPrefix(); const before=savedGeneration(f), opening=fileSystem.open, handles:FileHandle[]=[], controller=new AbortController(); let injected=false;
  const spy=vi.spyOn(fileSystem,"open").mockImplementation(async(...args)=>{
    const handle=await opening(...args), read=handle.read.bind(handle), close=handle.close.bind(handle); handles.push(handle);
    handle.read=(async(...a:Parameters<typeof handle.read>)=>{
      if(change==="short")return {bytesRead:0,buffer:a[0]}; if(change==="read_error")throw Error("FICTITIOUS_READ_ERROR");
      const r=await read(...a); if(!injected){injected=true;
        if(change==="append")await appendFile(f.path,"x"); if(change==="truncate")await truncate(f.path,0); if(change==="rewrite")await writeFile(f.path,encode([call]));
        if(change==="unlink")await unlink(f.path);
        if(change==="replace"||change==="symlink"){const replacement=f.path+".replacement";await writeFile(replacement,encode(ordinary.slice(0,2)));if(change==="replace")await rename(replacement,f.path);else{await unlink(f.path);await symlink(replacement,f.path);}}
        if(change==="abort")controller.abort();
      } return r;
    }) as typeof handle.read;
    if(change==="close_error")handle.close=async()=>{await close();throw Error("FICTITIOUS_CLOSE_ERROR");}; return handle;
  });syncBuiltinESMExports();
  try{
    const outcome=await (ingestion as any).ingestSourceFileFromCheckpoint(f.store,context,{path:f.path,provider:"claude",expectedRevision:1,chunkBytes:5,signal:controller.signal},f.candidate);
    expect(outcome.status).toBe(change==="abort"?"aborted":"rejected"); expect(savedGeneration(f)).toEqual(before); expect(handles.length).toBeGreaterThan(0);
    for(const handle of handles)await expect(handle.stat()).rejects.toMatchObject({code:"EBADF"}); expect(JSON.stringify(outcome)).not.toMatch(/FICTITIOUS_|source\.jsonl/);
  }finally{spy.mockRestore();syncBuiltinESMExports();f.db.close();}
});

it.each(["abort","append","close_error"])("suffix phase %s never publishes partial state", async change=>{
  const f=await seededPrefix(),before=savedGeneration(f);await appendFile(f.path,encode(ordinary.slice(2)));const opening=fileSystem.open,handles:FileHandle[]=[],controller=new AbortController();let injected=false;
  const openSpy=vi.spyOn(fileSystem,"open").mockImplementation(async(...args)=>{const h=await opening(...args),close=h.close.bind(h);handles.push(h);if(change==="close_error")h.close=async()=>{await close();throw Error("private");};return h;});syncBuiltinESMExports();
  const original=ClaudeAdapter.prototype.ingest,ingestSpy=vi.spyOn(ClaudeAdapter.prototype,"ingest").mockImplementation(function(value,descriptor){const batch=original.call(this,value,descriptor);if(!injected){injected=true;if(change==="abort")controller.abort();if(change==="append")appendFileSync(f.path,"x");}return batch;});
  try{
    const outcome=await (ingestion as any).ingestSourceFileFromCheckpoint(f.store,context,{path:f.path,provider:"claude",expectedRevision:1,chunkBytes:11,signal:controller.signal},f.candidate);
    expect(outcome.status).toBe(change==="abort"?"aborted":"rejected");expect(savedGeneration(f)).toEqual(before);for(const h of handles)await expect(h.stat()).rejects.toMatchObject({code:"EBADF"});
  }finally{ingestSpy.mockRestore();openSpy.mockRestore();syncBuiltinESMExports();f.db.close();}
});

it("total record limit includes the committed prefix rather than only suffix",async()=>{
  const f=await seededPrefix(encode(ordinary.slice(0,2)),{maxRecords:3}),before=savedGeneration(f);await appendFile(f.path,encode(ordinary.slice(2)));
  try{expect(await (ingestion as any).ingestSourceFileFromCheckpoint(f.store,context,{path:f.path,provider:"claude",expectedRevision:1,maxRecords:3},f.candidate)).toMatchObject({status:"rejected",reason:"record_limit"});expect(savedGeneration(f)).toEqual(before);}finally{f.db.close();}
});

it.each(["early","middle"])("same-size %s rewrite with restored mtime and unchanged LF forces full replay",async where=>{
  const all=encode(ordinary),f=await seededPrefix(all),info=await stat(f.path);let text=all.toString();
  text=where==="early"?text.replace('"uuid":"call"','"uuid":"cAll"'):text.replace('"output_tokens":6','"output_tokens":7');const changed=Buffer.from(text);expect(changed.length).toBe(all.length);await writeFile(f.path,changed);await utimes(f.path,info.atime,info.mtime);const expected=reference(changed,f.path),spy=vi.spyOn(ClaudeAdapter.prototype,"ingest");
  try{expect(await (ingestion as any).ingestSourceFileFromCheckpoint(f.store,context,{path:f.path,provider:"claude",expectedRevision:1},f.candidate)).toMatchObject({status:"committed",revision:2});expect(spy).toHaveBeenCalledTimes(4);assertProjection(f.store.readSource(f.id),expected,changed.length);}finally{f.db.close();}
});

it("unchanged Claude preserves revision/output and explicit cold Codex replay captures checkpoints",async()=>{
  const f=await seededPrefix(encode(ordinary), {maxFileBytes:16*1024*1024});
  try{
    const before=savedGeneration(f),spy=vi.spyOn(ClaudeAdapter.prototype,"ingest"),warm=await scanSources(f.store,context,[{provider:"claude",path:f.root}]);expect(warm.counts).toMatchObject({unchanged:1,committed:0});expect(spy).not.toHaveBeenCalled();expect(savedGeneration(f)).toEqual(before);spy.mockRestore();
    const codex=join(f.root,"codex.jsonl");await writeFile(codex,'{"type":"session_meta","payload":{"id":"FICTITIOUS_CODEX"}}\n');const cid=context.fingerprint("source",["codex",codex]);
    expect(await ingestion.ingestSourceFile(f.store,context,{path:codex,provider:"codex",expectedRevision:null})).toMatchObject({status:"committed",revision:1});expect(f.db.prepare("SELECT * FROM source_parser_checkpoints WHERE source_id=?").all(cid)).toHaveLength(1);expect(f.store.readSourceForIngestion(cid,context)).toMatchObject({source:{provider:"codex",revision:1},checkpoint:{contractVersion:1,nextOrdinal:1}});
    await appendFile(codex,'{}\n');const codexSpy=vi.spyOn(CodexAdapter.prototype,"ingest");expect(await ingestion.ingestSourceFile(f.store,context,{path:codex,provider:"codex",expectedRevision:1})).toMatchObject({status:"committed",revision:2});expect(codexSpy).toHaveBeenCalledTimes(2);expect(f.db.prepare("SELECT * FROM source_parser_checkpoints WHERE source_id=?").all(cid)).toHaveLength(1);expect(f.store.readSourceForIngestion(cid,context)).toMatchObject({source:{provider:"codex",revision:2},checkpoint:{contractVersion:1,nextOrdinal:2}});
  }finally{f.db.close();}
});

it("new whole-file proof hashes exact verified-prefix and decoder-suffix bytes",async()=>{
  const f=await seededPrefix(),oldOffset=f.candidate.source.completedOffset,all=encode(ordinary),changed=Buffer.from(all.toString().replace('"output_tokens":10','"output_tokens":11'));expect(changed.length).toBe(all.length);await appendFile(f.path,all.subarray(oldOffset));
  const opening=fileSystem.open;let injected=false;
  const spy=vi.spyOn(fileSystem,"open").mockImplementation(async(...args)=>{const h=await opening(...args),read=h.read.bind(h);h.read=(async(...a:Parameters<typeof h.read>)=>{const r=await read(...a),position=Number(a[3]);if(!injected&&position===oldOffset){expect(r.bytesRead).toBe(all.length-oldOffset);(a[0] as Buffer).set(changed.subarray(oldOffset));injected=true;}return r;}) as typeof h.read;return h;});syncBuiltinESMExports();
  try{
    expect(await (ingestion as any).ingestSourceFileFromCheckpoint(f.store,context,{path:f.path,provider:"claude",expectedRevision:1},f.candidate)).toMatchObject({status:"committed",revision:2});expect(injected).toBe(true);
    const expected=reference(changed,f.path),saved=f.store.readSource(f.id);assertProjection(saved,expected,changed.length);expect(saved.evidence.usage[0].counts.output).toBe(11);
    const observedBoundary=context.fingerprint("content",["source_boundary_v1",expected.offset,changed.subarray(Math.max(0,expected.offset-4096),expected.offset).toString("base64")]);
    const diskBoundary=context.fingerprint("content",["source_boundary_v1",expected.offset,all.subarray(Math.max(0,expected.offset-4096),expected.offset).toString("base64")]);
    expect(saved.boundaryFingerprint).toBe(observedBoundary);expect(saved.boundaryFingerprint).not.toBe(diskBoundary);
    const proof=context.startSourceFileProof({sourceId:f.id,provider:"claude",parserVersion:saved.parserVersion,maxFileBytes:64*1024*1024,maxRecords:32768,maxLineBytes:1024*1024,observedSize:changed.length});proof.update(changed);expect(saved.cacheEvidence.contentFingerprint).toBe(proof.finish());
    const diskProof=context.startSourceFileProof({sourceId:f.id,provider:"claude",parserVersion:saved.parserVersion,maxFileBytes:64*1024*1024,maxRecords:32768,maxLineBytes:1024*1024,observedSize:all.length});diskProof.update(all);expect(saved.cacheEvidence.contentFingerprint).not.toBe(diskProof.finish());
  }finally{spy.mockRestore();syncBuiltinESMExports();f.db.close();}
});

it.each(["before_open","after_close"])("cancellation %s preserves original generation",async phase=>{
  const f=await seededPrefix(),before=savedGeneration(f),controller=new AbortController(),opening=fileSystem.open;let opens=0;
  const spy=vi.spyOn(fileSystem,"open").mockImplementation(async(...args)=>{opens++;const h=await opening(...args),close=h.close.bind(h);h.close=async()=>{await close();controller.abort();};return h;});syncBuiltinESMExports();if(phase==="before_open")controller.abort();
  try{expect(await (ingestion as any).ingestSourceFileFromCheckpoint(f.store,context,{path:f.path,provider:"claude",expectedRevision:1,signal:controller.signal},f.candidate)).toMatchObject({status:"aborted"});expect(savedGeneration(f)).toEqual(before);if(phase==="before_open")expect(opens).toBe(0);}finally{spy.mockRestore();syncBuiltinESMExports();f.db.close();}
});

it.each(["ingestion", "suffix"])("new %s candidate envelopes reject executable or unexpected shapes without callbacks or writes", async api => {
  const f = await seededPrefix();
  const reader = await import("../src/scanner/source-prefix.js");
  const original = api === "ingestion" ? f.candidate : {
    sourceId:f.id, provider:"claude", parserVersion:f.candidate.source.parserVersion,
    observedSize:f.candidate.source.observedSize, completedOffset:f.candidate.source.completedOffset,
    boundaryFingerprint:f.candidate.source.boundaryFingerprint, contentFingerprint:f.candidate.source.cacheEvidence.contentFingerprint,
    nextOrdinal:f.candidate.checkpoint.nextOrdinal, maxFileBytes:f.candidate.checkpoint.maxFileBytes,
    maxRecords:f.candidate.checkpoint.maxRecords, maxLineBytes:f.candidate.checkpoint.maxLineBytes,
  };
  let callbacks = 0;
  const throwCallback = () => { callbacks++; throw Error("FICTITIOUS_EXECUTABLE_CANDIDATE"); };
  const getter = (value:any, field:string) => Object.defineProperty({...value}, field, {enumerable:true, get:throwCallback});
  const proxy = (value:any) => new Proxy(value, {get:throwCallback, ownKeys:throwCallback, getPrototypeOf:throwCallback});
  const variants:any[] = [getter(original, api === "ingestion" ? "source" : "observedSize"), proxy(original), {...original, extra:"FICTITIOUS"}, {...original, [Symbol("unexpected")]:true}];
  if (api === "ingestion") variants.push({...original, source:getter(original.source,"sourceId")}, {...original, checkpoint:getter(original.checkpoint,"nextOrdinal")}, {...original, predecessor:proxy(original.predecessor)}, {...original, source:{...original.source,cacheEvidence:getter(original.source.cacheEvidence,"contentFingerprint")}});
  const before = savedGeneration(f), open = vi.spyOn(fileSystem, "open"); syncBuiltinESMExports();
  try {
    for (const candidate of variants) {
      if (api === "ingestion") await expect((ingestion as any).ingestSourceFileFromCheckpoint(f.store,context,{path:f.path,provider:"claude",expectedRevision:1},candidate)).rejects.toThrow();
      else await expect((reader as any).readSourceSuffixWithProof(f.path,context,candidate,()=>true)).rejects.toThrow();
      expect(callbacks).toBe(0); expect(open).not.toHaveBeenCalled(); expect(savedGeneration(f)).toEqual(before);
    }
  } finally { open.mockRestore(); syncBuiltinESMExports(); f.db.close(); }
});
