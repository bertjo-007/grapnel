import { ArrowsLeftRight, CheckCircle, ClipboardText, FileArrowUp, Info, Scan, Warning } from '@phosphor-icons/react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { db } from '../../core/db/db';
import { commitImport, type CommitResult } from '../../core/import/commit';
import { DELIMITERS, detectStructure, detectHeader } from '../../core/import/detect';
import { ACCEPTED_FILES, extractBytes, kindOf } from '../../core/import/extract';
import { extractLines } from '../../core/import/extract/text';
import { guessLangs } from '../../core/import/lang';
import { guessAlternatingLangs } from '../../core/import/pair';
import { annotateRows, buildRows, summarize, swapSides, type ImportTarget } from '../../core/import/rows';
import type { ColumnMapping, Extracted, PreviewRow, RowStatus, Structure } from '../../core/import/types';
import type { Card, Lang } from '../../core/types';
import { Field, Segmented, Switch } from '../components';
import { useI18n, type Key } from '../i18n';
import { PageHeader } from '../shell/Shell';
import { useToast } from '../state';
import { LangSelect } from './NewSet';

type Phase = 'source' | 'reading' | 'ocr' | 'preview' | 'committing' | 'done';
type RowFilter = 'all' | 'problems' | 'selected' | 'notSelected';

const PROBLEMS: RowStatus[] = ['incomplete', 'duplicate', 'uncertain', 'unassigned', 'exists', 'changed', 'same-front'];

function defaultLangs(ex: Extracted, st: Structure, fallback: { front: Lang; back: Lang }): { front: Lang; back: Lang } {
  if (ex.langs) return ex.langs;
  if (st.kind === 'alternating') {
    const g = guessAlternatingLangs(ex.blocks);
    return { front: g.front === 'other' ? fallback.front : g.front, back: g.back === 'other' ? fallback.back : g.back };
  }
  const rows = buildRows(ex, st, fallback).filter((r) => !r.unassigned);
  const g = guessLangs(rows.map((r) => r.front), rows.map((r) => r.back));
  return { front: g.front === 'other' ? fallback.front : g.front, back: g.back === 'other' ? fallback.back : g.back };
}

function statusBadge(s: RowStatus): string {
  if (s === 'ok') return 'badge-success';
  if (s === 'duplicate' || s === 'incomplete' || s === 'unassigned') return 'badge-danger';
  if (s === 'uncertain' || s === 'changed') return 'badge-warning';
  return '';
}

export function ImportPage() {
  const { t, langName, sideName } = useI18n();
  const toast = useToast();
  const [params] = useSearchParams();
  const presetSet = params.get('set');
  const sets = useLiveQuery(() => db.sets.toArray(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('source');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ex, setEx] = useState<Extracted | null>(null);
  const [pendingFile, setPendingFile] = useState<{ file: File; data: ArrayBuffer; kind: 'image' | 'pdf' } | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [structure, setStructure] = useState<Structure>({ kind: 'alternating' });
  const [customDelim, setCustomDelim] = useState('');
  const [langs, setLangs] = useState<{ front: Lang; back: Lang }>({ front: 'fr', back: 'de' });
  const [rawRows, setRawRows] = useState<PreviewRow[]>([]);
  const [target, setTarget] = useState<ImportTarget>(presetSet ? 'append' : 'new');
  const [targetSet, setTargetSet] = useState<string>(presetSet ?? '');
  const [title, setTitle] = useState('');
  const [addUnmatched, setAddUnmatched] = useState(true);
  const [filter, setFilter] = useState<RowFilter>('all');
  const [result, setResult] = useState<(CommitResult & { total: number }) | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const ids = { paste: useId(), title: useId(), set: useId(), delim: useId() };

  const existing = useLiveQuery(
    () => (target !== 'new' && targetSet ? db.cards.where('setId').equals(targetSet).toArray() : Promise.resolve([] as Card[])),
    [target, targetSet],
  );
  const rows = useMemo(() => annotateRows(rawRows, target, existing ?? []), [rawRows, target, existing]);
  const sum = useMemo(() => summarize(rows), [rows]);

  // Struktur oder Sprachen geändert: Zeilen neu aufbauen.
  const rebuild = (e: Extracted, st: Structure, l: { front: Lang; back: Lang }) => setRawRows(buildRows(e, st, l));

  const loaded = (e: Extracted) => {
    if (e.blocks.length === 0 && !e.cards?.length) {
      setError(t('import.error.empty'));
      setPhase('source');
      return;
    }
    const st = detectStructure(e);
    const l = defaultLangs(e, st, langs);
    setEx(e);
    setStructure(st);
    setLangs(l);
    setTitle(e.title || e.fileName.replace(/\.[^.]+$/, ''));
    rebuild(e, st, l);
    setFilter('all');
    setPhase('preview');
  };

  const readFile = async (file: File) => {
    setError(null);
    const kind = kindOf(file.name, file.type);
    if (kind === 'unknown') {
      setError(t('import.error.format'));
      return;
    }
    setPhase('reading');
    try {
      const data = await file.arrayBuffer();
      if (kind === 'image') {
        setPendingFile({ file, data, kind: 'image' });
        setPhase('ocr');
        return;
      }
      const e = await extractBytes(data, file.name, file.type);
      if (e.needsOcr) {
        setPendingFile({ file, data, kind: 'pdf' });
        setPhase('ocr');
        return;
      }
      loaded(e);
    } catch {
      setError(t('import.error.read'));
      setPhase('source');
    }
  };

  const runOcr = async () => {
    if (!pendingFile) return;
    setOcrProgress(0);
    try {
      const { ocrImages } = await import('../../core/import/extract/ocr');
      let images: (HTMLCanvasElement | File)[] = [pendingFile.file];
      if (pendingFile.kind === 'pdf') {
        const { renderPdfPages } = await import('../../core/import/extract/pdf');
        images = await renderPdfPages(pendingFile.data);
      }
      const e = await ocrImages(images, [langs.front, langs.back], pendingFile.file.name, setOcrProgress);
      setPendingFile(null);
      loaded(e);
    } catch {
      setError(t('import.error.read'));
      setPhase('source');
    }
  };

  const setStructureKind = (kind: Structure['kind']) => {
    if (!ex) return;
    let st: Structure;
    if (kind === 'columns') {
      const first = ex.blocks.find((b) => b.cells && b.cells.length >= 2);
      const cols = Math.max(2, ...ex.blocks.map((b) => b.cells?.length ?? 0));
      const det = first ? detectHeader(first.cells!, cols) : { mapping: detectHeader([], cols).mapping, isHeader: false };
      st = { kind: 'columns', mapping: det.mapping, hasHeader: det.isHeader };
    } else if (kind === 'delimited') st = { kind: 'delimited', delimiter: (structure.kind === 'delimited' && structure.delimiter) || ';' };
    else st = { kind } as Structure;
    setStructure(st);
    rebuild(ex, st, langs);
  };

  const editRow = (key: string, patch: Partial<PreviewRow>) => setRawRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const selectWhere = (pred: (r: PreviewRow) => boolean, value: boolean) =>
    setRawRows((list) => {
      const visibleKeys = new Set(rows.filter(pred).map((r) => r.key));
      return list.map((r) => (visibleKeys.has(r.key) ? { ...r, selected: value, touched: true } : r));
    });

  const visible = useMemo(() => {
    switch (filter) {
      case 'problems':
        return rows.filter((r) => r.statuses.some((s) => PROBLEMS.includes(s)));
      case 'selected':
        return rows.filter((r) => r.selected);
      case 'notSelected':
        return rows.filter((r) => !r.selected);
      default:
        return rows;
    }
  }, [rows, filter]);

  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useWindowVirtualizer({ count: visible.length, estimateSize: () => 76, overscan: 10, scrollMargin: listRef.current?.offsetTop ?? 0, getItemKey: (i) => visible[i]?.key ?? i });

  useEffect(() => {
    if (presetSet && sets && !sets.some((s) => s.id === presetSet)) setTarget('new');
  }, [presetSet, sets]);

  const commit = async () => {
    if (!ex) return;
    setPhase('committing');
    try {
      const res = await commitImport({
        rows,
        target,
        setId: target === 'new' ? undefined : targetSet,
        newSet: { title: title.trim() || ex.fileName, description: '', frontLang: langs.front, backLang: langs.back },
        fileName: ex.fileName,
        format: ex.format,
        addUnmatched,
      });
      const total = await db.cards.where('setId').equals(res.setId).count();
      setResult({ ...res, total });
      setPhase('done');
    } catch {
      toast(t('common.error'), { kind: 'error' });
      setPhase('preview');
    }
  };

  const reset = () => {
    setEx(null);
    setRawRows([]);
    setResult(null);
    setPaste('');
    setPhase('source');
  };

  const sourceLabel = (r: PreviewRow) => {
    if (!ex) return r.source;
    const unit = ex.unit;
    return t(`import.source.${unit}` as Key, { n: r.source });
  };

  // ---------- Ansichten ----------

  if (phase === 'done' && result) {
    return (
      <div className="stack narrow">
        <PageHeader title={t('import.done.title')} />
        <div className={`callout ${result.ok ? 'success' : 'danger'}`}>
          {result.ok ? <CheckCircle size={20} /> : <Warning size={20} />}
          <div className="stack" style={{ gap: 4 }}>
            <strong>{t('import.done.text', { imported: result.imported, updated: result.updated })}</strong>
            <span>{t('import.done.check', { total: t('count.cards', { n: result.total }) })}</span>
            {!result.ok && <span>{t('import.done.mismatch', { expected: result.expectedNew, imported: result.imported })}</span>}
          </div>
        </div>
        <div className="row-wrap">
          <Link to={`/sets/${result.setId}`} className="btn btn-primary">
            {t('import.open')}
          </Link>
          <button className="btn" onClick={reset}>
            {t('import.another')}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'source' || phase === 'reading') {
    return (
      <div className="stack narrow">
        <PageHeader title={t('import.title')} back={presetSet ? { to: `/sets/${presetSet}`, label: t('common.back') } : undefined} />
        <div
          className={`dropzone ${dragOver ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void readFile(f);
          }}
        >
          <FileArrowUp size={32} />
          <strong>{phase === 'reading' ? t('import.reading') : t('import.drop')}</strong>
          <span className="small text-2">{t('import.formats')}</span>
          <button className="btn btn-primary" onClick={() => fileInput.current?.click()} disabled={phase === 'reading'}>
            {t('import.choose')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_FILES}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void readFile(f);
            }}
          />
        </div>
        {error && (
          <div className="callout danger" role="alert">
            <Warning size={18} />
            {error}
          </div>
        )}
        <section className="panel panel-pad stack">
          <div className="row">
            <ClipboardText size={20} />
            <h2 className="small-heading">{t('import.paste')}</h2>
          </div>
          <Field label={t('import.paste.help')} id={ids.paste}>
            <textarea id={ids.paste} className="textarea mono-input" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'house;Haus\napple;Apfel\nto learn;lernen'} />
          </Field>
          <div className="row">
            <div className="spacer" />
            <button className="btn" disabled={!paste.trim()} onClick={() => loaded(extractLines(paste, t('import.paste'), 'paste'))}>
              {t('import.paste.read')}
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (phase === 'ocr') {
    return (
      <div className="stack narrow">
        <PageHeader title={t('import.ocr.title')} />
        {pendingFile?.kind === 'pdf' && <div className="callout warning">{t('import.pdfNoText')}</div>}
        <div className="panel panel-pad stack">
          <div className="callout accent">
            <Info size={18} />
            {t('import.ocr.consent')}
          </div>
          <div className="grid-2">
            <Field label={t('editor.frontLang')}>
              <LangSelect value={langs.front} onChange={(l) => setLangs((x) => ({ ...x, front: l }))} />
            </Field>
            <Field label={t('editor.backLang')}>
              <LangSelect value={langs.back} onChange={(l) => setLangs((x) => ({ ...x, back: l }))} />
            </Field>
          </div>
          {ocrProgress > 0 && <p className="small num">{t('import.ocr.running', { p: Math.round(ocrProgress * 100) })}</p>}
          <div className="row">
            <button className="btn" onClick={reset}>
              {t('common.cancel')}
            </button>
            <div className="spacer" />
            <button className="btn btn-primary" onClick={() => void runOcr()} disabled={ocrProgress > 0}>
              <Scan size={18} />
              {t('import.ocr.start')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!ex) return null;

  const hasCells = ex.blocks.some((b) => b.cells && b.cells.length >= 2);
  const structureOptions: { value: Structure['kind']; label: string }[] =
    structure.kind === 'cards'
      ? [{ value: 'cards', label: t('import.structure.cards') }]
      : [
          { value: 'alternating', label: t('import.structure.alternating') },
          { value: 'delimited', label: t('import.structure.delimited') },
          ...(hasCells ? [{ value: 'columns' as const, label: t('import.structure.columns') }] : []),
          { value: 'blocks', label: t('import.structure.blocks') },
        ];
  const columnCount = Math.max(2, ...ex.blocks.map((b) => b.cells?.length ?? 0));
  const activeSets = (sets ?? []).filter((s) => !s.archivedAt);
  const commitDisabled = phase === 'committing' || sum.selected === 0 || (target !== 'new' && !targetSet);

  const SUMMARY: { key: keyof typeof sum; label: Key; tone?: string }[] = [
    { key: 'recognized', label: 'import.summary.recognized' },
    { key: 'selected', label: 'import.summary.selected', tone: 'badge-accent' },
    { key: 'duplicates', label: 'import.summary.duplicates', tone: 'badge-danger' },
    { key: 'incomplete', label: 'import.summary.incomplete', tone: 'badge-danger' },
    { key: 'uncertain', label: 'import.summary.uncertain', tone: 'badge-warning' },
    { key: 'unassigned', label: 'import.summary.unassigned', tone: 'badge-danger' },
    { key: 'exists', label: 'import.summary.exists' },
    { key: 'changed', label: 'import.summary.changed', tone: 'badge-warning' },
    { key: 'sameFront', label: 'import.summary.sameFront' },
  ];

  return (
    <div className="stack import-preview">
      <PageHeader title={t('import.title')} sub={ex.fileName} actions={<button className="btn" onClick={reset}>{t('common.cancel')}</button>} />

      {ex.warnings.map((w) => (
        <div key={w} className="callout warning">
          <Warning size={18} />
          {t(`import.warn.${w}` as Key)}
        </div>
      ))}

      <section className="panel panel-pad stack">
        <Field label={t('import.structure')}>
          <Segmented label={t('import.structure')} value={structure.kind} onChange={setStructureKind} options={structureOptions} />
        </Field>
        {structure.kind === 'alternating' && <p className="small text-2">{t('import.structure.alternating.help')}</p>}
        {structure.kind === 'blocks' && <p className="small text-2">{t('import.structure.blocks.help')}</p>}
        {structure.kind === 'delimited' && (
          <div className="row-wrap">
            <Segmented
              label={t('import.delimiter')}
              value={DELIMITERS.some((d) => d.value === structure.delimiter) ? structure.delimiter : 'custom'}
              onChange={(v) => {
                if (v === 'custom') return;
                const st: Structure = { kind: 'delimited', delimiter: v };
                setStructure(st);
                rebuild(ex, st, langs);
              }}
              options={[...DELIMITERS.map((d) => ({ value: d.value, label: d.label })), { value: 'custom', label: t('import.delimiter.custom') }]}
            />
            <input
              id={ids.delim}
              className="input delim-input"
              aria-label={t('import.delimiter.custom')}
              placeholder={t('import.delimiter.custom')}
              value={customDelim}
              onChange={(e) => {
                setCustomDelim(e.target.value);
                if (e.target.value) {
                  const st: Structure = { kind: 'delimited', delimiter: e.target.value };
                  setStructure(st);
                  rebuild(ex, st, langs);
                }
              }}
            />
          </div>
        )}
        {structure.kind === 'columns' && (
          <div className="stack">
            {ex.sheets && ex.sheets.length > 1 && (
              <Field label={t('import.sheet')}>
                <select
                  className="select"
                  onChange={(e) => {
                    const sheet = ex.sheets![Number(e.target.value)];
                    const next = { ...ex, blocks: sheet.blocks };
                    setEx(next);
                    rebuild(next, structure, langs);
                  }}
                >
                  {ex.sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="mapping-grid">
              {(['front', 'back', 'example', 'explanation', 'tags', 'notes'] as (keyof ColumnMapping)[]).map((field) => (
                <Field key={field} label={t(`import.field.${field}` as Key)}>
                  <select
                    className="select"
                    value={structure.mapping[field] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value === '' ? null : Number(e.target.value);
                      const mapping = { ...structure.mapping, [field]: field === 'front' || field === 'back' ? (v ?? 0) : v };
                      const st: Structure = { ...structure, mapping };
                      setStructure(st);
                      rebuild(ex, st, langs);
                    }}
                  >
                    {field !== 'front' && field !== 'back' && <option value="">{t('import.mapping.none')}</option>}
                    {Array.from({ length: columnCount }, (_, i) => (
                      <option key={i} value={i}>
                        {t('import.mapping.col', { n: i + 1 })}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
            <Switch
              checked={structure.hasHeader}
              onChange={(v) => {
                const st: Structure = { ...structure, hasHeader: v };
                setStructure(st);
                rebuild(ex, st, langs);
              }}
              label={t('import.header')}
            />
          </div>
        )}
        <div className="lang-row">
          <Field label={t('editor.frontLang')}>
            <LangSelect
              value={langs.front}
              onChange={(l) => {
                const next = { ...langs, front: l };
                setLangs(next);
                rebuild(ex, structure, next);
              }}
            />
          </Field>
          <button
            className="btn btn-icon swap-btn"
            aria-label={t('import.swap')}
            title={t('import.swap')}
            onClick={() => {
              const next = { front: langs.back, back: langs.front };
              setLangs(next);
              if (structure.kind === 'alternating') rebuild(ex, structure, next);
              else setRawRows((r) => swapSides(r));
            }}
          >
            <ArrowsLeftRight size={18} />
          </button>
          <Field label={t('editor.backLang')}>
            <LangSelect
              value={langs.back}
              onChange={(l) => {
                const next = { ...langs, back: l };
                setLangs(next);
                rebuild(ex, structure, next);
              }}
            />
          </Field>
        </div>
      </section>

      <section className="panel panel-pad stack">
        <Field label={t('import.target')}>
          <Segmented
            label={t('import.target')}
            value={target}
            onChange={setTarget}
            options={[
              { value: 'new', label: t('import.target.new') },
              { value: 'append', label: t('import.target.append') },
              { value: 'update', label: t('import.target.update') },
            ]}
          />
        </Field>
        {target === 'new' ? (
          <Field label={t('import.setTitle')} id={ids.title}>
            <input id={ids.title} className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        ) : (
          <>
            <Field label={t('import.chooseSet')} id={ids.set}>
              <select id={ids.set} className="select" value={targetSet} onChange={(e) => setTargetSet(e.target.value)}>
                <option value="">-</option>
                {activeSets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({langName(s.frontLang)} → {langName(s.backLang)})
                  </option>
                ))}
              </select>
            </Field>
            <p className="small text-2">{target === 'update' ? t('import.target.update.help') : t('import.target.append.help')}</p>
            {target === 'update' && <Switch checked={addUnmatched} onChange={setAddUnmatched} label={t('import.addUnmatched')} />}
          </>
        )}
      </section>

      <section className="stack">
        <div className="section-title">
          <h2>{t('import.preview')}</h2>
          <span className="small muted">{t('import.edit.hint')}</span>
        </div>
        <div className="summary-chips">
          {SUMMARY.filter((s) => sum[s.key] > 0 || s.key === 'recognized' || s.key === 'selected').map((s) => (
            <span key={s.key} className={`badge ${s.tone ?? ''} summary-badge num`}>
              {t(s.label, { n: sum[s.key] })}
            </span>
          ))}
        </div>
        <div className="toolbar">
          <Segmented
            label={t('import.preview')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('import.filter.all') },
              { value: 'problems', label: t('import.filter.problems') },
              { value: 'selected', label: t('import.filter.selected') },
              { value: 'notSelected', label: t('import.filter.notSelected') },
            ]}
          />
          <div className="spacer" />
          <button className="btn btn-sm" onClick={() => selectWhere((r) => visible.includes(r) && !r.unassigned, true)}>
            {t('import.selectAll')}
          </button>
          <button className="btn btn-sm" onClick={() => selectWhere((r) => visible.includes(r), false)}>
            {t('import.selectNone')}
          </button>
        </div>

        <div ref={listRef} className="preview-list panel" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((v) => {
            const r = visible[v.index];
            if (!r) return null;
            return (
              <div
                key={r.key}
                data-index={v.index}
                ref={virtualizer.measureElement}
                className={`preview-row ${r.selected ? '' : 'off'} ${r.unassigned ? 'unassigned' : ''}`}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}
              >
                <input type="checkbox" className="check" checked={r.selected} aria-label={t('import.row.include')} onChange={(e) => editRow(r.key, { selected: e.target.checked, touched: true })} />
                <span className="preview-no num small muted">#{r.index + 1}</span>
                <div className="preview-fields">
                  {r.unassigned ? (
                    <span className="break unassigned-text">{r.front}</span>
                  ) : (
                    <>
                      <input className="input input-sm" value={r.front} aria-label={`${sideName(langs.front, 'front')} #${r.index + 1}`} onChange={(e) => editRow(r.key, { front: e.target.value })} />
                      <input className="input input-sm" value={r.back} aria-label={`${sideName(langs.back, 'back')} #${r.index + 1}`} onChange={(e) => editRow(r.key, { back: e.target.value })} />
                    </>
                  )}
                </div>
                <div className="preview-meta">
                  <span className="small muted">{sourceLabel(r)}</span>
                  {r.statuses.map((s) => (
                    <span key={s} className={`badge ${statusBadge(s)}`}>
                      {s === 'duplicate' ? t('import.status.duplicate', { n: (r.duplicateOf ?? 0) + 1 }) : t(`import.status.${s}` as Key)}
                    </span>
                  ))}
                  {r.example && <span className="small text-2 break">{r.example}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="commit-bar">
        <span className="small text-2 num">
          {t('import.summary.recognized', { n: sum.recognized })}, {t('import.summary.selected', { n: sum.selected })}
        </span>
        <button className="btn btn-primary btn-lg" disabled={commitDisabled} onClick={() => void commit()}>
          {phase === 'committing' ? t('import.committing') : target === 'update' ? t('import.commit.update') : t('import.commit', { n: sum.selected })}
        </button>
      </div>
    </div>
  );
}
