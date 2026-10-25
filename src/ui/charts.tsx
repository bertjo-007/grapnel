import type { DayActivity, StatusCounts } from '../core/stats/stats';
import { useI18n } from './i18n';

/**
 * Kleine, eigene Diagramme. Sie zeigen nur, was gespeichert ist: Tage ohne Antworten
 * sind leer (keine erfundene 0-%-Linie), Achsen beginnen bei 0.
 */

function dayLabel(day: string, locale: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  return new Intl.DateTimeFormat(locale, opts).format(new Date(`${day}T12:00:00`));
}

/** Aktivitäts-Kalender: Spalten = Wochen, Zeilen = Wochentage (Mo bis So). */
export function Heatmap({ days }: { days: DayActivity[] }) {
  const { t, locale } = useI18n();
  const max = Math.max(1, ...days.map((d) => d.answers));
  const level = (n: number) => (n === 0 ? 0 : n <= max * 0.25 ? 1 : n <= max * 0.5 ? 2 : n <= max * 0.75 ? 3 : 4);
  // Mit Montag beginnen: vorne auffüllen.
  const first = new Date(`${days[0].day}T12:00:00`).getDay();
  const pad = (first + 6) % 7;
  const cells: (DayActivity | null)[] = [...Array.from({ length: pad }, () => null), ...days];
  const weeks: (DayActivity | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const total = days.reduce((n, d) => n + d.answers, 0);
  return (
    <div className="heatmap-wrap">
      <div className="heatmap" role="img" aria-label={`${t('stats.activity')}: ${t('count.answers', { n: total })}`}>
        {weeks.map((w, i) => (
          <div key={i} className="heatmap-week">
            {w.map((d, j) => (d ? <span key={j} className={`hm l${level(d.answers)}`} title={t('stats.day', { day: dayLabel(d.day, locale), n: d.answers })} /> : <span key={j} className="hm empty" />))}
          </div>
        ))}
      </div>
      <div className="heatmap-legend small muted">
        <span>{t('stats.less')}</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`hm l${l}`} />
        ))}
        <span>{t('stats.moreLegend')}</span>
      </div>
    </div>
  );
}

/** Senkrechte Balken mit Beschriftung an den Enden der Achse. */
export function Bars({ data, format, highlightFirst }: { data: { day: string; value: number }[]; format?: (v: number) => string; highlightFirst?: boolean }) {
  const { locale } = useI18n();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="bars-wrap">
      <div className="bars" role="list">
        {data.map((d, i) => (
          <div key={d.day} className="bar-col" role="listitem" title={`${dayLabel(d.day, locale)}: ${format ? format(d.value) : d.value}`}>
            <span className="bar-value num">{d.value > 0 ? (format ? format(d.value) : d.value) : ''}</span>
            <span className={`bar ${highlightFirst && i === 0 ? 'first' : ''}`} style={{ height: `${(d.value / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="axis small muted">
        <span>{dayLabel(data[0].day, locale)}</span>
        <span>{dayLabel(data[data.length - 1].day, locale)}</span>
      </div>
    </div>
  );
}

/** Anteil richtiger Antworten pro Tag. Lücken, wo nicht gelernt wurde. */
export function AccuracyLine({ days }: { days: DayActivity[] }) {
  const { locale, percent } = useI18n();
  const w = 100;
  const h = 40;
  const n = days.length;
  const x = (i: number) => (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => h - v * h;
  const segments: string[] = [];
  let cur = '';
  days.forEach((d, i) => {
    if (d.accuracy === null) {
      if (cur) segments.push(cur);
      cur = '';
      return;
    }
    cur += `${cur ? 'L' : 'M'}${x(i).toFixed(2)},${y(d.accuracy).toFixed(2)}`;
  });
  if (cur) segments.push(cur);
  const withData = days.filter((d) => d.accuracy !== null);
  return (
    <div className="line-wrap">
      <div className="line-chart">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
          {[0.5, 1].map((g) => (
            <line key={g} x1={0} x2={w} y1={y(g)} y2={y(g)} className="grid-line" vectorEffect="non-scaling-stroke" />
          ))}
          {segments.map((d, i) => (
            <path key={i} d={d} className="line" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {days.map((d, i) =>
          d.accuracy === null ? null : (
            <span key={d.day} className="line-dot" style={{ left: `${(x(i) / w) * 100}%`, top: `${(y(d.accuracy) / h) * 100}%` }} title={`${dayLabel(d.day, locale)}: ${percent(d.accuracy)} (${d.correct}/${d.answers})`} />
          ),
        )}
        <span className="line-label top small muted">{percent(1)}</span>
        <span className="line-label mid small muted">{percent(0.5)}</span>
      </div>
      <div className="axis small muted">
        <span>{dayLabel(days[0].day, locale)}</span>
        <span className="sr-only">{withData.map((d) => `${dayLabel(d.day, locale)} ${percent(d.accuracy!)}`).join(', ')}</span>
        <span>{dayLabel(days[n - 1].day, locale)}</span>
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<keyof StatusCounts, string> = {
  mastered: 'var(--success)',
  review: 'var(--accent)',
  learning: 'var(--warning)',
  new: 'var(--surface-3)',
};

/** Kartenstatus am Ende jedes Tages als gestapelte Balken. */
export function StackedStatus({ rows }: { rows: ({ day: string } & StatusCounts)[] }) {
  const { t, locale } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.new + r.learning + r.review + r.mastered));
  const order: (keyof StatusCounts)[] = ['mastered', 'review', 'learning', 'new'];
  return (
    <div className="bars-wrap">
      <div className="bars stacked">
        {rows.map((r) => {
          const total = r.new + r.learning + r.review + r.mastered;
          return (
            <div key={r.day} className="bar-col" title={`${dayLabel(r.day, locale)}: ${order.map((k) => `${t(`status.${k}`)} ${r[k]}`).join(', ')}`}>
              <span className="stack-bar" style={{ height: `${(total / max) * 100}%` }}>
                {order.map((k) => (r[k] > 0 ? <span key={k} style={{ flex: r[k], background: STATUS_COLORS[k] }} /> : null))}
              </span>
            </div>
          );
        })}
      </div>
      <div className="axis small muted">
        <span>{dayLabel(rows[0].day, locale)}</span>
        <span>{dayLabel(rows[rows.length - 1].day, locale)}</span>
      </div>
    </div>
  );
}
