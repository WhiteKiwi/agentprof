import { spawnSync } from "node:child_process";
import { appendFile,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect,it,vi } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { createSourceStore } from "../src/db/source-store.js";
import { CodexAdapter } from "../src/parsers/codex/index.js";
import { ingestSourceFileFromCheckpoint } from "../src/scanner/source-ingest.js";
import { temporaryDirectory } from "./helpers.js";
import { context,keyId,ordinary,encode,cold } from "./codex-resume-fixture.js";
// Portable harness input must identify a built, immutable PR38 (pre-resume) tree.
// Never silently replace it with current production or fake legacy rows.
const seed = `const a=JSON.parse(process.argv[1]);const {openDatabase}=await import(a.dist+"db/database.js");const {createSourceStore}=await import(a.dist+"db/source-store.js");const {createIdentityContext}=await import(a.dist+"normalize/identity.js");const {ingestSourceFile}=await import(a.dist+"scanner/source-ingest.js");const db=await openDatabase(a.data);try{const c=createIdentityContext(Buffer.alloc(32,37),"7".repeat(32));const r=await ingestSourceFile(createSourceStore(db,c.keyId),c,{path:a.path,provider:"codex",expectedRevision:null});if(r.status!=="committed")throw Error("OLD_SEED_REJECTED");process.stdout.write(JSON.stringify({sourceId:r.sourceId,version:db.prepare("PRAGMA user_version").get().user_version}));}finally{db.close();}`;
it("actual previous Codex source upgrades without checkpoint, fully replays then captures",async()=>{
 const old=process.env.AGENTPROF_PRE_RESUME_DIST;expect(old,"HARNESS_REQUIRED: AGENTPROF_PRE_RESUME_DIST must be pinned PR38 dist").toBeTruthy();const root=temporaryDirectory(),path=join(root,"input.jsonl"),data=join(root,"data");await writeFile(path,encode(ordinary.slice(0,2)));
 const child=spawnSync(process.execPath,["--input-type=module","--eval",seed,JSON.stringify({dist:pathToFileURL(old!.replace(/\/$/,"")+"/").href,path,data})],{encoding:"utf8",timeout:10000,env:{...process.env,NODE_NO_WARNINGS:"1"}});expect(child.error).toBeUndefined();expect(child.status).toBe(0);expect(child.stderr).toBe("");const evidence=JSON.parse(child.stdout);expect(evidence.version).toBe(5);
 const db=await openDatabase(data);try{expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(6);const store=createSourceStore(db,keyId),candidate=store.readSourceForIngestion(evidence.sourceId,context);expect(candidate.checkpoint).toBeNull();await appendFile(path,encode(ordinary.slice(2)));const expected=cold(encode(ordinary),path),spy=vi.spyOn(CodexAdapter.prototype,"ingest");try{expect(await ingestSourceFileFromCheckpoint(store,context,{path,provider:"codex",expectedRevision:1},candidate)).toMatchObject({status:"committed",revision:2});expect(spy).toHaveBeenCalledTimes(4);expect(store.readSourceForIngestion(evidence.sourceId,context).checkpoint!.nextOrdinal).toBe(4);expect(store.readSource(evidence.sourceId)!.events).toEqual([...expected.snapshot.events].sort((a,b)=>a.id.localeCompare(b.id)));}finally{spy.mockRestore();}}finally{db.close();}
});
