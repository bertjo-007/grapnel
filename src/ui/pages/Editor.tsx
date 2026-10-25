import {
  ArrowDown,
  ArrowUp,
  CaretDown,
  CaretUp,
  CheckSquare,
  Copy,
  DotsSixVertical,
  Flag,
  ImageSquare,
  Microphone,
  Plus,
  Square,
  Star,
  StopCircle,
  Trash,
  UploadSimple,
  X,
} from '@phosphor-icons/react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { answerVariants } from '../../core/answer/variants';
import { db } from '../../core/db/db';
import { addCards, deleteCards, deleteMedia, duplicateCard, insertCardAfter, moveCard, putMedia, restoreCards, setCardFlags, updateCard, updateSet } from '../../core/db/repo';
import type { Card, Lang, StudySet } from '../../core/types';
import { AudioButton, CardImage } from '../cardview';
import { ConfirmDialog, Field, LoadingBlock } from '../components';
import { useCards, useSet } from '../hooks';
import { useI18n } from '../i18n';
import { compressImage, MAX_AUDIO_BYTES, startRecording, type Recorder } from '../media';
import { PageHeader } from '../shell/Shell';
import { useToast } from '../state';
import { LangSelect } from './NewSet';
import { NotFound } from './NotFound';

/**
 * Textfeld, das lokal tippt und verzögert speichert. Während man schreibt, überschreiben
 * Aktualisierungen aus der Datenbank das Feld nicht (sonst springt der Cursor).
 */
function useDraft(value: string, save: (v: string) => void, delay = 500) {
  const [text, setText] = useState(value);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty.current) setText(value);
  }, [value]);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (dirty.current) {
      dirty.current = false;
      saveRef.current(textRef.current);
    }
  }, []);
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => () => flush(), [flush]);
  return {
    value: text,
    onChange: (v: string) => {
      setText(v);
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    onBlur: flush,
  };
}

function AutoTextarea(props: { value: string; onChange: (v: string) => void; onBlur: () => void; placeholder?: string; ariaLabel: string; id?: string; lang?: string; autoFocus?: boolean; onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void; inputRef?: (el: HTMLTextAreaElement | null) => void; className?: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(resize, [props.value]);
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        props.inputRef?.(el);
      }}
      id={props.id}
      className={`textarea editor-text ${props.className ?? ''}`}
      rows={1}
      value={props.value}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      lang={props.lang}
      autoFocus={props.autoFocus}
      spellCheck
      onChange={(e) => props.onChange(e.target.value)}
      onBlur={props.onBlur}
      onKeyDown={props.onKeyDown}
    />
  );
}

const BCP: Record<Lang, string | undefined> = { fr: 'fr', de: 'de', en: 'en', it: 'it', es: 'es', other: undefined };

function DraftField({ card, field, label, placeholder, lang, rows }: { card: Card; field: 'example' | 'explanation' | 'notes'; label: string; placeholder?: string; lang?: string; rows?: number }) {
  const id = useId();
  const d = useDraft(card[field], (v) => void updateCard(card.id, { [field]: v }));
  return (
    <Field label={label} id={id}>
      <textarea id={id} className="textarea" rows={rows ?? 2} value={d.value} placeholder={placeholder} lang={lang} onChange={(e) => d.onChange(e.target.value)} onBlur={d.onBlur} />
    </Field>
  );
}

function ListField({ card, field, label, help, splitter, joiner }: { card: Card; field: 'extraAnswers' | 'extraFrontAnswers' | 'tags'; label: string; help: string; splitter: RegExp; joiner: string }) {
  const id = useId();
  const d = useDraft(card[field].join(joiner), (v) =>
    void updateCard(card.id, {
      [field]: v
        .split(splitter)
        .map((x) => x.trim())
        .filter(Boolean),
    }),
  );
  return (
    <Field label={label} id={id} help={help}>
      {field === 'tags' ? (
        <input id={id} className="input" value={d.value} onChange={(e) => d.onChange(e.target.value)} onBlur={d.onBlur} />
      ) : (
        <textarea id={id} className="textarea" rows={2} value={d.value} onChange={(e) => d.onChange(e.target.value)} onBlur={d.onBlur} />
      )}
    </Field>
  );
}

function MediaControls({ card }: { card: Card }) {
  const { t } = useI18n();
  const toast = useToast();
  const imgInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const [rec, setRec] = useState<Recorder | null>(null);

  const setImage = async (file: File) => {
    try {
      const { data, mime } = await compressImage(file);
      const id = await putMedia(data, mime);
      const old = card.imageId;
      await updateCard(card.id, { imageId: id });
      if (old) await deleteMedia(old);
    } catch {
      toast(t('common.error'), { kind: 'error' });
    }
  };
  const setAudio = async (data: ArrayBuffer, mime: string) => {
    if (data.byteLength > MAX_AUDIO_BYTES) {
      toast(t('editor.audioTooLarge'), { kind: 'error' });
      return;
    }
    const id = await putMedia(data, mime);
    const old = card.audioId;
    await updateCard(card.id, { audioId: id });
    if (old) await deleteMedia(old);
  };

  return (
    <div className="media-controls">
      <div className="field">
        <span className="field-label">{t('editor.image')}</span>
        {card.imageId ? (
          <div className="media-preview">
            <CardImage imageId={card.imageId} className="editor-image" />
            <button
              className="btn btn-sm"
              onClick={async () => {
                const old = card.imageId!;
                await updateCard(card.id, { imageId: null });
                await deleteMedia(old);
              }}
            >
              <X size={16} />
              {t('editor.removeImage')}
            </button>
          </div>
        ) : (
          <button className="btn btn-sm" onClick={() => imgInput.current?.click()}>
            <ImageSquare size={16} />
            {t('editor.addImage')}
          </button>
        )}
        <input ref={imgInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void setImage(e.target.files[0])} />
      </div>
      <div className="field">
        <span className="field-label">{t('editor.audio')}</span>
        <div className="row-wrap">
          {card.audioId && <AudioButton audioId={card.audioId} />}
          {rec ? (
            <button
              className="btn btn-sm btn-danger"
              onClick={async () => {
                const r = await rec.stop();
                setRec(null);
                await setAudio(r.data, r.mime);
              }}
            >
              <StopCircle size={16} />
              {t('editor.stopRecording')}
            </button>
          ) : (
            <button
              className="btn btn-sm"
              onClick={async () => {
                try {
                  setRec(await startRecording());
                } catch {
                  toast(t('editor.micDenied'), { kind: 'error' });
                }
              }}
            >
              <Microphone size={16} />
              {t('editor.record')}
            </button>
          )}
          <button className="btn btn-sm" onClick={() => audioInput.current?.click()}>
            <UploadSimple size={16} />
            {t('editor.uploadAudio')}
          </button>
          {card.audioId && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={async () => {
                const old = card.audioId!;
                await updateCard(card.id, { audioId: null });
                await deleteMedia(old);
              }}
            >
              {t('editor.removeAudio')}
            </button>
          )}
        </div>
        <input ref={audioInput} type="file" accept="audio/*" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) await setAudio(await f.arrayBuffer(), f.type || 'audio/mpeg');
        }} />
      </div>
    </div>
  );
}

interface RowProps {
  card: Card;
  index: number;
  set: StudySet;
  expanded: boolean;
  selected: boolean | null;
  focus: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onInsertAfter: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (delta: -1 | 1) => void;
  onDragStart: (e: React.PointerEvent) => void;
  onFocused: () => void;
}

function EditorRow({ card, index, set, expanded, selected, focus, ...on }: RowProps) {
  const { t } = useI18n();
  const front = useDraft(card.front, (v) => void updateCard(card.id, { front: v }));
  const back = useDraft(card.back, (v) => void updateCard(card.id, { back: v }));
  const frontRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (focus && frontRef.current) {
      frontRef.current.focus();
      on.onFocused();
    }
  }, [focus, on]);
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      front.onBlur();
      back.onBlur();
      on.onInsertAfter();
    }
  };
  const derived = useMemo(() => answerVariants(card.back).slice(1, 8), [card.back]);
  const derivedFront = useMemo(() => answerVariants(card.front).slice(1, 8), [card.front]);

  return (
    <div className={`editor-row ${expanded ? 'expanded' : ''}`}>
      <div className="editor-row-main">
        <div className="editor-row-side">
          {selected !== null ? (
            <button className="btn btn-ghost btn-icon btn-sm" aria-pressed={selected} aria-label={t('common.select')} onClick={on.onToggleSelect}>
              {selected ? <CheckSquare size={20} weight="fill" className="accent" /> : <Square size={20} />}
            </button>
          ) : (
            <button className="drag-handle" aria-label={t('editor.drag')} title={t('editor.drag')} onPointerDown={on.onDragStart}>
              <DotsSixVertical size={18} />
            </button>
          )}
          <span className="editor-no num">{index + 1}</span>
        </div>
        <div className="editor-fields">
          <AutoTextarea {...front} inputRef={(el) => (frontRef.current = el)} ariaLabel={`${t('editor.front')} ${index + 1}`} placeholder={t('editor.front')} lang={BCP[set.frontLang]} onKeyDown={onKey} />
          <AutoTextarea {...back} ariaLabel={`${t('editor.back')} ${index + 1}`} placeholder={t('editor.back')} lang={BCP[set.backLang]} onKeyDown={onKey} />
        </div>
        <div className="editor-row-actions">
          <button className={`btn btn-ghost btn-icon btn-sm flag-btn ${card.flagDifficult ? 'on difficult' : ''}`} aria-pressed={card.flagDifficult} aria-label={t('editor.markDifficult')} title={t('editor.markDifficult')} onClick={() => void setCardFlags([card.id], { flagDifficult: !card.flagDifficult })}>
            <Flag size={17} weight={card.flagDifficult ? 'fill' : 'regular'} />
          </button>
          <button className={`btn btn-ghost btn-icon btn-sm flag-btn ${card.flagImportant ? 'on important' : ''}`} aria-pressed={card.flagImportant} aria-label={t('editor.markImportant')} title={t('editor.markImportant')} onClick={() => void setCardFlags([card.id], { flagImportant: !card.flagImportant })}>
            <Star size={17} weight={card.flagImportant ? 'fill' : 'regular'} />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" aria-expanded={expanded} aria-label={t('editor.details')} title={t('editor.details')} onClick={on.onToggleExpand}>
            {expanded ? <CaretUp size={17} /> : <CaretDown size={17} />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="editor-details">
          <div className="grid-2">
            <DraftField card={card} field="example" label={t('editor.example')} lang={BCP[set.frontLang]} />
            <DraftField card={card} field="explanation" label={t('editor.explanation')} />
          </div>
          <div className="grid-2">
            <ListField card={card} field="extraAnswers" label={t('editor.answers')} help={derived.length ? t('editor.derived', { list: derived.join(', ') }) : t('editor.answers.help')} splitter={/\n/} joiner={'\n'} />
            <ListField card={card} field="extraFrontAnswers" label={t('editor.frontAnswers')} help={derivedFront.length ? t('editor.derived', { list: derivedFront.join(', ') }) : t('editor.answers.help')} splitter={/\n/} joiner={'\n'} />
          </div>
          <div className="grid-2">
            <ListField card={card} field="tags" label={t('editor.tags')} help={t('editor.tags.help')} splitter={/,/} joiner={', '} />
            <DraftField card={card} field="notes" label={t('editor.notes')} rows={1} />
          </div>
          <MediaControls card={card} />
          <div className="row-wrap editor-detail-actions">
            <button className="btn btn-sm" onClick={() => on.onMove(-1)} disabled={index === 0}>
              <ArrowUp size={16} />
              {t('editor.moveUp')}
            </button>
            <button className="btn btn-sm" onClick={() => on.onMove(1)}>
              <ArrowDown size={16} />
              {t('editor.moveDown')}
            </button>
            <button className="btn btn-sm" onClick={on.onDuplicate}>
              <Copy size={16} />
              {t('common.duplicate')}
            </button>
            <div className="spacer" />
            <button className="btn btn-sm btn-ghost danger-text" onClick={on.onDelete}>
              <Trash size={16} />
              {t('common.delete')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SetDetailsForm({ set }: { set: StudySet }) {
  const { t } = useI18n();
  const ids = { title: useId(), desc: useId(), front: useId(), back: useId() };
  const title = useDraft(set.title, (v) => void updateSet(set.id, { title: v.trim() || t('editor.newSetTitle') }));
  const desc = useDraft(set.description, (v) => void updateSet(set.id, { description: v }));
  return (
    <details className="panel set-form" open={!set.title || undefined}>
      <summary>{t('set.details')}</summary>
      <div className="stack">
        <Field label={t('editor.setTitle')} id={ids.title}>
          <input id={ids.title} className="input" value={title.value} onChange={(e) => title.onChange(e.target.value)} onBlur={title.onBlur} />
        </Field>
        <Field label={t('editor.setDescription')} id={ids.desc}>
          <textarea id={ids.desc} className="textarea" rows={2} value={desc.value} onChange={(e) => desc.onChange(e.target.value)} onBlur={desc.onBlur} />
        </Field>
        <div className="grid-2">
          <Field label={t('editor.frontLang')} id={ids.front}>
            <LangSelect id={ids.front} value={set.frontLang} onChange={(l) => void updateSet(set.id, { frontLang: l })} />
          </Field>
          <Field label={t('editor.backLang')} id={ids.back}>
            <LangSelect id={ids.back} value={set.backLang} onChange={(l) => void updateSet(set.id, { backLang: l })} />
          </Field>
        </div>
      </div>
    </details>
  );
}

export function EditorPage() {
  const { setId } = useParams();
  const [params] = useSearchParams();
  const { t } = useI18n();
  const toast = useToast();
  const set = useSet(setId);
  const cards = useCards(setId);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(params.get('card') ? [params.get('card')!] : []));
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const startedNew = useRef(false);

  const virtualizer = useWindowVirtualizer({
    count: cards?.length ?? 0,
    estimateSize: () => 96,
    overscan: 8,
    scrollMargin: listRef.current?.offsetTop ?? 0,
    getItemKey: (i) => cards?.[i]?.id ?? i,
  });

  // Neues Set: gleich mit der ersten Karte beginnen.
  useEffect(() => {
    if (!set || !cards || startedNew.current) return;
    startedNew.current = true;
    if (params.get('new') && cards.length === 0) void addCards(set.id, [{}]).then(([c]) => setFocusId(c.id));
    const target = params.get('card');
    if (target) {
      const idx = cards.findIndex((c) => c.id === target);
      if (idx >= 0) setTimeout(() => virtualizer.scrollToIndex(idx, { align: 'center' }), 50);
    }
  }, [set, cards, params, virtualizer]);

  // Neu eingefügte Karte sichtbar machen.
  useEffect(() => {
    if (!focusId || !cards) return;
    const idx = cards.findIndex((c) => c.id === focusId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'auto' });
  }, [focusId, cards, virtualizer]);

  const remove = useCallback(
    async (ids: string[]) => {
      const withHistory = await db.reviewLogs.where('cardId').anyOf(ids).count();
      const backup = (await db.cards.bulkGet(ids)).filter((c): c is Card => !!c);
      const withMedia = backup.some((c) => c.imageId || c.audioId);
      if (withHistory > 0 || withMedia || ids.length > 1) {
        setConfirm({ ids });
        return;
      }
      // Ohne Verlauf und Medien: sofort löschen und Rückgängig anbieten.
      await deleteCards(ids);
      toast(t('editor.deleted', { n: ids.length }), {
        action: {
          label: t('common.undo'),
          run: () => void restoreCards(backup),
        },
      });
    },
    [t, toast],
  );

  const onDragStart = (id: string) => (e: React.PointerEvent) => {
    if (!cards) return;
    e.preventDefault();
    const start = cards.findIndex((c) => c.id === id);
    setDrag({ id, over: start });
    let over = start;
    let raf = 0;
    let lastY = e.clientY;
    const update = () => {
      const offset = window.scrollY + lastY;
      const item = virtualizer.getVirtualItemForOffset(offset);
      if (item) {
        const mid = item.start + item.size / 2;
        over = offset < mid ? item.index : item.index + 1;
        setDrag({ id, over });
      }
      // Am Rand automatisch scrollen.
      const edge = 80;
      if (lastY < edge) window.scrollBy(0, -12);
      else if (lastY > window.innerHeight - edge) window.scrollBy(0, 12);
      raf = requestAnimationFrame(update);
    };
    const move = (ev: PointerEvent) => {
      lastY = ev.clientY;
    };
    const up = async () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDrag(null);
      if (over === start || over === start + 1) return;
      const before = over > 0 ? cards[over - 1]?.id ?? null : null;
      const after = cards[over]?.id ?? null;
      await moveCard(id, before === id ? null : before, after === id ? null : after);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    raf = requestAnimationFrame(update);
  };

  if (set === undefined || !cards) return <LoadingBlock />;
  if (set === null) return <NotFound text={t('set.notFound')} />;

  const items = virtualizer.getVirtualItems();
  const selCount = selection?.size ?? 0;

  return (
    <div className="stack editor">
      <PageHeader
        back={{ to: `/sets/${set.id}`, label: set.title || t('common.untitled') }}
        title={t('editor.title')}
        sub={t('count.cards', { n: cards.length })}
        actions={
          <>
            <button className={`btn ${selection ? 'btn-soft' : ''}`} onClick={() => setSelection(selection ? null : new Set())}>
              <CheckSquare size={18} />
              {t('editor.selectMode')}
            </button>
            <Link to={`/sets/${set.id}`} className="btn btn-primary">
              {t('common.done')}
            </Link>
          </>
        }
      />
      <SetDetailsForm set={set} />

      {selection && (
        <div className="bulk-bar panel">
          <span className="small">{t('editor.selected', { n: selCount })}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setSelection(new Set(selCount === cards.length ? [] : cards.map((c) => c.id)))}>
            {selCount === cards.length ? t('import.selectNone') : t('import.selectAll')}
          </button>
          <div className="spacer" />
          <button className="btn btn-sm" disabled={!selCount} onClick={() => void setCardFlags([...selection], { flagDifficult: true })}>
            <Flag size={16} />
            {t('editor.markDifficult')}
          </button>
          <button className="btn btn-sm" disabled={!selCount} onClick={() => void setCardFlags([...selection], { flagImportant: true })}>
            <Star size={16} />
            {t('editor.markImportant')}
          </button>
          <button className="btn btn-sm" disabled={!selCount} onClick={() => void setCardFlags([...selection], { flagImportant: false, flagDifficult: false })}>
            {t('editor.unmark')}
          </button>
          <button className="btn btn-sm btn-danger" disabled={!selCount} onClick={() => setConfirm({ ids: [...selection] })}>
            <Trash size={16} />
            {t('editor.deleteSelected')}
          </button>
        </div>
      )}

      {cards.length === 0 && <p className="muted">{t('editor.empty')}</p>}

      <div ref={listRef} className="editor-list" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {items.map((v) => {
          const card = cards[v.index];
          if (!card) return null;
          return (
            <div
              key={card.id}
              data-index={v.index}
              ref={virtualizer.measureElement}
              className={`editor-slot ${drag?.id === card.id ? 'dragging' : ''} ${drag && drag.over === v.index ? 'drop-before' : ''} ${drag && drag.over === v.index + 1 && v.index === cards.length - 1 ? 'drop-after' : ''}`}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}
            >
              <EditorRow
                card={card}
                index={v.index}
                set={set}
                expanded={expanded.has(card.id)}
                selected={selection ? selection.has(card.id) : null}
                focus={focusId === card.id}
                onFocused={() => setFocusId(null)}
                onToggleExpand={() =>
                  setExpanded((s) => {
                    const n = new Set(s);
                    if (n.has(card.id)) n.delete(card.id);
                    else n.add(card.id);
                    return n;
                  })
                }
                onToggleSelect={() =>
                  setSelection((s) => {
                    const n = new Set(s ?? []);
                    if (n.has(card.id)) n.delete(card.id);
                    else n.add(card.id);
                    return n;
                  })
                }
                onInsertAfter={async () => setFocusId((await insertCardAfter(set.id, card.id)).id)}
                onDuplicate={async () => {
                  const c = await duplicateCard(card.id);
                  if (c) setFocusId(c.id);
                }}
                onDelete={() => void remove([card.id])}
                onMove={async (delta) => {
                  const i = v.index;
                  if (delta === -1 && i > 0) await moveCard(card.id, cards[i - 2]?.id ?? null, cards[i - 1].id);
                  if (delta === 1 && i < cards.length - 1) await moveCard(card.id, cards[i + 1].id, cards[i + 2]?.id ?? null);
                }}
                onDragStart={onDragStart(card.id)}
              />
            </div>
          );
        })}
      </div>

      <div className="editor-add">
        <button className="btn btn-soft btn-lg btn-block" onClick={async () => setFocusId((await addCards(set.id, [{}]))[0].id)}>
          <Plus size={20} />
          {t('editor.addCard')}
        </button>
        <p className="small muted">{t('editor.addHint')}</p>
      </div>

      <ConfirmDialog
        open={!!confirm}
        danger
        title={confirm && confirm.ids.length === 1 ? t('editor.delete.title') : t('editor.deleteSelected.title', { n: confirm?.ids.length ?? 0 })}
        text={confirm && confirm.ids.length === 1 ? t('editor.delete.text') : t('editor.deleteSelected.text')}
        confirmLabel={t('common.delete')}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          await deleteCards(confirm.ids);
          toast(t('editor.deleted', { n: confirm.ids.length }));
          setSelection((s) => (s ? new Set([...s].filter((id) => !confirm.ids.includes(id))) : s));
          setConfirm(null);
        }}
      />
    </div>
  );
}
