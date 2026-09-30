import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { escapeHtml as esc, metric, formatDuration, evidenceBadge, evidenceTable } from '../design/components.mjs';
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
    {label:'Observed span',value:formatDuration(s.observedSpanSeconds),note:'Session observation window; includes gaps. Not task elapsed.'},
    {label:'Observed turn time',value:formatDuration(s.turnUnionSeconds),note:'Union of explicit turn intervals. May include approval waits; not CPU time.'},
    {label:'Tool interval union',value:formatDuration(s.toolUnionSeconds),note:'Within the observed turns in this fixture. Overlap counted once; not a call-duration sum.'}
  ].map(metric).join('');
  const hotspots = s.hotspots.map(h => `<tr><th scope="row">${esc(h.label)}</th><td class="ap-number">${esc(formatDuration(h.seconds))}</td><td>${evidenceBadge(h.evidence)}</td><td>${esc(h.sample)}</td></tr>`).join('');
  const ids = new Set();
  const insights = s.insights.map(item => {
    if (!/^[a-z][a-z0-9-]*$/.test(item.id) || ids.has(item.id)) throw new TypeError('Expected a unique safe insight ID');
    ids.add(item.id);
    return `<article class="ap-insight"><p class="ap-overline">${esc(item.rule)}</p><div class="ap-insight-title"><h3>${esc(item.title)}</h3>${evidenceBadge(item.evidence)}</div><p>${esc(item.description)}</p><p class="ap-insight-meta">${esc(item.sample)} · ${esc(item.scope)} · ${esc(formatDuration(item.seconds))}</p><details class="ap-details" id="evidence-${item.id}"><summary>Inspect evidence and next step</summary><div class="ap-details-body"><p><strong>Next step.</strong> ${esc(item.nextStep)}</p><p><strong>One experiment.</strong> ${esc(item.experiment)}</p><p><strong>Quality guardrail.</strong> ${esc(item.guardrail)}</p>${evidenceTable(item.events)}<p class="ap-note">${esc(item.caveat)}</p></div></details></article>`;
  }).join('') || '<p class="ap-note">No insight candidates in this snapshot. This does not establish absence of problems.</p>';
  const slots = {CSS:css,JS:js,CSP:csp,ICON:icon,TITLE:esc(s.title),PERIOD:esc(s.period),TIMEZONE:esc(s.timezone),COLLECTED:esc(s.collectedAt),SOURCE:esc(s.source),COVERAGE:esc(coverage),MISSING:String(s.terminalCalls-s.timedCalls),SESSIONS:String(s.sessions),PENDING:String(s.pendingCalls),SUMMARY:summary,HOTSPOTS:hotspots,INSIGHTS:insights,WASTE:esc(formatDuration(s.wasteSeconds))};
  return (await read('report.template.html')).replace(/@@([A-Z]+)@@/g, (_, key) => { if (!(key in slots)) throw new Error('Unknown template slot'); return slots[key]; });
}
