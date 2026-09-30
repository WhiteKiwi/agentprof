import { writeFile } from 'node:fs/promises';
import { renderReport } from './render.mjs';
import { snapshot } from './fixture.mjs';
await writeFile(new URL('./preview.html', import.meta.url), await renderReport(snapshot));
console.log('Built report/preview.html — synthetic presentation only; no logs loaded.');
