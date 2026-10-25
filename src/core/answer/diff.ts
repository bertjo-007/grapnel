/** Zeichenweiser Vergleich für die Anzeige: was fehlt, was zu viel ist. */
export type DiffPart = { type: 'same' | 'missing' | 'extra'; text: string };

export function charDiff(given: string, expected: string): DiffPart[] {
  const a = Array.from(given);
  const b = Array.from(expected);
  if (a.length * b.length > 40_000) return [{ type: 'extra', text: given }];
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i].toLowerCase() === b[j].toLowerCase() ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], ch: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += ch;
    else parts.push({ type, text: ch });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].toLowerCase() === b[j].toLowerCase()) {
      push('same', b[j]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('extra', a[i]);
      i++;
    } else {
      push('missing', b[j]);
      j++;
    }
  }
  while (i < n) push('extra', a[i++]);
  while (j < m) push('missing', b[j++]);
  return parts;
}
