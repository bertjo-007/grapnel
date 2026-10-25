import { describe, expect, it } from 'vitest';
import { AnswerIndex, checkAnswer, type CheckInput } from '../src/core/answer/check';
import { answerVariants, applySuffix, expandParens } from '../src/core/answer/variants';
import { charDiff } from '../src/core/answer/diff';
import { DEFAULT_SETTINGS, type AnswerSettings } from '../src/core/settings';

const base = DEFAULT_SETTINGS.answer;
const de = (given: string, answer: string, over: Partial<CheckInput> = {}, s: Partial<AnswerSettings> = {}) =>
  checkAnswer({ given, answer, lang: 'de', nativeLang: 'de', settings: { ...base, ...s }, ...over });
const fr = (given: string, answer: string, over: Partial<CheckInput> = {}, s: Partial<AnswerSettings> = {}) =>
  checkAnswer({ given, answer, lang: 'fr', nativeLang: 'de', settings: { ...base, ...s }, ...over });

describe('Varianten aus dem Kartentext', () => {
  it('trennt Synonyme an Komma und Semikolon', () => {
    const v = answerVariants('der Morgen, der Vormittag; morgens, vormittags');
    expect(v).toEqual(expect.arrayContaining(['der Morgen', 'der Vormittag', 'morgens', 'vormittags']));
  });
  it('löst optionale Klammern auf', () => {
    expect(expandParens('(aus)rechnen')).toEqual(expect.arrayContaining(['rechnen', 'ausrechnen']));
    expect(expandParens('nie(mals)')).toEqual(expect.arrayContaining(['nie', 'niemals']));
    expect(expandParens('der (Voll-)Bart')).toEqual(expect.arrayContaining(['der Bart', 'der Vollbart']));
    expect(expandParens('(immer) noch')).toEqual(expect.arrayContaining(['noch', 'immer noch']));
    expect(expandParens('(der/die) erste')).toEqual(expect.arrayContaining(['erste', 'der erste', 'die erste']));
  });
  it('kennt Endungsmuster', () => {
    expect(answerVariants('zweite(r, -s)')).toEqual(expect.arrayContaining(['zweite', 'zweiter', 'zweites']));
  });
  it('behandelt Klammern am Ende als Hinweis', () => {
    expect(answerVariants('ab (zeitlich)')).toContain('ab');
    expect(answerVariants('ab (zeitlich)')).not.toContain('ab zeitlich');
    expect(answerVariants('soixante-dix (in B und CH: septante)')).toContain('soixante-dix');
    expect(
      answerVariants("soustraire (je soustrais, ns soustrayons, ils soustraient; j'ai soustrait; je soustrairai)"),
    ).toContain('soustraire');
  });
  it('bildet Femininformen, nie das Fragment allein', () => {
    expect(applySuffix('courageux', '-euse')).toBe('courageuse');
    expect(applySuffix('mensuel', '-elle')).toBe('mensuelle');
    expect(applySuffix('définitif', '-ve')).toBe('définitive');
    expect(applySuffix('collectif', '-ive')).toBe('collective');
    expect(applySuffix('marié', '-e')).toBe('mariée');
    expect(applySuffix('absent', '-e')).toBe('absente');
    const v = answerVariants('courageux, -euse');
    expect(v).toEqual(expect.arrayContaining(['courageux', 'courageuse']));
    expect(v).not.toContain('-euse');
  });
  it('entfernt Platzhalter als zusätzliche Variante', () => {
    expect(answerVariants('mettre qc')).toContain('mettre');
    expect(answerVariants('jdm. die Hand geben')).toContain('die Hand geben');
    expect(answerVariants("avoir l'air + ADJ.")).toContain("avoir l'air");
  });
  it('ergänzt «der, die X» zu beiden Formen', () => {
    expect(answerVariants('der, die Alleinerziehende')).toEqual(
      expect.arrayContaining(['der Alleinerziehende', 'die Alleinerziehende']),
    );
    expect(answerVariants('der, die Alleinerziehende')).not.toContain('der');
  });
});

describe('Antwortprüfung', () => {
  it('ss = ß und œ = oe gelten immer', () => {
    expect(de('Strasse', 'die Straße').result).toBe('correct');
    expect(fr('la soeur', 'la sœur').result).toBe('correct');
  });
  it('ignoriert Gross/Klein und Leerraum', () => {
    expect(de('  der   MORGEN ', 'der Morgen').result).toBe('correct');
  });
  it('akzeptiert jede Synonym-Variante', () => {
    expect(de('vormittags', 'der Morgen, der Vormittag; morgens, vormittags').result).toBe('correct');
    expect(de('zweiter', 'zweite(r, -s)').result).toBe('correct');
    expect(de('rechnen', '(aus)rechnen').result).toBe('correct');
  });
  it('Artikel in der Fremdsprache: fehlend oder falsch ist falsch', () => {
    expect(fr('tante', 'la tante')).toMatchObject({ result: 'wrong', reason: 'article-missing' });
    expect(fr('le tante', 'la tante')).toMatchObject({ result: 'wrong', reason: 'article-wrong' });
    expect(fr('la tante', 'la tante').result).toBe('correct');
    expect(fr("l'été", "l'été").result).toBe('correct');
    expect(fr('l’ été', "l'été").result).toBe('correct');
  });
  it('Artikel in der Muttersprache darf fehlen', () => {
    expect(de('Tante', 'die Tante').result).toBe('correct');
    expect(de('der Tante', 'die Tante').result).toBe('wrong');
  });
  it('Akzente: ohne Toleranz falsch mit Hinweis, mit Toleranz fast richtig', () => {
    expect(fr('lete', "l'été")).toMatchObject({ result: 'wrong' });
    expect(fr('le pere', 'le père')).toMatchObject({ result: 'wrong', reason: 'accent' });
    expect(fr('le pere', 'le père', {}, { tolerateAccents: true })).toMatchObject({ result: 'almost', reason: 'accent' });
  });
  it('Tippfehler nur mit Toleranz, nie bei kurzen Wörtern', () => {
    expect(de('Fruhling', 'der Frühling, das Frühjahr').result).toBe('wrong');
    expect(de('Frühlnig', 'der Frühling', {}, { tolerateTypos: true })).toMatchObject({ result: 'almost', reason: 'typo' });
    expect(de('Frühlnig', 'der Frühling')).toMatchObject({ result: 'wrong', reason: 'typo' });
    expect(de('Haut', 'das Haus', {}, { tolerateTypos: true }).result).toBe('wrong');
  });
  it('Tippfehler-Toleranz greift nicht, wenn die Eingabe eine andere Karte ist', () => {
    const idx = new AnswerIndex(
      [
        { id: 'a', text: 'die Tante' },
        { id: 'b', text: 'die Tanne' },
      ],
      base,
      'de',
    );
    const r = de('Tanne', 'die Tante', { isOtherAnswer: (p) => idx.belongsToOther(p, new Set(['a'])) }, { tolerateTypos: true });
    expect(r.result).toBe('wrong');
  });
  it('strenger Modus verlangt die exakte Schreibweise', () => {
    expect(de('morgen', 'der Morgen', {}, { strict: true }).result).toBe('wrong');
    expect(de('der Morgen', 'der Morgen', {}, { strict: true }).result).toBe('correct');
  });
  it('Geschwisterkarte mit gleicher Frage zählt als richtig', () => {
    const r = de('wenn', 'wann', { siblings: [{ answer: 'wenn, als' }] });
    expect(r).toMatchObject({ result: 'correct', reason: 'sibling' });
  });
  it('leere Eingabe ist unbeantwortet', () => {
    expect(de('  ', 'der Morgen').result).toBe('skipped');
  });
  it('akzeptiert Femininform und Maskulinform', () => {
    expect(fr('courageuse', 'courageux, -euse').result).toBe('correct');
    expect(fr('courageux', 'courageux, -euse').result).toBe('correct');
  });
});

describe('Abweichung anzeigen', () => {
  it('markiert fehlende Buchstaben', () => {
    const parts = charDiff('Frhling', 'Frühling');
    expect(parts.some((p) => p.type === 'missing' && p.text === 'ü')).toBe(true);
  });
});
