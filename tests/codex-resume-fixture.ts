import { createHash, createHmac } from "node:crypto";
import { createIdentityContext } from "../src/normalize/identity.js";
import { createCodexAdapter } from "../src/parsers/codex/index.js";
export const secret = Buffer.alloc(32,37), keyId = "7".repeat(32), context = createIdentityContext(secret,keyId);
export const sha = (text:string) => createHash("sha256").update(text).digest("hex");
export const hmac = (domain:string,...parts:unknown[]) => `h1:${keyId}:${domain}:${createHmac("sha256",secret).update(JSON.stringify([1,1,domain,...parts])).digest("hex")}`;
export const session = "FICTITIOUS_CODEX_RESUME_SESSION";
export const at = (n:number) => new Date(Date.UTC(2026,8,1,0,0,n)).toISOString();
export const counts = (input=100,output=10) => ({input_tokens:input,output_tokens:output,cached_input_tokens:20,cache_write_input_tokens:5,reasoning_output_tokens:2,total_tokens:input+output});
export const meta = {type:"session_meta",payload:{id:session,cli_version:"0.159.0",cwd:"/FICTITIOUS_PROJECT"}};
export const call = (name="exec_command",id="call",args:unknown={cmd:"rg target FICTITIOUS_COMMAND",workdir:"/FICTITIOUS_PROJECT"}) => ({type:"response_item",timestamp:at(0),payload:{type:"function_call",call_id:id,name,arguments:JSON.stringify(args)}});
export const result = (id="call",second=4,output:unknown={exit_code:1,output:"FICTITIOUS_OUTPUT 한글"}) => ({type:"response_item",timestamp:at(second),payload:{type:"function_call_output",call_id:id,output}});
export const usage = {type:"token_usage_record",timestamp:at(5),payload:{thread_id:session,turn_id:"t1",response_id:"r1",usage:counts(),thread_token_usage:counts(200,20)}};
export const token = (second:number,input:number,output:number,last=false) => ({type:"event_msg",timestamp:at(second),payload:{type:"token_count",info:{[last?"last_token_usage":"total_token_usage"]:counts(input,output)}}});
export const ordinary = [meta,call(),result(),usage];
export const wrappers = [meta,call("exec","wrapper",{}),result("wrapper"),call(),result(),usage];
export const processes = [meta,call(),result("call",1,{running:true,session_id:321}),call("write_stdin","poll",{session_id:321,chars:""}),result("poll",4,{exit_code:0,output:"FICTITIOUS_DONE"}),result("poll",4,{exit_code:0,output:"FICTITIOUS_DONE"})];
export const replay = [meta,result(),call(),result(),usage,usage];
export const cumulative = [meta,token(1,100,10),token(2,150,15),token(3,80,8),token(2,70,7),token(4,100,10,true),token(5,50,5,true)];
export function encode(records:readonly unknown[],crlf=false,bom=false) {return Buffer.from((bom?"\uFEFF":"")+records.map(v=>JSON.stringify(v)+(crlf?"\r\n":"\n")).join(""));}
// Deliberately no checkpoint export/restore and no ingestion/store helper.
export function cold(bytes:Buffer,path:string) {
 const adapter=createCodexAdapter(context);let offset=0,ordinal=0;
 while(offset<bytes.length){const lf=bytes.indexOf(10,offset);if(lf<0)break;let line=bytes.subarray(offset,lf).toString("utf8");if(offset===0&&line.startsWith("\uFEFF"))line=line.slice(1);adapter.ingest(JSON.parse(line),{fileIdentity:path,sourceAlias:"source-1",byteOffset:offset,ordinal:ordinal++});offset=lf+1;}
 return {snapshot:adapter.snapshot(),offset,ordinal};
}
export function allRows(db:any) {return Object.fromEntries(["settings","schema_migrations","source_store_identity","source_event_headers","source_event_contributions","source_metric_headers","source_metric_contributions","source_cache_evidence","source_relationship_headers","source_relationship_contributions","source_parser_checkpoints"].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY ${t==="schema_migrations"?"1":"1,2"}`).all()]));}
// Independent persisted projection framing, not imported from production validator.
export function projection(db:any,id:string) {
 const digest=createHash("sha256").update("agentprof.source-projection/v1\n"),frame=(v:unknown)=>digest.update(JSON.stringify(v)+"\n");
 for(const r of db.prepare("SELECT * FROM source_event_contributions WHERE source_id=? ORDER BY event_id").all(id))frame(["event",r.event_id,r.event_id,r.event_json]);
 for(const r of db.prepare("SELECT * FROM source_metric_contributions WHERE source_id=? ORDER BY kind,ordinal").all(id))frame([r.kind,r.ordinal,r.row_id,r.row_json]);
 const h=db.prepare("SELECT * FROM source_relationship_headers WHERE source_id=?").get(id);
 frame(["relationship_header",null,null,JSON.stringify(h?[h.contract_version,h.capture_policy_version,h.status,h.reason,h.metadata_count,h.wrapper_count,h.message_count,h.relationship_bytes]:null)]);
 for(const r of db.prepare("SELECT * FROM source_relationship_contributions WHERE source_id=? ORDER BY kind,ordinal").all(id))frame([r.kind,r.ordinal,r.row_id,r.row_json]);
 return digest.digest("hex");
}
export function seal(db:any,id:string,provider="codex") {
 const h=db.prepare("SELECT * FROM source_event_headers WHERE source_id=?").get(id),c=db.prepare("SELECT * FROM source_parser_checkpoints WHERE source_id=?").get(id),p=db.prepare("SELECT * FROM source_cache_evidence WHERE source_id=?").get(id);
 return hmac("source",`agentprof.${provider}-source-generation/v1`,sha(JSON.stringify([1,id,provider,h.parser_version,h.normalization_version,h.key_version,h.key_id,h.revision,h.completed_offset,h.observed_size,h.boundary_fingerprint,p.contract_version,p.content_fingerprint,c.next_ordinal,c.max_file_bytes,c.max_records,c.max_line_bytes,c.checkpoint_bytes,sha(c.checkpoint_json),c.adapter_limits_fingerprint,projection(db,id)])));
}
export function resign(db:any,id:string) {db.prepare("UPDATE source_parser_checkpoints SET generation_seal=? WHERE source_id=?").run(seal(db,id),id);}
