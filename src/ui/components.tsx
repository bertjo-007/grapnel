import { X } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useT } from './i18n';

// ---------- Dialog ----------

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/** Natives <dialog>: Fokusfalle, Escape und Hintergrund-Sperre gibt der Browser dazu. */
export function Dialog({ open, onClose, title, children, footer, wide }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useT();
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'wide' : ''}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <div className="dialog-head">
            <h2 id={titleId}>{title}</h2>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label={t('common.close')}>
              <X size={18} />
            </button>
          </div>
          <div className="dialog-body">{children}</div>
          {footer && <div className="dialog-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  text: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  danger?: boolean;
  /** Wort, das zur Bestätigung eingetippt werden muss. */
  requireWord?: string;
  extra?: ReactNode;
}

export function ConfirmDialog({ open, title, text, confirmLabel, onConfirm, onClose, danger, requireWord, extra }: ConfirmProps) {
  const t = useT();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  const ok = !requireWord || typed.trim().toUpperCase() === requireWord.toUpperCase();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-2">{text}</div>
      {extra}
      {requireWord && (
        <div className="field">
          <span className="field-label" id={`${inputId}-l`}>
            {t('settings.wipe.type', { word: requireWord })}
          </span>
          <input id={inputId} aria-labelledby={`${inputId}-l`} className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" />
        </div>
      )}
    </Dialog>
  );
}

// ---------- Eingaben ----------

/**
 * Feld mit Beschriftung darüber. Bewusst kein <label> als Hülle: Ein Label leitet Taps an
 * das erste Steuerelement weiter (Fallstrick aus Aurum). Die Verknüpfung läuft über id.
 */
export function Field({ label, help, error, children, id }: { label: string; help?: ReactNode; error?: string | null; children: ReactNode; id?: string }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? <span className="field-error">{error}</span> : help ? <span className="field-help">{help}</span> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, help, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="switch-row">
      <div className="switch-text">
        <span id={id}>{label}</span>
        {help && <span className="field-help">{help}</span>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={id} className="switch" disabled={disabled} onClick={() => onChange(!checked)} />
    </div>
  );
}

export interface SegOption<V extends string> {
  value: V;
  label: ReactNode;
  title?: string;
}

export function Segmented<V extends string>({ value, options, onChange, label }: { value: V; options: SegOption<V>[]; onChange: (v: V) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, min, max, step = 1, label, suffix }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; label: string; suffix?: string }) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="btn btn-sm btn-icon" onClick={() => onChange(clamp(value - step))} disabled={value <= min} aria-label="-">
        −
      </button>
      <span className="num stepper-value">
        {value}
        {suffix ? ` ${suffix}` : ''}
      </span>
      <button type="button" className="btn btn-sm btn-icon" onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label="+">
        +
      </button>
    </div>
  );
}

// ---------- Darstellung ----------

export function Progress({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, text, children }: { icon: ReactNode; title: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children && <div className="row-wrap">{children}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** Aufklappmenü, schliesst bei Klick ausserhalb oder Escape. */
export function Menu({ trigger, children, up }: { trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode; children: (close: () => void) => ReactNode; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div className={`menu ${up ? 'up' : ''}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function Skeleton({ h = 20, w = '100%' }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden />;
}

export function LoadingBlock() {
  const t = useT();
  return (
    <div className="stack" aria-busy="true" aria-label={t('common.loading')}>
      <Skeleton h={28} w="40%" />
      <Skeleton h={88} />
      <Skeleton h={88} />
    </div>
  );
}
