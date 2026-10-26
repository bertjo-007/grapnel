// Import von Joshuas Französischwörter.docx über die Oberfläche, mit Nachzählen.
import { existsSync } from 'node:fs';
import { BASE, clickText, fullShot, launch, noHorizontalScroll, shot, sleep, watch } from './lib.mjs';

const FIXTURE = 'public/startsets/franzoesischwoerter.docx';
if (!existsSync(FIXTURE)) throw new Error('Fixture fehlt');

const browser = await launch();
const errors = [];
const page = await browser.newPage();
watch(page, errors);
await page.setViewport({ width: 1440, height: 900 });

await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
await shot(page, '01-home-empty');
console.log('Startseite leer:', await page.$eval('h1', (e) => e.textContent));

await page.goto(`${BASE}/import`, { waitUntil: 'networkidle0' });
await shot(page, '02-import-start');
const input = await page.$('input[type=file]');
await input.uploadFile(FIXTURE);
await page.waitForSelector('.preview-row', { timeout: 20000 });
await sleep(400);
const badges = await page.$$eval('.summary-badge', (els) => els.map((e) => e.textContent));
console.log('Zusammenfassung:', badges.join(' | '));
const structure = await page.$eval('.seg button[aria-pressed=true]', (e) => e.textContent);
console.log('Aufbau:', structure);
const langs = await page.$$eval('.lang-row select', (els) => els.map((e) => e.value));
console.log('Sprachen:', langs.join(' → '));
const title = await page.$eval('input.input:not(.input-sm):not([type=search])', (e) => e.value);
console.log('Titel:', title);
await shot(page, '03-import-preview');
console.log('Kein horizontales Scrollen:', await noHorizontalScroll(page));

// Nur die zu prüfenden Zeilen ansehen.
await clickText(page, 'Zu prüfen');
await sleep(300);
const problems = await page.$$eval('.preview-row', (els) => els.slice(0, 6).map((e) => e.textContent?.replace(/\s+/g, ' ').trim()));
console.log('Erste zu prüfende Zeilen:\n  ' + problems.join('\n  '));
await shot(page, '04-import-problems');

const commitLabel = await page.$eval('.commit-bar .btn-primary', (e) => e.textContent);
console.log('Knopf:', commitLabel);
await page.click('.commit-bar .btn-primary');
await page.waitForSelector('.callout.success, .callout.danger', { timeout: 20000 });
console.log('Ergebnis:', (await page.$eval('.callout', (e) => e.textContent))?.replace(/\s+/g, ' '));
await shot(page, '05-import-done');

await clickText(page, 'Lernset öffnen');
await page.waitForSelector('.card-row', { timeout: 10000 });
await sleep(300);
await fullShot(page, '06-set-detail');
console.log('Set:', await page.$eval('h1', (e) => e.textContent), '|', await page.$eval('.page-sub', (e) => e.textContent));

// Neu laden: Daten müssen bleiben.
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('.card-row');
console.log('Nach Neuladen noch da:', await page.$eval('.page-sub', (e) => e.textContent));
console.log('Set-URL:', page.url());

console.log('Fehler:', errors.length ? errors.join('\n') : 'keine');
await browser.close();
