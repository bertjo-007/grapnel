// Juwelen: Einrichtung, Tauschen mit Maus, Wischen und Tastatur, Fragen, Spielende,
// zu wenige Karten, Handy und Dunkelmodus.
import { BASE, launch, noHorizontalScroll, shot, sleep, watch } from './lib.mjs';

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
  ['la table', 'der Tisch'],
  ['la fenêtre', 'das Fenster'],
  ['le jardin', 'der Garten'],
];
const makeSet = (title, words) =>
  page.evaluate(
    async (title, words) => {
      const repo = await import('/src/core/db/repo.ts');
      const set = await repo.createSet({ title, frontLang: 'fr', backLang: 'de' });
      await repo.addCards(set.id, words.map(([front, back]) => ({ front, back })));
      return set.id;
    },
    title,
    words,
  );

// Zu wenige Karten
const small = await makeSet('Klein', WORDS.slice(0, 4));
await page.goto(`${BASE}/study/${small}/gems`, { waitUntil: 'load' });
await page.waitForSelector('.callout.warning, .start-bar');
console.log('4 Karten:', await page.$eval('.callout.warning', (e) => e.textContent).catch(() => 'kein Hinweis!'));

const setId = await makeSet('Juwelen-Test', WORDS);
await page.goto(`${BASE}/sets/${setId}`, { waitUntil: 'load' });
await page.waitForSelector('.mode-grid');
console.log('Kachel:', await page.$$eval('.mode-tile', (els) => els.map((e) => e.textContent).find((x) => x?.startsWith('Juwelen'))));
await page.goto(`${BASE}/study/${setId}/gems`, { waitUntil: 'load' });
await page.waitForSelector('.start-bar .btn-primary');
await shot(page, 'gems-01-setup');
await page.click('.start-bar .btn-primary');
await page.waitForSelector('.gems-board .gem-slot');
await sleep(500);
console.log('Juwelen auf dem Feld:', await page.$$eval('.gem-slot', (e) => e.length));
await shot(page, 'gems-02-board');

const sessionId = page.url().split('/session/')[1];
const game = () =>
  page.evaluate(async (id) => {
    const { db } = await import('/src/core/db/db.ts');
    const g = await import('/src/core/session/gems.ts');
    const s = (await db.sessions.get(id)).state;
    return { moves: s.moves, score: s.score, done: s.done, current: s.current, move: g.findMove(s.board, s.size), size: s.size };
  }, sessionId);
const slot = (i) => page.$(`.gem-slot[data-index="${i}"]`);
const settle = async () => {
  for (let k = 0; k < 40; k++) {
    await sleep(150);
    const busy = await page.evaluate(() => !!document.querySelector('.gem-slot.pop'));
    if (!busy) break;
  }
  await sleep(1200);
};

/** Offene Fragen beantworten: richtig, wenn right, sonst falsch. */
async function answerQuestions(right) {
  for (let k = 0; k < 8; k++) {
    if (!(await page.$('.gems-question'))) return;
    // Schon beantwortet (Rückmeldung oder automatisches Weiter): warten, bis die Frage weg ist.
    if (!(await page.$('.gems-question .options .option:not([aria-disabled="true"]), .gems-question .answer-input:not([disabled])'))) {
      const next = await page.$('.gems-question .feedback .btn-primary');
      if (next) await next.click();
      await sleep(600);
      continue;
    }
    const prompt = await page.$eval('.gems-question .prompt-text', (e) => e.textContent);
    const pair = WORDS.find(([f, b]) => f === prompt || b === prompt);
    const solution = pair[0] === prompt ? pair[1] : pair[0];
    if (await page.$('.gems-question .options .option')) {
      const opts = await page.$$('.gems-question .options .option');
      let clicked = false;
      for (const o of opts) {
        const text = await o.evaluate((e) => e.textContent ?? '');
        if (text.includes(solution) === right) {
          await o.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) await opts[0].click();
    } else {
      await page.type('.gems-question .answer-input', right ? solution : 'xyz');
      await page.keyboard.press('Enter');
    }
    await sleep(1300);
    const next = await page.$('.gems-question .feedback .btn-primary');
    if (next) await next.click();
    await sleep(500);
  }
}

// 1) Tippen, tippen
let g = await game();
const before = g;
await (await slot(g.move[0])).click();
await sleep(150);
await (await slot(g.move[1])).click();
await settle();
g = await game();
console.log(`Tippen: Züge ${before.moves} → ${g.moves}, Punkte ${before.score} → ${g.score}, Frage: ${!!g.current}`);
await shot(page, 'gems-03-after-tap');
if (g.current) {
  await shot(page, 'gems-04-question');
  await answerQuestions(true);
  console.log('Nach richtiger Antwort, Züge:', (await game()).moves);
}

// 2) Ungültiger Tausch kostet nichts
g = await game();
const invalid = await page.evaluate(async (id) => {
  const { db } = await import('/src/core/db/db.ts');
  const gm = await import('/src/core/session/gems.ts');
  const s = (await db.sessions.get(id)).state;
  for (let i = 0; i < s.board.length - 1; i++) {
    if ((i + 1) % s.size === 0) continue;
    const b = s.board.slice();
    [b[i], b[i + 1]] = [b[i + 1], b[i]];
    if (s.board[i].kind !== 'stone' && s.board[i + 1].kind !== 'stone' && !gm.findRuns(b, s.size).length) return [i, i + 1];
  }
  return null;
}, sessionId);
await (await slot(invalid[0])).click();
await (await slot(invalid[1])).click();
await sleep(600);
console.log('Ungültiger Tausch: Züge vorher', g.moves, 'nachher', (await game()).moves);

// 3) Wischen
g = await game();
{
  const [a, b] = g.move;
  const ba = await (await slot(a)).boundingBox();
  const bb = await (await slot(b)).boundingBox();
  await page.mouse.move(ba.x + ba.width / 2, ba.y + ba.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 6 });
  await page.mouse.up();
  await settle();
  console.log('Wischen: Züge', g.moves, '→', (await game()).moves);
  await answerQuestions(true);
}

// 4) Tastatur
g = await game();
{
  const [a, b] = g.move;
  await page.focus(`.gem-slot[data-index="${a}"]`);
  await page.keyboard.press('Enter');
  const key = b === a + 1 ? 'ArrowRight' : b === a - 1 ? 'ArrowLeft' : b > a ? 'ArrowDown' : 'ArrowUp';
  await page.keyboard.press(key);
  await settle();
  console.log('Tastatur: Züge', g.moves, '→', (await game()).moves, '| Fokus im Feld:', await page.evaluate(() => !!document.activeElement?.closest('.gems-board')));
  await answerQuestions(false);
}

// 5) Neu laden mitten im Spiel: Stand bleibt
g = await game();
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.gems-board .gem-slot, .gems-question');
await sleep(600);
const after = await game();
console.log('Neu geladen: Züge', g.moves, '=', after.moves, 'Punkte', g.score, '=', after.score);
await answerQuestions(false);

// 6) Bis zum Ende spielen, Fragen falsch beantworten
for (let k = 0; k < 80; k++) {
  if (await page.$('.summary')) break;
  await answerQuestions(false);
  g = await game();
  if (g.done || !g.move) break;
  await (await slot(g.move[0])).click();
  await (await slot(g.move[1])).click();
  await settle();
}
await page.waitForSelector('.summary', { timeout: 10000 });
console.log('Ende:', (await page.$eval('.summary', (e) => e.textContent))?.replace(/\s+/g, ' ').slice(0, 220));
await shot(page, 'gems-05-end');

// 7) Handy, dunkel
await page.setViewport({ width: 375, height: 812 });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await page.click('.summary-actions .btn-primary, .summary .btn-primary').catch(() => {});
await page.waitForSelector('.gems-board .gem-slot');
await sleep(800);
console.log('Nochmals: Züge', (await game()).moves, '| Handy ohne seitliches Scrollen:', await noHorizontalScroll(page));
await shot(page, 'gems-06-mobile-dark');
const box = await (await page.$('.gems-board')).boundingBox();
console.log('Feld Handy:', Math.round(box.width), '×', Math.round(box.height), 'Zelle', Math.round(box.width / 8), 'px');

console.log('Fehler:', errors.length ? errors.join('\n') : 'keine');
await browser.close();
