import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { JUNO_PIZZA_MS, type JunoView } from '@veyvox/shared/src/juno';
import { pizzaFlights, projectPizzaHands, type PizzaFlight } from './junoPizzaTimeline';

interface Presentation { before: JunoView; id: string; startedAt: number; flights: PizzaFlight[] }
const roster = (game: JunoView) => JSON.stringify([game.id, game.direction, game.players.map(p => p.userId)]);

/** The store remains authoritative; only this mounted match's visible hands are staged. */
export function useJunoPizzaPresentation(game: JunoView | null, viewerId: string | undefined, observedAt: number, active: boolean) {
  const previous = useRef({ game, viewerId }), held = useRef<Presentation | null>(null);
  const [cancelledId, setCancelledId] = useState<string | null>(null);
  const [, tick] = useState(0);
  const onStop = useCallback((id: string) => setCancelledId(id), []);
  const presentation = useMemo(() => {
    const move = game?.lastMove, resolution = game?.pizzaResolution;
    if (!game || !active || game.phase !== 'playing' || move?.type !== 'play' || move.card?.face !== 'pizza'
      || !move.id || resolution?.id !== move.id || cancelledId === move.id
      || previous.current.viewerId !== viewerId || typeof Element.prototype.animate !== 'function'
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
    if (held.current?.id === move.id && roster(held.current.before) === roster(game)) return held.current;
    const before = previous.current.game;
    if (!before || before.phase !== 'playing' || before.lastMove?.id === move.id
      || roster(before) !== roster(game) || resolution.remainingMs < 2_000) return null;
    const flights = pizzaFlights(game);
    // A missed intervening move is not a reliable pre-exchange view.
    if (before.players.some(person => {
      const after = game.players.find(p => p.userId === person.userId)!;
      return person.cardCount - (person.userId === move.userId ? 1 : 0)
        - flights.filter(f => f.fromUserId === person.userId).length
        + flights.filter(f => f.toUserId === person.userId).length !== after.cardCount;
    })) return null;
    if (viewerId && !before.maskedHand && !game.maskedHand) {
      const original = before.hand.filter(c => c.id !== move.card?.id);
      const oldIds = new Set(original.map(c => c.id)), newIds = new Set(game.hand.map(c => c.id));
      if (original.filter(c => !newIds.has(c.id)).length !== flights.filter(f => f.fromUserId === viewerId).length
        || game.hand.filter(c => !oldIds.has(c.id)).length !== flights.filter(f => f.toUserId === viewerId).length) return null;
    }
    return { before, id: move.id, flights, startedAt: observedAt - (JUNO_PIZZA_MS - resolution.remainingMs) };
  }, [game, viewerId, observedAt, active, cancelledId]);
  useLayoutEffect(() => { previous.current = { game, viewerId }; held.current = presentation; }, [game, viewerId, presentation]);
  useEffect(() => {
    if (!presentation) return;
    const elapsed = Date.now() - presentation.startedAt;
    const boundaries = new Set([JUNO_PIZZA_MS, ...presentation.flights.flatMap(f => [f.departureMs, f.arrivalMs])]);
    const timers = [...boundaries].filter(ms => ms > elapsed).map(ms => window.setTimeout(() => tick(n => n + 1), Math.ceil(ms - elapsed)));
    return () => { for (const timer of timers) window.clearTimeout(timer); };
  }, [presentation]);
  const startedAt = presentation?.startedAt ?? observedAt - (JUNO_PIZZA_MS - (game?.pizzaResolution?.remainingMs ?? JUNO_PIZZA_MS));
  return { game: game && presentation ? projectPizzaHands(presentation.before, game, presentation.flights, viewerId, Date.now() - startedAt) : game, startedAt, onStop };
}
