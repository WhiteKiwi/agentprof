import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { randomBytes } from "node:crypto";
import { lstat, realpath, open, link, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { resolve, dirname, join, parse, sep, relative, isAbsolute } from "node:path";
import { SafeError } from "../privacy/diagnostics.js";
export type PublicationWarning="target_verification_failed"|"temporary_cleanup_failed"|"directory_sync_unsupported"|"directory_sync_failed"|"directory_close_failed";
export type Publication=Readonly<{output:string;published:true;bytes:number;durability:"synced"|"unsupported"|"unconfirmed";cleanup:"removed"|"retained";targetVerification:"verified"|"unconfirmed";status:"published"|"published_with_warning";warnings:readonly PublicationWarning[]}>;
function code(e:unknown):string|undefined{return e!==null&&typeof e==="object"&&"code"in e&&typeof e.code==="string"?e.code:undefined;}
export function validateReportPath(path:string):string{if(typeof path!=="string"||!path.trim()||Buffer.byteLength(path)>4096||/[\u0000-\u001f\u007f-\u009f]/u.test(path))throw new SafeError("INVALID_ARGUMENT");return path;}
const same=(a:Stats,b:Stats)=>a.dev===b.dev&&a.ino===b.ino;
async function parentIdentity(parent:string):Promise<Stats>{let cursor=parse(parent).root;for(const part of parent.slice(cursor.length).split(sep).filter(Boolean)){cursor=join(cursor,part);const info=await lstat(cursor);if(!info.isDirectory()||info.isSymbolicLink())throw new SafeError("REPORT_OUTPUT_UNSAFE");}if(await realpath(parent)!==parent)throw new SafeError("REPORT_OUTPUT_UNSAFE");return lstat(parent);}
async function absent(path:string){try{await lstat(path);}catch(e){if(code(e)==="ENOENT")return;throw new SafeError("REPORT_OUTPUT_UNSAFE");}throw new SafeError("REPORT_OUTPUT_UNSAFE");}
/** Stable trusted ancestors are required; pathname APIs are not hostile-rename race-proof. */
export async function writeReportOutput(args:Readonly<{output:string;dataDirectory:string;html:string}>):Promise<Publication>{
 validateReportPath(args.output);validateReportPath(args.dataDirectory);if(typeof args.html!=="string"||Buffer.byteLength(args.html)>1048576)throw new SafeError("REPORT_LIMIT");
 if(process.platform!=="linux"&&process.platform!=="darwin")throw new SafeError("UNSUPPORTED_PLATFORM");
 const output=resolve(args.output),parent=dirname(output),buffer=Buffer.from(args.html),temporary=join(parent,`.agentprof-report-${randomBytes(16).toString("hex")}.tmp`);
 let parentStat:Stats;try{parentStat=await parentIdentity(parent);const privatePath=await realpath(resolve(args.dataDirectory)),rel=relative(privatePath,output);if(rel===""||!rel.startsWith(`..${sep}`)&&rel!==".."&&!isAbsolute(rel))throw new SafeError("REPORT_OUTPUT_UNSAFE");await absent(output);}catch(e){if(e instanceof SafeError)throw e;throw new SafeError("REPORT_OUTPUT_UNSAFE");}
 let file:FileHandle|null=null,owned:Stats|null=null,created=false,published=false;
 const cleanup=async():Promise<boolean>=>{if(!created)return true;try{const current=await lstat(temporary);if(owned===null||!same(current,owned)||!current.isFile()||current.isSymbolicLink())return false;await unlink(temporary);created=false;return true;}catch(e){if(code(e)==="ENOENT"){created=false;return true;}return false;}};
 try{
  file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);created=true;owned=await file.stat();const named=await lstat(temporary);if(!owned.isFile()||(owned.mode&0o777)!==0o600||!same(owned,named)||named.isSymbolicLink())throw new SafeError("REPORT_OUTPUT_UNSAFE");
  let offset=0;while(offset<buffer.length){const written=await file.write(buffer,offset,buffer.length-offset,offset);if(!Number.isSafeInteger(written.bytesWritten)||written.bytesWritten<=0||written.bytesWritten>buffer.length-offset)throw new SafeError("REPORT_OUTPUT_FAILED");offset+=written.bytesWritten;}
  await file.sync();await file.close();file=null;
  if(!same(parentStat,await parentIdentity(parent)))throw new SafeError("REPORT_OUTPUT_UNSAFE");const current=await lstat(temporary);if(!same(owned,current)||!current.isFile()||(current.mode&0o777)!==0o600||current.size!==buffer.length)throw new SafeError("REPORT_OUTPUT_UNSAFE");
  try{await link(temporary,output);}catch(e){if(code(e)==="EEXIST")throw new SafeError("REPORT_OUTPUT_UNSAFE");throw new SafeError("REPORT_OUTPUT_FAILED");}published=true;
 }catch(e){
  if(file!==null){try{await file.close();}catch{/* Preserve the original prelink failure. */}}
  if(!published){if(!await cleanup())throw new SafeError("REPORT_OUTPUT_CLEANUP_FAILED");throw e instanceof SafeError?e:new SafeError("REPORT_OUTPUT_FAILED");}
 }
 // No throwing path below may turn a linked result into an unpublished failure.
 const warnings:PublicationWarning[]=[];let targetVerification:Publication["targetVerification"]="unconfirmed";
 try{const target=await lstat(output);if(owned!==null&&same(target,owned)&&target.isFile()&&!target.isSymbolicLink()&&(target.mode&0o777)===0o600&&target.size===buffer.length)targetVerification="verified";else warnings.push("target_verification_failed");}catch{warnings.push("target_verification_failed");}
 const removed=await cleanup();if(!removed)warnings.push("temporary_cleanup_failed");let durability:Publication["durability"]="unconfirmed",directory:FileHandle|null=null;
 try{directory=await open(parent,constants.O_RDONLY|(constants.O_DIRECTORY??0));await directory.sync();durability="synced";}catch(e){if(["EINVAL","ENOTSUP","EOPNOTSUPP"].includes(code(e)??"")){durability="unsupported";warnings.push("directory_sync_unsupported");}else warnings.push("directory_sync_failed");}finally{if(directory!==null)try{await directory.close();}catch{warnings.push("directory_close_failed");}}
 return Object.freeze({output,published:true,bytes:buffer.length,durability,cleanup:removed?"removed":"retained",targetVerification,status:warnings.length===0?"published":"published_with_warning",warnings:Object.freeze(warnings)});
}
