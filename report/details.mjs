import { escapeHtml as esc, formatDuration as duration } from '../design/components.mjs';
import { bar, timeline } from './charts.mjs';
const categories = { build:'Build',test:'Tests',search:'Search','api-tool':'API / tool requests' };
const scopes = { 'process-runtime':'Process runtime', 'invocation-latency':'Invocation latency' };
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const slug = s => typeof s === 'string' && /^[a-z][a-z0-9-]*$/.test(s);
const pct = (n,d) => n===null || d===null || d===0 ? null : n/d*100;
const percent = value => value===null?'Unknown':`${Number(value.toFixed(1))}%`;
const sum = values => { const n=values.length ? values.reduce((a,b)=>a+b,0) : null; if(n!==null&&!finite(n))throw new TypeError('Duration sum overflow'); return n; };
/** Presentation arithmetic for a bounded synthetic fixture, not product analysis. */
export function unionSeconds(intervals) {
 const sorted=intervals.map(([a,b])=>{if(!finite(a)||!finite(b)||b<a)throw new TypeError('Invalid interval');return[a,b];}).sort((a,b)=>a[0]-b[0]);
 let total=0,end=null;
 for(const [a,b] of sorted){total+=end===null?b-a:Math.max(0,b-Math.max(a,end));end=end===null?b:Math.max(end,b);}
 return total;
}
export function prepareDetails(f) {
 if(f.kind!=='synthetic'||!slug(f.id)||!finite(f.windowSeconds)||f.windowSeconds<=0||!Array.isArray(f.calls)||f.calls.length>200)throw new TypeError('Invalid bounded synthetic detail cohort');
 const ids=new Set(),aliases=new Map();
 for(const c of f.calls){
  if(!slug(c.id)||ids.has(c.id)||!slug(c.aliasId)||!Object.hasOwn(categories,c.category)||!Object.hasOwn(scopes,c.scope)||c.evidence!=='direct'||!['success','error','cancelled','pending','unknown'].includes(c.status))throw new TypeError('Invalid call identity/classification');
  ids.add(c.id);
  if(typeof c.alias!=='string'||typeof c.condition!=='string'||(c.duration!==null&&!finite(c.duration))||(c.start!==null&&!finite(c.start))||(c.end!==null&&!finite(c.end)))throw new TypeError('Invalid display fields');
  if((c.start!==null&&c.start>f.windowSeconds)||(c.end!==null&&(c.start===null||c.end<c.start||c.end>f.windowSeconds)))throw new TypeError('Call outside detail window');
  if(c.status==='pending'&&(c.duration!==null||c.end!==null))throw new TypeError('Pending call cannot have completed duration');
  if((c.category==='api-tool')!==(c.scope==='invocation-latency'))throw new TypeError('Incompatible duration cohort');
  const signature=JSON.stringify([c.alias,c.category,c.scope,c.evidence]);
  if(aliases.has(c.aliasId)&&aliases.get(c.aliasId)!==signature)throw new TypeError('Alias cannot merge incompatible calls');
  aliases.set(c.aliasId,signature);
 }
 const terminal=c=>['success','error'].includes(c.status);
 const timed=c=>terminal(c)&&c.duration!==null;
 const cohorts=Object.keys(scopes).map(scope=>{
  const eligible=f.calls.filter(c=>c.scope===scope&&terminal(c));const values=eligible.filter(timed);
  const total=sum(values.map(c=>c.duration));
  const groupKey=c=>scope==='invocation-latency'?c.aliasId:c.category;
  const groups=[...new Set(eligible.map(groupKey))].map(key=>{
   const rows=eligible.filter(c=>groupKey(c)===key),covered=rows.filter(timed);const seconds=sum(covered.map(c=>c.duration));
   return {category:rows[0].category,label:scope==='invocation-latency'?rows[0].alias:categories[key],seconds,eligible:rows.length,timed:covered.length,share:pct(seconds,total)};
  });
  return {scope,label:scopes[scope],eligible:eligible.length,timed:values.length,total,groups,observed:f.calls.filter(c=>c.scope===scope).length,pending:f.calls.filter(c=>c.scope===scope&&c.status==='pending').length};
 });
 const commands=[...aliases.keys()].map(aliasId=>{
  const all=f.calls.filter(c=>c.aliasId===aliasId),eligible=all.filter(terminal),covered=eligible.filter(timed),values=covered.map(c=>c.duration),total=sum(values);
  const placed=eligible.filter(c=>c.start!==null&&c.end!==null);const union=placed.length?unionSeconds(placed.map(c=>[c.start,c.end])):null;
  const categoryTotal=sum(f.calls.filter(c=>c.scope===all[0].scope&&c.category===all[0].category&&timed(c)).map(c=>c.duration));
  return {union,windowShare:pct(union,f.windowSeconds),placed:placed.length,categoryShare:pct(total,categoryTotal),aliasId,alias:all[0].alias,scope:all[0].scope,category:all[0].category,count:all.length,eligible:eligible.length,timed:covered.length,pending:all.filter(c=>c.status==='pending').length,total,mean:values.length?total/values.length:null,max:values.length?Math.max(...values):null,share:pct(total,cohorts.find(x=>x.scope===all[0].scope).total)};
 }).sort((a,b)=>(b.total??-1)-(a.total??-1)||a.aliasId.localeCompare(b.aliasId));
 const occupancy=Object.keys(categories).map(category=>{
  const eligible=f.calls.filter(c=>c.category===category&&terminal(c));const placed=eligible.filter(c=>c.start!==null&&c.end!==null);
  const seconds=placed.length?unionSeconds(placed.map(c=>[c.start,c.end])):null;
  return{category,label:categories[category],seconds,share:pct(seconds,f.windowSeconds),placed:placed.length,eligible:eligible.length};
 });
 const longest=Object.keys(scopes).map(scope=>({scope,label:scopes[scope],calls:f.calls.filter(c=>c.scope===scope&&timed(c)).sort((a,b)=>b.duration-a.duration||a.id.localeCompare(b.id)).slice(0,5)}));
 return {cohorts,commands,occupancy,longest};
}
const fmt = n => n===null?'Unknown':duration(Number(n.toFixed(2)));
function stack(cohort) {
 if(cohort.total===null||cohort.total===0)return '<p class="ap-note">No positive timed duration denominator · share unknown</p>';
 let x=0;const roles=['direct','observed','unknown'];
 return `<svg class="report-token-chart" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="${esc(cohort.label)} duration share: ${esc(cohort.groups.map(g=>`${g.label} ${percent(g.share)}`).join(', '))}">${cohort.groups.map((g,i)=>{if(g.seconds===null)return '';const r=`<rect x="${x}" width="${g.share}" height="8" class="ap-svg-${roles[i%roles.length]}"/>`;x+=g.share;return r;}).join('')}</svg>`;
}
function cohortPanel(c) {
 return `<section class="ap-panel"><div class="ap-panel-heading"><h3>${esc(c.label)} mix</h3><span class="ap-badge ap-badge--info">Direct synthetic</span></div><p class="report-big">${fmt(c.total)} <span>cumulative</span></p>${stack(c)}<div class="report-breakdown-rows">${c.groups.map(g=>`<div class="ap-chart-label"><span>${esc(g.label)}</span><strong>${fmt(g.seconds)} · ${percent(g.share)}</strong></div>`).join('')}</div><p class="ap-small ap-muted">Denominator: ${fmt(c.total)} of timed terminal calls in this ${esc(c.label.toLowerCase())} cohort · ${c.timed} / ${c.eligible} terminal calls timed · ${c.observed} observed calls · ${c.pending} pending excluded</p></section>`;
}
function commandTable(cohort, commands, cohortId) {
 const rows=commands.filter(c=>c.scope===cohort.scope);const max=Math.max(1,...rows.map(c=>c.total??0));
 return `<section class="ap-panel"><h3>${esc(cohort.label)} command ranking</h3><p class="ap-small ap-muted">Bars: cumulative seconds. Shares use this cohort's ${fmt(cohort.total)} denominator; mean/max use only timed terminal calls.</p><div class="ap-table-wrap report-command-table" role="region" aria-label="${esc(cohort.label)} command statistics" tabindex="0"><table class="ap-table"><caption>Safe display aliases · not raw commands · descending cumulative duration</caption><thead><tr><th scope="col">Command / tool alias</th><th scope="col">Sum / share</th><th scope="col">Window occupancy</th><th scope="col">Calls / timed</th><th scope="col">Mean</th><th scope="col">Max</th></tr></thead><tbody>${rows.map(c=>`<tr><th scope="row"><a href="#command-${cohortId}-${c.aliasId}" data-open-span="command-${cohortId}-${c.aliasId}">${esc(c.alias)}</a></th><td>${fmt(c.total)} · ${percent(c.share)}${bar(c.total,max,`${c.alias}: cumulative ${fmt(c.total)}`)}<span class="ap-small ap-muted">${percent(c.categoryShare)} of ${esc(categories[c.category])} cumulative time</span></td><td>${fmt(c.union)} · ${percent(c.windowShare)}<br><span class="ap-small ap-muted">${c.placed}/${c.eligible} intervals</span></td><td>${c.count} calls · ${c.timed}/${c.eligible} terminal timed${c.pending?` · ${c.pending} pending`:''}</td><td>${fmt(c.mean)}</td><td>${fmt(c.max)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
export function renderDetails(f) {
 const m=prepareDetails(f),cohortId=f.id;
 const occupancy=m.occupancy.map(g=>`<div class="report-time-row"><div class="ap-chart-label"><strong>${esc(g.label)}</strong><span>${fmt(g.seconds)} / ${fmt(f.windowSeconds)} · ${percent(g.share)}</span></div>${bar(g.seconds,f.windowSeconds,`${g.label} observed interval occupancy ${percent(g.share)}`)}<p class="ap-small ap-muted">${g.placed}/${g.eligible} terminal intervals placed · observed paired timestamps</p></div>`).join('');
 const ranking=m.longest.map(group=>`<section class="ap-panel"><h3>Longest ${esc(group.label.toLowerCase())} calls</h3><ol class="report-longest">${group.calls.map(c=>`<li><a href="#run-${cohortId}-${c.id}" data-open-span="run-${cohortId}-${c.id}">${esc(c.alias)}</a><strong>${fmt(c.duration)}</strong><span class="ap-small ap-muted">${esc(c.status)} · ${esc(c.id)}</span></li>`).join('')}</ol></section>`).join('');
 const commandDetails=m.commands.map(c=>`<details class="ap-details" id="command-${cohortId}-${c.aliasId}"><summary>${esc(c.alias)} · ${fmt(c.total)} cumulative</summary><div class="ap-details-body"><p class="ap-small ap-muted">Display grouping only. Same alias does not establish retry identity, equivalent targets or unnecessary repetition.</p><ul>${f.calls.filter(r=>r.aliasId===c.aliasId).map(r=>`<li><a href="#run-${cohortId}-${r.id}" data-open-span="run-${cohortId}-${r.id}">${esc(r.id)} · ${fmt(r.duration)} · ${esc(r.status)}</a></li>`).join('')}</ul></div></details>`).join('');
 const runDetails=f.calls.map(c=>`<details class="ap-details" id="run-${cohortId}-${c.id}"><summary>${esc(c.alias)} · ${esc(c.id)} · ${fmt(c.duration)}</summary><div class="ap-details-body"><dl class="ap-report-context"><div><dt>Status</dt><dd>${esc(c.status)}</dd></div><div><dt>Direct timing scope</dt><dd>${esc(scopes[c.scope])} · ${fmt(c.duration)}</dd></div><div><dt>Observed interval offsets</dt><dd>${c.start===null?'Unknown':`${c.start}s`} → ${c.end===null?'Unknown':`${c.end}s`}</dd></div><div><dt>Safe input conditions</dt><dd>${esc(c.condition)}</dd></div></dl><p class="ap-small ap-muted">Synthetic evidence only. Interval time and direct duration are separate fields; no request body, endpoint, raw shell command or output is included.</p></div></details>`).join('');
 const t={label:f.label,windowSeconds:f.windowSeconds,spans:f.calls.filter(c=>c.start!==null).map(c=>({id:`${cohortId}-${c.id}`,label:`${c.id} · ${c.alias}`,start:c.start,end:c.end,note:`Synthetic observed interval; direct ${scopes[c.scope]} ${fmt(c.duration)}; status ${c.status}.`}))};
 return `<section id="details" aria-labelledby="detail-title"><div class="ap-section-heading"><div><p class="ap-overline">Detailed timing / independent synthetic cohort</p><h2 id="detail-title">Which requests and commands took the time?</h2><p class="ap-small ap-muted">${esc(f.label)} · ${fmt(f.windowSeconds)} observation window · separate from the overview sample</p></div></div><div class="report-two-up">${m.cohorts.map(cohortPanel).join('')}</div><p class="ap-note">Cumulative mix answers “which calls account for the recorded duration?” It is not a share of task elapsed time; process runtime can exceed the window when calls overlap. API/tool latency includes the invocation path, not pure network time. Model API request/response timing: Unsupported.</p><section class="ap-panel"><div class="ap-panel-heading"><h3>Share of the observed window</h3><span class="ap-small ap-muted">Independent interval unions</span></div>${occupancy}<p class="ap-note">Each row uses the ${fmt(f.windowSeconds)} observed window, not verified task elapsed. Categories overlap: these percentages do not add to 100%. Missing/pending intervals are excluded; uncovered time is not proven idle.</p></section><div class="ap-stack">${m.cohorts.map(c=>commandTable(c,m.commands,cohortId)).join('')}</div><div class="report-two-up">${ranking}</div><section class="ap-panel"><h3>Concurrent execution lanes</h3>${timeline(t)}</section><section class="ap-panel"><h3>Command groups</h3>${commandDetails}<h3>Individual execution evidence</h3>${runDetails}</section></section>`;
}
