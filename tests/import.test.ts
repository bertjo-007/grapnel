import { existsSync, readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { detectStructure } from '../src/core/import/detect';
import { extractDocx, parseDocumentXml } from '../src/core/import/extract/docx';
import { groupTextItems } from '../src/core/import/extract/pdf';
import { decodeText, extractCsv, extractLines } from '../src/core/import/extract/text';
import { extractXlsx } from '../src/core/import/extract/xlsx';
import { guessLangs } from '../src/core/import/lang';
import { guessAlternatingLangs } from '../src/core/import/pair';
import { annotateRows, buildRows, summarize } from '../src/core/import/rows';
import type { Extracted } from '../src/core/import/types';

const FIXTURE = 'public/startsets/franzoesischwoerter.docx';

function pipeline(ex: Extracted, langs?: { front: 'fr' | 'de'; back: 'fr' | 'de' }) {
  const st = detectStructure(ex);
  const content = ex.blocks.filter((b) => b.text.trim());
  const guessed =
    langs ??
    (st.kind === 'alternating'
      ? guessAlternatingLangs(ex.blocks)
      : guessLangs(content.filter((_, i) => i % 2 === 0).map((b) => b.text), content.filter((_, i) => i % 2 === 1).map((b) => b.text)));
  const rows = annotateRows(buildRows(ex, st, guessed), 'new');
  return { st, rows, sum: summarize(rows), langs: guessed };
}

describe.skipIf(!existsSync(FIXTURE))('Joshuas Französischwörter.docx', () => {
  it('erkennt 726 Paare, 3 fremde Zeilen und 130 Duplikate', async () => {
    const ex = await extractDocx(readFileSync(FIXTURE), 'Französischwörter.docx');
    expect(ex.blocks.filter((b) => b.text.trim()).length).toBe(1455);
    const { st, rows, sum, langs } = pipeline(ex);
    expect(st.kind).toBe('alternating');
    expect(langs).toEqual({ front: 'fr', back: 'de' });
    expect(sum.recognized).toBe(726);
    expect(sum.unassigned).toBe(3);
    expect(sum.duplicates).toBe(130);
    expect(sum.selected).toBe(596);
    expect(sum.incomplete).toBe(0);

    const unassigned = rows.filter((r) => r.unassigned).map((r) => r.front);
    expect(unassigned).toEqual(['Noch nicht gelernt (275)', 'Diese Begriffe hast du noch nicht gelernt!', 'Diese 275 auswählen']);

    const entries = rows.filter((r) => !r.unassigned);
    expect(entries[0]).toMatchObject({ front: 'zéro', back: 'null' });
    expect(entries[264]).toMatchObject({ front: "l'enfant", back: 'das Kind' });
    expect(entries[265]).toMatchObject({ front: 'le garçon', back: 'der Junge' });
    expect(entries.at(-1)).toMatchObject({ front: 'la poche', back: 'die Tasche' });
    // Texte unverändert übernommen.
    expect(entries.find((r) => r.front === 'la sœur')?.back).toBe('die Schwester');
    expect(entries.find((r) => r.front === "l'été")?.back).toBe('der Sommer');
    expect(entries.some((r) => r.front === 'quatre-vingt-dix (in B und CH: nonante)' && r.back === 'neunzig')).toBe(true);
    expect(entries.some((r) => r.front === 'douxième')).toBe(true);
    // Keine Paarung wurde als unsicher markiert, bei der die Sprachen vertauscht sind.
    expect(entries.filter((r) => r.uncertain).map((r) => `${r.front} | ${r.back}`)).toEqual([]);
  });
});

describe('Struktur-Erkennung', () => {
  it('erkennt einfache Listen mit Semikolon', () => {
    const ex = extractLines('house;Haus\napple;Apfel\nto learn;lernen', 'x.txt', 'paste');
    const { st, rows, sum } = pipeline(ex, { front: 'fr', back: 'de' });
    expect(st).toEqual({ kind: 'delimited', delimiter: ';' });
    expect(sum.selected).toBe(3);
    expect(rows[2]).toMatchObject({ front: 'to learn', back: 'lernen' });
  });
  it('markiert mehrdeutige Zeilen bei weichen Trennzeichen', () => {
    const ex = extractLines('un;eins; eine, ein\nchat;Katze\nchien;Hund', 'x.txt', 'paste');
    const { rows } = pipeline(ex, { front: 'fr', back: 'de' });
    expect(rows[0]).toMatchObject({ front: 'un', back: 'eins; eine, ein', uncertain: true });
    expect(rows[0].statuses).toContain('uncertain');
  });
  it('überspringt eine Überschrift mitten in abwechselnden Zeilen', () => {
    const lines = ['la maison', 'das Haus', 'le chien', 'der Hund', 'Kapitel 2: Familie', 'la mère', 'die Mutter', 'le père', 'der Vater'];
    const ex = extractLines(lines.join('\n'), 'x.txt');
    ex.blocks[4].bold = true;
    const { rows } = pipeline(ex, { front: 'fr', back: 'de' });
    expect(rows.filter((r) => !r.unassigned).map((r) => r.front)).toEqual(['la maison', 'le chien', 'la mère', 'le père']);
    expect(rows.find((r) => r.unassigned)?.front).toBe('Kapitel 2: Familie');
  });
  it('markiert unvollständige Einträge statt sie zu verwerfen', () => {
    const ex = extractLines('a;1\nb;\nc;3', 'x.txt', 'paste');
    const { rows, sum } = pipeline(ex, { front: 'fr', back: 'de' });
    expect(rows).toHaveLength(3);
    expect(rows[1].statuses).toContain('incomplete');
    expect(rows[1].selected).toBe(false);
    expect(sum.incomplete).toBe(1);
  });
  it('liest CSV mit Kopfzeile und Anführungszeichen', () => {
    const csv = 'front,back,example,tags\n"la maison","das Haus","C\'est ma maison, ici.",Wohnen|Alltag\n"le ""chat""","die Katze\nzweite Zeile",,\n';
    const ex = extractCsv(csv, 'x.csv');
    const { st, rows } = pipeline(ex, { front: 'fr', back: 'de' });
    expect(st.kind).toBe('columns');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ front: 'la maison', back: 'das Haus', example: "C'est ma maison, ici.", tags: ['Wohnen', 'Alltag'] });
    expect(rows[1]).toMatchObject({ front: 'le "chat"', back: 'die Katze\nzweite Zeile' });
  });
  it('liest Windows-1252 und UTF-8 mit BOM', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x63, 0x61, 0x66, 0xc3, 0xa9]))).toBe('café');
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe('café');
  });
});

describe('Office-Dateien', () => {
  it('liest DOCX-Tabellen als Spalten', () => {
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>Titel</w:t></w:r></w:p><w:tbl>' +
      '<w:tr><w:tc><w:p><w:r><w:t>Vorderseite</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rückseite</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>le chat</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>die Katze &amp; Co</w:t></w:r></w:p></w:tc></w:tr>' +
      '</w:tbl></w:body></w:document>';
    const blocks = parseDocumentXml(xml);
    expect(blocks).toHaveLength(3);
    const { rows } = pipeline({ format: 'docx', fileName: 'x', unit: 'paragraph', blocks, warnings: [] }, { front: 'fr', back: 'de' });
    expect(rows.filter((r) => !r.unassigned)).toEqual([expect.objectContaining({ front: 'le chat', back: 'die Katze & Co' })]);
  });
  it('liest XLSX mit gemeinsamen Zeichenketten', async () => {
    const zip = new JSZip();
    zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Wörter" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/sharedStrings.xml', '<sst><si><t>l\'été</t></si><si><r><t>der </t></r><r><t>Sommer</t></r></si></sst>');
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="B2" t="inlineStr"><is><t>nur hinten</t></is></c></row></sheetData></worksheet>');
    const ex = await extractXlsx(await zip.generateAsync({ type: 'uint8array' }), 'x.xlsx');
    expect(ex.blocks[0].cells).toEqual(["l'été", 'der Sommer']);
    expect(ex.blocks[1].cells).toEqual(['', 'nur hinten']);
  });
  it('gruppiert PDF-Textstücke zu Zeilen und Spalten', () => {
    const blocks = groupTextItems(
      [
        { str: 'la maison', x: 50, y: 700, w: 60, h: 12 },
        { str: 'das Haus', x: 250, y: 700.5, w: 50, h: 12 },
        { str: 'le chien', x: 50, y: 680, w: 50, h: 12 },
        { str: 'der Hund', x: 250, y: 680, w: 50, h: 12 },
      ],
      1,
    );
    expect(blocks.map((b) => b.cells)).toEqual([
      ['la maison', 'das Haus'],
      ['le chien', 'der Hund'],
    ]);
  });
});
