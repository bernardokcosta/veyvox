import { useEffect, useRef } from 'react';
import { JUNO_PIZZA_MS, type JunoMove, type JunoView } from '@veyvox/shared/src/juno';
import { JUNO_ASSETS, junoCardUrl } from './junoAssets';
import { junoSeats } from './junoSeats';
import { pizzaOrbitFrames, type JunoPizzaPoint } from './junoPizzaGeometry';
import { layoutPixels } from '../../platform/interfaceScale';

interface Props {
  move: JunoMove | null;
  players: JunoView['players'];
  direction: 1 | -1;
  viewerId?: string;
  resolution: JunoView['pizzaResolution'];
  active: boolean;
}
function image(src: string, className: string): HTMLImageElement {
  const node = document.createElement('img');
  node.src = src; node.className = className; node.alt = ''; node.draggable = false;
  return node;
}

/** Decorative DOM/animation handles only. No hidden card data or game commands. */
export function JunoPizzaEffects(props: Props) {
  const { move, players, direction, resolution, active } = props;
  const layer = useRef<HTMLDivElement>(null), latest = useRef(props);
  const seen = useRef(move?.id), stopCurrent = useRef<(() => void) | null>(null);
  const id = move?.id, resolutionId = resolution?.id;
  const roster = players.map(p => p.userId).join(',');
  const previousLayout = useRef({ roster, direction });
  useEffect(() => { latest.current = props; }, [props]);
  useEffect(() => {
    if (!active || resolutionId !== id || previousLayout.current.roster !== roster || previousLayout.current.direction !== direction) stopCurrent.current?.();
    previousLayout.current = { roster, direction };
  }, [active, resolutionId, id, roster, direction]);
  useEffect(() => {
    if (!id || id === seen.current) return;
    seen.current = id;
    const current = latest.current, root = layer.current, match = root?.closest('.juno-match');
    if (!root || !match || !current.active || current.move?.type !== 'play' || current.move.card?.face !== 'pizza'
      || current.resolution?.id !== id || current.resolution.remainingMs < 2_000
      || typeof root.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const box = root.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const seats = junoSeats(current.players, current.viewerId), anchors = new Map<string, JunoPizzaPoint>();
    for (const [position, person] of Object.entries(seats)) {
      if (!person) continue;
      const seat = match.querySelector(`[data-seat="${position}"]`);
      const preferred = person.userId === current.viewerId ? match.querySelector('.juno-hand') : seat?.querySelector('.juno-opponent-cards');
      let rect = preferred?.getBoundingClientRect();
      if (!rect?.width || !rect.height) rect = seat?.getBoundingClientRect();
      if (!rect?.width || !rect.height) return;
      anchors.set(person.userId, { x: layoutPixels(rect.x + rect.width / 2 - box.x), y: layoutPixels(rect.y + rect.height / 2 - box.y) });
    }
    const author = current.players.findIndex(p => p.userId === current.move!.userId);
    if (author < 0 || anchors.size !== current.players.length) return;
    const ordered = current.players.map((_, i) => current.players[(author + i * current.direction + current.players.length) % current.players.length]!);
    const frames = pizzaOrbitFrames(ordered.map(p => anchors.get(p.userId)!));
    if (!frames.length) return;
    const card = match.querySelector('.juno-hand .juno-card-art') ?? match.querySelector('.juno-discard');
    const cardHeight = layoutPixels(card?.getBoundingClientRect().height ?? 0);
    if (cardHeight <= 0) return;
    const elapsed = Math.max(0, JUNO_PIZZA_MS - current.resolution.remainingMs);
    const animations: Animation[] = [], timers: number[] = [];
    let stopped = false;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      const rect = root.getBoundingClientRect();
      if (rect.width !== box.width || rect.height !== box.height || rect.x !== box.x || rect.y !== box.y) stop();
    });
    const visibility = () => { if (document.visibilityState === 'hidden') stop(); };
    function stop() {
      if (stopped) return;
      stopped = true;
      for (const animation of animations) animation.cancel();
      for (const timer of timers) window.clearTimeout(timer);
      observer?.disconnect(); window.removeEventListener('resize', stop); document.removeEventListener('visibilitychange', visibility);
      root!.replaceChildren();
      if (stopCurrent.current === stop) stopCurrent.current = null;
    }
    const animate = (node: HTMLElement, keyframes: Keyframe[], duration: number, delay = 0, easing = 'linear') => {
      const animation = node.animate(keyframes, { duration, delay, easing, fill: 'both' });
      animation.currentTime = elapsed; animations.push(animation);
    };
    const place = (node: HTMLElement, width: number, height = width) => {
      node.style.width = `${width}px`; node.style.height = `${height}px`;
      node.style.left = `${-width / 2}px`; node.style.top = `${-height / 2}px`;
      root.append(node);
    };
    stopCurrent.current = stop;
    try {
      const pizza = document.createElement('div'); pizza.className = 'juno-pizza-sprite';
      const art = image(JUNO_ASSETS.pizza, 'juno-pizza-spin'); pizza.append(art); place(pizza, cardHeight / 3);
      animate(pizza, frames.map((frame, i) => ({ ...frame, opacity: i === 0 || i === frames.length - 1 ? 0 : 1 })), JUNO_PIZZA_MS);
      animate(art, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(3600deg)' }], JUNO_PIZZA_MS);
      for (let i = 0; i < 32; i++) {
        const delay = 120 + i * 140, frame = frames[Math.floor(delay / JUNO_PIZZA_MS * (frames.length - 1))]!;
        const particle = image(JUNO_ASSETS.flourParticle, 'juno-pizza-particle'); place(particle, 6 + i % 4);
        animate(particle, [{ transform: `${frame.transform} scale(.6)`, opacity: 0 },
          { transform: `${frame.transform} scale(1)`, opacity: .55, offset: .15 },
          { transform: `${frame.transform} translate(${(i % 3 - 1) * 13}px, ${8 + i % 7}px) scale(2)`, opacity: 0 }], 450, delay, 'ease-out');
      }
      let total = 0;
      const touched = new Set<string>();
      for (const transfer of current.move.pizzaTransfers ?? []) {
        const from = anchors.get(transfer.fromUserId), to = anchors.get(transfer.toUserId);
        if (!from || !to || transfer.fromUserId === transfer.toUserId || !Number.isInteger(transfer.amount) || transfer.amount < 1) continue;
        const count = Math.min(5, transfer.amount, 20 - total);
        const sourceIndex = ordered.findIndex(p => p.userId === transfer.fromUserId);
        const base = sourceIndex / ordered.length * JUNO_PIZZA_MS + 100;
        for (let i = 0; i < count; i++) {
          const ghost = document.createElement('span'); ghost.className = 'juno-pizza-card juno-card-art juno-floured-card';
          ghost.append(image(junoCardUrl(undefined, true), 'juno-card-face'), image(JUNO_ASSETS.flour, 'juno-card-flour'));
          place(ghost, cardHeight * 720 / 1056 * .65, cardHeight * .65);
          const tilt = (total % 2 ? 1 : -1) * (8 + total % 7);
          animate(ghost, [
            { transform: `translate3d(${from.x}px, ${from.y}px, 0) rotate(${tilt}deg) scale(.7)`, opacity: 0 },
            { transform: `translate3d(${from.x}px, ${from.y - 10}px, 0) rotate(${tilt}deg) scale(1)`, opacity: 1, offset: .12 },
            { transform: `translate3d(${(from.x + to.x) / 2}px, ${(from.y + to.y) / 2 - cardHeight * .45}px, 0) rotate(${-tilt}deg) scale(1.08)`, opacity: 1, offset: .52 },
            { transform: `translate3d(${to.x}px, ${to.y}px, 0) rotate(${tilt / 2}deg) scale(.65)`, opacity: 0 },
          ], 700, base + i * 45, 'cubic-bezier(.22,.61,.36,1)');
          total++;
        }
        if (count) { touched.add(transfer.fromUserId); touched.add(transfer.toUserId); }
        if (total >= 20) break;
      }
      ordered.forEach((person, index) => {
        if (!touched.has(person.userId)) return;
        const delay = index / ordered.length * JUNO_PIZZA_MS + 150;
        if (delay < elapsed) return;
        timers.push(window.setTimeout(() => {
          if (stopped) return;
          const point = anchors.get(person.userId)!, impact = image(`${JUNO_ASSETS.flourImpact}?hit=${encodeURIComponent(id)}-${index}`, 'juno-pizza-impact');
          const size = cardHeight * .8; place(impact, size);
          impact.style.left = `${point.x - size / 2}px`; impact.style.top = `${point.y - size / 2}px`;
          const animation = impact.animate([{ opacity: .8, transform: 'scale(.6)' }, { opacity: 0, transform: 'scale(1.2)' }], { duration: 650, fill: 'both', easing: 'ease-out' });
          animations.push(animation);
        }, delay - elapsed));
      });
      observer?.observe(match); window.addEventListener('resize', stop); document.addEventListener('visibilitychange', visibility);
      timers.push(window.setTimeout(stop, current.resolution.remainingMs));
    } catch { stop(); /* Cosmetic API/asset failures must not block the match. */ }
    return stop;
  }, [id]);
  return <div ref={layer} className="juno-effects juno-pizza-effects" aria-hidden="true" />;
}
