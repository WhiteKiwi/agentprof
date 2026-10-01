import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { snapshot } from '../fixture.mjs';
import { renderReport } from '../render.mjs';
test('fixed snapshot is deterministic, scoped, offline and explicit about capability', async () => {
 const html = await renderReport(snapshot);
 assert.equal(html, await renderReport(snapshot));
 for (const text of ['32 / 40','8 missing timing','0s','Unknown','Unsupported','UTC','One experiment.','Quality guardrail.','not implemented']) assert.ok(html.includes(text),text);
 assert.doesNotMatch(html, /@@[A-Z]+@@|https?:\/\/|<iframe|<object|fetch\(/);
 for (const tag of ['style','script']) { const content=html.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))[1]; assert.ok(html.includes(`sha256-${createHash('sha256').update(content).digest('base64')}`)); }
});
test('untrusted strings remain inert and unexpected raw fields are not serialized', async () => {
 const s=structuredClone(snapshot); const attack='</script><img src=x onerror="globalThis.injected=true">';
 s.title=attack; s.insights[0].events[0].id=attack; s.rawPrompt='DO_NOT_SERIALIZE_RAW';
 const html=await renderReport(s); assert.ok(html.includes('&lt;/script&gt;&lt;img')); assert.ok(!html.includes(attack)); assert.ok(!html.includes(s.rawPrompt));
 assert.equal((html.match(/<script>/g)||[]).length,1);
});
test('invalid numeric values, unsafe IDs and non-synthetic input fail closed', async () => {
 for(const change of [{kind:'real'},{wasteSeconds:0},{timedCalls:41},{terminalCalls:-1},{turnUnionSeconds:NaN},{observedSpanSeconds:'0'}]) await assert.rejects(renderReport({...snapshot,...change}));
 const s=structuredClone(snapshot); s.insights[0].id='bad" onclick="evil'; await assert.rejects(renderReport(s));
 s.insights[0].id='overview'; s.insights.push({...s.insights[0]}); await assert.rejects(renderReport(s));
});
test('empty samples do not invent a ratio or insight', async () => {
 const html=await renderReport({...snapshot,terminalCalls:0,timedCalls:0,insights:[]});
 assert.ok(html.includes('Unknown (no eligible calls)')); assert.ok(html.includes('No insight candidates'));
});
test('all display-text positions escape markup, quotes and Unicode without interpreting it', async () => {
 const s=structuredClone(snapshot); const attack='<svg onload="evil()">&\' 긴 한글 이름 </style><script>evil()</script>';
 for(const key of ['title','period','timezone','collectedAt','source']) s[key]=attack;
 for(const h of s.hotspots) { h.label=attack; h.sample=attack; }
 for(const item of s.insights) {
  for(const key of ['title','rule','description','sample','scope','nextStep','experiment','guardrail','caveat']) item[key]=attack;
  for(const e of item.events) for(const key of ['id','interval','result']) e[key]=attack;
 }
 const html=await renderReport(s); assert.ok(!html.includes(attack)); assert.ok(html.includes('긴 한글 이름')); assert.ok(html.includes('&lt;svg onload=&quot;evil()&quot;&gt;&amp;&#39;'));
 assert.equal((html.match(/<script>/g)||[]).length,1); assert.equal((html.match(/<style>/g)||[]).length,1);
});
test('known zero remains distinct from null and denominator metadata remains visible', async () => {
 const s=structuredClone(snapshot); s.hotspots=[{label:'Known',seconds:0,sample:'1 / 1 timed',evidence:'direct'},{label:'Missing',seconds:null,sample:'0 / 1 timed',evidence:'unknown'}];
 const html=await renderReport(s); assert.match(html,/Known<\/th><td class="ap-number">0s/); assert.match(html,/Missing<\/th><td class="ap-number">Unknown/);
});
test('responsive and accessibility hooks are present (static inspection, not browser proof)', async () => {
 const html=await renderReport(snapshot);
 for(const text of ['@media(max-width:640px)','minmax(0,1fr)','overflow-wrap: anywhere','scope="col"','scope="row"','<caption>','<summary>','prefers-reduced-motion','[hidden]']) assert.ok(html.includes(text),text);
 assert.doesNotMatch(html, /<[^>]+(?:src|href)=["'](?:https?:|\/\/)/);
});
