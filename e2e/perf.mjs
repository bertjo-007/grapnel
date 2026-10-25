// Leistung mit einem grossen Set (5000 Karten): Import, Set-Seite, Editor, Lernen starten.
import { writeFileSync } from 'node:fs';
import { BASE, launch, OUT, shot, sleep, watch } from './lib.mjs';

const N = 5000;
const rows = ['front,back,example'];
for (let i = 1; i <= N; i++) rows.push(`mot ${i},Wort ${i},"Phrase numéro ${i}, avec virgule"`);
const file = `${OUT}/gross.csv`;
writeFileSync(file, rows.join('\n'));

const browser = await launch();
const errors = [];
const page = await browser.newPage();
watch(page, errors);
await page.setViewport({ width: 1440, height: 900 });

let t = Date.now();
await page.goto(`${BASE}/import`, { waitUntil: 'networkidle0' });
await (await page.$('input[type=file]')).uploadFile(file);
await page.waitForSelector('.preview-row', { timeout: 60000 });
console.log(`Vorschau ${N} Zeilen: ${Date.now() - t} ms`);
t = Date.now();
await page.click('.commit-bar .btn-primary');
await page.waitForSelector('.callout.success, .callout.danger', { timeout: 60000 });
console.log(`Übernehmen: ${Date.now() - t} ms`, (await page.$eval('.callout', (e) => e.textContent))?.replace(/\s+/g, ' '));
await page.click('.btn-primary');
await page.waitForSelector('.card-row');
const url = page.url();

t = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.card-row');
console.log(`Set-Seite bis erste Karte: ${Date.now() - t} ms`);
const rendered = await page.$$eval('.card-row', (e) => e.length);
console.log('Gerenderte Zeilen (virtualisiert):', rendered);
t = Date.now();
await page.type('input[type=search]', 'mot 4999');
await sleep(300);
console.log(`Suche: ${Date.now() - t} ms, Treffer:`, await page.$$eval('.card-row', (e) => e.map((x) => x.textContent?.slice(0, 20))));

t = Date.now();
await page.goto(`${url}/edit`, { waitUntil: 'load' });
await page.waitForSelector('.editor-row');
console.log(`Editor bis erste Karte: ${Date.now() - t} ms`);
const frames = await page.evaluate(async () => {
  let count = 0;
  const start = performance.now();
  await new Promise((res) => {
    const step = () => {
      count++;
      window.scrollBy(0, 400);
      if (performance.now() - start < 2000) requestAnimationFrame(step);
      else res();
    };
    requestAnimationFrame(step);
  });
  return Math.round(count / 2);
});
console.log('Editor scrollen: ~', frames, 'Bilder/s');
await shot(page, '80-editor-5000');

t = Date.now();
await page.goto(`${url.replace('/sets/', '/study/')}/learn`, { waitUntil: 'load' });
await page.waitForSelector('.start-bar');
console.log(`Lernen-Setup: ${Date.now() - t} ms`, await page.$eval('.start-bar', (e) => e.textContent));
t = Date.now();
await page.click('.start-bar .btn-primary');
await page.waitForSelector('.task');
console.log(`Sitzung bis erste Aufgabe: ${Date.now() - t} ms`);

console.log('Fehler:', errors.length ? errors.join('\n') : 'keine');
await browser.close();
