// GitHub-Pages-Build: Startsets, kein Sync, Unterseiten, Service Worker und offline.
// Lokal: npm run build:pages && npm run preview:pages, dann node e2e/pages.mjs
// Live:  GRAPNEL_URL=https://bertjo-007.github.io/grapnel node e2e/pages.mjs
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { noHorizontalScroll, shot, sleep, watch } from './lib.mjs';

const BASE = process.env.GRAPNEL_URL ?? 'http://127.0.0.1:4175/grapnel';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), 'grapnel-e2e-')),
  // Ohne navigator.webdriver, sonst lässt die App die Startsets absichtlich weg.
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--no-first-run', '--disable-features=Translate', '--lang=de-CH', '--disable-blink-features=AutomationControlled'],
});
const errors = [];
const page = await browser.newPage();
watch(page, errors);
await page.setViewport({ width: 390, height: 844 });

await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForSelector('h1');
console.log('Begrüssung:', await page.$eval('h1', (e) => e.textContent));
await sleep(5000);
await page.goto(`${BASE}/sets`, { waitUntil: 'load' });
await page.waitForSelector('.set-tile', { timeout: 20000 });
await sleep(800);
const tiles = await page.$$eval('.set-tile', (els) => els.map((e) => e.textContent?.replace(/\s+/g, ' ').trim()));
console.log('Sets:', tiles.length);
for (const t of tiles) console.log('  ', t);
console.log('Kein horizontales Scrollen:', await noHorizontalScroll(page));
await shot(page, 'pages-01-sets');

// Unterseite direkt laden (auf GitHub kommt sie über 404.html)
const href = await page.$eval('.set-tile', (e) => e.getAttribute('href'));
const res = await page.goto(new URL(href, BASE).href, { waitUntil: 'load' });
await page.waitForSelector('h1');
console.log('Unterseite direkt:', res?.status(), '|', await page.$eval('h1', (e) => e.textContent));

await page.goto(`${BASE}/settings`, { waitUntil: 'load' });
await page.waitForSelector('h1');
await sleep(500);
const sections = await page.$$eval('h2', (els) => els.map((e) => e.textContent));
console.log('Einstellungen:', sections.join(' · '));
console.log('Sync sichtbar:', sections.some((s) => /sync/i.test(s ?? '')));

const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  const keys = await caches.keys();
  const c = await caches.open(keys[0]);
  return { active: !!reg.active, scope: reg.scope, files: (await c.keys()).length };
});
console.log('Service Worker:', sw);

await page.setOfflineMode(true);
await page.goto(`${BASE}/sets`, { waitUntil: 'load' }).catch((e) => console.log('offline:', e.message));
await sleep(1500);
console.log('Offline Sets:', await page.$$eval('.set-tile', (e) => e.length));
await page.setOfflineMode(false);

const real = errors.filter((e) => !e.includes('ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to fetch') && !e.includes('404'));
console.log('Fehler:', real.length ? real.join('\n') : 'keine');
await browser.close();
