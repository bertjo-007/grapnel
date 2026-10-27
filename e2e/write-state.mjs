// Schreiben verändert den Lernstand: nach einer Runde in jeder Richtung muss die Set-Seite
// (und die Übersicht) die gelernten Karten zeigen.
import { BASE, launch, shot, sleep, watch } from './lib.mjs';

const browser = await launch();
const errors = [];
const page = await browser.newPage();
watch(page, errors);
await page.setViewport({ width: 1280, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: 'load' });

const WORDS = [
  ['la maison', 'das Haus'],
  ['le chat', 'die Katze'],
  ['le chien', 'der Hund'],
  ['la porte', 'die Tür'],
  ['le livre', 'das Buch'],
];

async function makeSet(title) {
  return page.evaluate(
    async (title, words) => {
      const repo = await import('/src/core/db/repo.ts');
      const set = await repo.createSet({ title, frontLang: 'fr', backLang: 'de' });
      await repo.addCards(set.id, words.map(([front, back]) => ({ front, back })));
      return set.id;
    },
    title,
    WORDS,
  );
}

/** Eine Schreiben-Sitzung, alle Antworten richtig. */
async function writeAll(setId, dir) {
  await page.goto(`${BASE}/study/${setId}/write?dir=${dir}`, { waitUntil: 'load' });
  await page.waitForSelector('.start-bar .btn-primary');
  await page.click('.start-bar .btn-primary');
  for (let i = 0; i < 20; i++) {
    await page.waitForSelector('.task, .summary', { timeout: 8000 });
    if (await page.$('.summary')) break;
    await page.waitForSelector('.answer-input');
    const prompt = await page.$eval('.prompt-text', (e) => e.textContent);
    const pair = WORDS.find(([f, b]) => f === prompt || b === prompt);
    await page.type('.answer-input', pair[0] === prompt ? pair[1] : pair[0]);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.feedback', { timeout: 4000 });
    await page.keyboard.press('Enter');
    await sleep(150);
  }
}

async function report(setId, label) {
  const db = await page.evaluate(async (setId) => {
    const { db } = await import('/src/core/db/db.ts');
    const states = await db.cardStates.where('setId').equals(setId).toArray();
    const by = {};
    for (const s of states) by[s.direction] = (by[s.direction] ?? 0) + (s.fsrs.state !== 0 ? 1 : 0);
    return by;
  }, setId);
  await page.goto(`${BASE}/sets/${setId}`, { waitUntil: 'load' });
  await page.waitForSelector('.legend');
  await sleep(400);
  const legend = await page.$eval('.legend', (e) => e.textContent?.replace(/\s+/g, ' '));
  await page.goto(`${BASE}/sets`, { waitUntil: 'load' });
  await page.waitForSelector('.set-tile');
  await sleep(400);
  const bar = await page.$$eval('.set-tile', (els, id) => els.find((e) => e.getAttribute('href')?.endsWith(id))?.querySelector('.statusbar')?.getAttribute('aria-label'), setId);
  console.log(`${label}: DB gelernt je Richtung ${JSON.stringify(db)} | Set-Seite: ${legend} | Übersicht: ${bar}`);
}

const a = await makeSet('Test FR→DE');
await writeAll(a, 'f2b');
await report(a, 'Schreiben FR→DE');

const b = await makeSet('Test DE→FR');
await writeAll(b, 'b2f');
await report(b, 'Schreiben DE→FR');
await page.goto(`${BASE}/sets/${b}`, { waitUntil: 'load' });
await sleep(600);
await shot(page, 'write-state');

console.log('Fehler:', errors.length ? errors.join('\n') : 'keine');
await browser.close();
