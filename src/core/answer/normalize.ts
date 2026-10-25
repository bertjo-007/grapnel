/**
 * Vereinheitlichung von Texten vor dem Vergleich. Was hier passiert, gilt immer
 * (auch im strengen Modus), weil es Tastatur-Unterschiede ausgleicht und keine Fehler:
 * typografische Apostrophe, geschützte Leerzeichen, ß = ss (Schweizer Schreibweise),
 * œ = oe und æ = ae (auf Schweizer Tastaturen kaum tippbar).
 */

const APOSTROPHES = /[’‘ʼ`´′]/g;
const QUOTES = /[«»“”„‟]/g;
const DASHES = /[‐‑‒–—−]/g;

/** Unicode, Apostrophe, Bindestriche und Leerraum vereinheitlichen. Ändert keine Buchstaben. */
export function cleanText(s: string): string {
  return s
    .normalize('NFC')
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '"')
    .replace(DASHES, '-')
    .replace(/[  \t]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(\p{L})' +(?=\p{L})/gu, "$1'")
    .trim();
}

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
}

export interface FoldOptions {
  ignoreCase: boolean;
  accents: boolean; // true = Akzente behalten
  strict: boolean;
}

/** Vergleichsform eines Textes. */
export function fold(s: string, o: FoldOptions): string {
  let t = cleanText(s);
  if (!o.strict) t = t.replace(/^[\s.,;:!?¿¡"]+|[\s.,;:!?"]+$/g, '');
  t = t.replace(/ß/g, 'ss').replace(/ẞ/g, 'SS').replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE');
  if (o.ignoreCase && !o.strict) t = t.toLowerCase();
  if (!o.accents) t = stripAccents(t);
  return t;
}

/** Lockerste Form: für Duplikat-Erkennung und Schlüssel. */
export function looseKey(s: string): string {
  return fold(s, { ignoreCase: true, accents: true, strict: false });
}
