import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { JunoCard as Card, JunoMove } from '@veyvox/shared/src/juno';
import { JunoCard } from './JunoCard';
import { JunoStackOverlay } from './JunoStackOverlay';
import { JUNO_ASSETS } from './junoAssets';
import { layoutPixels } from '../../platform/interfaceScale';
import { useFormatters } from '../../i18n/formatters';

interface ReportAnchor { left: number; top: number; width: number; height: number }

/** Only new confirmed moves animate. Mounting, polls and reconnects never replay. */
export function JunoEffects({ move, position, name, viewerId, stackDraw = 0, topCardFace }: {
  move: JunoMove | null; position: string; name: string; viewerId?: string; stackDraw?: number; topCardFace?: Card['face'];
}) {
  const { t } = useTranslation('voice');
  const { formatNumber } = useFormatters();
  const layer = useRef<HTMLDivElement>(null);
  const seen = useRef(move?.id);
  const [cue, setCue] = useState<{ id: string; move: JunoMove; position: string; name: string; fromX: number; fromY: number; report: ReportAnchor } | null>(null);
  const [stackTake, setStackTake] = useState<{ id: string; amount: number; name: string } | null>(null);
  const id = move?.id;
  useEffect(() => {
    if (!id || id === seen.current) return;
    seen.current = id;
    // A normal draw yields at most one card. Timeouts can also draw for Memory,
    // but a stack timeout leaves its +2/+4 on top of the discard pile.
    const drawCardOnTop = topCardFace === 'draw2' || topCardFace === 'draw4';
    if ((move?.type === 'draw' || (move?.type === 'timeout' && drawCardOnTop)) && move.amount !== undefined && move.amount > 1) {
      setStackTake({ id, amount: move.amount, name });
    } else if (stackDraw > 0) {
      setStackTake(null);
    }
    if (!move || !['play', 'draw', 'announce', 'timeout', 'report', 'memory_miss', 'intoxicated_miss'].includes(move.type)) return;
    const box = layer.current?.getBoundingClientRect();
    const avatar = layer.current?.parentElement?.querySelector(`[data-seat="${position}"] .juno-avatar-frame`)?.getBoundingClientRect();
    const anchor = layer.current?.parentElement?.querySelector(`[data-seat="${position}"] .juno-report-anchor`)?.getBoundingClientRect();
    const width = anchor?.width ? layoutPixels(anchor.width) : 56;
    const height = anchor?.height ? layoutPixels(anchor.height) : 48;
    setCue({ id, move, position, name, fromX: box && avatar ? layoutPixels(avatar.x + avatar.width / 2 - box.x - box.width / 2) : 0,
      fromY: box && avatar ? layoutPixels(avatar.y + avatar.height / 2 - box.y - box.height * .4) : 0,
      report: { width, height, left: box && anchor ? layoutPixels(anchor.x - box.x)
        : box && avatar ? layoutPixels(avatar.x + avatar.width / 2 - box.x) - width * 119 / 360 : 0,
      top: box && anchor ? layoutPixels(anchor.y - box.y) : box && avatar ? layoutPixels(avatar.y - box.y) - height - 10 : 0 } });
  }, [id, move, position, name, stackDraw, topCardFace]);
  useEffect(() => {
    if (!cue) return;
    const timeout = window.setTimeout(() => setCue(null), cue.move.type === 'report' ? 1050 : 1400);
    return () => window.clearTimeout(timeout);
  }, [cue]);
  useEffect(() => {
    if (!stackTake) return;
    const timeout = window.setTimeout(() => setStackTake(null), 1600);
    return () => window.clearTimeout(timeout);
  }, [stackTake]);
  const announcement = cue?.move.type === 'announce' || cue?.move.announced;
  const special = cue?.move.card?.face;
  const symbol = special === 'draw2' ? '+2' : special === 'draw4' ? '+4' : special === 'reverse' ? '↺' : special === 'skip' ? '⊘' : null;
  return <><div ref={layer} className="juno-effects" aria-hidden="true" style={cue ? { '--from-x': `${cue.fromX}px`, '--from-y': `${cue.fromY}px` } as CSSProperties : undefined}>{cue && (cue.move.type === 'report'
    ? (cue.move.amount ?? 0) > 0 && <ReportImpact key={cue.id} id={cue.id} position={cue.position} anchor={cue.report} />
    : cue.move.type === 'memory_miss' ? <div key={cue.id} className="juno-effect-memory-miss">{t('juno.memory.miss', { name: cue.name, amount: cue.move.amount ?? 0 })}</div>
    : cue.move.type === 'intoxicated_miss' ? <div key={cue.id} className="juno-effect-intoxicated-miss glass">
      {cue.move.userId === viewerId && cue.move.misplayedCard && <div className="juno-intoxicated-wrong-card"><JunoCard card={cue.move.misplayedCard} /></div>}
      <span>{t('juno.intoxicated.miss', { name: cue.name, amount: formatNumber(cue.move.amount ?? 0) })}</span>
    </div> : <>
    {cue.move.card && <div key={`${cue.move.id}:card`} className="juno-effect-card" data-from={cue.position}><JunoCard card={cue.move.card} /></div>}
    {!cue.move.card && !announcement && <div key={`${cue.move.id}:draw`} className="juno-effect-draw" data-from={cue.position}><JunoCard back /></div>}
    {symbol && <strong key={`${cue.move.id}:special`} className="juno-effect-special">{symbol}</strong>}
    {cue.move.intoxicatedColor && <div className="juno-effect-intoxicated-color glass">{t('juno.intoxicated.colorChanged', { name: cue.name })}</div>}
    {announcement && <div key={`${cue.move.id}:juno`} className="juno-effect-announce" data-from={cue.position}>
      <img src={JUNO_ASSETS.logo} alt="" /><span>{t('juno.announcedBy', { name: cue.name })}</span>
    </div>}
  </>)}</div>
    {stackDraw > 0 ? <JunoStackOverlay amount={stackDraw} />
      : stackTake && <JunoStackOverlay key={stackTake.id} amount={stackTake.amount} takenBy={stackTake.name} />}
  </>;
}

/** The supplied first-frame crop is 284×236 at (254,5) in the 724×241 GIF. */
function ReportImpact({ id, position, anchor }: { id: string; position: string; anchor: ReportAnchor }) {
  const imageHeight = anchor.width * 150 / 180, scaleX = anchor.width / 284, scaleY = imageHeight / 236;
  const imageY = anchor.top + (anchor.height - imageHeight) / 2;
  return <div className="juno-effect-report" data-from={position}>
    <div className="juno-hammer-replay" style={{ left: anchor.left - 73 * scaleX, top: imageY, width: 389 * scaleX, height: imageHeight }}>
      <img src={`${JUNO_ASSETS.hammer}?hit=${encodeURIComponent(id)}`} alt="" draggable={false}
        style={{ left: -181 * scaleX, top: -5 * scaleY, width: 724 * scaleX, height: 241 * scaleY }} />
    </div>
    <div className="juno-report-impact" style={{ left: anchor.left + anchor.width * 119 / 360, top: imageY + imageHeight * .79 }}>
      <span className="juno-report-flash" /><span className="juno-report-ring" />
      {Array.from({ length: 12 }, (_, i) => {
        const angle = i * Math.PI / 6, distance = i % 2 ? 34 : 48;
        return <i key={i} style={{ '--dx': `${Math.cos(angle) * distance}px`, '--dy': `${Math.sin(angle) * distance}px`, '--turn': `${i * 37}deg` } as CSSProperties} />;
      })}
    </div>
  </div>;
}
