import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db } from '../core/db/db';
import { saveSettings } from '../core/db/repo';
import { DEFAULT_SETTINGS, withDefaults, type Settings } from '../core/settings';
import { getSyncConfig, initSync, syncNow, SyncError, type SyncConfig } from '../core/sync/client';

// ---------- Einstellungen ----------

interface SettingsCtx {
  settings: Settings;
  loaded: boolean;
  update: (patch: Partial<Settings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsCtx | null>(null);

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const row = useLiveQuery(() => db.settings.get('app'), [], 'loading' as const);
  const loaded = row !== 'loading';
  const settings = useMemo(() => (row === 'loading' ? DEFAULT_SETTINGS : withDefaults(row?.value)), [row]);
  const [systemDark, setSystemDark] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark);
    const root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-motion', settings.reduceMotion || prefersReducedMotion() ? 'reduced' : 'full');
    root.lang = settings.uiLang === 'de' ? 'de-CH' : 'en';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0f1115' : '#f6f7f9'));
    try {
      localStorage.setItem('grapnel.theme', settings.theme);
    } catch {
      // Ohne localStorage blitzt höchstens das Design beim Start kurz auf.
    }
  }, [loaded, settings.theme, settings.reduceMotion, settings.uiLang, systemDark]);

  const update = useCallback(async (patch: Partial<Settings>) => {
    await saveSettings(patch);
  }, []);

  return <SettingsContext.Provider value={{ settings, loaded, update }}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsCtx {
  const v = useContext(SettingsContext);
  if (!v) throw new Error('SettingsProvider fehlt');
  return v;
}

export function motionReduced(settings: Settings): boolean {
  return settings.reduceMotion || prefersReducedMotion();
}

// ---------- Meldungen ----------

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

interface ToastCtx {
  toast: (text: string, opts?: { kind?: Toast['kind']; action?: Toast['action']; ms?: number }) => void;
}

const ToastContext = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const toast = useCallback<ToastCtx['toast']>((text, opts = {}) => {
    const id = next.current++;
    setToasts((list) => [...list.slice(-2), { id, text, kind: opts.kind ?? 'info', action: opts.action }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), opts.ms ?? (opts.action ? 6000 : 3500));
  }, []);
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
            <span className="spacer">{t.text}</span>
            {t.action && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  t.action!.run();
                  setToasts((list) => list.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastCtx['toast'] {
  const v = useContext(ToastContext);
  if (!v) throw new Error('ToastProvider fehlt');
  return v.toast;
}

// ---------- Sync im Hintergrund ----------

interface SyncCtx {
  config: SyncConfig | null;
  running: boolean;
  pending: number;
  error: SyncError['code'] | null;
  run: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

const SyncContext = createContext<SyncCtx | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<SyncError['code'] | null>(null);
  const pending = useLiveQuery(() => db.outbox.count(), [], 0);

  const refresh = useCallback(async () => {
    setConfig(await getSyncConfig());
  }, []);

  const run = useCallback(async () => {
    const cfg = await getSyncConfig();
    setConfig(cfg);
    if (!cfg) return false;
    setRunning(true);
    try {
      await syncNow();
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof SyncError ? e.code : 'server');
      return false;
    } finally {
      setRunning(false);
      setConfig(await getSyncConfig());
    }
  }, []);

  useEffect(() => {
    void initSync().then((cfg) => {
      setConfig(cfg);
      if (cfg) void run();
    });
  }, [run]);

  // Abgleich, wenn die App wieder sichtbar wird, das Netz zurückkommt und regelmässig.
  useEffect(() => {
    if (!config) return;
    const onVisible = () => document.visibilityState === 'visible' && void run();
    const onOnline = () => void run();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const timer = setInterval(() => document.visibilityState === 'visible' && void run(), 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
    };
  }, [config, run]);

  // Lokale Änderungen kurz sammeln und dann hochladen.
  useEffect(() => {
    if (!config || pending === 0) return;
    const h = setTimeout(() => void run(), 4000);
    return () => clearTimeout(h);
  }, [config, pending, run]);

  return <SyncContext.Provider value={{ config, running, pending, error, run, refresh }}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncCtx {
  const v = useContext(SyncContext);
  if (!v) throw new Error('SyncProvider fehlt');
  return v;
}
