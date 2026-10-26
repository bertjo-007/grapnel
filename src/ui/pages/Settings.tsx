import { ArrowsClockwise, CloudArrowUp, Copy, DownloadSimple, Keyboard, LinkSimple, Trash, UploadSimple, Warning } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { setSyncActive, wipeAllData } from '../../core/db/repo';
import { exportJson, restoreBackup, type GrapnelFile } from '../../core/export/export';
import type { ArticlePolicy, Settings, ThemeChoice, UiLang } from '../../core/settings';
import { decodeCode, encodeCode, fromBase64Url, generateKey } from '../../core/sync/crypto';
import { deleteRemote, disableSync, enableSync, SYNC_AVAILABLE } from '../../core/sync/client';
import type { DirectionChoice } from '../../core/types';
import { dayKey } from '../../core/util/time';
import { ConfirmDialog, Dialog, Field, Segmented, Stepper, Switch } from '../components';
import { saveFile } from '../download';
import { useI18n, type Key } from '../i18n';
import { voiceFor } from '../media';
import { PageHeader, ShortcutsDialog } from '../shell/Shell';
import { useSettings, useSync, useToast } from '../state';
import { requestPersistence } from '../sw';
import { LangSelect } from './NewSet';

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className="panel panel-pad settings-section" id={id}>
      <h2 className="small-heading">{title}</h2>
      <div className="settings-body">{children}</div>
    </section>
  );
}

function fmtBytes(n: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v)} ${units[i]}`;
}

function StorageInfo() {
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<{ usage: number; persisted: boolean } | null>(null);
  const [denied, setDenied] = useState(false);
  const load = async () => {
    const est = (await navigator.storage?.estimate?.()) ?? {};
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    setInfo({ usage: est.usage ?? 0, persisted });
  };
  useEffect(() => {
    void load();
  }, []);
  if (!info) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="text-2">{t('settings.storage.used', { used: fmtBytes(info.usage, locale) })}</span>
      <div className={`callout ${info.persisted ? 'success' : 'warning'}`}>{info.persisted ? t('settings.storage.persisted') : t('settings.storage.notPersisted')}</div>
      {!info.persisted && (
        <div className="row-wrap">
          <button
            className="btn btn-sm"
            onClick={async () => {
              const ok = await requestPersistence();
              setDenied(!ok);
              await load();
            }}
          >
            {t('settings.storage.request')}
          </button>
          {denied && <span className="small muted">{t('settings.storage.denied')}</span>}
        </div>
      )}
    </div>
  );
}

function SyncSection() {
  const { t, relTime } = useI18n();
  const toast = useToast();
  const sync = useSync();
  const [consent, setConsent] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const codeId = useId();

  // Link aus dem QR-Code: #sync=… (der Teil nach # wird nie an einen Server geschickt).
  useEffect(() => {
    const m = location.hash.match(/^#sync=([A-Za-z0-9_-]+)$/);
    if (m) {
      try {
        const key = fromBase64Url(m[1]);
        if (key.length === 32) {
          setJoinCode(encodeCode(key));
          setJoinOpen(true);
        }
      } catch {
        // ungültiger Link: einfach ignorieren
      }
      history.replaceState(null, '', location.pathname);
    } else if (location.hash === '#sync') {
      document.getElementById('sync')?.scrollIntoView();
    }
  }, []);

  const code = sync.config ? encodeCode(fromBase64Url(sync.config.key)) : '';
  const link = sync.config ? `${location.origin}${import.meta.env.BASE_URL}settings#sync=${sync.config.key}` : '';
  useEffect(() => {
    if (!showCode || !link) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    void QRCode.toDataURL(link, { margin: 1, width: 240, color: { dark: dark ? '#eceef2' : '#14171c', light: dark ? '#161920' : '#fdfdfe' } }).then(setQr);
  }, [showCode, link]);

  const startNew = async () => {
    await enableSync(generateKey());
    await sync.refresh();
    const ok = await sync.run();
    setShowCode(true);
    toast(ok ? t('sync.started') : t(`sync.error.${sync.error ?? 'server'}` as Key), { kind: ok ? 'info' : 'error' });
  };

  const join = async () => {
    const key = decodeCode(joinCode);
    if (!key) {
      setJoinError(t('sync.code.invalid'));
      return;
    }
    await enableSync(key);
    await sync.refresh();
    setJoinOpen(false);
    const ok = await sync.run();
    toast(ok ? t('sync.joined') : t(`sync.error.${sync.error ?? 'server'}` as Key), { kind: ok ? 'info' : 'error' });
  };

  if (!sync.config) {
    return (
      <Section title={t('sync.title')} id="sync">
        <p className="text-2">{t('sync.off.text')}</p>
        <ul className="sync-how small text-2">
          <li>{t('sync.how.1')}</li>
          <li>{t('sync.how.2')}</li>
          <li>{t('sync.how.3')}</li>
        </ul>
        <label className="consent">
          <input type="checkbox" className="check" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span className="small">{t('sync.consent')}</span>
        </label>
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={!consent} onClick={() => void startNew()}>
            <CloudArrowUp size={18} />
            {t('sync.start')}
          </button>
          <button className="btn" disabled={!consent} onClick={() => setJoinOpen(true)}>
            <LinkSimple size={18} />
            {t('sync.join')}
          </button>
        </div>
        <Dialog
          open={joinOpen}
          onClose={() => setJoinOpen(false)}
          title={t('sync.join.title')}
          footer={
            <>
              <button className="btn" onClick={() => setJoinOpen(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={() => void join()} disabled={!joinCode.trim()}>
                {t('sync.join.confirm')}
              </button>
            </>
          }
        >
          <p className="text-2">{t('sync.join.text')}</p>
          <p className="small text-2">{t('sync.how.2')}</p>
          <Field label={t('sync.code')} id={codeId} error={joinError}>
            <textarea id={codeId} className="textarea mono-input" rows={3} value={joinCode} onChange={(e) => (setJoinCode(e.target.value), setJoinError(null))} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
          </Field>
        </Dialog>
      </Section>
    );
  }

  return (
    <Section title={t('sync.title')} id="sync">
      <div className="row-wrap">
        <span className="badge badge-success">{t('sync.on')}</span>
        <span className="small text-2">{sync.config.lastSyncAt ? t('sync.last', { when: relTime(sync.config.lastSyncAt) }) : t('sync.never')}</span>
        {sync.pending > 0 && <span className="small muted">{t('sync.pending', { n: sync.pending })}</span>}
      </div>
      {sync.error && (
        <div className="callout danger">
          <Warning size={18} />
          {t(`sync.error.${sync.error}` as Key)}
        </div>
      )}
      <div className="row-wrap">
        <button className="btn" disabled={sync.running} onClick={async () => toast((await sync.run()) ? t('sync.ok') : t(`sync.error.${sync.error ?? 'server'}` as Key))}>
          <ArrowsClockwise size={18} />
          {sync.running ? t('sync.running') : t('sync.now')}
        </button>
        <button className="btn" onClick={() => setShowCode((s) => !s)}>
          {showCode ? t('sync.code.hide') : t('sync.code.show')}
        </button>
        <button className="btn btn-ghost" onClick={() => setDisableOpen(true)}>
          {t('sync.disable')}
        </button>
      </div>
      {showCode && (
        <div className="sync-code">
          {qr && <img src={qr} alt="QR" width={200} height={200} className="qr" />}
          <div className="stack" style={{ gap: 8 }}>
            <span className="field-label">{t('sync.code')}</span>
            <code className="code break">{code}</code>
            <div className="row-wrap">
              <button
                className="btn btn-sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(code);
                  toast(t('sync.code.copied'));
                }}
              >
                <Copy size={16} />
                {t('common.copy')}
              </button>
            </div>
            <p className="small muted">{t('sync.qr.help')}</p>
          </div>
        </div>
      )}
      <Dialog
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        title={t('sync.disable.title')}
        footer={
          <>
            <button
              className="btn"
              onClick={async () => {
                await disableSync();
                await sync.refresh();
                setDisableOpen(false);
              }}
            >
              {t('sync.disable.keep')}
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                try {
                  await deleteRemote();
                } catch {
                  toast(t('sync.error.offline'), { kind: 'error' });
                  return;
                }
                await disableSync();
                await sync.refresh();
                setDisableOpen(false);
              }}
            >
              {t('sync.disable.delete')}
            </button>
          </>
        }
      >
        <p className="text-2">{t('sync.disable.text')}</p>
      </Dialog>
    </Section>
  );
}

export function SettingsPage() {
  const { t, percent } = useI18n();
  const { settings, update } = useSettings();
  const toast = useToast();
  const sync = useSync();
  const navigate = useNavigate();
  const restoreInput = useRef<HTMLInputElement>(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const ids = { name: useId() };
  const [name, setName] = useState(settings.name);
  const set = (patch: Partial<Settings>) => void update(patch);
  const answer = (patch: Partial<Settings['answer']>) => void update({ answer: { ...settings.answer, ...patch } });
  const srs = (patch: Partial<Settings['srs']>) => void update({ srs: { ...settings.srs, ...patch } });
  const hasVoice = !!voiceFor('fr', settings.allowOnlineVoices) || !!voiceFor('de', settings.allowOnlineVoices);

  return (
    <div className="stack narrow settings">
      <PageHeader title={t('settings.title')} />

      <Section title={t('settings.profile')}>
        <Field label={t('settings.name')} id={ids.name}>
          <input id={ids.name} className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => set({ name: name.trim() })} autoComplete="given-name" />
        </Field>
      </Section>

      <Section title={t('settings.appearance')}>
        <Field label={t('settings.theme')}>
          <Segmented<ThemeChoice>
            label={t('settings.theme')}
            value={settings.theme}
            onChange={(v) => set({ theme: v })}
            options={[
              { value: 'system', label: t('settings.theme.system') },
              { value: 'light', label: t('settings.theme.light') },
              { value: 'dark', label: t('settings.theme.dark') },
            ]}
          />
        </Field>
        <Field label={t('settings.language')}>
          <Segmented<UiLang>
            label={t('settings.language')}
            value={settings.uiLang}
            onChange={(v) => set({ uiLang: v })}
            options={[
              { value: 'de', label: 'Deutsch' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Field>
        <Switch checked={settings.reduceMotion} onChange={(v) => set({ reduceMotion: v })} label={t('settings.reduceMotion')} help={t('settings.reduceMotion.help')} />
        <Switch checked={settings.showShortcutHints} onChange={(v) => set({ showShortcutHints: v })} label={t('settings.shortcuts')} help={t('settings.shortcuts.help')} />
        <button className="btn btn-sm btn-ghost align-start" onClick={() => setShortcuts(true)}>
          <Keyboard size={18} />
          {t('settings.shortcuts.open')}
        </button>
      </Section>

      <Section title={t('settings.learning')}>
        <Field label={t('settings.direction')}>
          <Segmented<DirectionChoice>
            label={t('settings.direction')}
            value={settings.defaultDirection}
            onChange={(v) => set({ defaultDirection: v })}
            options={[
              { value: 'f2b', label: t('settings.direction.f2b') },
              { value: 'b2f', label: t('settings.direction.b2f') },
              { value: 'both', label: t('dir.both') },
            ]}
          />
        </Field>
        <div className="setting-line">
          <span>{t('settings.newPerSession')}</span>
          <Stepper label={t('settings.newPerSession')} value={settings.newPerSession} onChange={(v) => set({ newPerSession: v })} min={1} max={100} />
        </div>
        <div className="setting-line">
          <span>{t('settings.newPerDay')}</span>
          <Stepper label={t('settings.newPerDay')} value={settings.srs.newPerDay} onChange={(v) => srs({ newPerDay: v })} min={1} max={500} step={5} />
        </div>
        <div className="setting-line">
          <span>{t('settings.roundSize')}</span>
          <Stepper label={t('settings.roundSize')} value={settings.roundSize} onChange={(v) => set({ roundSize: v })} min={3} max={20} />
        </div>
        <Switch checked={settings.autoShuffle} onChange={(v) => set({ autoShuffle: v })} label={t('settings.autoShuffle')} />
        <Field label={t('settings.flashRating')}>
          <Segmented
            label={t('settings.flashRating')}
            value={settings.flashcardRating}
            onChange={(v) => set({ flashcardRating: v })}
            options={[
              { value: 'binary', label: t('flash.rating.binary') },
              { value: 'four', label: t('flash.rating.four') },
            ]}
          />
        </Field>
      </Section>

      <Section title={t('settings.answers')}>
        <Switch checked={settings.answer.ignoreCase} onChange={(v) => answer({ ignoreCase: v })} label={t('settings.ignoreCase')} disabled={settings.answer.strict} />
        <Switch checked={settings.answer.tolerateAccents} onChange={(v) => answer({ tolerateAccents: v })} label={t('settings.tolerateAccents')} disabled={settings.answer.strict} />
        <Switch checked={settings.answer.tolerateTypos} onChange={(v) => answer({ tolerateTypos: v })} label={t('settings.tolerateTypos')} help={t('settings.tolerateTypos.help')} disabled={settings.answer.strict} />
        <Switch checked={settings.answer.strict} onChange={(v) => answer({ strict: v })} label={t('settings.strict')} help={t('settings.strict.help')} />
        <Field label={t('settings.articles')} help={t('settings.articles.help')}>
          <Segmented<ArticlePolicy>
            label={t('settings.articles')}
            value={settings.answer.articles}
            onChange={(v) => answer({ articles: v })}
            options={[
              { value: 'foreign', label: t('settings.articles.foreign') },
              { value: 'always', label: t('settings.articles.always') },
              { value: 'never', label: t('settings.articles.never') },
            ]}
          />
        </Field>
        <Field label={t('settings.nativeLang')}>
          <LangSelect value={settings.nativeLang} onChange={(l) => set({ nativeLang: l })} />
        </Field>
      </Section>

      <Section title={t('settings.srs')}>
        <Field label={t('settings.retention')} help={t('settings.retention.help')}>
          <Segmented
            label={t('settings.retention')}
            value={String(settings.srs.retention)}
            onChange={(v) => srs({ retention: Number(v) })}
            options={['0.8', '0.85', '0.9', '0.95'].map((v) => ({ value: v, label: percent(Number(v)) }))}
          />
        </Field>
        <Field label={t('settings.maxInterval')}>
          <Segmented
            label={t('settings.maxInterval')}
            value={String(settings.srs.maxIntervalDays)}
            onChange={(v) => srs({ maxIntervalDays: Number(v) })}
            options={[90, 180, 365, 730].map((d) => ({ value: String(d), label: t('count.days', { n: d }) }))}
          />
        </Field>
        <Link to="/help/srs" className="small">
          {t('review.explain')}
        </Link>
      </Section>

      <Section title={t('settings.voices')}>
        <Switch checked={settings.allowOnlineVoices} onChange={(v) => set({ allowOnlineVoices: v })} label={t('settings.onlineVoices')} help={t('settings.onlineVoices.help')} />
        {!hasVoice && <p className="small muted">{t('settings.voices.none')}</p>}
      </Section>

      {SYNC_AVAILABLE && <SyncSection />}

      <Section title={t('settings.data')}>
        <StorageInfo />
        <div className="data-actions">
          <div className="data-action">
            <div>
              <strong>{t('settings.export')}</strong>
              <p className="small text-2">{t('settings.export.help')}</p>
            </div>
            <button
              className="btn"
              onClick={async () => {
                const file = await exportJson('all', { progress: true, media: true });
                await saveFile(JSON.stringify(file), `grapnel-sicherung-${dayKey(Date.now())}.json`, 'application/json');
              }}
            >
              <DownloadSimple size={18} />
              {t('common.export')}
            </button>
          </div>
          <div className="data-action">
            <div>
              <strong>{t('settings.restore')}</strong>
              <p className="small text-2">{t('settings.restore.help')}</p>
            </div>
            <button className="btn" onClick={() => restoreInput.current?.click()}>
              <UploadSimple size={18} />
              {t('common.import')}
            </button>
            <input
              ref={restoreInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  const file = JSON.parse(await f.text()) as GrapnelFile;
                  if (file.app !== 'grapnel') throw new Error();
                  const r = await restoreBackup(file, settings);
                  toast(t('settings.restore.done', { sets: r.sets, cards: r.cards, logs: r.logs }));
                } catch {
                  toast(t('settings.restore.error'), { kind: 'error' });
                }
              }}
            />
          </div>
          <div className="data-action">
            <div>
              <strong>{t('settings.wipe')}</strong>
              <p className="small text-2">{t('settings.wipe.text')}</p>
            </div>
            <button className="btn btn-danger" onClick={() => setWipeOpen(true)}>
              <Trash size={18} />
              {t('common.delete')}
            </button>
          </div>
        </div>
      </Section>

      <Section title={t('settings.about')}>
        <p className="small text-2">{t(SYNC_AVAILABLE ? 'settings.about.text' : 'settings.about.local')}</p>
      </Section>

      <ConfirmDialog
        open={wipeOpen}
        danger
        title={t('settings.wipe.title')}
        text={t('settings.wipe.text')}
        extra={sync.config ? <p className="small text-2">{t('settings.wipe.sync')}</p> : undefined}
        requireWord={t('settings.wipe.word')}
        confirmLabel={t('settings.wipe.confirm')}
        onClose={() => setWipeOpen(false)}
        onConfirm={async () => {
          await wipeAllData();
          setSyncActive(false);
          await sync.refresh();
          setWipeOpen(false);
          toast(t('settings.wipe.done'));
          navigate('/', { replace: true });
        }}
      />
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
    </div>
  );
}
