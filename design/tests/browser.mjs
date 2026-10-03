/** Optional browser verification. Requires Playwright + Chromium available in
 * the caller's environment; this repo does not install or download browsers. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const output = resolve(process.env.AP_QA_DIR || '/tmp/agentprof-design-qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const url = new URL('../showcase.html', import.meta.url).href;
const results = [];
const context = await browser.newContext();
await context.setOffline(true);
for (const width of [320, 390, 1440]) for (const theme of ['dark', 'light']) {
  const page = await context.newPage({ viewport: { width, height: 1000 } });
  await page.setViewportSize({ width, height: 1000 });
  const requests = [], errors = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await page.selectOption('#theme', theme);
  assert.equal(await page.getAttribute('html', 'data-theme'), theme);
  assert.equal(await page.evaluate(() => globalThis.__agentprofInjected), undefined);
  assert.equal(await page.locator('#safe-string img').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width} ${theme}`);
  assert.equal(await page.locator('.ap-insight:visible').count(), 3);
  await page.selectOption('#evidence-filter', 'estimated');
  assert.equal(await page.locator('.ap-insight:visible').count(), 0);
  assert.equal(await page.locator('#empty-results').isVisible(), true);
  await page.click('#reset-filter');
  assert.equal(await page.locator('.ap-insight:visible').count(), 3);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'evidence-filter');
  await page.selectOption('#evidence-filter', 'direct');
  assert.equal(await page.locator('.ap-insight:visible').count(), 1);
  await page.locator('[data-open-evidence]').click();
  assert.equal(await page.locator('#retry-pattern-evidence').getAttribute('open'), '');
  assert.equal(await page.locator('.ap-nav a[aria-current]').getAttribute('href'), '#insights');
  assert.equal(await page.locator('.ap-insight:visible').count(), 3);
  await page.locator('#retry-pattern-evidence summary').press('Enter');
  assert.equal(await page.locator('#retry-pattern-evidence').getAttribute('open'), null);
  await page.locator('#retry-pattern-evidence summary').press('Space');
  assert.equal(await page.locator('#retry-pattern-evidence').getAttribute('open'), '');
  assert.equal(await page.locator('#retry-pattern-evidence summary').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
  await page.locator('#components summary').click();
  await page.locator('#sample-action').click(); await page.locator('#sample-action').click();
  assert.match(await page.locator('#action-status').textContent(), /2 times/);
  assert.equal(await page.locator('button:disabled').isDisabled(), true);
  await page.locator('#sample-label').fill('Synthetic label');
  assert.equal(await page.locator('#sample-label').getAttribute('aria-invalid'), 'false');
  await page.locator('#sample-label').fill('  ');
  assert.equal(await page.locator('#sample-label').getAttribute('aria-invalid'), 'true');
  const badTargets = await page.locator('button, select, summary, .ap-nav a, .ap-button').evaluateAll(elements => elements.filter(e => e.getClientRects().length && (e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44)).map(e => e.textContent));
  assert.deepEqual(badTargets, []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `expanded overflow at ${width} ${theme}`);
  await page.screenshot({ path: `${output}/${theme}-${width}-expanded.png`, fullPage: true });
  await page.locator('#components summary').click();
  await page.locator('#retry-pattern-evidence summary').click();
  await page.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); });
  await page.screenshot({ path: `${output}/${theme}-${width}.png`, fullPage: true });
  assert.deepEqual(requests, []); assert.deepEqual(errors, []);
  results.push({ theme, width, offline: true, externalRequests: 0, consoleErrors: 0, overflow: false, interactions: 'passed' });
  await page.close();
}
const page = await context.newPage();
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(url);
await page.keyboard.press('Tab');
assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Skip to report overview');
await page.keyboard.press('Enter');
assert.equal(await page.evaluate(() => document.activeElement.id), 'overview');
await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
await page.selectOption('#theme', 'system');
assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
assert.equal(await page.locator('.ap-button').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s');
await page.emulateMedia({ colorScheme: 'dark' });
assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
await page.selectOption('#theme', 'light'); await page.selectOption('#theme', 'dark'); await page.selectOption('#theme', 'light');
assert.equal(await page.locator('.ap-metric-value').first().textContent(), '30 min');
await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
await page.screenshot({ path: `${output}/light-200percent-css-zoom.png`, fullPage: true });
await page.evaluate(() => { document.documentElement.style.zoom = ''; });
const printScreenState = () => page.evaluate(() => ({
  filter: document.querySelector('#evidence-filter').value,
  emptyHidden: document.querySelector('#empty-results').hidden,
  status: document.querySelector('#filter-status').textContent,
  hiddenInsights: [...document.querySelectorAll('.ap-insight')].map(insight => insight.hidden),
  openDetails: [...document.querySelectorAll('details')].map(details => details.open),
}));
for (const filter of ['direct', 'estimated']) {
  await page.selectOption('#evidence-filter', filter);
  await page.locator('details').evaluateAll(elements => elements.forEach((details, index) => { details.open = index % 2 === 0; }));
  const beforePrint = await printScreenState();
  assert.equal(beforePrint.emptyHidden, filter !== 'estimated');
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => { dispatchEvent(new Event('beforeprint')); dispatchEvent(new Event('beforeprint')); });
  assert.equal(await page.locator('.ap-insight:visible').count(), 3);
  assert.equal(await page.locator('#empty-results').isVisible(), false);
  assert.equal(await page.locator('.ap-theme').isVisible(), false);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)');
  assert.equal(await page.locator('details:not([open])').count(), 0);
  await page.pdf({ path: `${output}/${filter === 'direct' ? 'print-specimen' : 'print-empty-filter'}.pdf`, format: 'A4', printBackground: true });
  await page.evaluate(() => { dispatchEvent(new Event('afterprint')); dispatchEvent(new Event('afterprint')); });
  await page.emulateMedia({ media: 'screen' });
  assert.deepEqual(await printScreenState(), beforePrint);
  assert.equal(await page.locator('.ap-insight:visible').count(), filter === 'direct' ? 1 : 0);
  assert.equal(await page.locator('#empty-results').isVisible(), filter === 'estimated');
  // Exercise the cancellation event path without generating another PDF.
  await page.evaluate(() => { dispatchEvent(new Event('beforeprint')); dispatchEvent(new Event('afterprint')); });
  assert.deepEqual(await printScreenState(), beforePrint);
}
await page.close();
const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
await noJs.setOffline(true);
const staticPage = await noJs.newPage(); await staticPage.goto(url);
assert.equal(await staticPage.locator('.ap-insight').count(), 3);
await staticPage.locator('#retry-pattern-evidence summary').click();
assert.equal(await staticPage.locator('#retry-pattern-evidence').getAttribute('open'), '');
assert.equal(await staticPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
await staticPage.screenshot({ path: `${output}/no-js-320.png`, fullPage: true });
await browser.close();
await writeFile(`${output}/results.json`, JSON.stringify({ results, keyboard: 'passed', reducedMotion: 'passed', systemTheme: 'passed', repeatedTheme: 'passed', print: 'passed', cssZoom200Percent: 'passed', noJavaScript: 'passed' }, null, 2));
console.log(`PASS: 6 viewport/theme combinations; filtering, disclosures, keyboard, safe text, targets, repeated actions, reduced motion, print and no-JS. Evidence: ${output}`);
