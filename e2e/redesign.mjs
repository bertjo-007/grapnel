// Redesign-Durchgang: jede Seite, jeder Modus und die wichtigsten Dialoge als Bild, auf dem
// Computer und dem Handy, dunkel und hell. Prüft nebenbei seitliches Scrollen und Konsolenfehler.
import { BASE, launch, noHorizontalScroll, OUT, sleep, watch } from './lib.mjs';

const browser = await launch();
const errors = [];
const page = await browser.newPage();
watch(page, errors);
const overflow = [];

async function seed() {
  return page.evaluate(async () => {
    const repo = await import('/src/core/db/repo.ts');
    const words = [
      ['la maison', 'das Haus'], ['le chat', 'die Katze'], ['le chien', 'der Hund'], ['la porte', 'die Tür'],
      ['le livre', 'das Buch'], ['la table', 'der Tisch'], ['le jardin', 'der Garten'], ['la fenêtre', 'das Fenster'],
    ];
    const a = await repo.createSet({ title: 'Französisch Kapitel 1', description: 'Grundwortschatz, Haus und Tiere', frontLang: 'fr', backLang: 'de' });
    const cards = await repo.addCards(a.id, words.map(([front, back]) => ({ front, back, tags: ['1.1 Zuhause'] })));
    const b = await repo.createSet({ title: 'Freizeit', frontLang: 'fr', backLang: 'de' });
    await repo.addCards(b.id, [['la fête', 'das Fest'], ['le sport', 'der Sport'], ['le cadeau', 'das Geschenk'], ['offrir', 'schenken'], ['la musique', 'die Musik'], ['le film', 'der Film']].map(([front, back]) => ({ front, back })));
    const settings = await repo.getSettings();
    const day = 86400000;
    for (let i = 0; i < cards.length; i++)
      for (let d = 6; d >= 0; d -= 2)
        await repo.recordAnswer({ card: cards[i], direction: 'f2b', sessionId: null, mode: 'write', task: 'write', result: (i + d) % 4 ? 'correct' : 'wrong', rating: (i + d) % 4 ? 3 : 1, at: Date.now() - d * day - i * 60000 }, settings);
    return a.id;
  });
}

async function shot(name, { full = false } = {}) {
  await sleep(450);
  if (!(await noHorizontalScroll(page))) overflow.push(name);
  await page.screenshot({ path: `${OUT}/rd-${name}.png`, fullPage: full });
}

async function startSession(setId, mode) {
  await page.goto(`${BASE}/study/${setId}/${mode}`, { waitUntil: 'load' });
  await page.waitForSelector('.start-bar .btn-primary');
  await page.click('.start-bar .btn-primary');
  await sleep(700);
}

async function tour(prefix, setId) {
  // Startseite, Übersicht, Set, Editor, Import
  for (const [name, path] of [['home', '/'], ['sets', '/sets'], ['set', `/sets/${setId}`], ['editor', `/sets/${setId}/edit`], ['import', '/import'], ['review', '/review'], ['stats', '/stats'], ['settings', '/settings'], ['newset', '/sets/new'], ['setup', `/study/${setId}/learn`]]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
    await page.waitForSelector('h1');
    await shot(`${prefix}-${name}`);
  }
  // Dialoge und Menü auf der Set-Seite
  await page.goto(`${BASE}/sets/${setId}`, { waitUntil: 'load' });
  await page.waitForSelector('.card-row');
  await (await page.$('.card-row')).click();
  await page.waitForSelector('dialog[open]');
  await shot(`${prefix}-dialog-card`);
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.click('button[aria-label="Mehr"]');
  await sleep(250);
  await shot(`${prefix}-menu`);
  await page.keyboard.press('Escape');
  // Lernmodi
  await startSession(setId, 'learn');
  await shot(`${prefix}-learn`);
  await page.keyboard.press('Escape');
  await sleep(300);
  await shot(`${prefix}-pause`);
  await startSession(setId, 'flashcards');
  await shot(`${prefix}-flash-front`);
  await page.keyboard.press(' ');
  await sleep(700);
  await shot(`${prefix}-flash-back`);
  await startSession(setId, 'write');
  await page.type('.answer-input', 'xyz');
  await page.keyboard.press('Enter');
  await sleep(500);
  await shot(`${prefix}-write-feedback`);
  await startSession(setId, 'mc');
  await shot(`${prefix}-mc`);
  await startSession(setId, 'test');
  await shot(`${prefix}-test`);
  await startSession(setId, 'match');
  await shot(`${prefix}-match`);
  await startSession(setId, 'gems');
  await shot(`${prefix}-gems`);
}

// Ladebild: App-Code zurückhalten, damit nur das statische Ladebild steht.
await page.setRequestInterception(true);
page.on('request', (r) => (r.url().includes('/src/main.tsx') && globalThis.__blockMain ? r.abort() : r.continue()));
globalThis.__blockMain = true;
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await sleep(400);
await page.screenshot({ path: `${OUT}/rd-boot.png` });
globalThis.__blockMain = false;

await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForSelector('h1');
await shot('d-home-empty');
const setId = await seed();

await tour('d', setId);

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await tour('m', setId);

// Hell
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
await page.evaluate(async () => {
  const repo = await import('/src/core/db/repo.ts');
  await repo.saveSettings({ theme: 'light' });
});
for (const [name, path] of [['home', '/'], ['set', `/sets/${setId}`], ['settings', '/settings']]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
  await page.waitForSelector('h1');
  await shot(`l-${name}`);
}
await startSession(setId, 'flashcards');
await shot('l-flash');

console.log('Seitlich zu breit:', overflow.length ? overflow.join(', ') : 'nirgends');
console.log('Fehler:', errors.filter((e) => !e.includes('main.tsx') && !e.includes('ERR_FAILED')).join('\n') || 'keine');
await browser.close();
