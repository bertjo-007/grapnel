// Durchgang durch alle Modi mit Joshuas Set. Antworten werden teils richtig, teils falsch gegeben.
import { BASE, clickText, launch, noHorizontalScroll, shot, sleep, watch } from './lib.mjs';

const FIXTURE = 'public/startsets/franzoesischwoerter.docx';
const browser = await launch();
const errors = [];
const page = await browser.newPage();
watch(page, errors);
await page.setViewport({ width: 1440, height: 900 });
const log = (...a) => console.log(...a);

async function importFixture() {
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle0' });
  const input = await page.$('input[type=file]');
  await input.uploadFile(FIXTURE);
  await page.waitForSelector('.preview-row', { timeout: 20000 });
  await page.click('.commit-bar .btn-primary');
  await page.waitForSelector('.callout.success', { timeout: 20000 });
  await clickText(page, 'Lernset öffnen');
  await page.waitForSelector('.card-row');
  return page.url().split('/sets/')[1];
}

/** Antwortet auf die aktuelle Aufgabe. right = richtig antworten. */
async function answerTask(right) {
  await page.waitForSelector('.task, .round-break, .summary', { timeout: 8000 });
  if (await page.$('.round-break')) {
    await page.click('.round-break .btn-primary');
    return 'round';
  }
  if (await page.$('.summary')) return 'done';
  const type = await page.evaluate(() => {
    if (document.querySelector('.write-box input:not([disabled])')) return 'write';
    if (document.querySelector('.tf')) return 'tf';
    if (document.querySelector('.options .option')) return 'mc';
    if (document.querySelector('.task .btn-primary.btn-block')) return 'flash';
    return 'unknown';
  });
  if (type === 'write') {
    // Die richtige Antwort aus der Datenbank holen geht hier nicht direkt: «Weiss ich nicht» zeigt sie.
    if (right) {
      const solution = await page.evaluate(async () => {
        const prompt = document.querySelector('.prompt-text')?.textContent ?? '';
        const db = await new Promise((res) => {
          const r = indexedDB.open('grapnel');
          r.onsuccess = () => res(r.result);
        });
        const cards = await new Promise((res) => {
          const tx = db.transaction('cards').objectStore('cards').getAll();
          tx.onsuccess = () => res(tx.result);
        });
        const c = cards.find((x) => x.front === prompt) ?? cards.find((x) => x.back === prompt);
        return c ? (c.front === prompt ? c.back : c.front) : '';
      });
      await page.type('.answer-input', solution.split(/[,;]/)[0]);
      await page.keyboard.press('Enter');
    } else {
      await page.type('.answer-input', 'xyz');
      await page.keyboard.press('Enter');
    }
    await page.waitForSelector('.feedback', { timeout: 4000 });
    const res = await page.$eval('.result-line', (e) => e.textContent);
    await page.keyboard.press('Enter');
    return `write:${res}`;
  }
  if (type === 'mc') {
    const idx = await page.evaluate((right) => {
      const prompt = document.querySelector('.prompt-text')?.textContent;
      return { prompt, right };
    }, right);
    void idx;
    await page.click('.options .option');
    await sleep(1100);
    if (await page.$('.feedback')) {
      await page.keyboard.press('Enter');
      return 'mc:falsch';
    }
    return 'mc:richtig';
  }
  if (type === 'tf') {
    await page.click('.tf .option');
    await sleep(1100);
    if (await page.$('.feedback')) {
      await page.keyboard.press('Enter');
      return 'tf:falsch';
    }
    return 'tf:richtig';
  }
  if (type === 'flash') {
    await page.click('.task .btn-primary.btn-block');
    await sleep(100);
    await page.click(right ? '.rate-btn.known' : '.rate-btn.unknown');
    return 'flash';
  }
  return type;
}

const setId = await importFixture();
log('Set importiert:', setId);
await page.evaluate(() => window.scrollTo(0, 0));
await shot(page, '10-set-top');
await page.evaluate(() => window.scrollTo(0, 700));
await sleep(200);
await shot(page, '11-set-cards');

// ---------- Lernen ----------
await page.goto(`${BASE}/study/${setId}/learn`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.start-bar');
log('Lernen-Setup:', await page.$eval('.start-bar', (e) => e.textContent));
await shot(page, '12-learn-setup');
await page.click('.start-bar .btn-primary');
await page.waitForSelector('.session');
await sleep(300);
await shot(page, '13-learn-task');
const results = [];
for (let i = 0; i < 26; i++) results.push(await answerTask(i % 4 !== 1));
log('Lernen:', results.join(', '));
await shot(page, '14-learn-later');
log('Fortschritt:', await page.$eval('.session-title', (e) => e.textContent));

// Pausieren und Weiterlernen von der Startseite
await page.keyboard.press('Escape');
await sleep(300);
await shot(page, '15-pause');
await clickText(page, 'Später fortsetzen');
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
await sleep(300);
await shot(page, '16-home-continue');
log('Startseite:', await page.$eval('.hero-card', (e) => e.textContent));

// ---------- Karteikarten ----------
await page.goto(`${BASE}/study/${setId}/flashcards`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.start-bar');
await page.click('.start-bar .btn-primary');
await page.waitForSelector('.flashcard');
await shot(page, '17-flash-front');
await page.keyboard.press(' ');
await sleep(600);
await shot(page, '18-flash-back');
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('2');
  await sleep(150);
  await page.keyboard.press(' ');
  await sleep(150);
}
await page.keyboard.press('1');
log('Karteikarten:', await page.$eval('.session-title', (e) => e.textContent));

// ---------- Schreiben ----------
await page.goto(`${BASE}/study/${setId}/write?sel=random`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.start-bar');
await page.click('.start-bar .btn-primary');
await page.waitForSelector('.answer-input');
await page.type('.answer-input', 'falsch');
await page.keyboard.press('Enter');
await page.waitForSelector('.feedback');
await shot(page, '19-write-wrong');
const hasOverride = await page.evaluate(() => [...document.querySelectorAll('.feedback button')].some((b) => b.textContent?.includes('Ich hatte recht')));
log('Schreiben: «Ich hatte recht» angeboten:', hasOverride);
await page.keyboard.press('Enter');
log('Schreiben nächste:', await answerTask(true));
await shot(page, '20-write-next');

// ---------- Test ----------
await page.goto(`${BASE}/study/${setId}/test`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.start-bar');
await clickText(page, 'Zuordnen', '.chip');
await clickText(page, 'Wahr oder falsch', '.chip');
await shot(page, '21-test-setup');
await page.click('.start-bar .btn-primary');
await page.waitForSelector('.test');
await shot(page, '22-test-q1');
// zwei Fragen beantworten, Rest offen lassen
for (let i = 0; i < 2; i++) {
  if (await page.$('.answer-input')) await page.type('.answer-input', 'irgendwas');
  else if (await page.$('.options .option')) await page.click('.options .option');
  await clickText(page, 'Weiter', '.test-footer button');
  await sleep(150);
}
await clickText(page, 'Abgeben', '.test-submit-early, .test-footer button');
await page.waitForSelector('dialog[open]');
await shot(page, '23-test-confirm');
await page.click('dialog[open] .btn-primary');
await page.waitForSelector('.score');
await shot(page, '24-test-result');
log('Test:', await page.$eval('.score', (e) => e.textContent));

// ---------- Zuordnen ----------
await page.goto(`${BASE}/study/${setId}/match?sel=random`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.start-bar');
await page.click('.start-bar .btn-primary');
await page.waitForSelector('.tiles');
await shot(page, '25-match');
const tiles = await page.$$('.tile');
await tiles[0].click();
await tiles[1].click();
await sleep(200);
await shot(page, '26-match-attempt');
log('Zuordnen:', await page.$eval('.match-head', (e) => e.textContent));

// ---------- Gemischt ----------
await page.goto(`${BASE}/study/${setId}/mixed`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.start-bar');
await page.click('.start-bar .btn-primary');
const mixed = [];
for (let i = 0; i < 8; i++) mixed.push(await answerTask(true));
log('Gemischt:', mixed.join(', '));

// ---------- Übersichten ----------
for (const [path, name] of [
  ['/', '30-home'],
  ['/sets', '31-sets'],
  ['/review', '32-review'],
  ['/stats', '33-stats'],
  ['/settings', '34-settings'],
  ['/help/srs', '35-help'],
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
  await sleep(400);
  await shot(page, name);
  if (!(await noHorizontalScroll(page))) log('Horizontal scrollbar auf', path);
}
await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle0' });
await page.evaluate(() => window.scrollTo(0, 800));
await sleep(200);
await shot(page, '33b-stats-lower');
await page.goto(`${BASE}/sets/${setId}/edit`, { waitUntil: 'networkidle0' });
await sleep(400);
await shot(page, '36-editor');

// ---------- Handy ----------
await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
for (const [path, name] of [
  ['/', '40-m-home'],
  [`/sets/${setId}`, '41-m-set'],
  ['/stats', '42-m-stats'],
  [`/sets/${setId}/edit`, '43-m-editor'],
  ['/settings', '44-m-settings'],
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
  await sleep(400);
  await shot(page, name);
  if (!(await noHorizontalScroll(page))) log('Handy: horizontal scrollbar auf', path);
}
await page.goto(`${BASE}/study/${setId}/flashcards`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.start-bar');
await page.click('.start-bar .btn-primary');
await page.waitForSelector('.flashcard');
await shot(page, '45-m-flash');
await page.tap('.flashcard');
await sleep(600);
await shot(page, '46-m-flash-back');
await page.goto(`${BASE}/study/${setId}/write?sel=random`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.start-bar');
await page.click('.start-bar .btn-primary');
await page.waitForSelector('.answer-input');
await shot(page, '47-m-write');
await page.goto(`${BASE}/study/${setId}/match`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.start-bar');
await page.click('.start-bar .btn-primary');
await page.waitForSelector('.tiles');
await shot(page, '48-m-match');
if (!(await noHorizontalScroll(page))) log('Handy: horizontal scrollbar im Zuordnen');

// ---------- Dunkel ----------
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
await sleep(300);
await shot(page, '50-m-dark-home');
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${BASE}/study/${setId}/learn`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.start-bar');
await page.click('.start-bar .btn-primary');
await page.waitForSelector('.task');
await sleep(300);
await shot(page, '51-dark-task');
await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle0' });
await sleep(300);
await shot(page, '52-dark-stats');

log('Fehler:', errors.length ? errors.join('\n') : 'keine');
await browser.close();
