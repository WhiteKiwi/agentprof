import test from 'node:test';
import assert from 'node:assert/strict';
import { bar, tokenComposition, timeline } from '../charts.mjs';
import { snapshot } from '../fixture.mjs';
test('bars encode values on explicit denominator and distinguish null from zero',()=>{
 assert.match(bar(30,60,'half'),/width="50"/); assert.match(bar(0,60,'zero'),/width="0"/); assert.match(bar(null,60,'missing'),/Unknown · no bar/);
 for(const v of [-1,NaN,Infinity,61,'30']) assert.throws(()=>bar(v,60,'bad'));
 assert.throws(()=>bar(0,0,'bad')); assert.throws(()=>bar(0,10,'bad','evil'));
});
test('token partition counts cache-read once and rejects fractional or invalid samples',()=>{
 const html=tokenComposition(snapshot.tokens); assert.match(html,/30,000/); assert.match(html,/Cache-read is a subset/);
 assert.throws(()=>tokenComposition({...snapshot.tokens,eligible:9})); assert.throws(()=>tokenComposition({...snapshot.tokens,output:0.5}));
});
test('timeline marks exact endpoints and pending start without invented duration',()=>{
 const html=timeline(snapshot.timeline); assert.match(html,/start 20s, end 80s/); assert.match(html,/Pending · end unknown/); assert.match(html,/Span values as a table/);
 assert.ok(!html.includes('critical path</'));
 for(const span of [{id:'a',label:'x',start:5,end:4},{id:'a',label:'x',start:-1,end:4},{id:'a',label:'x',start:0,end:301},{id:'a',label:'x',start:NaN,end:null},{id:'bad"',label:'x',start:0,end:1}]) assert.throws(()=>timeline({...snapshot.timeline,spans:[span]}));
});
test('timeline labels and notes are escaped, including SVG aria labels',()=>{
 const t=structuredClone(snapshot.timeline);t.label='<script>x</script>';t.spans[0].label='" onload="x';t.spans[0].note='<img src=x>';
 const html=timeline(t);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&quot; onload=&quot;x'));
});
