import { useState } from 'react';
import { db } from '../core/db/db';
import { cardsToDelimited, exportJson, fileName } from '../core/export/export';
import type { CardState, StudySet } from '../core/types';
import { Dialog, Segmented, Switch } from './components';
import { saveFile } from './download';
import { useI18n } from './i18n';
import { useToast } from './state';

type Format = 'csv' | 'tsv' | 'json';

export async function exportSetFile(set: StudySet, format: Format, extras: boolean, progress: boolean): Promise<void> {
  if (format === 'json') {
    const file = await exportJson([set.id], { progress, media: extras });
    await saveFile(JSON.stringify(file, null, 2), fileName(set.title, 'json'), 'application/json');
    return;
  }
  const cards = await db.cards.where('[setId+position]').between([set.id, -Infinity], [set.id, Infinity]).toArray();
  const states = new Map<string, CardState>((await db.cardStates.where('setId').equals(set.id).toArray()).map((s) => [s.key, s]));
  const text = cardsToDelimited(cards, states, { delimiter: format === 'csv' ? ',' : '\t', extras, progress });
  await saveFile(text, fileName(set.title, format), format === 'csv' ? 'text/csv;charset=utf-8' : 'text/tab-separated-values;charset=utf-8');
}

export function ExportDialog({ set, open, onClose }: { set: StudySet; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [format, setFormat] = useState<Format>('csv');
  const [extras, setExtras] = useState(true);
  const [progress, setProgress] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${t('common.export')}: ${set.title}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await exportSetFile(set, format, extras, progress);
                onClose();
              } catch {
                toast(t('common.error'), { kind: 'error' });
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('common.export')}
          </button>
        </>
      }
    >
      <Segmented
        label={t('export.format')}
        value={format}
        onChange={setFormat}
        options={[
          { value: 'csv', label: 'CSV' },
          { value: 'tsv', label: 'TSV' },
          { value: 'json', label: 'JSON' },
        ]}
      />
      <p className="small text-2">{format === 'json' ? t('export.help.json') : t('export.help.table')}</p>
      <Switch checked={extras} onChange={setExtras} label={format === 'json' ? t('export.media') : t('export.extras')} />
      <Switch checked={progress} onChange={setProgress} label={t('export.progress')} />
    </Dialog>
  );
}

