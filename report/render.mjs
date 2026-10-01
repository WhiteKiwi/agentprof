import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { escapeHtml as esc, metric, formatDuration, evidenceBadge, evidenceTable } from '../design/components.mjs';
import { detailFixture } from './detail-fixture.mjs';
import { renderDetails } from './details.mjs';
import { bar, tokenComposition, timeline } from './charts.mjs';
const root = new URL('./', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const count = value => { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Expected a non-negative count'); return value; };
/** Only this internal synthetic display model is supported; no raw snapshot is serialized. */
export async function renderReport(s) {
  if (s.wasteSeconds !== null) throw new TypeError('This preview has no eligible waste intervals');
  if (s.kind !== 'synthetic') throw new TypeError('Only synthetic report previews are supported');
  for (const key of ['sessions', 'terminalCalls', 'timedCalls', 'pendingCalls']) count(s[key]);
  if (s.timedCalls > s.terminalCalls) throw new TypeError('Coverage exceeds its denominator');
  for (const key of ['observedSpanSeconds', 'turnUnionSeconds', 'toolUnionSeconds', 'wasteSeconds']) formatDuration(s[key]);
  const coverage = s.terminalCalls === 0 ? 'Unknown (no eligible calls)' : `${s.timedCalls} / ${s.terminalCalls} terminal calls`;
  const css = `${await read('../design/tokens.css')}\n${await read('../design/components.css')}\n${await read('report.css')}`;
  const js = await read('report.mjs');
  const hash = text => createHash('sha256').update(text).digest('base64');
  const csp = `default-src 'none'; img-src data:; style-src 'sha256-${hash(css)}'; script-src 'sha256-${hash(js)}'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const icon = `data:image/png;base64,${(await readFile(new URL('../assets/reference/salamander2.png', root))).toString('base64')}`;
  const summary = [
    {label:'Observed turn time',value:formatDuration(s.turnUnionSeconds),note:'Explicit interval union · not CPU time'},
    {label:'Tool interval union',value:formatDuration(s.toolUnionSeconds),note:'Overlap counted once · not call sum'},
    {label:'Timing coverage',value:s.terminalCalls ? `${Math.round(s.timedCalls/s.terminalCalls*100)}%` : 'Unknown',note:coverage+' timed'},
    {label:'Sessions',value:s.sessions,note:`${s.terminalCalls} terminal calls · ${s.pendingCalls} pending`}
  ].map(metric).join('');
  const time = [
    ['Observed span',s.observedSpanSeconds,'Selected session observation window'],
    ['Observed turn union',s.turnUnionSeconds,'May include approval waits'],
    ['Tool interval union',s.toolUnionSeconds,'Within observed turns']
  ].map(([label,value,note])=>`<div class="report-time-row"><div class="ap-chart-label"><strong>${esc(label)}</strong><span class="ap-number">${formatDuration(value)}</span></div>${s.observedSpanSeconds>0 ? bar(value,s.observedSpanSeconds,`${label}: ${formatDuration(value)} of ${formatDuration(s.observedSpanSeconds)} observation window`) : '<span class="ap-small ap-muted">No positive observation window · no bar</span>'}<p class="ap-small ap-muted">${esc(note)}</p></div>`).join('');
  const maximum = Math.max(1,...s.hotspots.filter(h=>h.seconds!==null).map(h=>h.seconds));
  const hotspots = s.hotspots.map(h => `<tr><th scope="row">${esc(h.label)}</th><td class="ap-number">${esc(formatDuration(h.seconds))}${bar(h.seconds,maximum,`${h.label}: ${formatDuration(h.seconds)}, independent sum`,h.evidence)}</td><td>${evidenceBadge(h.evidence)}</td><td>${esc(h.sample)}</td></tr>`).join('');
  const ids = new Set();
  const insights = s.insights.map(item => {
    if (!/^[a-z][a-z0-9-]*$/.test(item.id) || ids.has(item.id)) throw new TypeError('Expected a unique safe insight ID');
    ids.add(item.id);
    return `<article class="ap-insight"><p class="ap-overline">${esc(item.rule)}</p><div class="ap-insight-title"><h3>${esc(item.title)}</h3>${evidenceBadge(item.evidence)}</div><p>${esc(item.description)}</p><p class="ap-insight-meta">${esc(item.sample)} · ${esc(item.scope)} · ${esc(formatDuration(item.seconds))}</p><details class="ap-details" id="evidence-${item.id}"><summary>Inspect evidence and next step</summary><div class="ap-details-body"><p><strong>Next step.</strong> ${esc(item.nextStep)}</p><p><strong>One experiment.</strong> ${esc(item.experiment)}</p><p><strong>Quality guardrail.</strong> ${esc(item.guardrail)}</p>${evidenceTable(item.events)}<p class="ap-note">${esc(item.caveat)}</p></div></details></article>`;
  }).join('') || '<p class="ap-note">No insight candidates in this snapshot. This does not establish absence of problems.</p>';
  const slots = {CSS:css,JS:js,CSP:csp,ICON:icon,TITLE:esc(s.title),PERIOD:esc(s.period),TIMEZONE:esc(s.timezone),COLLECTED:esc(s.collectedAt),SOURCE:esc(s.source),COVERAGE:esc(coverage),MISSING:String(s.terminalCalls-s.timedCalls),SESSIONS:String(s.sessions),PENDING:String(s.pendingCalls),SUMMARY:summary,HOTSPOTS:hotspots,INSIGHTS:insights,WASTE:esc(formatDuration(s.wasteSeconds)),TIME:time,TOKENS:tokenComposition(s.tokens),TIMELINE:timeline(s.timeline),DETAILS:renderDetails(s.details || detailFixture)};
  return (await read('report.template.html')).replace(/@@([A-Z]+)@@/g, (_, key) => { if (!(key in slots)) throw new Error('Unknown template slot'); return slots[key]; });
}
