import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JunoView } from '@veyvox/shared/src/juno';
import { junoGame } from './junoTestFixtures';
import { useJunoPizzaPresentation } from './useJunoPizzaPresentation';

function views() {
  const before = junoGame('playing');
  before.hand = [{ id: 'pizza', face: 'pizza', color: null }, { id: 'out', face: '2', color: 'mint' }, { id: 'stay', face: '3', color: 'coral' }];
  before.players[0]!.cardCount = 3;
  const after: JunoView = { ...before, hand: [before.hand[2]!, { id: 'in', face: '4', color: 'sky', floured: true }],
    players: before.players.map(p => ({ ...p, cardCount: p.userId === 'a' ? 2 : 7, flouredCardCount: 1 })),
    lastMove: { id: 'pizza-move', type: 'play', userId: 'a', card: before.hand[0],
      pizzaTransfers: [{ fromUserId: 'a', toUserId: 'b', amount: 1 }, { fromUserId: 'b', toUserId: 'a', amount: 1 }] },
    pizzaResolution: { id: 'pizza-move', remainingMs: 5_000 } };
  return { before, after };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); Reflect.deleteProperty(Element.prototype, 'animate'); });

describe('match-local pizza presentation lifecycle', () => {
  it('preserves the first observation anchor for delayed rendering and subsequent polls', () => {
    const { before, after } = views();
    const { result, rerender } = renderHook(({ game, observedAt }) => useJunoPizzaPresentation(game, 'a', observedAt, true),
      { initialProps: { game: before, observedAt: 10_000 } });
    act(() => vi.advanceTimersByTime(200));
    rerender({ game: after, observedAt: 10_000 });
    expect(result.current.startedAt).toBe(10_000);
    expect(result.current.game!.hand.map(c => c.id)).toEqual(['stay']);
    rerender({ game: { ...after, pizzaResolution: { id: 'pizza-move', remainingMs: 4800 } }, observedAt: 10_200 });
    expect(result.current.startedAt).toBe(10_000);
  });
  it('updates three-player departures and arrivals even when timeouts truncate fractional delays', () => {
    const schedule = window.setTimeout;
    vi.spyOn(window, 'setTimeout').mockImplementation((fn, delay, ...args) => schedule(fn, Math.trunc(delay ?? 0), ...args));
    const { before, after } = views();
    before.players.push({ userId: 'c', name: 'C', cardCount: 7, announced: false });
    after.players.push({ userId: 'c', name: 'C', cardCount: 7, announced: false, flouredCardCount: 1 });
    after.lastMove!.pizzaTransfers = [
      { fromUserId: 'a', toUserId: 'b', amount: 1 },
      { fromUserId: 'b', toUserId: 'c', amount: 1 },
      { fromUserId: 'c', toUserId: 'a', amount: 1 },
    ];
    const { result, rerender, unmount } = renderHook(({ game }) => useJunoPizzaPresentation(game, 'a', 10_000, true),
      { initialProps: { game: before } });
    rerender({ game: after });
    act(() => vi.advanceTimersByTime(1766));
    act(() => vi.advanceTimersByTime(34));
    expect(result.current.game!.players.map(p => p.cardCount)).toEqual([1, 7, 7]);
    act(() => vi.advanceTimersByTime(666));
    act(() => vi.advanceTimersByTime(34));
    expect(result.current.game!.players.map(p => p.cardCount)).toEqual([1, 7, 8]);
    unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it('stages a fresh exchange, keeps the authoritative view untouched and does not restart on polls', () => {
    const { before, after } = views();
    const { result, rerender, unmount } = renderHook(({ game, observedAt }) => useJunoPizzaPresentation(game, 'a', observedAt, true),
      { initialProps: { game: before, observedAt: 10_000 } });
    rerender({ game: after, observedAt: 10_000 });
    expect(result.current.game!.hand.map(c => c.id)).toEqual(['out', 'stay']);
    expect(after.hand.map(c => c.id)).toEqual(['stay', 'in']);
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.game!.hand.map(c => c.id)).toEqual(['stay']);
    act(() => vi.advanceTimersByTime(700));
    expect(result.current.game!.players[1]!.cardCount).toBe(8);
    rerender({ game: { ...after, pizzaResolution: { id: 'pizza-move', remainingMs: 4200 } }, observedAt: 10_800 });
    expect(result.current.game!.players[1]!.cardCount).toBe(8);
    act(() => vi.advanceTimersByTime(2500));
    expect(result.current.game!.hand).toEqual(after.hand);
    unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['initial', 'reduced', 'stale', 'viewer', 'roster', 'cancel', 'completed'] as const)('shows the committed state without stale private cards on %s', mode => {
    const { before, after } = views();
    if (mode === 'reduced') vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const { result, rerender, unmount } = renderHook(
      ({ game, viewer, active }) => useJunoPizzaPresentation(game, viewer, 10_000, active),
      { initialProps: { game: mode === 'initial' ? after : before, viewer: 'a', active: true } });
    rerender({ game: after, viewer: 'a', active: mode !== 'stale' });
    if (mode === 'viewer') rerender({ game: { ...after, hand: [] }, viewer: 'b', active: true });
    if (mode === 'roster') rerender({ game: { ...after, players: after.players.slice(0, 1) }, viewer: 'a', active: true });
    if (mode === 'cancel') act(() => result.current.onStop('pizza-move'));
    if (mode === 'completed') rerender({ game: { ...after, pizzaResolution: undefined }, viewer: 'a', active: true });
    expect(result.current.game!.hand.map(c => c.id)).not.toContain('out');
    unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});
