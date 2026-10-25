// Editor, Kartendetails, Markierungen, Export, Sprache, alles löschen.
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE, clickText, launch, shot, sleep, watch } from './lib.mjs';

const browser = await launch();
const errors = [];
const page = await browser.newPage();
watch(page, errors);
await page.setViewport({ width: 1280, height: 900 });
const order = () => page.$$eval('.editor-row', (rows) => rows.map((r) => r.querySelector('textarea')?.value));

// Neues Set über das Formular
await page.goto(`${BASE}/sets/new`, { waitUntil: 'networkidle0' });
await page.type('#' + (await page.$eval('form input', (e) => e.id)), 'Familie');
await page.click('form button[type=submit]');
await page.waitForSelector('.editor-row textarea');
await sleep(300);
// Erste Karte tippen, mit Ctrl+Enter die nächsten
const cards = [
  ['la mère', 'die Mutter'],
  ['le père', 'der Vater'],
  ['la sœur', 'die Schwester'],
];
for (let i = 0; i < cards.length; i++) {
  const areas = await page.$$('.editor-row textarea');
  await areas[i * 2].type(cards[i][0]);
  await areas[i * 2 + 1].type(cards[i][1]);
  if (i < cards.length - 1) {
    await page.keyboard.down('Control');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Control');
    await sleep(500);
  }
}
await sleep(800);
console.log('Nach Eingabe:', await order());

// Verschieben per Knopf: dritte Karte nach oben
const rows = await page.$$('.editor-row');
await (await rows[2].$('button[aria-expanded]')).click();
await sleep(200);
await clickText(page, 'Nach oben', '.editor-details button');
await sleep(600);
console.log('Nach «Nach oben»:', await order());
await shot(page, '90-editor-details');

// Ziehen: erste Karte ans Ende
const handle = await page.$('.drag-handle');
const box = await handle.boundingBox();
const last = await page.$$('.editor-row');
const lastBox = await last[last.length - 1].boundingBox();
await page.mouse.move(box.x + 10, box.y + 10);
await page.mouse.down();
await page.mouse.move(box.x + 10, lastBox.y + lastBox.height - 5, { steps: 12 });
await sleep(300);
await page.mouse.up();
await sleep(800);
console.log('Nach Ziehen:', await order());

// Set-Seite: Markierung setzen, Kartendetails öffnen
await clickText(page, 'Fertig');
await page.waitForSelector('.card-row');
await (await page.$('.card-row .flag-btn')).click();
await sleep(300);
console.log('Markiert-Zähler:', await page.$$eval('.chip', (c) => c.map((x) => x.textContent).find((x) => x?.startsWith('Markiert'))));
await (await page.$('.card-row')).click();
await page.waitForSelector('dialog[open]');
await sleep(300);
await shot(page, '91-card-dialog');
console.log('Kartendialog:', (await page.$eval('dialog[open]', (e) => e.textContent))?.slice(0, 120));
await page.keyboard.press('Escape');
await sleep(200);

// Export CSV in ein eigenes Download-Verzeichnis
const dl = mkdtempSync(join(tmpdir(), 'grapnel-dl-'));
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
await page.click('button[aria-label="Mehr"]');
await clickText(page, 'Exportieren', '.menu button');
await page.waitForSelector('dialog[open]');
await clickText(page, 'Exportieren', 'dialog[open] .btn-primary');
await sleep(1500);
const files = readdirSync(dl);
console.log('Download:', files);
if (files[0]) console.log(readFileSync(join(dl, files[0]), 'utf8').slice(0, 200));

// Englische Oberfläche
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle0' });
await clickText(page, 'English', '.seg button');
await sleep(500);
console.log('Englisch:', await page.$eval('h1', (e) => e.textContent), '|', await page.$$eval('.nav-label', (e) => e.slice(0, 5).map((x) => x.textContent).join(', ')));
await shot(page, '92-english');
await clickText(page, 'Deutsch', '.seg button');
await sleep(400);

// Alles löschen mit Bestätigung
await clickText(page, 'Löschen', '.data-action .btn-danger');
await page.waitForSelector('dialog[open]');
const confirmBtn = await page.$('dialog[open] .btn-danger');
console.log('Löschen ohne Wort gesperrt:', await confirmBtn.evaluate((b) => b.disabled));
await page.type('dialog[open] input', 'löschen');
console.log('Nach Eintippen frei:', !(await confirmBtn.evaluate((b) => b.disabled)));
await confirmBtn.click();
await sleep(1000);
console.log('Nach Löschen:', await page.$eval('h1', (e) => e.textContent), '|', await page.$eval('.empty h3', (e) => e.textContent).catch(() => '-'));
void existsSync;

console.log('Fehler:', errors.length ? errors.join('\n') : 'keine');
await browser.close();
