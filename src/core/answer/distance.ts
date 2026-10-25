/**
 * Damerau-Levenshtein (Variante «optimal string alignment»): Einfügen, Löschen,
 * Ersetzen und Vertauschen zweier Nachbarbuchstaben kosten je 1.
 * Bricht ab, sobald das Limit sicher überschritten ist.
 */
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0;
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > limit) return limit + 1;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev2 = new Array<number>(m + 1).fill(0);
  let prev = new Array<number>(m + 1);
  let cur = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return limit + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[m];
}

/** Erlaubte Tippfehler je nach Länge der erwarteten Antwort. */
export function typoAllowance(expectedLength: number): number {
  if (expectedLength < 5) return 0;
  if (expectedLength < 10) return 1;
  return 2;
}
