import { Confetti } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { answerOf, promptOf, type ItemRef } from '../../core/session/deck';
import type { Session } from '../../core/types';
import { useI18n } from '../i18n';
import { useSettings, useToast } from '../state';
import { useStudy } from './common';
import { useFrame } from './SessionPage';
import { startSession } from './start';

/** Abschluss einer Sitzung: was sitzt, was noch Übung braucht, wie es weitergeht. */
export function Summary({
  session,
  title,
  lead,
  note,
  practice,
  onAgain,
  againLabel,
  children,
  extraActions,
}: {
  session: Session;
  title: string;
  lead?: ReactNode;
  note?: ReactNode;
  practice: ItemRef[];
  onAgain?: () => void;
  againLabel?: string;
  children?: ReactNode;
  extraActions?: ReactNode;
}) {
  const { t } = useI18n();
  const { deck } = useStudy();
  const { settings } = useSettings();
  const frame = useFrame();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const relearn = async () => {
    setBusy(true);
    try {
      const id = await startSession({ mode: 'learn', setIds: session.setIds, title: session.title, refs: practice, settings, shuffle: false, newLimit: practice.length });
      navigate(`/session/${id}`, { replace: true });
    } catch {
      toast(t('common.error'), { kind: 'error' });
      setBusy(false);
    }
  };

  return (
    <div className="summary">
      <div className="summary-head">
        {practice.length === 0 && (
          <span className="summary-icon">
            <Confetti size={30} weight="fill" />
          </span>
        )}
        <h1>{title}</h1>
        {lead && <p className="text-2">{lead}</p>}
      </div>
      {children}
      {practice.length > 0 ? (
        <section className="panel summary-list">
          <h2 className="small-heading">{t('session.needsPractice')}</h2>
          <ul>
            {practice.slice(0, 50).map((r) => {
              const c = deck.card(r.c);
              if (!c) return null;
              return (
                <li key={`${r.c}:${r.d}`}>
                  <span className="break">{promptOf(c, r.d)}</span>
                  <span className="break text-2">{answerOf(c, r.d)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="callout success">{t('session.allFirstTry')}</p>
      )}
      {note && <p className="small text-2">{note}</p>}
      <div className="summary-actions">
        {onAgain && (
          <button className="btn btn-primary btn-lg" onClick={onAgain}>
            {againLabel ?? t('session.again')}
          </button>
        )}
        {!onAgain && practice.length > 0 && (
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => void relearn()}>
            {t('test.relearn')}
          </button>
        )}
        {extraActions}
        <button className="btn btn-lg" onClick={frame.leave}>
          {session.setIds.length === 1 ? t('session.backToSet') : t('nav.review')}
        </button>
      </div>
    </div>
  );
}
