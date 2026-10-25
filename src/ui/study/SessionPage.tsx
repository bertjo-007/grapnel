import { X } from '@phosphor-icons/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { db } from '../../core/db/db';
import { finishSession, saveSession } from '../../core/db/repo';
import type { Deck } from '../../core/session/deck';
import type { Session } from '../../core/types';
import { Dialog, LoadingBlock, Progress } from '../components';
import { useHotkeys } from '../hooks';
import { useI18n, type Key } from '../i18n';
import { NotFound } from '../pages/NotFound';
import { ShortcutsDialog } from '../shell/Shell';
import { useSettings } from '../state';
import { StudyProvider } from './common';
import { FlashRunner } from './FlashRunner';
import { LearnRunner } from './LearnRunner';
import { MatchRunner } from './MatchRunner';
import { RoundsRunner } from './RoundsRunner';
import { loadDeck } from './start';
import { TestRunner } from './TestRunner';

// ---------- Zustand einer laufenden Sitzung ----------

interface FrameCtx {
  setProgress: (done: number, total: number) => void;
  setOptions: (node: ReactNode) => void;
  /** Zurück zum Ursprung (Set-Seite oder Wiederholen). */
  leave: () => void;
  requestPause: () => void;
  /** Modus meldet, wie man vorzeitig abschliesst (Ergebnis zeigen). null = nicht möglich. */
  setFinisher: (fn: (() => void) | null) => void;
}

const Frame = createContext<FrameCtx | null>(null);

export function useFrame(): FrameCtx {
  const v = useContext(Frame);
  if (!v) throw new Error('Frame fehlt');
  return v;
}

/**
 * Hält den Modus-Zustand und speichert ihn nach jeder Änderung. Der Zustand wird vor
 * jeder Änderung kopiert, damit React die Änderung sicher sieht.
 */
export function useSessionState<S>(session: Session) {
  const [state, setState] = useState<S>(() => session.state as S);
  const ref = useRef(state);
  ref.current = state;
  const update = useCallback(
    (mutate: (draft: S) => void, progress?: { done: number; total: number } | ((next: S) => { done: number; total: number })) => {
      const next = structuredClone(ref.current);
      mutate(next);
      ref.current = next;
      setState(next);
      const p = typeof progress === 'function' ? progress(next) : progress;
      void saveSession(session.id, { state: next, ...(p ? { progressDone: p.done, progressTotal: p.total } : {}) });
      return next;
    },
    [session.id],
  );
  const finish = useCallback(async () => {
    await finishSession(session.id, ref.current);
  }, [session.id]);
  return { state, update, finish };
}

function StudyFrame({ session, children }: { session: Session; children: ReactNode }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [progress, setProgressState] = useState({ done: session.progressDone, total: session.progressTotal });
  const [options, setOptions] = useState<ReactNode>(null);
  const [paused, setPaused] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [finisher, setFinisherState] = useState<(() => void) | null>(null);

  const leave = useCallback(() => {
    navigate(session.setIds.length === 1 ? `/sets/${session.setIds[0]}` : '/review', { replace: true });
  }, [navigate, session.setIds]);

  useHotkeys({ Escape: () => setPaused(true), '?': () => setShortcuts(true) }, !paused, ['Escape']);
  useEffect(() => {
    document.body.classList.add('in-session');
    return () => document.body.classList.remove('in-session');
  }, []);

  // Stabil halten: Die Modi hängen Effekte an diesen Kontext. Ein neues Objekt bei jedem
  // Rendern würde diese Effekte endlos neu auslösen.
  const setProgress = useCallback((done: number, total: number) => setProgressState({ done, total }), []);
  const setFinisher = useCallback((fn: (() => void) | null) => setFinisherState(() => fn), []);
  const requestPause = useCallback(() => setPaused(true), []);
  const ctx = useMemo<FrameCtx>(() => ({ setProgress, setOptions, leave, requestPause, setFinisher }), [setProgress, leave, requestPause, setFinisher]);

  return (
    <Frame.Provider value={ctx}>
      <div className="session">
        <header className="session-top">
          <button className="btn btn-ghost btn-icon" onClick={() => setPaused(true)} aria-label={t('session.pause')}>
            <X size={22} />
          </button>
          <div className="session-progress">
            <div className="session-title">
              <span className="break">{t(`mode.${session.mode}` as Key)}</span>
              <span className="num muted">{t('session.progress', { done: progress.done, total: progress.total })}</span>
            </div>
            <Progress value={progress.total ? progress.done / progress.total : 0} label={t('session.progress', { done: progress.done, total: progress.total })} />
          </div>
          <div className="session-options">{options}</div>
        </header>
        <main className="session-body">{children}</main>
        {settings.showShortcutHints && (
          <button className="shortcut-hint" onClick={() => setShortcuts(true)}>
            {t('session.shortcutsHint')}
          </button>
        )}
      </div>
      <Dialog
        open={paused}
        onClose={() => setPaused(false)}
        title={t('session.paused')}
        footer={
          <>
            <button className="btn" onClick={leave}>
              {t('session.end.later')}
            </button>
            {finisher && (
              <button
                className="btn"
                onClick={() => {
                  setPaused(false);
                  finisher();
                }}
              >
                {t('session.end.finish')}
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setPaused(false)}>
              {t('session.resume')}
            </button>
          </>
        }
      >
        <p className="text-2">{t('session.paused.text')}</p>
      </Dialog>
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
    </Frame.Provider>
  );
}

export function SessionPage() {
  const { sessionId } = useParams();
  const { t } = useI18n();
  const [loaded, setLoaded] = useState<{ session: Session; deck: Deck } | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setLoaded(undefined);
    void (async () => {
      const session = sessionId ? await db.sessions.get(sessionId) : undefined;
      if (!session) {
        if (alive) setLoaded(null);
        return;
      }
      const deck = await loadDeck(session.setIds);
      if (alive) setLoaded({ session, deck });
    })();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  if (loaded === undefined)
    return (
      <div className="session">
        <div className="session-body">
          <LoadingBlock />
        </div>
      </div>
    );
  if (loaded === null)
    return (
      <div className="session">
        <div className="session-body">
          <NotFound text={t('session.missing')} />
        </div>
      </div>
    );

  const { session, deck } = loaded;
  const kind = (session.state as { kind: string }).kind;
  return (
    <StudyProvider key={session.id} session={session} deck={deck}>
      <StudyFrame session={session}>
        {kind === 'flash' && <FlashRunner session={session} />}
        {kind === 'learn' && <LearnRunner session={session} />}
        {kind === 'rounds' && <RoundsRunner session={session} />}
        {kind === 'test' && <TestRunner session={session} />}
        {kind === 'match' && <MatchRunner session={session} />}
      </StudyFrame>
    </StudyProvider>
  );
}
