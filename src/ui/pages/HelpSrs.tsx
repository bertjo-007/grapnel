import { useI18n } from '../i18n';
import { PageHeader } from '../shell/Shell';

export function HelpSrs() {
  const { t } = useI18n();
  return (
    <div className="stack narrow prose">
      <PageHeader title={t('help.srs.title')} back={{ to: '/review', label: t('nav.review') }} />
      <p>{t('help.srs.p1')}</p>
      <p>{t('help.srs.p2')}</p>
      <h2>{t('help.srs.h2')}</h2>
      <ul>
        <li>{t('help.srs.l1')}</li>
        <li>{t('help.srs.l2')}</li>
        <li>{t('help.srs.l3')}</li>
      </ul>
      <h2>{t('help.srs.h3')}</h2>
      <p>{t('help.srs.p3')}</p>
      <h2>{t('help.srs.h4')}</h2>
      <p>{t('help.srs.p4')}</p>
    </div>
  );
}
