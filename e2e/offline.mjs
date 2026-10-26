// Produktions-Build: Service Worker installiert, danach offline neu laden.
import { launch, shot, sleep, watch } from './lib.mjs';

const BASE = process.env.GRAPNEL_URL ?? 'http://127.0.0.1:4175';
const FIXTURE = 'public/startsets/franzoesischwoerter.docx';
const browser = await launch();
const errors = [];
const page = await browser.newPage();
watch(page, errors);
await page.setViewport({ width: 1280, height: 860 });

await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
const swReady = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return !!reg.active;
});
console.log('Service Worker aktiv:', swReady);
const cached = await page.evaluate(async () => {
  const keys = await caches.keys();
  const c = await caches.open(keys[0]);
  return { cache: keys[0], files: (await c.keys()).length };
});
console.log('Zwischenspeicher:', cached);

// Ein Set anlegen, damit offline etwas zu sehen ist.
await page.goto(`${BASE}/import`, { waitUntil: 'networkidle0' });
await (await page.$('input[type=file]')).uploadFile(FIXTURE);
await page.waitForSelector('.preview-row', { timeout: 20000 });
await page.click('.commit-bar .btn-primary');
await page.waitForSelector('.callout.success');

await page.setOfflineMode(true);
await page.goto(`${BASE}/sets`, { waitUntil: 'load' }).catch((e) => console.log('Navigation offline:', e.message));
await sleep(1500);
const tiles = await page.$$eval('.set-tile', (els) => els.map((e) => e.textContent));
console.log('Offline sichtbar:', tiles);
// Offline einen Lernmodus öffnen (lazy geladene Seite muss aus dem Speicher kommen).
const href = await page.$eval('.set-tile', (e) => e.getAttribute('href'));
await page.goto(`${BASE}${href}`, { waitUntil: 'load' });
await sleep(800);
await page.click('.mode-tile.primary');
await sleep(1500);
console.log('Offline Lernen-Setup:', await page.$eval('.start-bar', (e) => e.textContent).catch(() => 'fehlt'));
await shot(page, '70-offline');
await page.setOfflineMode(false);
console.log('Fehler:', errors.filter((e) => !e.includes('ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to fetch')).join('\n') || 'keine');
await browser.close();
