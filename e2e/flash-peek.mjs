// Karteikarten: Beim Weiterblättern darf die nächste Karte nie umgedreht erscheinen.
// Ein MutationObserver hält jeden Zustand der Karte fest; ist die Karte mit dem Text der
// nächsten Vorderseite je «umgedreht», hat man deren Lösung kurz gesehen.
import { BASE, launch, sleep, watch } from './lib.mjs';

const browser = await launch();
const errors = [];
const page = await browser.newPage();
watch(page, errors);
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/`, { waitUntil: 'load' });
const setId = await page.evaluate(async () => {
  const repo = await import('/src/core/db/repo.ts');
  const set = await repo.createSet({ title: 'Blättern', frontLang: 'fr', backLang: 'de' });
  await repo.addCards(set.id, [
    { front: 'la maison', back: 'das Haus' },
    { front: 'le chat', back: 'die Katze' },
    { front: 'le chien', back: 'der Hund' },
    { front: 'la porte', back: 'die Tür' },
  ]);
  return set.id;
});
await page.goto(`${BASE}/study/${setId}/flashcards`, { waitUntil: 'load' });
await page.waitForSelector('.start-bar .btn-primary');
await page.click('.start-bar .btn-primary');
await page.waitForSelector('.flashcard');

await page.evaluate(() => {
  window.__frames = [];
  const snap = () => {
    const el = document.querySelector('.flashcard');
    if (!el) return;
    const inner = el.querySelector('.flashcard-inner');
    window.__frames.push({
      flipped: el.classList.contains('flipped'),
      // Mitten in der Rückdreh-Animation ist die Klasse schon weg, die Drehung aber noch sichtbar.
      turned: inner ? getComputedStyle(inner).transform !== 'none' && getComputedStyle(inner).transform !== 'matrix(1, 0, 0, 1, 0, 0)' : false,
      front: el.querySelector('.flashcard-face.front .flash-text')?.textContent,
    });
  };
  new MutationObserver(snap).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  const loop = () => {
    snap();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});

let peeks = 0;
for (let i = 0; i < 3; i++) {
  const front = await page.$eval('.flashcard .front .flash-text', (e) => e.textContent);
  await page.keyboard.press(' ');
  await sleep(700);
  await page.evaluate(() => (window.__frames = []));
  await page.click('.rate-btn.known');
  await sleep(900);
  const frames = await page.evaluate(() => window.__frames);
  const bad = frames.filter((f) => f.front !== front && (f.flipped || f.turned));
  console.log(`Karte ${i + 1} «${front}» → nächste: ${frames.at(-1)?.front}, Bilder ${frames.length}, Rückseite kurz sichtbar: ${bad.length}`);
  peeks += bad.length;
}
console.log('Ergebnis:', peeks === 0 ? 'nie gesehen' : `${peeks} Bilder mit Lösung`);
console.log('Fehler:', errors.length ? errors.join('\n') : 'keine');
await browser.close();
