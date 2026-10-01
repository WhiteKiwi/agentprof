import test from 'node:test';
import assert from 'node:assert/strict';
import { detailFixture } from '../detail-fixture.mjs';
import { prepareDetails,renderDetails,unionSeconds } from '../details.mjs';
import { renderReport } from '../render.mjs';
import { snapshot } from '../fixture.mjs';
const clone=()=>structuredClone(detailFixture);
test('independent hand-authored oracle: same-scope duration shares and API coverage',()=>{
 const m=prepareDetails(detailFixture),p=m.cohorts[0],a=m.cohorts[1];
 assert.deepEqual([p.total,p.eligible,p.timed],[360,7,7]);assert.deepEqual(p.groups.map(x=>[x.category,x.seconds]),[['build',180],['test',120],['search',60]]);
 for(const [i,expected] of [50,100/3,100/6].entries()) assert.ok(Math.abs(p.groups[i].share-expected)<1e-10);
 assert.deepEqual([a.total,a.observed,a.eligible,a.timed,a.pending],[240,6,5,4,1]);
 assert.deepEqual(a.groups.map(g=>g.share),[75,25]);assert.equal(m.cohorts.length,2);
});
test('interval occupancy uses unions and is deliberately non-additive',()=>{
 const m=prepareDetails(detailFixture);assert.deepEqual(m.occupancy.map(x=>x.seconds),[180,120,60,240]);
 assert.deepEqual(m.occupancy.map(x=>x.share),[60,40,20,80]);assert.equal(m.occupancy.reduce((s,x)=>s+x.share,0),200);
 const placed=detailFixture.calls.filter(x=>x.start!==null&&x.end!==null);assert.equal(unionSeconds(placed.map(x=>[x.start,x.end])),260);
 assert.equal(unionSeconds([[0,10],[5,15],[15,20],[6,8]]),20);
});
test('safe command ranking has correct count/sum/mean/max and two share denominators',()=>{
 const m=prepareDetails(detailFixture),b=m.commands.find(x=>x.aliasId==='build-bundle');
 assert.deepEqual([b.count,b.timed,b.total,b.mean,b.max,b.union],[2,2,140,70,80,140]);
 assert.equal(b.share,140/360*100);assert.equal(b.categoryShare,140/180*100);assert.equal(b.windowShare,140/300*100);
 assert.equal(m.longest[0].calls[0].id,'build-2');assert.equal(m.longest[0].calls[0].duration,80);
 const api=m.commands.find(x=>x.aliasId==='api-fetch');assert.deepEqual([api.count,api.eligible,api.timed,api.pending,api.total],[3,2,1,1,60]);
});
test('missing, zero, empty and pending do not become false duration shares',()=>{
 const f=clone();f.calls=f.calls.slice(0,1);f.calls[0].duration=null;f.calls[0].start=null;f.calls[0].end=null;
 let m=prepareDetails(f);assert.equal(m.commands[0].total,null);assert.equal(m.commands[0].mean,null);assert.equal(m.commands[0].share,null);assert.equal(m.commands[0].union,null);
 f.calls[0].duration=0;f.calls[0].start=0;f.calls[0].end=0;m=prepareDetails(f);assert.equal(m.commands[0].total,0);assert.equal(m.commands[0].mean,0);assert.equal(m.commands[0].share,null);assert.equal(m.commands[0].windowShare,0);
 f.calls=[];m=prepareDetails(f);assert.equal(m.commands.length,0);assert.equal(m.cohorts[0].total,null);assert.match(renderDetails(f),/No positive timed duration denominator/);
});
test('duration-only values are not used to invent interval placement',()=>{
 const f=clone();f.calls=f.calls.slice(0,1);f.calls[0].duration=100;f.calls[0].start=null;f.calls[0].end=null;
 const m=prepareDetails(f);assert.equal(m.commands[0].total,100);assert.equal(m.commands[0].union,null);
});
test('invalid cohorts, IDs, aliases, endpoints, pending durations and overflow fail closed',()=>{
 for(const change of [{duration:-1},{duration:Infinity},{start:-1},{end:301},{start:null,end:3},{status:'pending',duration:4},{evidence:'estimated'},{scope:'invocation-latency'},{id:'bad"'}]) {
  const f=clone();Object.assign(f.calls[0],change);assert.throws(()=>prepareDetails(f));
 }
 let f=clone();f.calls.push({...f.calls[0]});assert.throws(()=>prepareDetails(f));
 f=clone();f.calls[1].alias='different identity';assert.throws(()=>prepareDetails(f));
 f=clone();f.calls[0].duration=Number.MAX_VALUE;f.calls[1].duration=Number.MAX_VALUE;assert.throws(()=>prepareDetails(f));
 f=clone();f.calls=Array.from({length:201},(_,i)=>({...f.calls[0],id:`call-${i}`}));assert.throws(()=>prepareDetails(f));
});
test('detail text, SVG labels and attributes are escaped; raw fields never serialized',async()=>{
 const f=clone(),attack='</script><img src=x onerror="globalThis.injected=true">';
 f.label=attack;for(const c of f.calls){c.alias=attack;c.condition=attack;c.rawCommand='DO_NOT_INCLUDE_RAW';}
 const html=await renderReport({...snapshot,details:f});assert.ok(!html.includes(attack));assert.ok(!html.includes('DO_NOT_INCLUDE_RAW'));assert.match(html,/&lt;\/script&gt;&lt;img/);assert.equal((html.match(/<script>/g)||[]).length,1);
 assert.match(html,/Model API request\/response timing: Unsupported/);
});
test('cancelled and unknown outcomes are not terminal distribution samples',()=>{
 const f=clone();f.calls[0].status='cancelled';f.calls[1].status='unknown';
 const m=prepareDetails(f),b=m.commands.find(c=>c.aliasId==='build-bundle');assert.equal(b.count,2);assert.equal(b.eligible,0);assert.equal(b.total,null);assert.equal(b.windowShare,null);assert.equal(m.cohorts[0].total,220);
});
test('all detail drilldown targets resolve and embedded report stays offline',async()=>{
 const html=await renderReport(snapshot);const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 for(const [,id] of html.matchAll(/(?:href="#|data-open-span=")([^"]+)"/g))assert.ok(ids.includes(id),`Missing target ${id}`);
 assert.doesNotMatch(html,/<[^>]+(?:src|href)=["'](?:https?:|\/\/)/);
});
