import { useTranslation } from 'react-i18next';
import { JUNO_MAX_PLAYERS } from '@veyvox/shared/src/juno';
import { useJunoStore } from '../../stores/junoStore';
import { JunoCard } from './JunoCard';
import { JUNO_ASSETS } from './junoAssets';
import { JunoLocale, useJunoLanguage } from './JunoLocale';
import './juno.css';

export function JunoTile({ onOpen, compact }: { onOpen?: () => void; compact?: boolean }) {
  return <JunoLocale><JunoTileContent onOpen={onOpen} compact={compact} /></JunoLocale>;
}
function JunoTileContent({ onOpen, compact }: { onOpen?: () => void; compact?: boolean }) {
  const { t } = useTranslation('voice');
  const snapshot = useJunoStore(s => s.snapshot);
  const game = snapshot?.game;
  const maxSeats = !game || snapshot?.supportsSix === true ? JUNO_MAX_PLAYERS : 4;
  const { language: gameLanguage, dir: gameDir } = useJunoLanguage();
  return <button type="button" className={compact ? 'juno-tile juno-tile-compact' : 'juno-tile'} lang={gameLanguage} dir={gameDir} onClick={onOpen ?? (() => useJunoStore.getState().setOpen(true))} aria-label={t('juno.open')}>
    <div className="juno-tile-cards"><JunoCard back /><JunoCard card={{ id: 'preview', face: '7', color: 'coral' }} /><JunoCard card={{ id: 'preview2', face: 'reverse', color: 'mint' }} /></div>
    <div><img className="juno-tile-logo" src={JUNO_ASSETS.logo} alt={t('juno.name')} /><span>{game?.phase === 'playing' ? t('juno.inProgress') : t('juno.seats', { occupied: game?.players.length ?? 0, max: maxSeats })}</span></div>
    <span className="juno-tile-open">{t('juno.open')}</span>
  </button>;
}
