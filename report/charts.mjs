import { escapeHtml as esc, formatDuration } from '../design/components.mjs';
const number = v => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new TypeError('Expected finite non-negative chart value'); return v; };
export function bar(value, maximum, label, role='observed') {
  if (!['observed','direct','unknown'].includes(role)) throw new TypeError('Invalid chart role');
  number(maximum); if(maximum===0) throw new TypeError('Chart maximum must be positive');
  if(value===null) return '<span class="ap-small ap-muted">Unknown · no bar</span>';
  number(value); if(value>maximum) throw new TypeError('Chart value exceeds maximum');
  return `<svg class="ap-chart-svg report-bar" viewBox="0 0 100 4" preserveAspectRatio="none" role="img" aria-label="${esc(label)}"><rect width="100" height="4" rx="1" class="ap-svg-track"/><rect width="${value/maximum*100}" height="4" rx="1" class="ap-svg-${role}"/></svg>`;
}
export function tokenComposition(t) {
  for(const k of ['uncachedInput','cacheReadInput','output','eligible','inspected']) number(t[k]);
  if(!Number.isSafeInteger(t.eligible)||!Number.isSafeInteger(t.inspected)||t.eligible>t.inspected) throw new TypeError('Invalid token sample');
  for(const k of ['uncachedInput','cacheReadInput','output']) if(!Number.isSafeInteger(t[k])) throw new TypeError('Token counts must be integers');
  const total=t.uncachedInput+t.cacheReadInput+t.output; if(!Number.isSafeInteger(total)||total<=0) throw new TypeError('Invalid token partition');
  let x=0; const rows=[['Uncached input',t.uncachedInput,'direct'],['Cache-read input',t.cacheReadInput,'observed'],['Output',t.output,'unknown']];
  const rects=rows.map(([label,value,role])=>{const w=value/total*100;const r=`<rect x="${x}" width="${w}" height="8" class="ap-svg-${role}"/>`;x+=w;return r;}).join('');
  return `<p class="report-big">${total.toLocaleString('en-US')} <span>tokens</span></p><svg class="report-token-chart" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="Synthetic tokens: ${t.uncachedInput} uncached input, ${t.cacheReadInput} cache-read input, ${t.output} output">${rects}</svg><dl class="report-legend">${rows.map(([l,v])=>`<div><dt>${l}</dt><dd>${v.toLocaleString('en-US')}</dd></div>`).join('')}</dl><p class="ap-small ap-muted">${t.eligible} / ${t.inspected} unique final responses eligible · direct synthetic usage</p><p class="ap-small ap-muted">Cache-read is a subset of input, counted once. Cache-write: Unsupported. No tool attribution or cost estimate.</p>`;
}
export function timeline(t) {
  number(t.windowSeconds);if(t.windowSeconds===0)throw new TypeError('Invalid timeline window');
  const ids=new Set();
  const rows=t.spans.map(s=>{
    if(!/^[a-z][a-z0-9-]*$/.test(s.id)||ids.has(s.id))throw new TypeError('Invalid span ID');ids.add(s.id);
    number(s.start);if(s.start>t.windowSeconds)throw new TypeError('Span outside window');
    if(s.end!==null){number(s.end);if(s.end<s.start||s.end>t.windowSeconds)throw new TypeError('Invalid span endpoints');}
    const value=s.end===null?'Pending · end unknown':formatDuration(s.end-s.start);
    const mark=s.end===null?`<line x1="${s.start/t.windowSeconds*100}" x2="${s.start/t.windowSeconds*100}" y1="0" y2="8" class="report-pending"/>`:`<rect x="${s.start/t.windowSeconds*100}" width="${(s.end-s.start)/t.windowSeconds*100}" height="8" rx="1" class="ap-svg-observed"/>`;
    return `<div class="report-span-row"><a href="#span-${s.id}" data-open-span="span-${s.id}">${esc(s.label)}</a><svg viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="${esc(s.label)}: start ${s.start}s, ${s.end===null?'end unknown':`end ${s.end}s`}"><rect width="100" height="8" class="ap-svg-track"/>${mark}</svg><span class="ap-number">${esc(value)}</span></div>`;
  }).join('');
  const table=`<details class="ap-details"><summary>Span values as a table</summary><div class="ap-details-body ap-table-wrap"><table class="ap-table"><caption>Selected excerpt · seconds from start · observed item intervals</caption><thead><tr><th scope="col">Item</th><th scope="col">Start</th><th scope="col">End</th><th scope="col">Duration</th></tr></thead><tbody>${t.spans.map(s=>`<tr><th scope="row">${esc(s.label)}</th><td>${s.start}s</td><td>${s.end===null?'Unknown':`${s.end}s`}</td><td>${s.end===null?'Pending':formatDuration(s.end-s.start)}</td></tr>`).join('')}</tbody></table></div></details>`;
  const detail=t.spans.map(s=>`<details class="ap-details" id="span-${s.id}"><summary>${esc(s.label)} · ${s.end===null?'Pending':formatDuration(s.end-s.start)}</summary><div class="ap-details-body"><dl class="ap-report-context"><div><dt>Start / end offset</dt><dd>${s.start}s / ${s.end===null?'Unknown':`${s.end}s`}</dd></div><div><dt>Timing meaning</dt><dd>Observed item interval · paired timestamps</dd></div></dl><p>${esc(s.note)}</p><p class="ap-small ap-muted">${esc(s.id)} · synthetic evidence. No dependency or critical-path claim.</p></div></details>`).join('');
  return `<p class="ap-small ap-muted">${esc(t.label)} · offsets from excerpt start · ${t.spans.length} selected items</p><div class="report-axis"><span>0s</span><span>${t.windowSeconds/2}s</span><span>${t.windowSeconds}s</span></div><div class="report-spans">${rows}</div>${table}<p class="ap-small ap-muted">Bars are observed intervals. A vertical tick marks a pending start; no duration is invented. Parallel rows overlap, and empty regions are not proven idle.</p><div class="report-span-details">${detail}</div>`;
}
