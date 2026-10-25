import { Compass } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { EmptyState } from '../components';
import { useT } from '../i18n';

export function NotFound({ text }: { text?: string }) {
  const t = useT();
  return (
    <EmptyState icon={<Compass size={22} />} title={text ?? t('common.error')}>
      <Link to="/" className="btn btn-primary">
        {t('session.home')}
      </Link>
    </EmptyState>
  );
}
