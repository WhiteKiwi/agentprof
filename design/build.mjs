import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fixture } from './fixtures.mjs';
import { escapeHtml, metric, chartRow, insight, badge, evidenceBadge, formatDuration } from './components.mjs';
const root = new URL('./', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
export const injectionExample = '</script><img src=x onerror="globalThis.__agentprofInjected=true"> & "quoted"';
export async function buildShowcase() {
  const css = `${await read('tokens.css')}\n${await read('components.css')}`;
  const js = await read('showcase.mjs');
  const icon = `data:image/png;base64,${(await readFile(new URL('../assets/reference/salamander2.png', root))).toString('base64')}`;
  const digest = text => createHash('sha256').update(text).digest('base64');
  const csp = `default-src 'none'; img-src data:; style-src 'sha256-${digest(css)}'; script-src 'sha256-${digest(js)}'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const states = [
    ['Unknown', formatDuration(null), 'No timing evidence. Do not render as 0s.', 'neutral'],
    ['Measured zero', formatDuration(0), 'A known zero remains a numeric value.', 'info'],
    ['Pending', 'In progress', 'No completion event. No duration invented.', 'warning'],
    ['Empty input', 'No sessions', 'Nothing was loaded into this example.', 'neutral'],
    ['Partial support', '32 / 40', 'Show eligibility and missing evidence together.', 'warning'],
    ['Read error', 'Unavailable', 'A failed read is distinct from empty input.', 'danger']
  ].map(([label, value, note, role]) => `<article class="ap-state">${badge(label, role)}<h3 class="ap-state-value">${escapeHtml(value)}</h3><p>${escapeHtml(note)}</p></article>`).join('');
  const replacements = { CSP: csp, ICON: icon, CSS: css, JS: js, PERIOD: escapeHtml(fixture.period), METRICS: fixture.metrics.map(metric).join(''), BREAKDOWN: fixture.breakdown.map(chartRow).join(''), INSIGHTS: fixture.insights.map(insight).join(''), STATES: states, BADGES: ['direct', 'observed', 'estimated', 'unknown', 'unsupported'].map(evidenceBadge).join('') + badge('✓ Confirmed success', 'success') + badge('! Confirmed error', 'danger'), SAFE_STRING: escapeHtml(injectionExample) };
  const html = (await read('showcase.template.html')).replace(/@@([A-Z_]+)@@/g, (_, key) => {
    if (!(key in replacements)) throw new Error(`Missing template slot: ${key}`);
    return replacements[key];
  });
  await writeFile(new URL('showcase.html', root), html);
  return html;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  const html = await buildShowcase();
  console.log(`Built design/showcase.html (${Buffer.byteLength(html).toLocaleString()} bytes). Synthetic data only.`);
}
