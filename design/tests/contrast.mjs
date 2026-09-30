import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const css = await readFile(new URL('../tokens.css', import.meta.url), 'utf8');
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
function parse(block) { return Object.fromEntries([...block.matchAll(/(--ap-[\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()])); }
const base = parse(blocks.find(([, selector]) => selector.trim().endsWith(':root'))[2]);
const luminance = hex => {
  const channels = hex.replace('#', '').match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
};
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + .05) / (lo + .05); };
const results = [];
for (const theme of ['dark', 'light']) {
  const block = blocks.find(([, selector]) => selector.includes(`[data-theme="${theme}"]`));
  const tokens = { ...base, ...parse(block[2]) };
  function value(role) { const color = tokens[`--ap-${role}`]; assert(color, role); return color.startsWith('var(') ? value(color.slice(9, -1)) : color; }
  function check(foreground, background, min, purpose) {
    const fg = value(foreground), bg = value(background), measured = ratio(fg, bg);
    results.push({ theme, foreground, background, fg, bg, ratio: measured, minimum: min, purpose });
    assert(measured >= min, `${theme} ${foreground}/${background}: ${measured} < ${min}`);
  }
  for (const bg of ['canvas', 'surface', 'surface-raised']) {
    for (const fg of ['text', 'text-muted', 'brand-text']) check(fg, bg, 4.5, 'ordinary text');
    for (const fg of ['focus', 'control-border']) check(fg, bg, 3, 'essential boundary / focus');
    for (const fg of ['info', 'observed', 'unknown']) check(fg, bg, 3, 'essential chart fill');
  }
  for (const bg of ['brand-field', 'brand-hover', 'brand-active']) check('on-brand', bg, 4.5, 'primary button text');
  for (const role of ['success', 'warning', 'danger', 'info', 'unknown', 'observed']) check(role, `${role}-soft`, 4.5, 'badge text');
  check('brand-text', 'brand-soft', 4.5, 'selected navigation text');
  check('focus', 'brand-soft', 3, 'selected navigation focus');
  check('danger', 'surface', 3, 'invalid input boundary');
}
if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2));
else console.log(`PASS: ${results.length} theme/state contrast pairs; lowest ratio ${Math.min(...results.map(x => x.ratio)).toFixed(2)}:1. Pair checks are not a complete accessibility audit.`);
