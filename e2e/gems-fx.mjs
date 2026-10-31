// Juwelen-Symbole und Bombe: Zustände (Hover, ausgewählt, Fokus, gesperrt), Explosion
// Bild für Bild, keine Layoutverschiebung, reduzierte Bewegung, Handy und dunkel.
import { BASE, launch, OUT, sleep, watch } from './lib.mjs';

const browser = await launch();
const errors = [];
const page = await browser.newPage();
watch(page, errors);
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
await page.goto(`${BASE}/`, { waitUntil: 'load' });

const setId = await page.evaluate(async () => {
  const repo = await import('/src/core/db/repo.ts');
  const set = await repo.createSet({ title: 'Bombe', frontLang: 'fr', backLang: 'de' });
  const w = ['maison', 'chat', 'chien', 'porte', 'livre', 'table', 'jardin', 'fenêtre'];
  await repo.addCards(set.id, w.map((x, i) => ({ front: `le ${x}`, back: `Wort ${i}` })));
  return set.id;
});

async function startGame() {
  await page.goto(`${BASE}/study/${setId}/gems`, { waitUntil: 'load' });
  await page.waitForSelector('.start-bar .btn-primary');
  await page.click('.start-bar .btn-primary');
  await page.waitForSelector('.gem-slot');
  await sleep(700);
  return page.url().split('/session/')[1];
}

/** Legt eine Bombe so, dass ein Tausch von 27↔35 sie in einer Reihe mit zwei gleichen zündet. */
async function rigBomb(id) {
  await page.evaluate(async (id) => {
    const { db } = await import('/src/core/db/db.ts');
    const s = await db.sessions.get(id);
    const b = s.state.board;
    const other = (c) => (c + 3) % 6;
    b[25] = { id: 90001, kind: 'normal', color: 0 };
    b[26] = { id: 90002, kind: 'bomb', color: 0 };
    b[27] = { id: 90003, kind: 'normal', color: other(0) };
    b[35] = { id: 90004, kind: 'normal', color: 0 };
    b[18] = { id: 90005, kind: 'stone', color: -1 };
    await db.sessions.update(id, { state: s.state });
  }, id);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.gem-slot');
  await sleep(700);
}

const board = () => page.$('.gems-board');
const shotBoard = async (name) => (await board()).screenshot({ path: `${OUT}/${name}.png` });

// --- Zustände ---
let id = await startGame();
await rigBomb(id);
await shotBoard('fx-01-board-light');
const slot27 = await page.$('.gem-slot[data-index="27"]');
const b27 = await slot27.boundingBox();
await page.mouse.move(b27.x + b27.width / 2, b27.y + b27.height / 2);
await sleep(250);
await shotBoard('fx-02-hover');
await page.focus('.gem-slot[data-index="10"]');
await page.keyboard.press('ArrowRight');
await sleep(150);
await shotBoard('fx-03-focus');
await page.keyboard.press('Enter');
await sleep(250);
await shotBoard('fx-04-selected-focus');
await page.keyboard.press('Escape');

// Nahaufnahme der Sonderjuwelen in der Legende (gestochen scharf bei 3×)
await page.click('.gems-legend summary');
await sleep(200);
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 4 });
await sleep(300);
await (await page.$('.gems-legend ul')).screenshot({ path: `${OUT}/fx-05-legend-4x.png` });
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
await page.click('.gems-legend summary');

// --- Explosion ---
const layout = () =>
  page.evaluate(() => {
    const r = document.querySelector('.gems-board').getBoundingClientRect();
    return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}|doc ${document.documentElement.scrollHeight}`;
  });
const before = await layout();
const scoreBefore = await page.$eval('.gems-score', (e) => e.textContent);
await (await page.$('.gem-slot[data-index="27"]')).click();
await (await page.$('.gem-slot[data-index="35"]')).click();
const frames = [];
const t0 = Date.now();
for (const at of [120, 300, 470, 560, 680, 820, 1100]) {
  while (Date.now() - t0 < at) await sleep(5);
  const info = await page.evaluate(() => ({
    charging: document.querySelectorAll('.gem-slot.charging').length,
    braced: document.querySelectorAll('.gem-slot.braced').length,
    blasted: document.querySelectorAll('.gem-slot.blasted').length,
    fx: document.querySelectorAll('.blast').length,
    score: document.querySelector('.gems-score')?.textContent,
  }));
  frames.push({ at, ...info, layout: await layout() });
  await shotBoard(`fx-10-blast-${String(at).padStart(4, '0')}`);
}
await sleep(1500);
for (const f of frames) console.log(`${f.at} ms: Aufladen ${f.charging}, Spannung ${f.braced}, Welle ${f.blasted}, Explosion ${f.fx}, Punkte ${f.score}, Layout ${f.layout === before ? 'gleich' : f.layout}`);
const final = await page.evaluate(async (id) => {
  const { db } = await import('/src/core/db/db.ts');
  const s = (await db.sessions.get(id)).state;
  return { score: s.score, stones: s.stonesBroken, moves: s.moves };
}, id);
console.log(`Punkte vorher ${scoreBefore}, Anzeige jetzt ${await page.$eval('.gems-score', (e) => e.textContent)}, gespeichert ${final.score}, Steine gesprengt ${final.stones}`);
console.log('Layout danach:', (await layout()) === before ? 'gleich' : await layout());

// --- Frage offen: gesperrtes Feld ---
const q = await page.$('.gems-question');
if (q) {
  await page.screenshot({ path: `${OUT}/fx-06-dimmed.png` });
  console.log('Feld gesperrt (inert):', await page.$eval('.gems-stage', (e) => e.inert));
}

// --- Reduzierte Bewegung ---
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
id = await startGame();
await rigBomb(id);
await (await page.$('.gem-slot[data-index="27"]')).click();
await (await page.$('.gem-slot[data-index="35"]')).click();
const red = [];
const t1 = Date.now();
for (const at of [40, 120, 220]) {
  while (Date.now() - t1 < at) await sleep(5);
  red.push(
    await page.evaluate(() => {
      const g = document.querySelector('.gem-slot.blasted .gem');
      return { fx: document.querySelectorAll('.blast').length, blasted: document.querySelectorAll('.gem-slot.blasted').length, anim: g ? getComputedStyle(g).animationName : '-' };
    }),
  );
  if (at === 120) await shotBoard('fx-20-reduced-blast');
}
console.log('Reduziert:', JSON.stringify(red));
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

// --- Handy, dunkel ---
await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 3 });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
id = await startGame();
await rigBomb(id);
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await sleep(300);
await shotBoard('fx-30-mobile-dark');
await (await page.$('.gem-slot[data-index="27"]')).click();
await (await page.$('.gem-slot[data-index="35"]')).click();
await sleep(330);
await shotBoard('fx-31-mobile-dark-blast');
await sleep(1500);
console.log('Handy: seitliches Scrollen', await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1));

console.log('Fehler:', errors.length ? errors.join('\n') : 'keine');
await browser.close();
