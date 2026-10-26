import { Flag, PencilSimple, SpeakerHigh, Star } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { setCardFlags } from '../core/db/repo';
import { stateKey } from '../core/srs/scheduler';
import { isAutoDifficult, isDueToday, statusOf } from '../core/srs/status';
import type { Card, CardState, Direction, Lang, StudySet } from '../core/types';
import { Dialog } from './components';
import { useCardLogs, useMediaUrl } from './hooks';
import { useI18n, type Key } from './i18n';
import { onVoicesChanged, speak, voiceFor } from './media';
import { useSettings } from './state';

/** Vorlesen-Knopf: erscheint nur, wenn eine erlaubte Stimme für die Sprache da ist. */
export function SpeakButton({ text, lang, size = 'sm' }: { text: string; lang: Lang; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  const { settings } = useSettings();
  const [available, setAvailable] = useState(() => !!voiceFor(lang, settings.allowOnlineVoices));
  useEffect(() => {
    const check = () => setAvailable(!!voiceFor(lang, settings.allowOnlineVoices));
    check();
    return onVoicesChanged(check);
  }, [lang, settings.allowOnlineVoices]);
  if (!available || !text.trim()) return null;
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-icon ${size === 'sm' ? 'btn-sm' : ''}`}
      aria-label={t('common.listen')}
      title={t('common.listen')}
      onClick={(e) => {
        e.stopPropagation();
        speak(text, lang, settings.allowOnlineVoices);
      }}
    >
      <SpeakerHigh size={18} />
    </button>
  );
}

export function AudioButton({ audioId }: { audioId: string | null }) {
  const { t } = useI18n();
  const url = useMediaUrl(audioId);
  if (!url) return null;
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon btn-sm"
      aria-label={t('common.play')}
      onClick={(e) => {
        e.stopPropagation();
        void new Audio(url).play();
      }}
    >
      <SpeakerHigh size={18} weight="fill" />
    </button>
  );
}

export function CardImage({ imageId, className }: { imageId: string | null; className?: string }) {
  const url = useMediaUrl(imageId);
  if (!url) return null;
  return <img src={url} alt="" className={className ?? 'card-image'} loading="lazy" />;
}

export function StatusBadge({ state, card }: { state: CardState | undefined; card?: Card }) {
  const { t } = useI18n();
  const status = statusOf(state);
  const cls = { new: '', learning: 'badge-warning', review: 'badge-accent', mastered: 'badge-success' }[status];
  return (
    <span className="row" style={{ gap: 4 }}>
      <span className={`badge ${cls}`}>{t(`status.${status}` as Key)}</span>
      {isAutoDifficult(state) && <span className="badge badge-danger">{t('status.difficult')}</span>}
      {card?.flagDifficult && <Flag size={14} weight="fill" className="flag-icon difficult" aria-label={t('flag.difficult')} />}
      {card?.flagImportant && <Star size={14} weight="fill" className="flag-icon important" aria-label={t('flag.important')} />}
    </span>
  );
}

export function FlagToggles({ card }: { card: Card }) {
  const { t } = useI18n();
  return (
    <span className="row" style={{ gap: 2 }}>
      <button
        type="button"
        className={`btn btn-ghost btn-icon btn-sm flag-btn ${card.flagDifficult ? 'on difficult' : ''}`}
        aria-pressed={card.flagDifficult}
        aria-label={t('editor.markDifficult')}
        title={t('editor.markDifficult')}
        onClick={(e) => {
          e.stopPropagation();
          void setCardFlags([card.id], { flagDifficult: !card.flagDifficult });
        }}
      >
        <Flag size={17} weight={card.flagDifficult ? 'fill' : 'regular'} />
      </button>
      <button
        type="button"
        className={`btn btn-ghost btn-icon btn-sm flag-btn ${card.flagImportant ? 'on important' : ''}`}
        aria-pressed={card.flagImportant}
        aria-label={t('editor.markImportant')}
        title={t('editor.markImportant')}
        onClick={(e) => {
          e.stopPropagation();
          void setCardFlags([card.id], { flagImportant: !card.flagImportant });
        }}
      >
        <Star size={17} weight={card.flagImportant ? 'fill' : 'regular'} />
      </button>
    </span>
  );
}

/** Alles zu einer Karte: Inhalt, Medien, Lernstand je Richtung und Verlauf. */
export function CardDialog({ card, set, states, onClose }: { card: Card | null; set: StudySet; states: Map<string, CardState>; onClose: () => void }) {
  const { t, relTime, date, sideName } = useI18n();
  const logs = useCardLogs(card?.id);
  if (!card) return <Dialog open={false} onClose={onClose} title="">{null}</Dialog>;
  const replaced = new Set((logs ?? []).map((l) => l.replaces).filter(Boolean));
  const dirs: Direction[] = ['f2b', 'b2f'];
  return (
    <Dialog open={!!card} onClose={onClose} title={card.front || t('common.untitled')} wide>
      <div className="card-detail">
        <CardImage imageId={card.imageId} />
        <div className="card-detail-sides">
          <div>
            <span className="field-label">{sideName(set.frontLang, 'front')}</span>
            <p className="card-detail-text break pre">
              {card.front}
              <SpeakButton text={card.front} lang={set.frontLang} />
              <AudioButton audioId={card.audioId} />
            </p>
          </div>
          <div>
            <span className="field-label">{sideName(set.backLang, 'back')}</span>
            <p className="card-detail-text break pre">
              {card.back}
              <SpeakButton text={card.back} lang={set.backLang} />
            </p>
          </div>
        </div>
        {card.example && (
          <div>
            <span className="field-label">{t('editor.example')}</span>
            <p className="break pre text-2">{card.example}</p>
          </div>
        )}
        {card.explanation && (
          <div>
            <span className="field-label">{t('editor.explanation')}</span>
            <p className="break pre text-2">{card.explanation}</p>
          </div>
        )}
        {card.notes && (
          <div>
            <span className="field-label">{t('editor.notes')}</span>
            <p className="break pre text-2">{card.notes}</p>
          </div>
        )}
        {card.tags.length > 0 && (
          <div className="row-wrap">
            {card.tags.map((tag) => (
              <span key={tag} className="badge">
                {tag}
              </span>
            ))}
          </div>
        )}
        <div className="row-wrap">
          <FlagToggles card={card} />
          <div className="spacer" />
          <Link to={`/sets/${set.id}/edit?card=${card.id}`} className="btn btn-sm">
            <PencilSimple size={16} />
            {t('common.edit')}
          </Link>
        </div>
        <div className="dir-states">
          {dirs.map((d) => {
            const st = states.get(stateKey(card.id, d));
            return (
              <div key={d} className="dir-state">
                <span className="small muted">{d === 'f2b' ? `${t(`lang.${set.frontLang}` as Key)} → ${t(`lang.${set.backLang}` as Key)}` : `${t(`lang.${set.backLang}` as Key)} → ${t(`lang.${set.frontLang}` as Key)}`}</span>
                <StatusBadge state={st} />
                {st && st.fsrs.state !== 0 && <span className="small text-2">{isDueToday(st, Date.now()) ? t('status.due') : t('card.dueOn', { when: relTime(st.due) })}</span>}
                {st && <span className="small muted num">{t('card.counts', { c: st.correct, w: st.wrong })}</span>}
              </div>
            );
          })}
        </div>
        <div>
          <h3 className="small-heading">{t('card.history')}</h3>
          {!logs || logs.length === 0 ? (
            <p className="muted small">{t('card.noHistory')}</p>
          ) : (
            <ul className="history">
              {logs
                .slice()
                .reverse()
                .slice(0, 30)
                .map((l) => (
                  <li key={l.id} className={replaced.has(l.id) ? 'replaced' : ''}>
                    <span className={`dot ${l.result}`} aria-hidden />
                    <span className="num small">{date(l.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="small">{t(`mode.${l.mode}` as Key)}</span>
                    <span className="small text-2">{t(`feedback.${l.result}` as Key)}</span>
                    {l.override && <span className="badge">{t('card.override')}</span>}
                    {replaced.has(l.id) && <span className="badge">{t('card.replaced')}</span>}
                    {l.given && <span className="small muted break">«{l.given}»</span>}
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
