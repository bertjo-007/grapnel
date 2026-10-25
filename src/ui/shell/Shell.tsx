import { AnchorSimple, ArrowsClockwise, Cards, ChartBar, CloudCheck, CloudSlash, GearSix, House } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { db } from '../../core/db/db';
import { endOfDay } from '../../core/util/time';
import { Dialog, Kbd } from '../components';
import { useHotkeys } from '../hooks';
import { useT, type Key } from '../i18n';
import { useSync } from '../state';
import { applyUpdate, onUpdateAvailable } from '../sw';
import { isIosStandalone } from '../viewport';

const NAV: { to: string; key: Key; icon: typeof House; end?: boolean }[] = [
  { to: '/', key: 'nav.home', icon: House, end: true },
  { to: '/sets', key: 'nav.sets', icon: Cards },
  { to: '/review', key: 'nav.review', icon: ArrowsClockwise },
  { to: '/stats', key: 'nav.stats', icon: ChartBar },
  { to: '/settings', key: 'nav.settings', icon: GearSix },
];

/** Fällige Karten aus aktiven (nicht archivierten) Sets, für die Zahl am Navigationspunkt. */
export function useDueCount(): number {
  return (
    useLiveQuery(async () => {
      const now = Date.now();
      const archived = new Set((await db.sets.filter((s) => s.archivedAt !== null).primaryKeys()) as string[]);
      return db.cardStates
        .where('due')
        .belowOrEqual(endOfDay(now))
        .filter((s) => s.fsrs.state !== 0 && !archived.has(s.setId) && (s.fsrs.state === 2 || s.due <= now))
        .count();
    }, []) ?? 0
  );
}

function NavItems({ compact }: { compact?: boolean }) {
  const t = useT();
  const due = useDueCount();
  return (
    <>
      {NAV.map(({ to, key, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          {({ isActive }) => (
            <>
              <span className="nav-icon">
                <Icon size={compact ? 24 : 20} weight={isActive ? 'fill' : 'regular'} />
                {to === '/review' && due > 0 && <span className="nav-badge num">{due > 99 ? '99+' : due}</span>}
              </span>
              <span className="nav-label">{t(key)}</span>
            </>
          )}
        </NavLink>
      ))}
    </>
  );
}

function SyncIndicator() {
  const t = useT();
  const { config, error, running } = useSync();
  const navigate = useNavigate();
  if (!config) return null;
  const Icon = error ? CloudSlash : CloudCheck;
  return (
    <button className={`sync-indicator ${error ? 'error' : ''}`} onClick={() => navigate('/settings#sync')}>
      <Icon size={18} />
      <span>{running ? t('sync.running') : error ? t(`sync.error.${error}` as Key) : t('sync.on')}</span>
    </button>
  );
}

export function Logo() {
  return (
    <span className="logo" aria-hidden>
      <AnchorSimple size={18} weight="bold" />
    </span>
  );
}

function UpdateBanner() {
  const t = useT();
  const [waiting, setWaiting] = useState(false);
  useEffect(() => onUpdateAvailable(setWaiting), []);
  if (!waiting) return null;
  return (
    <div className="update-banner" role="status">
      <span>{t('app.update')}</span>
      <button className="btn btn-sm btn-primary" onClick={applyUpdate}>
        {t('app.update.reload')}
      </button>
    </div>
  );
}

const INSTALL_KEY = 'grapnel.installHint';

function InstallHint() {
  const t = useT();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(INSTALL_KEY) === '1';
    } catch {
      dismissed = false;
    }
    setShow(ios && !isIosStandalone() && !dismissed);
  }, []);
  if (!show) return null;
  return (
    <div className="install-hint">
      <span>{t('app.install.ios')}</span>
      <button
        className="btn btn-sm"
        onClick={() => {
          setShow(false);
          try {
            localStorage.setItem(INSTALL_KEY, '1');
          } catch {
            // nur Komfort
          }
        }}
      >
        {t('app.install.dismiss')}
      </button>
    </div>
  );
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const rows: [ReactNode, Key][] = [
    [<Kbd key="s">{t('kbd.space')}</Kbd>, 'shortcuts.flip'],
    [
      <span key="lr" className="row">
        <Kbd>←</Kbd>
        <Kbd>→</Kbd>
      </span>,
      'shortcuts.prevNext',
    ],
    [
      <span key="r" className="row">
        <Kbd>1</Kbd>
        <Kbd>2</Kbd>
        <Kbd>3</Kbd>
        <Kbd>4</Kbd>
      </span>,
      'shortcuts.rate',
    ],
    [<Kbd key="e">Enter</Kbd>, 'shortcuts.check'],
    [
      <span key="c" className="row">
        <Kbd>1</Kbd>
        <span className="muted">…</span>
        <Kbd>4</Kbd>
      </span>,
      'shortcuts.choose',
    ],
    [
      <span key="tf" className="row">
        <Kbd>W</Kbd>
        <Kbd>F</Kbd>
      </span>,
      'shortcuts.tf',
    ],
    [<Kbd key="o">O</Kbd>, 'shortcuts.override'],
    [<Kbd key="m">S</Kbd>, 'shortcuts.shuffle'],
    [<Kbd key="esc">Esc</Kbd>, 'shortcuts.pause'],
    [<Kbd key="sl">/</Kbd>, 'shortcuts.search'],
    [
      <span key="n" className="row">
        <Kbd>Ctrl</Kbd>
        <Kbd>Enter</Kbd>
      </span>,
      'shortcuts.newCard',
    ],
    [<Kbd key="q">?</Kbd>, 'shortcuts.help'],
  ];
  return (
    <Dialog open={open} onClose={onClose} title={t('shortcuts.title')}>
      <div className="shortcut-list">
        {rows.map(([keys, label]) => (
          <div key={label} className="shortcut-row">
            <span>{t(label)}</span>
            {keys}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/** Rahmen aller normalen Seiten: Navigation links (Computer) oder unten (Handy). */
export function Shell() {
  const t = useT();
  const location = useLocation();
  const [shortcuts, setShortcuts] = useState(false);
  useHotkeys({ '?': () => setShortcuts(true) });
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <span>{t('app.name')}</span>
        </div>
        <nav className="side-nav" aria-label={t('nav.main')}>
          <NavItems />
        </nav>
        <div className="spacer" />
        <SyncIndicator />
      </aside>
      <main className="main" id="main">
        <UpdateBanner />
        <InstallHint />
        <Outlet />
      </main>
      <nav className="tabbar" aria-label={t('nav.main')}>
        <NavItems compact />
      </nav>
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
    </div>
  );
}

/** Seitenkopf: Titel, optional Zurück-Link und Aktionen rechts. */
export function PageHeader({ title, sub, back, actions }: { title: ReactNode; sub?: ReactNode; back?: { to: string; label: string }; actions?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className="page-header">
      {back && (
        <button className="back-link" onClick={() => navigate(back.to)}>
          ← {back.label}
        </button>
      )}
      <div className="page-header-row">
        <div className="page-title">
          <h1 className="break">{title}</h1>
          {sub && <div className="page-sub">{sub}</div>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}
