import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { JUNO_MAX_PLAYERS } from '@veyvox/shared/src/juno';
import { useJunoStore } from '../../stores/junoStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useAuthStore } from '../../stores/authStore';
import { JunoPlayerBadge } from './JunoPlayerBadge';
import { JunoCard } from './JunoCard';
import { JUNO_ASSETS } from './junoAssets';
import { Modal } from '../ui/Modal';

export function JunoLobby({ onRanking }: { onRanking: () => void }) {
  const { t } = useTranslation(['voice', 'common']);
  const { snapshot, target, connected, pending, stale, loading, command } = useJunoStore();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const self = useAuthStore(s => s.user);
  const spaceId = useSpaceStore(s => target ? s.spaceChannelIndex.get(target.channelId)?.spaceId ?? '' : '');
  const game = snapshot?.game;
  const isPlayer = !!game?.players.some(p => p.userId === target?.userId);
  const disabled = !connected || pending || stale || !snapshot;
  // Older hosts never advertise six seats; until a snapshot says otherwise, offer the full table.
  const maxSeats = !game || snapshot?.supportsSix === true ? JUNO_MAX_PLAYERS : 4;
  return <div className="juno-lobby">
    {!game && self && <div className="juno-lobby-identity"><JunoPlayerBadge person={{ userId: self.id, name: self.displayName ?? self.username,
      user: self }} spaceId={spaceId} self /></div>}
    <img className="juno-main-logo" src={JUNO_ASSETS.logo} alt={t('juno.name')} />
    <h2>{game ? t('juno.lobbyTitle') : t('juno.invitation')}</h2>
    <p className="sr-only">{game ? t('juno.lobbyHint') : t('juno.description')}</p>
    {game && <div className="juno-lobby-players" aria-label={t('juno.players')}>
      {game.players.map(player => <div className="juno-lobby-seat" key={player.userId}>
        <JunoPlayerBadge person={player} spaceId={spaceId}
          self={player.userId === target?.userId} detail={player.userId === game.hostId ? t('juno.host') : player.computer ? undefined : t('juno.ready')} />
        {player.computer && target?.userId === game.hostId && game.supportsBots && <button type="button" className="juno-remove-bot"
          aria-label={t('juno.removeBot', { name: t('juno.botName', { number: player.computer }) })} disabled={disabled}
          onClick={() => void command({ type: 'removeBot', botId: player.userId })}>×</button>}
      </div>)}
      {Array.from({ length: Math.max(0, maxSeats - game.players.length) }, (_, i) => game.supportsBots && target?.userId === game.hostId
        ? <button type="button" className="juno-seat-empty" key={i} aria-label={t('juno.addBot')} title={t('juno.addBot')}
          disabled={disabled} onClick={() => void command({ type: 'addBot' })}><span aria-hidden="true">＋</span></button>
        : <div className="juno-seat-empty" key={i} aria-label={t('juno.emptySeat')}><span aria-hidden="true">＋</span></div>)}
    </div>}
    {game && game.phase === 'lobby' && snapshot?.supportsOptions === true && <>
      <button type="button" className="juno-secondary juno-options-toggle" disabled={disabled} onClick={() => setOptionsOpen(true)}>{t('juno.options.title')}</button>
      <Modal isOpen={optionsOpen} onClose={() => setOptionsOpen(false)} maxWidth="max-w-md" mobileStyle="sheet">
        <div className="juno-options" role="dialog" aria-modal="true" aria-label={t('juno.options.title')}>
          <h2>{t('juno.options.title')}</h2>
          <label><input type="checkbox" checked={game.options.specials} disabled={disabled || target?.userId !== game.hostId} onChange={event => void command({ type: 'options', specials: event.target.checked })} />{t('juno.options.specials')}</label>
          <p>{t('juno.options.specialsHint')}</p>
          <label><input type="checkbox" checked={game.options.stacking} disabled={disabled || target?.userId !== game.hostId} onChange={event => void command({ type: 'options', stacking: event.target.checked })} />{t('juno.options.stacking')}</label>
          <p>{t('juno.options.stackingHint')}</p>
        </div>
      </Modal>
    </>}
    <div className="juno-menu-actions">
      {!game ? loading && !snapshot ? <p role="status">{t('common:states.loading')}</p>
        : <button type="button" className="juno-primary" disabled={disabled} onClick={() => void command({ type: 'create' })}>{t('juno.create')}</button>
        : target?.userId === game.hostId ? <button type="button" className="juno-primary" disabled={disabled || game.players.length < 2} onClick={() => void command({ type: 'start' })}>{t('juno.start')}</button>
          : !isPlayer ? <button type="button" className="juno-primary" disabled={disabled || game.players.length >= maxSeats} onClick={() => void command({ type: 'join' })}>{game.players.length >= maxSeats ? t('juno.full') : t('juno.join')}</button>
            : <p role="status">{t('juno.waitingHost')}</p>}
      <button type="button" className="juno-secondary" onClick={onRanking}>{t('juno.rankingTitle')}</button>
    </div>
    {game && <p className="sr-only">{t('juno.seats', { occupied: game.players.length, max: maxSeats })}</p>}
    <div className="juno-lobby-cards" aria-hidden="true"><JunoCard card={{ id: 'decoration', color: 'coral', face: '5' }} />
      <JunoCard card={{ id: 'decoration', color: 'mint', face: '2' }} /><JunoCard card={{ id: 'decoration', color: 'sky', face: '4' }} />
      <JunoCard card={{ id: 'decoration', color: null, face: 'draw4' }} /></div>
  </div>;
}
