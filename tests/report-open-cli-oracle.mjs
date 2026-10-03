// Independent synthetic CLI oracle. Usage: node this.mjs CANDIDATE_BINARY BASELINE_BINARY [INSTALLED_BINARY]
// Baseline must be the frozen dependency foundation. No GUI/native browser: Linux PATH shim only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
assert.equal(process.platform,'linux','Linux controlled-shim oracle only; macOS native opening NOT RUN');
const [candidate,baseline,installed]=process.argv.slice(2).map(value=>resolve(value));
assert(candidate && baseline,'candidate and baseline binaries required');
const root=mkdtempSync(join(realpathSync(tmpdir()),'report-open-oracle-'));
const input=join(root,'input'),data=join(root,'data'),bin=join(root,'bin'),record=join(root,'opener.jsonl');
mkdirSync(input);mkdirSync(bin);
const raw=join(input,'synthetic.jsonl'),sentinel='PRIVATE_RAW_ORACLE_SENTINEL';
const at=ms=>new Date(Date.UTC(2026,9,2)+ms).toISOString();
const records=[[0,10000],[5000,15000]].flatMap(([start,end],i)=>[
 {type:'assistant',uuid:`call-${i}`,sessionId:'SYNTHETIC_OPEN',cwd:`/${sentinel}`,isSidechain:false,timestamp:at(start),message:{id:`response-${i}`,role:'assistant',content:[{type:'tool_use',id:`tool-${i}`,name:'Bash',input:{command:`npm test '${sentinel}'`}}]}},
 {type:'user',uuid:`result-${i}`,sessionId:'SYNTHETIC_OPEN',isSidechain:false,timestamp:at(end),message:{role:'user',content:[{type:'tool_result',tool_use_id:`tool-${i}`,is_error:false,content:sentinel}]}}
]);
writeFileSync(raw,records.map(JSON.stringify).join('\n')+'\n');
const env={...process.env,PATH:bin,DISPLAY:':99',WAYLAND_DISPLAY:'',OPEN_RECORD:record,NODE_OPTIONS:'--max-old-space-size=512 --disable-warning=ExperimentalWarning'};
let timeoutFixture = false, timeoutReleaseAt = 0;
function invoke(binary,args,extra={}){if(timeoutFixture)timeoutReleaseAt=performance.now()+8000;const r=spawnSync(process.execPath,[binary,...args],{encoding:'utf8',timeout:9000,env:{...env,...extra}});assert.equal(r.error,undefined);return {status:r.status,stdout:r.stdout,stderr:r.stderr};}
function json(r,status=0){assert.equal(r.status,status,JSON.stringify(r));assert.equal(r.stderr,'');return JSON.parse(r.stdout);}
function snapshot(){return readdirSync(data).sort().map(name=>({name,sha:createHash('sha256').update(readFileSync(join(data,name))).digest('hex'),mode:statSync(join(data,name)).mode}));}
function clear(){rmSync(record,{force:true});}
function shim(mode){waitForOwnedTimeout();timeoutFixture=mode==='timeout';clear();const p=join(bin,'xdg-open');rmSync(p,{force:true});if(mode==='missing')return;
 writeFileSync(p,`#!${process.execPath}\nconst f=require('node:fs'),c=require('node:crypto');const p=process.argv[2],b=f.readFileSync(p);f.appendFileSync(process.env.OPEN_RECORD,JSON.stringify({argv:process.argv.slice(2),sha:c.createHash('sha256').update(b).digest('hex'),mode:f.statSync(p).mode&511})+'\\n');process.stdout.write('CHILD_PRIVATE_SENTINEL');process.stderr.write('CHILD_PRIVATE_SENTINEL');${mode==='timeout'?'setTimeout(()=>process.exit(0),7000);':mode==='signal'?"process.kill(process.pid,'SIGTERM');":`process.exit(${mode==='nonzero'?7:0});`}\n`,{mode:0o755});if(mode==='denied')chmodSync(p,0o644);
}
// Never signal a PID read from disk: successful helpers may have already exited.
// Only timeout fixtures have a finite 7-second self-exit. Give that owned fixture
// its bounded lifetime before removing files; this is not a GUI/termination claim.
function waitForOwnedTimeout(){if(!timeoutReleaseAt)return;const remaining=timeoutReleaseAt-performance.now();timeoutReleaseAt=0;if(remaining>0)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,remaining);}

let cases=0;
try{
 const scanned=json(invoke(baseline,['scan','--claude-root',input,'--data-dir',data,'--json']));assert.equal(scanned.result.counts.committed,1);
 const key=JSON.parse(readFileSync(join(data,'identity-key.json'),'utf8'));
 const source=`h1:${key.keyId}:source:`+createHmac('sha256',Buffer.from(key.secret,'hex')).update(JSON.stringify([1,1,'source','claude',raw])).digest('hex');
 rmSync(input,{recursive:true});const before=snapshot();
 const args=output=>['report','--source',source,'--output',output,'--data-dir',data,'--json'];
 const output=join(root,"report $()';` 한글#?%.html");
 const old=invoke(baseline,args(output));json(old);const html=readFileSync(output);assert(!html.includes(sentinel));assert(!html.includes(key.secret));rmSync(output);
 const defaultNew=invoke(candidate,args(output));assert.deepEqual(defaultNew,old);assert.deepEqual(readFileSync(output),html);rmSync(output);cases++;
 const humanArgs=output=>args(output).filter(arg=>arg!=='--json');
 const oldHuman=invoke(baseline,humanArgs(output));assert.equal(oldHuman.status,0);assert.equal(oldHuman.stderr,'');assert.deepEqual(readFileSync(output),html);rmSync(output);
 for(const binary of [candidate,...installed?[installed]:[]]){
  // Each binary, including installed, must retain default report bytes in BOTH formats.
  for(const [params,expected] of [[args(output),old],[humanArgs(output),oldHuman]]){
   clear();const unchanged=invoke(binary,params);assert.deepEqual(unchanged,expected);assert.deepEqual(readFileSync(output),html);assert(!existsSync(record));assert.deepEqual(snapshot(),before);rmSync(output);cases++;
  }

  for(const mode of ['zero','nonzero','missing','denied','signal','timeout']){
   shim(mode);const started=performance.now();const r=invoke(binary,[...args(output),'--open']);
   const receipt=json(r,mode==='zero'?0:1);assert.equal(receipt.command,'report');assert.equal(receipt.result.published,true);assert.equal(receipt.result.output,output);assert.deepEqual(readFileSync(output),html);assert.equal(receipt.result.bytes,html.length);
   const {open,...publication}=receipt.result;assert.deepEqual(publication,JSON.parse(old.stdout).result);
   if(mode==='zero'){assert.equal(receipt.ok,true);assert.deepEqual(open,{status:'accepted',opener:'xdg-open',browserVerified:false});}
   else{assert.equal(receipt.ok,false);assert.equal(open.status,'failed');assert.equal(open.browserVerified,false);assert.equal(open.error.code,mode==='timeout'?'OPEN_TIMEOUT':['missing','denied'].includes(mode)?'OPEN_OPENER_UNAVAILABLE':'OPEN_FAILED');}
   if(['missing','denied'].includes(mode))assert(!existsSync(record));else{const lines=readFileSync(record,'utf8').trim().split('\n');assert.equal(lines.length,1);assert.deepEqual(JSON.parse(lines[0]),{argv:[output],sha:createHash('sha256').update(html).digest('hex'),mode:0o600});}
   assert(!r.stdout.includes('CHILD_PRIVATE_SENTINEL'));assert(!r.stderr.includes('CHILD_PRIVATE_SENTINEL'));
   if(mode==='timeout'){assert(performance.now()-started>=4900);assert(open.error.message.includes('may already be open'));waitForOwnedTimeout();}
   assert.deepEqual(snapshot(),before);rmSync(output);cases++;
  }
  for(const mode of ['zero','nonzero','timeout']){
   shim(mode);const started=performance.now();const result=invoke(binary,[...humanArgs(output),'--open']);
   assert.equal(result.status,mode==='zero'?0:1);assert.equal(result.stderr,'');
   assert.equal(result.stdout.slice(0,oldHuman.stdout.length),oldHuman.stdout);
   assert(result.stdout.toLowerCase().includes('browser rendering is not verified'));
   assert.equal(result.stdout.match(/AgentProf report /g)?.length,1);
   assert(!result.stdout.includes('CHILD_PRIVATE_SENTINEL'));assert.deepEqual(readFileSync(output),html);
   const lines=readFileSync(record,'utf8').trim().split('\n');assert.equal(lines.length,1);
   assert.deepEqual(JSON.parse(lines[0]),{argv:[output],sha:createHash('sha256').update(html).digest('hex'),mode:0o600});
   if(mode==='nonzero')assert(result.stdout.includes('The system did not accept the open request. Open the selected HTML file manually.'));
   if(mode==='timeout'){assert(result.stdout.includes('may already be open'));assert(performance.now()-started>=4900);waitForOwnedTimeout();}
   assert.deepEqual(snapshot(),before);rmSync(output);cases++;
  }
  shim('zero');
  const switched=json(invoke(binary,['--json','--data-dir',data,'report','--open','--source',source,'--output',output]));assert.equal(switched.result.open.status,'accepted');rmSync(output);cases++;
  for(const extra of [['--open','--open'],['--open=false'],['--source',source,'--open'],['--output',output,'--open'],['--last','1','--open'],['extra','--open'],['--unknown','--open'],['--codex-root','/tmp/fake','--open'],['--claude-root','/tmp/fake','--open']]){
   clear();const r=invoke(binary,[...args(output),...extra]);assert.equal(r.status,2);assert.equal(r.stdout,'');assert.equal(JSON.parse(r.stderr).error.code,'INVALID_ARGUMENT');assert(!existsSync(output));assert(!existsSync(record));cases++;
  }
  for(const [flags,code] of [[['--source',source],'REPORT_SELECTION_REQUIRED'],[['--output',output],'REPORT_SELECTION_REQUIRED'],[['--source',source,'--output',join(root,'bad.txt')],'OPEN_FILE_UNSAFE']]){
   clear();const r=invoke(binary,['report','--data-dir',data,'--json','--open',...flags]);assert.equal(r.status,2);assert.equal(r.stdout,'');assert.equal(JSON.parse(r.stderr).error.code,code);assert(!existsSync(record));cases++;
  }
  writeFileSync(output,'DO_NOT_OVERWRITE');clear();const failed=invoke(binary,[...args(output),'--open']);assert.equal(failed.status,2);assert.equal(failed.stdout,'');assert.equal(JSON.parse(failed.stderr).error.code,'REPORT_OUTPUT_UNSAFE');assert.equal(readFileSync(output,'utf8'),'DO_NOT_OVERWRITE');assert(!existsSync(record));rmSync(output);cases++;
  const help=invoke(binary,['report','--help']);assert.equal(help.status,0);assert(help.stdout.includes('--open'));assert(!help.stdout.includes('no scan, roots, --last or --open'));cases++;
  // Standalone open retains exact receipts/status, and neighboring commands retain byte parity.
  writeFileSync(output,html);shim('zero');assert.deepEqual(invoke(binary,['open',output,'--json']),invoke(baseline,['open',output,'--json']));rmSync(output);cases++;
  for(const c of [['stats'],['stats','--invocation-overlap'],['insights']])assert.deepEqual(invoke(binary,[...c,'--source',source,'--data-dir',data,'--json']),invoke(baseline,[...c,'--source',source,'--data-dir',data,'--json']));
  assert.deepEqual(snapshot(),before);
 }
 console.log(JSON.stringify({status:'PASS',cases,installed:!!installed,platform:process.platform,node:process.version,realGUI:'NOT RUN',fixture:'synthetic only; raw inputs deleted before report',storeUnchanged:true}));
}finally{waitForOwnedTimeout();rmSync(root,{recursive:true,force:true});}
