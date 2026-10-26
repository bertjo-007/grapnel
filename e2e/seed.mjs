// Dev-Startdaten: Wortliste wird einmal eingefügt (alle Paare), Seiten heissen nach der Sprache.
// Puppeteer setzt sonst navigator.webdriver, und dann bleibt die App absichtlich leer.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { BASE, shot, sleep, watch } from './lib.mjs';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), 'grapnel-e2e-')),
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--no-first-run', '--disable-features=Translate', '--lang=de-CH', '--disable-blink-features=AutomationControlled'],
});
const errors = [];
const page = await browser.newPage();
watch(page, errors);
await page.setViewport({ width: 1280, height: 900 });

const counts = () =>
  page.evaluate(async () => {
    const { db } = await import('/src/core/db/db.ts');
    const sets = await db.sets.toArray();
    return Promise.all(
      sets.map(async (s) => {
        const cards = await db.cards.where('setId').equals(s.id).sortBy('position');
        return { title: s.title, front: s.frontLang, back: s.backLang, cards: cards.length, first: [cards[0]?.front, cards[0]?.back], last: [cards.at(-1)?.front, cards.at(-1)?.back] };
      }),
    );
  });

await page.goto(`${BASE}/`, { waitUntil: 'load' });
console.log('webdriver:', await page.evaluate(() => navigator.webdriver));
await page.waitForSelector('.set-tile', { timeout: 20000 });
await sleep(1500);
console.log('Nach erstem Start:', JSON.stringify(await counts()));
await page.reload({ waitUntil: 'load' });
await sleep(2500);
console.log('Nach Neuladen:', JSON.stringify(await counts()));

const href = await page.$eval('.set-tile', (e) => e.getAttribute('href'));
await page.goto(`${BASE}${href}/edit`, { waitUntil: 'load' });
await page.waitForSelector('.editor-row');
await sleep(500);
console.log('Editor-Beschriftung:', await page.$$eval('.editor-slot:first-child .editor-side', (e) => e.map((x) => x.textContent)));
await shot(page, '95-seed-editor');
await page.setViewport({ width: 390, height: 844 });
await sleep(400);
await shot(page, '96-seed-editor-mobile');
console.log('Fehler:', errors.length ? errors.join('\n') : 'keine');
await browser.close();
