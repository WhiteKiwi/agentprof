import { createClaudeAdapter } from "../src/parsers/claude/index.js";
import type { StoredSource } from "../src/db/source-store.js";
import { it as test } from "vitest";
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {summarizeSource} from "../src/analysis/source-summary.js";
import {createIdentityContext} from "../src/normalize/identity.js";
import {normalizeEvent} from "../src/normalize/event.js";
import {analyzeSourceSlowTool} from "../src/analysis/source-slow-tool.js";
import {analyzeSourceInvocationOverlap} from "../src/analysis/source-invocation-overlap.js";
import {buildSourceInvocationTimeline} from "../src/report/invocation-timeline.js";
import {buildSourceCommandBreakdown} from "../src/report/command-breakdown.js";
import {buildSourceReportModel} from "../src/report/source-model.js";
import {renderSourceReport} from "../src/report/render.js";
const id=createIdentityContext(new Uint8Array(32).fill(19),'9'.repeat(32));
const fingerprint=(kind,value)=>id.fingerprint(kind,[value]);
const sourceId=fingerprint('source','token-evidence-synthetic'),sessionId=fingerprint('session','token-evidence-synthetic');
const counts={input:100,output:20,total:120,cachedInput:40,cacheWriteInput:0,reasoningOutput:null};
const row=(name,overrides={})=>({id:fingerprint('event',name),sessionId,responseId:fingerprint('event',`response-${name}`),turnId:null,provider:'codex',source:'response_usage',scope:'response_increment',counts:{...counts},mapping:'openai_responses',finality:'source_terminal',selection:'eligible',countStatus:'complete',limitations:[],toolEventId:null,phase:'unknown',sourceRef:{fileId:sourceId,byteOffset:1},...overrides});
const duplicate=(r,name)=>({...r,id:fingerprint('event',name),sourceRef:{...r.sourceRef,byteOffset:2}});
function source(rows=[],withEvent=false){
 const events=withEvent?[normalizeEvent({provider:'codex',eventIdentity:'event',sessionIdentity:'token-evidence-synthetic',kind:'shell',toolName:'exec_command',command:'npm test synthetic',status:'completed',statusEvidence:'explicit',exitCode:0,durationMs:10,timingEvidence:'source_reported',durationScope:'process_runtime',sourceRef:{fileIdentity:'token-evidence-synthetic',byteOffset:1,recordType:'event_msg'}},id).event]:[];
 return {sourceId,provider:'codex',parserVersion:1,normalizationVersion:1,keyVersion:1,keyId:id.keyId,completedOffset:100,observedSize:105,boundaryFingerprint:fingerprint('content','boundary'),revision:1,availability:'available',events,persistedScope:'events_and_metric_evidence',aggregationReady:false,parserResumeReady:false,evidence:{turns:[],usage:rows,observations:[],diagnostics:[],capabilities:{provider:'codex',parserVersion:1,support:'shape_verified_only',coverage:'recognized_shapes',observedShapes:[],unsupportedRecords:0,ambiguousRecords:0,stateLimited:false,diagnosticsDropped:0}}};
}
const model=s=>{const slow=analyzeSourceSlowTool(s);return buildSourceReportModel(summarizeSource(s),slow,buildSourceCommandBreakdown(s,slow),buildSourceInvocationTimeline(s,analyzeSourceInvocationOverlap(s)));};
const a=row('A'),b=row('B'),c=row('C',{selection:'provisional'}),d=row('D');
const six=[a,duplicate(a,'A2'),b,c,d,duplicate({...d,counts:{...counts,output:21,total:121}},'D2')];
function invariants(s){const r=summarizeSource(s),u=r.usageEligibility;if(u){assert.equal(r.inventory.usage,u.selectedRows+u.deduplicatedRows+u.excludedRows);assert.equal(u.observedResponses,u.selectedRows);assert.equal(Object.values(u.exclusions).reduce((a,b)=>a+b,0),u.excludedRows);}return r;}
 test('six-row literal upstream oracle',()=>{const r=invariants(source(six));assert.deepEqual([r.inventory.usage,r.usageEligibility.selectedRows,r.usageEligibility.deduplicatedRows,r.usageEligibility.excludedRows,r.usageEligibility.observedResponses,r.usageEligibility.excludedResponseGroups],[6,2,1,3,2,1]);assert.equal(r.usageEligibility.exclusions.provisional,1);assert.equal(r.usageEligibility.exclusions.duplicate_response_conflict,2);assert.equal(r.usage[0].counts.total,240);});
 test('six-row all 720 orders retain literal oracle',()=>{function visit(xs,p=[]){if(!xs.length){const r=invariants(source(p));assert.deepEqual([r.usageEligibility.selectedRows,r.usageEligibility.deduplicatedRows,r.usageEligibility.excludedRows],[2,1,3]);return;}xs.forEach((x,i)=>visit(xs.filter((_,j)=>i!==j),[...p,x]));}visit(six);});
 test('identical provisional duplicates are not eligible duplicates',()=>{const r=invariants(source([c,duplicate(c,'C2')]));assert.deepEqual([r.usageEligibility.selectedRows,r.usageEligibility.deduplicatedRows,r.usageEligibility.excludedRows],[0,1,1]);assert.equal(r.usage,null);});
 test('absent and present-empty remain distinguishable',()=>{const s=source();const a=invariants({...s,evidence:null,persistedScope:'events_only'}),e=invariants(s);assert.equal(a.inventory.usage,null);assert.equal(a.usageEligibility,null);assert.equal(a.suppressionReason,'evidence_absent');assert.equal(e.inventory.usage,0);assert.equal(e.suppressionReason,null);assert.equal(e.usage,null);});
 test('each source suppression excludes all known rows',()=>{for(const mode of ['unavailable','stateLimited','ambiguousRecords','diagnosticsDropped']){const s=source(six);if(mode==='unavailable')s.availability='unavailable';else s.evidence.capabilities[mode]=mode==='stateLimited'?true:1;const r=invariants(s);assert.deepEqual([r.usageEligibility.selectedRows,r.usageEligibility.deduplicatedRows,r.usageEligibility.excludedRows],[0,0,6]);assert.equal(r.usageEligibility.exclusions.source_suppressed,6);}});
 test('overflow/unknown cache does not change evidence counts',()=>{const rows=[row('huge',{counts:{...counts,input:Number.MAX_SAFE_INTEGER,total:Number.MAX_SAFE_INTEGER,cachedInput:null}}),row('one',{counts:{...counts,input:1,total:1}})];const r=invariants(source(rows));assert.equal(r.usageEligibility.observedResponses,2);assert.equal(r.usage[0].counts.total,null);assert.equal(r.usage[0].counts.cachedInput,null);assert(r.usage[0].overflowComponents.includes('total'));assert(!r.usage[0].overflowComponents.includes('cachedInput'));});
 test('seven-session display cap retains pre-cap N',()=>{const m=model(source(Array.from({length:7},(_,i)=>row(`s${i}`,{sessionId:fingerprint('session',`s${i}`)}))));assert.equal(m.selection.sessions.shown,6);assert.equal(m.summary.usage.length,6);assert.equal(m.summary.usageEligibility.observedResponses,7);assert.equal(m.summary.inventory.usage,7);});
 test('observed zero stays an available eligible response',()=>{const r=invariants(source([row('zero',{counts:{input:0,output:0,total:0,cachedInput:0,cacheWriteInput:0,reasoningOutput:0}})]));assert.equal(r.usageEligibility.observedResponses,1);assert.equal(r.usage[0].counts.total,0);});
 const panel=html=>{const m=html.match(/<section\b[^>]*id="token-evidence"[^>]*>([\s\S]*?)<\/section>/);assert(m,'always-visible token-evidence section');return m[1];};
 test('six-row exact table and three-segment count bar',()=>{const h=panel(renderSourceReport(model(source(six))));for(const text of ['Eligible observed responses','Selected evidence rows','Duplicate evidence rows','Excluded evidence rows','Stored usage evidence rows','provisional','duplicate_response_conflict'])assert(h.includes(text),text);for(const [label,n]of [['Selected evidence rows',2],['Duplicate evidence rows',1],['Excluded evidence rows',3],['Stored usage evidence rows',6]])assert.match(h,new RegExp(`<th[^>]*>${label}<\\/th>\\s*<td>${n}<\\/td>`));assert.match(h,/viewBox="0 0 600 16"/);const widths=[...h.matchAll(/class="token-evidence-(?:selected|duplicate|excluded)"[^>]*width="([^"]+)"/g)].map(x=>Number(x[1]));assert.deepEqual(widths,[200,100,300]);assert(!h.includes('33.3%'));assert.match(h,/conflict[^<]*groups|Conflicting response groups/i);});
 test('present-empty panel exists without any displayed session',()=>{const h=panel(renderSourceReport(model(source())));assert(h.includes('No usage evidence rows stored'));assert(!h.includes('Usage unavailable: none'));assert(!h.includes('<rect'));});
 test('all-provisional explicitly no eligible responses',()=>{const h=panel(renderSourceReport(model(source([c,duplicate(c,'C2')]))));assert(h.includes('No eligible observed responses'));assert(h.includes('Duplicate evidence rows'));assert(h.includes('provisional'));});
 test('absent and suppressed distinct and always visible',()=>{const s=source();let h=panel(renderSourceReport(model({...s,evidence:null,persistedScope:'events_only'})));assert(h.includes('Usage evidence unavailable'));assert(h.includes('evidence_absent'));assert(!h.includes('<rect'));const t=source(six);t.evidence.capabilities.stateLimited=true;h=panel(renderSourceReport(model(t)));assert(h.includes('Usage evidence suppressed'));assert(h.includes('state_limited'));assert(h.includes('source_suppressed'));});
 test('source-unavailable keeps known inventory without inventing eligible responses',()=>{const s=source(six);s.availability='unavailable';const h=panel(renderSourceReport(model(s)));assert(h.includes('Usage evidence unavailable'));assert(h.includes('source_unavailable'));assert.match(h,/<th[^>]*>Stored usage evidence rows<\/th>\s*<td>6<\/td>/);});
 test('available zero and overflow retain cohort component semantics',()=>{const zero=model(source([row('zero',{counts:{input:0,output:0,total:0,cachedInput:0,cacheWriteInput:0,reasoningOutput:0}})]));assert(panel(renderSourceReport(zero)).includes('Eligible observed responses'));const s=source([row('huge',{counts:{...counts,input:Number.MAX_SAFE_INTEGER,total:Number.MAX_SAFE_INTEGER,cachedInput:null}}),row('one',{counts:{...counts,input:1,total:1}})]);const h=renderSourceReport(model(s));assert(panel(h).includes('Eligible observed responses'));assert(h.includes('unknown · numeric_overflow'));assert.match(h,/<th scope="row">cachedInput<\/th><td>unknown<\/td>/);});
 test('no misleading null-state text in existing session block',()=>{assert(!renderSourceReport(model(source([],true))).includes('Usage unavailable: none'));});
 test('display caps do not redefine global N',()=>{const m=model(source(Array.from({length:7},(_,i)=>row(`s${i}`,{sessionId:fingerprint('session',`s${i}`)}))));const h=panel(renderSourceReport(m));assert.match(h,/Eligible observed responses[\s\S]*?>7<|>7<[\s\S]*?Eligible observed responses/);});
 test('panel accessible, deterministic, bounded and static CSP exact',()=>{const m=model(source(six)),h=renderSourceReport(m),p=panel(h);assert.equal(h,renderSourceReport(m));assert(Buffer.byteLength(h)<=1048576);assert.match(p,/tabindex="0"/);assert.match(p,/role="region"/);assert.match(p,/<caption\b/);assert.match(p,/<th scope="row"/);assert(!/<details/.test(p));assert(!/<script|\sstyle=|\son[a-z]+=/i.test(h));const css=h.match(/<style>([\s\S]*?)<\/style>/)[1];assert(h.includes(`sha256-${createHash('sha256').update(css).digest('base64')}`));const ids=[...h.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);});
const reasons=['source_suppressed','cumulative_snapshot','unverified_snapshot','non_response_usage','duplicate_response_conflict','invalid','conflicted','provisional','snapshot_only','unverified_finality','missing_response_id','incomplete_components','unverified_mapping'];
const exactReason=(h,reason,n)=>assert.match(h,new RegExp(`(?:<dt[^>]*>${reason}<\\/dt>\\s*<dd[^>]*>${n}(?: rows)?<\\/dd>|<th[^>]*>${reason}<\\/th>\\s*<td>${n}<\\/td>)`));
const geometry=h=>[...h.matchAll(/<rect class="token-evidence-(selected|duplicate|excluded)"[^>]*>/g)].map(m=>({kind:m[1],x:Number(m[0].match(/\bx="([^"]+)"/)[1]),width:Number(m[0].match(/\bwidth="([^"]+)"/)[1])}));
test('literal non-source reason counts and all zero reasons remain visible',()=>{
 const conflict=row('conflict');
 const rows=[row('cumulative',{scope:'turn_cumulative'}),row('unverified',{scope:'unverified_snapshot'}),row('nonresponse',{source:'token_count'}),conflict,duplicate({...conflict,counts:{...counts,total:121}},'conflict2'),row('invalid',{selection:'invalid'}),row('conflicted',{selection:'conflicted'}),row('provisional',{selection:'provisional'}),row('snapshot',{selection:'snapshot_only'}),row('finality',{finality:'unknown'}),row('missing',{responseId:null}),row('incomplete',{countStatus:'partial'}),row('mapping',{mapping:'unknown'})];
 const m=model(source(rows));assert.equal(m.summary.usageEligibility.excludedRows,13);for(const reason of reasons)assert.equal(m.summary.usageEligibility.exclusions[reason],reason==='source_suppressed'?0:reason==='duplicate_response_conflict'?2:1);const h=panel(renderSourceReport(m));assert(!h.includes('<details'));assert(h.includes('source-wide')||h.includes('Source-wide'));
 for(const reason of reasons)exactReason(h,reason,reason==='source_suppressed'?0:reason==='duplicate_response_conflict'?2:1);
 const available=panel(renderSourceReport(model(source([a]))));for(const reason of reasons)exactReason(available,reason,0);
});
test('suppression reason precedence and known counts remain distinct',()=>{
 for(const [property,value,reason]of [['stateLimited',true,'state_limited'],['diagnosticsDropped',1,'state_limited'],['ambiguousRecords',1,'ambiguous_origin']]){
  const s=source(six);s.evidence.capabilities[property]=value;const h=panel(renderSourceReport(model(s)));assert(h.includes('Usage evidence suppressed'));assert(h.includes(reason));exactReason(h,'source_suppressed',6);for(const r of reasons.filter(r=>r!=='source_suppressed'))exactReason(h,r,0);
 }
 const s=source(six);s.availability='unavailable';s.evidence.capabilities.stateLimited=true;const h=panel(renderSourceReport(model(s)));assert(h.includes('Usage evidence unavailable'));assert(h.includes('source_unavailable'));exactReason(h,'source_suppressed',6);
});
test('SVG cumulative x positions and zero-width segments are literal',()=>{
 assert.deepEqual(geometry(panel(renderSourceReport(model(source(six))))),[{kind:'selected',x:0,width:200},{kind:'duplicate',x:200,width:100},{kind:'excluded',x:300,width:300}]);
 assert.deepEqual(geometry(panel(renderSourceReport(model(source([a]))))),[{kind:'selected',x:0,width:600},{kind:'duplicate',x:600,width:0},{kind:'excluded',x:600,width:0}]);
 assert.deepEqual(geometry(panel(renderSourceReport(model(source([c,duplicate(c,'C3')]))))),[{kind:'selected',x:0,width:0},{kind:'duplicate',x:0,width:300},{kind:'excluded',x:300,width:300}]);
});
test('tiny segment never widened and numeric geometry finite',()=>{
 const rows=[a,...Array.from({length:4095},(_,i)=>row(`excluded-${i}`,{selection:'provisional'}))],h=panel(renderSourceReport(model(source(rows)))),g=geometry(h);
 assert.deepEqual(g,[{kind:'selected',x:0,width:600/4096},{kind:'duplicate',x:600/4096,width:0},{kind:'excluded',x:600/4096,width:600*4095/4096}]);for(const v of g){assert(Number.isFinite(v.x));assert(Number.isFinite(v.width));}
});
test('absent counts and reasons never converted to zero',()=>{
 const s=source();s.evidence=null;s.persistedScope='events_only';const h=panel(renderSourceReport(model(s)));for(const label of ['Stored usage evidence rows','Selected evidence rows','Duplicate evidence rows','Excluded evidence rows'])assert.match(h,new RegExp(`<th[^>]*>${label}<\\/th>\\s*<td>unknown<\\/td>`));assert(!h.includes('<rect'));for(const reason of reasons)assert.match(h,new RegExp(`${reason}<\\/(?:dt|th)>\\s*<(?:dd|td)[^>]*>unknown`));
});
test('new panel does not leak source references or row/response identities',()=>{
 const s=source(six),h=renderSourceReport(model(s)),p=panel(h);for(const r of six){assert(!h.includes(r.id));assert(!h.includes(r.responseId));}assert(!p.includes(sourceId));assert(!p.includes(sessionId));assert(!p.includes('byteOffset'));assert(!p.includes('sourceRef'));
});
test('nested usage eligibility getters and symbol payload rejected without invocation',()=>{
 let calls=0;for(const mutate of [m=>Object.defineProperty(m.summary.usageEligibility,'observedResponses',{enumerable:true,get(){calls++;return 2;}}),m=>Object.defineProperty(m.summary.usageEligibility.exclusions,'provisional',{enumerable:true,get(){calls++;return 1;}}),m=>Object.defineProperty(m.summary.usageEligibility,Symbol('raw'),{value:'RAW_SENTINEL',enumerable:true})]){const m=structuredClone(model(source(six)));mutate(m);assert.throws(()=>renderSourceReport(m));}assert.equal(calls,0);
});
test('session without a cohort does not inherit another session outcome',()=>{
 const s=source([row('other-session',{sessionId:fingerprint('session','other-session')})],true),m=model(s),h=renderSourceReport(m);
 assert.equal(m.summary.usageEligibility.observedResponses,1);assert(h.includes('No eligible response-usage cohort in this displayed session.'));assert(!h.includes('Usage unavailable: none'));assert(!h.includes('Usage evidence suppressed'));
});

const clone=<T>(v:T)=>structuredClone(v) as any;
function timelineFixture(intervals:readonly (readonly [number,number,boolean?])[]=[[0,10],[5,15,true]]):StoredSource{
 const adapter=createClaudeAdapter(id);let ordinal=0;
 intervals.forEach(([start,end,error],i)=>{
  const base={sessionId:"SYNTHETIC_SESSION",cwd:"/SYNTHETIC_PROJECT",isSidechain:false};
  const records=[{...base,type:"assistant",uuid:`call-${i}`,timestamp:new Date(start).toISOString(),message:{id:`message-${i}`,role:"assistant",content:[{type:"tool_use",id:`tool-${i}`,name:"Bash",input:{command:"npm test PRIVATE_SENTINEL"}}]}},{...base,type:"user",uuid:`result-${i}`,timestamp:new Date(end).toISOString(),message:{role:"user",content:[{type:"tool_result",tool_use_id:`tool-${i}`,is_error:!!error,content:"PRIVATE_SENTINEL"}]}}];
  for(const r of records){adapter.ingest(r,{fileIdentity:"/SYNTHETIC_TIMELINE_INPUT.jsonl",sourceAlias:"source-1",byteOffset:ordinal*1000,ordinal});ordinal++;}
 });
 const snap=adapter.snapshot();return {sourceId:id.fingerprint("source",["claude","/SYNTHETIC_TIMELINE_INPUT.jsonl"]),provider:"claude",parserVersion:2,normalizationVersion:1,keyVersion:1,keyId:id.keyId,revision:1,availability:"available",completedOffset:100000,observedSize:100000,boundaryFingerprint:id.fingerprint("content",["boundary"]),cacheEvidence:null,relationshipEvidence:null,persistedScope:"events_and_metric_evidence",aggregationReady:false,parserResumeReady:false,events:snap.events,evidence:{turns:snap.turns,usage:snap.usage,observations:snap.observations,diagnostics:snap.diagnostics,capabilities:snap.capabilities}};
}

function maximumTimelineCombinedModel() {
  const m = clone(model(timelineFixture(Array.from({length:6},(_,i)=>[i,i+1] as const))));
  const summaryRow = structuredClone(m.summary.durations![0]!);
  const nativePartition = structuredClone(m.slowTool.partitions[0]!);
  const card = structuredClone(m.slowTool.candidates![0]!);
  const context = structuredClone(m.commandBreakdown.contexts[0]!);
  const originalGroup = structuredClone(context.groups![0]!);
  const originalCall = structuredClone(context.calls![0]!);
  const sessions: string[] = Array.from({ length: 6 }, (_, i) => id.fingerprint("session", ["timeline-ceiling",i+1]));
  const shapes = [
    ["invocation_latency", "paired_timestamps"], ["invocation_latency", "source_reported"],
    ["item_lifecycle", "paired_timestamps"], ["process_runtime", "source_reported"],
  ] as const;
  const count = (total: number, shown = total) => ({ total, shown, omitted: total - shown });
  const positionedSource=timelineFixture(Array.from({length:20},(_,i)=>[i,i+1] as const));
  const positioned=buildSourceInvocationTimeline(positionedSource,analyzeSourceInvocationOverlap(positionedSource)).partitions[0]!;
  m.invocationTimeline.partitions=sessions.map((sid,i)=>({...clone(positioned),id:`partition-${i+1}`,sessionId:sid,display:{...clone(positioned.display),rows:positioned.display.rows!.map(r=>({...clone(r),group:{...clone(r.group),commandPattern:"x".repeat(512)}}))}}));
  m.invocationTimeline.selection.sessions=count(6);
  m.selection.shownSessionIds = sessions; m.selection.sessionCounts = []; m.selection.partitionCounts = [];
  m.summary.durations = []; m.summary.usage = []; m.slowTool.partitions = []; m.slowTool.candidates = [];
  m.commandBreakdown.contexts = [];
  m.commandBreakdown.state = "details_available";
  for (const [si, sid] of sessions.entries()) {
    m.selection.sessionCounts.push({ sessionId: sid, partitions: count(4), usage: count(4) });
    for (const [pi, [durationScope, timingEvidence]] of shapes.entries()) {
      const index = si * 4 + pi, partitionId = `partition-${index + 1}`;
      const fields = { sessionId: sid, durationScope, timingEvidence };
      m.slowTool.partitions.push({ ...nativePartition, ...fields, id: partitionId, denominatorN: 50, denominatorSumMs: 500, tentativeTimedCalls: 50, evidenceEventCount: 50 });
      m.selection.partitionCounts.push({ ...fields, known: count(10), unknown: count(10), candidates: count(index < 10 ? 1 : 0) });
      for (let i = 0; i < 20; i++) m.summary.durations.push({
        ...summaryRow, ...fields, commandPattern: `npm test ${"--verbose ".repeat(i)}<target>`,
        n: 5, sumMs: i < 10 ? 20 : null, meanMs: i < 10 ? 4 : null, maxMs: 4, p50Ms: 4, p95Ms: 4,
        limitations: i < 10 ? [] : ["numeric_overflow"],
      });
      const groups = Array.from({ length: 10 }, (_, gi) => {
        const sumMs = gi === 0 ? 100 : gi === 1 ? 80 : 40;
        return { ...originalGroup, ordinal: gi + 1,
          group: { kind: "shell" as const, category: index === 23 ? "build" as const : "test" as const, toolName: "exec_command",
            commandPattern: index === 23 ? `cargo build ${"--verbose ".repeat(gi + 1)}<target>` : `npm test ${"--verbose ".repeat(gi)}<target>` },
          n: 5, sumMs, share: sumMs / 500,
        };
      });
      const calls = Array.from({ length: 10 }, (_, i) => ({
        ...originalCall, ordinal: i + 1, groupOrdinal: i < 5 ? 1 : 2,
        group: structuredClone(groups[i < 5 ? 0 : 1]!.group), durationMs: i < 5 ? 20 : 16,
      }));
      m.commandBreakdown.contexts.push({
        ...context, ...fields, displayPartitionId: partitionId, nativePartitionId: partitionId,
        state: "evaluated", denominatorN: 50, denominatorSumMs: 500, groups, calls,
        counts: { groups: count(10), calls: count(50, 10) },
      });
      if (index < 10) m.slowTool.candidates.push({
        ...card, ...fields, id: `candidate-${index + 1}`, partitionId, group: groups[0]!.group,
        n: 5, sumMs: 100, meanMs: 20, maxMs: 20, p50Ms: 20, p95Ms: 20,
        denominatorN: 50, denominatorSumMs: 500, observedEligibleNativeToolDurationShare: 0.2,
      });
    }
    for (let i = 0; i < 4; i++) m.summary.usage.push({
      sessionId: sid, provider: "codex", mapping: i < 2 ? "openai_responses" : "anthropic_messages",
      finality: i % 2 ? "trusted_final" : "source_terminal", observedResponses: 1,
      counts: { input: 10, output: 2, total: 12, cachedInput: 3, cacheWriteInput: 0, reasoningOutput: null, uncachedInput: null },
      overflowComponents: [], limitations: [], evidenceUsageCount: 1,
    });
  }
  m.selection.sessions = count(6); m.selection.partitions = count(24); m.selection.durations = count(480);
  m.selection.usage = count(24); m.selection.candidates = count(10);
  m.commandBreakdown.selection = {
    eligiblePartitions: count(24), unavailablePartitions: count(0), missingNativeContexts: count(0),
    groups: count(240), calls: count(1200, 240), totalsScope: "eligible_detail_partitions_only",
  };
  return m;
}

test('positive token evidence coexists with every inherited combined display ceiling',()=>{
 const m=maximumTimelineCombinedModel();m.summary.inventory.usage=4096;
 Object.assign(m.summary.usageEligibility,{observedResponses:24,selectedRows:24,deduplicatedRows:2000,excludedRows:2072,excludedResponseGroups:1000});
 m.summary.usageEligibility.exclusions.duplicate_response_conflict=2000;m.summary.usageEligibility.exclusions.provisional=72;
 const html=renderSourceReport(m),h=panel(html),bytes=Buffer.byteLength(html);
 assert.equal(m.summary.durations.length,480);assert.equal(m.summary.usage.length,24);assert.equal(m.slowTool.candidates.length,10);
 assert.equal(m.commandBreakdown.contexts.flatMap(p=>p.groups).length,240);assert.equal(m.commandBreakdown.contexts.flatMap(p=>p.calls).length,240);assert.equal(m.invocationTimeline.partitions.flatMap(p=>p.display.rows).length,120);
 assert.equal(geometry(h).length,3);assert(h.includes('<td>4096</td>'));assert(bytes<=1048576);console.info(`TOKEN_POSITIVE_COMBINED_BYTES=${bytes}`);
 for(const p of m.invocationTimeline.partitions)for(const r of p.display.rows)r.group.commandPattern='&'.repeat(512);
 for(const r of m.summary.durations)r.commandPattern='&'.repeat(512);for(const r of m.summary.usage)r.limitations=Array(64).fill('&'.repeat(128));
 assert.throws(()=>renderSourceReport(m),error=>error.code==='REPORT_LIMIT');
});
