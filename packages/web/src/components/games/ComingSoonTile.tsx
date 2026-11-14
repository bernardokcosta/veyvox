import { useTranslation } from 'react-i18next';

/**
 * A game that is announced but not playable yet: the name with an "Em breve"
 * badge. Not a button and not focusable, so the dialog's focus trap and the
 * keyboard flow only see the games that can actually open.
 */
export function ComingSoonTile({ name }: { name: string }) {
  const { t } = useTranslation('voice');
  return <div className="w-full h-full min-h-0 rounded-[14px] border border-border-soft bg-surface-elevated flex flex-col items-center justify-center gap-2 p-3 select-none"
    aria-label={`${name} — ${t('juno.comingSoon')}`}>
    <span className="text-lg font-bold tracking-wide text-txt-secondary">{name}</span>
    <span className="rounded-full bg-interactive-hover px-2.5 py-0.5 text-ui-caption text-txt-tertiary">{t('juno.comingSoon')}</span>
  </div>;
}
