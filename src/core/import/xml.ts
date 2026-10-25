/** Kleine Helfer zum Lesen von Office-XML ohne DOM (läuft auch in Tests unter Node). */

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) => {
    switch (e) {
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'amp':
        return '&';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    }
  });
}

/** Attribute eines Start-Tags als Objekt (Namensraum-Präfixe bleiben erhalten). */
export function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeXml(m[2]);
  return out;
}

/**
 * Findet Elemente auf oberster Ebene, auch wenn sie verschachtelt vorkommen (Tabellen in
 * Tabellen). Gibt Start- und Endposition jedes äussersten Elements zurück.
 */
export function topLevelElements(xml: string, tag: string): { start: number; end: number }[] {
  const open = new RegExp(`<${tag}(?=[\\s>])`, 'g');
  const close = `</${tag}>`;
  const out: { start: number; end: number }[] = [];
  let pos = 0;
  while (true) {
    open.lastIndex = pos;
    const m = open.exec(xml);
    if (!m) break;
    let depth = 1;
    let i = m.index + m[0].length;
    while (depth > 0) {
      open.lastIndex = i;
      const nextOpen = open.exec(xml);
      const nextClose = xml.indexOf(close, i);
      if (nextClose < 0) return out;
      if (nextOpen && nextOpen.index < nextClose) {
        depth++;
        i = nextOpen.index + nextOpen[0].length;
      } else {
        depth--;
        i = nextClose + close.length;
      }
    }
    out.push({ start: m.index, end: i });
    pos = i;
  }
  return out;
}
