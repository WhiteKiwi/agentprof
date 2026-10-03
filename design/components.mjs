/** Safe, framework-free HTML primitives. Inputs are normalized display data,
 * never raw logs. This specimen is not the product's future snapshot schema. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return 'Unknown';
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new TypeError('Expected a finite non-negative duration or null');
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round((seconds % 60) * 1000) / 1000;
  if (remainder === 60) return `${minutes + 1}m`;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
const evidenceRoles = { direct: ['Direct', 'info'], observed: ['Observed', 'observed'], estimated: ['Estimated', 'warning'], unknown: ['Unknown', 'neutral'], unsupported: ['Unsupported', 'neutral'] };
export function badge(label, role = 'neutral') {
  if (!['info', 'observed', 'warning', 'success', 'danger', 'brand', 'neutral'].includes(role)) throw new TypeError('Unknown semantic role');
  return `<span class="ap-badge ap-badge--${role}">${escapeHtml(label)}</span>`;
}
export function evidenceBadge(kind) {
  if (!evidenceRoles[kind]) throw new TypeError('Unknown evidence kind');
  return badge(...evidenceRoles[kind]);
}
export function metric({ label, value, unit = '', note }) {
  return `<article class="ap-metric"><h2 class="ap-metric-label">${escapeHtml(label)}</h2><p class="ap-metric-value">${escapeHtml(value == null ? 'Unknown' : value)}${unit && value != null ? ` <span class="ap-unit">${escapeHtml(unit)}</span>` : ''}</p><p class="ap-metric-foot">${escapeHtml(note)}</p></article>`;
}
export function chartRow({ label, seconds, total, evidence }) {
  if (!(typeof total === 'number' && Number.isFinite(total) && typeof seconds === 'number' && Number.isFinite(seconds) && total > 0 && seconds >= 0 && seconds <= total)) throw new TypeError('Chart value must be within its explicit denominator');
  if (!['direct', 'observed', 'unknown'].includes(evidence)) throw new TypeError('Unsupported chart role');
  const percent = Number((seconds / total * 100).toFixed(6));
  return `<div class="ap-chart-row"><div class="ap-chart-label"><span>${escapeHtml(label)}</span><strong class="ap-number">${formatDuration(seconds)} <span class="ap-muted">/ ${formatDuration(total)}</span></strong></div><svg class="ap-chart-svg" viewBox="0 0 100 2" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="2" rx=".5" class="ap-svg-track"/><rect width="${percent}" height="2" rx=".5" class="ap-svg-${evidence}"/></svg></div>`;
}
export function evidenceTable(events) {
  return `<div class="ap-table-wrap"><table class="ap-table"><caption>Synthetic, normalized evidence · no original commands or output</caption><thead><tr><th scope="col">Event</th><th scope="col">Interval</th><th scope="col">Evidence</th><th scope="col">Result</th></tr></thead><tbody>${events.map(event => `<tr><th scope="row" class="ap-mono">${escapeHtml(event.id)}</th><td class="ap-number">${escapeHtml(event.interval)}</td><td>${evidenceBadge(event.evidence)}</td><td>${escapeHtml(event.result)}</td></tr>`).join('')}</tbody></table></div>`;
}
export function insight(item) {
  if (!/^[a-z][a-z0-9-]*$/.test(item.id)) throw new TypeError('Insight id must be an HTML-safe slug');
  return `<article class="ap-insight" id="${item.id}" data-evidence="${escapeHtml(item.evidence)}" data-selected="${Boolean(item.selected)}"><div class="ap-insight-header"><div class="ap-insight-main"><p class="ap-overline">${escapeHtml(item.rule)}</p><div class="ap-insight-title"><h3>${escapeHtml(item.title)}</h3>${evidenceBadge(item.evidence)}</div><p class="ap-muted">${escapeHtml(item.description)}</p><div class="ap-insight-meta"><span>${escapeHtml(item.sample)}</span><span>${escapeHtml(item.scope)}</span></div></div><p class="ap-insight-value">${escapeHtml(formatDuration(item.seconds))}</p></div><details class="ap-details" id="${item.id}-evidence"><summary>Inspect evidence &amp; next step</summary><div class="ap-details-body"><p><strong>Next step.</strong> ${escapeHtml(item.nextStep)}</p>${evidenceTable(item.events)}<p class="ap-small ap-muted">${escapeHtml(item.caveat)}</p></div></details></article>`;
}
