import { useTranslation } from 'react-i18next';
import { useVoiceStore } from '../../stores/voiceStore';

export function VideoOnlyToggle({ className }: { className: string }) {
  const { t } = useTranslation('voice');
  const active = useVoiceStore((s) => s.hideNonVideoParticipants);
  const setActive = useVoiceStore((s) => s.setHideNonVideoParticipants);
  return (
    <button
      type="button"
      className={`${className} ${active ? 'bg-accent-primary/20 text-txt-primary' : 'text-txt-secondary hover:text-txt-primary'}`}
      aria-label={t('controls.hideNonVideo')}
      aria-pressed={active}
      title={t(active ? 'controls.showNonVideo' : 'controls.hideNonVideo')}
      onClick={() => setActive(!active)}
    >
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
        <path d="m10 9 5 3-5 3z" fill="currentColor" />
      </svg>
    </button>
  );
}
