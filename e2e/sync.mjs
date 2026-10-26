// Zwei Geräte (zwei Browser-Profile) über den lokalen Worker koppeln.
import { BASE, clickText, launch, shot, sleep, watch } from './lib.mjs';

const FIXTURE = 'public/startsets/franzoesischwoerter.docx';
const errors = [];
const a = await launch();
const b = await launch();
const pa = await a.newPage();
const pb = await b.newPage();
watch(pa, errors);
watch(pb, errors);
const reqB = [];
pb.on('request', (r) => r.url().includes('/api/') && reqB.push(Date.now() + ' ' + r.method() + ' ' + r.url().split('/api/')[1].slice(0, 60)));
pb.on('requestfinished', (r) => r.url().includes('/api/') && reqB.push(Date.now() + ' fertig ' + r.response()?.status()));
pb.on('requestfailed', (r) => r.url().includes('/api/') && reqB.push(Date.now() + ' FEHLGESCHLAGEN ' + r.failure()?.errorText));
await pa.setViewport({ width: 1280, height: 900 });
await pb.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

// Gerät A: importieren
await pa.goto(`${BASE}/import`, { waitUntil: 'networkidle0' });
await (await pa.$('input[type=file]')).uploadFile(FIXTURE);
await pa.waitForSelector('.preview-row', { timeout: 20000 });
await pa.click('.commit-bar .btn-primary');
await pa.waitForSelector('.callout.success');

// Gerät A: Sync einrichten
await pa.goto(`${BASE}/settings#sync`, { waitUntil: 'networkidle0' });
await pa.click('.consent input');
await clickText(pa, 'Sync einrichten');
await pa.waitForSelector('.sync-code .code', { timeout: 20000 });
await sleep(1500);
const code = await pa.$eval('.sync-code .code', (e) => e.textContent);
console.log('Code:', code);
console.log('Status A:', await pa.$eval('#sync', (e) => e.textContent?.slice(0, 120)));
await shot(pa, '60-sync-a');

// Gerät B: über den QR-Link (Code steht hinter #, geht nicht an den Server)
const key = await pa.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('grapnel');
    r.onsuccess = () => res(r.result);
  });
  return new Promise((res) => {
    const g = db.transaction('meta').objectStore('meta').get('sync');
    g.onsuccess = () => res(g.result.value.key);
  });
});
await pb.goto(`${BASE}/settings#sync=${key}`, { waitUntil: 'networkidle0' });
await pb.waitForSelector('dialog[open]');
await shot(pb, '61-sync-b-join');
const prefilled = await pb.$eval('dialog[open] textarea', (e) => e.value);
console.log('B vorausgefüllt gleich:', prefilled === code);
await pb.click('dialog[open] .btn-primary');
await sleep(4000);
await pb.goto(`${BASE}/sets`, { waitUntil: 'networkidle0' });
await sleep(500);
const tilesB = await pb.$$eval('.set-tile', (els) => els.map((e) => e.textContent));
console.log('Sets auf B:', tilesB);
await shot(pb, '62-sync-b-sets');

// Gerät B lernt ein paar Karteikarten
const setHref = await pb.$eval('.set-tile', (e) => e.getAttribute('href'));
const setId = setHref.split('/').pop();
await pb.goto(`${BASE}/study/${setId}/flashcards`, { waitUntil: 'load' });
await pb.waitForSelector('.start-bar');
await pb.click('.start-bar .btn-primary');
await pb.waitForSelector('.flashcard');
for (let i = 0; i < 3; i++) {
  await pb.tap('.flashcard');
  await sleep(300);
  await pb.click('.rate-btn.known');
  await sleep(300);
}
// B gleicht ab
await pb.goto(`${BASE}/settings`, { waitUntil: 'load' });
await sleep(300);
await clickText(pb, 'Jetzt abgleichen');
await sleep(3000);

// A gleicht ab und sieht den Lernstand
await pa.goto(`${BASE}/settings`, { waitUntil: 'load' });
await sleep(800);
await clickText(pa, 'Jetzt abgleichen');
await sleep(3000);
await pa.goto(`${BASE}/stats`, { waitUntil: 'load' });
await sleep(500);
const kpi = await pa.$$eval('.kpi', (els) => els.map((e) => e.textContent));
console.log('Statistik auf A nach Sync:', kpi.join(' | '));

console.log('Anfragen B:\n' + reqB.join('\n'));
console.log('Fehler:', errors.length ? errors.join('\n') : 'keine');
await a.close();
await b.close();
