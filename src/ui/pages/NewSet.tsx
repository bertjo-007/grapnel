import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { createSet } from '../../core/db/repo';
import type { Lang } from '../../core/types';
import { Field } from '../components';
import { useI18n } from '../i18n';
import { PageHeader } from '../shell/Shell';

export const LANGS: Lang[] = ['fr', 'de', 'en', 'it', 'es', 'other'];

export function LangSelect({ id, value, onChange }: { id?: string; value: Lang; onChange: (l: Lang) => void }) {
  const { langName } = useI18n();
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value as Lang)}>
      {LANGS.map((l) => (
        <option key={l} value={l}>
          {langName(l)}
        </option>
      ))}
    </select>
  );
}

export function NewSetPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [frontLang, setFront] = useState<Lang>('fr');
  const [backLang, setBack] = useState<Lang>('de');
  const [busy, setBusy] = useState(false);
  const ids = { title: useId(), desc: useId(), front: useId(), back: useId() };

  const create = async () => {
    setBusy(true);
    const set = await createSet({ title: title.trim() || t('editor.newSetTitle'), description, frontLang, backLang });
    navigate(`/sets/${set.id}/edit?new=1`, { replace: true });
  };

  return (
    <div className="stack narrow">
      <PageHeader title={t('home.newSet')} back={{ to: '/sets', label: t('nav.sets') }} />
      <form
        className="panel panel-pad stack"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Field label={t('editor.setTitle')} id={ids.title}>
          <input id={ids.title} className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('editor.newSetTitle')} autoFocus />
        </Field>
        <Field label={t('editor.setDescription')} id={ids.desc}>
          <textarea id={ids.desc} className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label={t('editor.frontLang')} id={ids.front}>
            <LangSelect id={ids.front} value={frontLang} onChange={setFront} />
          </Field>
          <Field label={t('editor.backLang')} id={ids.back}>
            <LangSelect id={ids.back} value={backLang} onChange={setBack} />
          </Field>
        </div>
        <div className="row">
          <div className="spacer" />
          <button type="button" className="btn" onClick={() => navigate(-1)}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t('common.continue')}
          </button>
        </div>
      </form>
    </div>
  );
}
