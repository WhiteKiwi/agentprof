import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { renderReport } from '../render.mjs';
import { snapshot } from '../fixture.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const dir=process.env.AP_QA_DIR || '/tmp/agentprof-report-qa';
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const context=await browser.newContext({offline:true});
 const checks=[];
 for(const width of [320,390,1440]) for(const theme of ['dark','light']) {
  const page=await context.newPage(); await page.setViewportSize({width,height:1000}); const requests=[],errors=[];
  page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());}); page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(new URL('../preview.html',import.meta.url).href);
  await page.selectOption('#theme',theme); await page.selectOption('#theme',theme==='dark'?'light':'dark'); await page.selectOption('#theme',theme);
  assert.equal(await page.getAttribute('html','data-theme'),theme);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${width} ${theme}`);
  const disclosure=page.locator('details summary'); await disclosure.focus(); await disclosure.press('Enter'); assert.ok(await page.locator('details').evaluate(e=>e.open)); await disclosure.press('Space'); assert.equal(await page.locator('details').evaluate(e=>e.open),false);
  await page.locator('a[href="#hotspots"]').click(); assert.ok(page.url().endsWith('#hotspots')); await page.goBack(); assert.ok(!page.url().endsWith('#hotspots'));
  await page.evaluate(()=>scrollTo(0,0)); await page.screenshot({path:`${dir}/${width}-${theme}.png`,fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'}); assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
  await page.emulateMedia({media:'print'}); assert.ok(await page.locator('.ap-details-body').isVisible());
  assert.deepEqual(requests,[]); assert.deepEqual(errors,[]); checks.push(`${width}/${theme}: pass`); await page.close();
 }
 const nojs=await browser.newContext({javaScriptEnabled:false,offline:true}); const p=await nojs.newPage(); await p.goto(new URL('../preview.html',import.meta.url).href); assert.equal(await p.locator('#theme').isVisible(),false); await p.locator('summary').click(); assert.ok(await p.getByText('One experiment.',{exact:false}).isVisible());
 const malicious=structuredClone(snapshot); malicious.title='</script><img src=x onerror="globalThis.injected=true">'; await writeFile(`${dir}/malicious.html`,await renderReport(malicious)); const attack=await context.newPage(); await attack.goto(`file://${dir}/malicious.html`); assert.equal(await attack.evaluate(()=>globalThis.injected),undefined); assert.equal(await attack.locator('#title img').count(),0);
 console.log(JSON.stringify({checks,noJavaScript:'pass',xss:'pass',externalRequests:0},null,2));
} finally {await browser.close();}
