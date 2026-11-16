import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JunoPizzaEffects } from './JunoPizzaEffects';
import { junoGame } from './junoTestFixtures';
import type { JunoMove } from '@veyvox/shared/src/juno';

const animate = vi.fn();
const cancel = vi.fn();
const move: JunoMove = { id: 'pizza', type: 'play', userId: 'a', card: { id: 'public', face: 'pizza', color: null },
  pizzaTransfers: [{ fromUserId: 'a', toUserId: 'b', amount: 5 }, { fromUserId: 'b', toUserId: 'a', amount: 2 }] };
const props = { players: junoGame('playing').players, direction: 1 as const, viewerId: 'a', active: true };
function Fixture({ current = null, active = true, onStop, startedAt = 10_000 }: { current?: JunoMove | null; active?: boolean; onStop?: (id: string) => void; startedAt?: number }) {
  return <div className="juno-match"><div data-seat="top"><div className="juno-opponent-cards" /></div>
    <div data-seat="bottom" /><div className="juno-discard" /><div className="juno-hand"><span className="juno-card-art" /></div>
    <JunoPizzaEffects {...props} move={current} active={active} onStop={onStop} startedAt={startedAt} resolution={current ? { id: current.id!, remainingMs: 5_000 } : undefined} />
  </div>;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  animate.mockReset(); cancel.mockReset(); animate.mockImplementation(() => ({ cancel, currentTime: 0 }));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const box = this.matches('.juno-match,.juno-pizza-effects') ? [0, 0, 600, 500]
      : this.matches('.juno-hand') ? [50, 400, 500, 80] : this.matches('.juno-hand .juno-card-art') ? [270, 400, 50, 90]
      : this.matches('.juno-opponent-cards') ? [260, 30, 80, 50] : [260, 200, 60, 90];
    return DOMRect.fromRect({ x: box[0], y: box[1], width: box[2], height: box[3] });
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(Element.prototype, 'animate'); Reflect.deleteProperty(document, 'timeline'); });
describe('bounded confirmed pizza presentation', () => {
  it('starts delayed effects on the same observed clock as hands and still finishes at the original deadline', () => {
    const onStop = vi.fn(), view = render(<Fixture onStop={onStop} />);
    act(() => vi.advanceTimersByTime(200));
    view.rerender(<Fixture current={move} onStop={onStop} />);
    expect(animate.mock.results[0]!.value.currentTime).toBe(200);
    act(() => vi.advanceTimersByTime(4_800));
    expect(view.container.querySelector('.juno-pizza-sprite')).toBeNull();
    expect(onStop).toHaveBeenCalledExactlyOnceWith('pizza');
  });
  it('anchors native animations absolutely instead of waiting for their pending play task', () => {
    Object.defineProperty(document, 'timeline', { configurable: true, value: { currentTime: 600 } });
    vi.spyOn(performance, 'now').mockReturnValue(600);
    const view = render(<Fixture />);
    act(() => vi.advanceTimersByTime(200));
    view.rerender(<Fixture current={move} />);
    expect(animate.mock.results[0]!.value.startTime).toBe(400);
  });
  it('does not replay an initial or polled move, uses card-height/3, and flies only private-safe backs', () => {
    const view = render(<Fixture current={move} />); expect(animate).not.toHaveBeenCalled();
    view.rerender(<Fixture current={{ ...move, id: 'new' }} />);
    expect(view.container.querySelector('.juno-pizza-sprite')).toHaveStyle({ width: '30px', height: '30px' });
    expect(view.container.querySelectorAll('.juno-pizza-card')).toHaveLength(7);
    for (const image of view.container.querySelectorAll('.juno-pizza-card .juno-card-face')) expect(image).toHaveAttribute('src', '/games/juno/cards/back.webp');
    expect(view.container.innerHTML).not.toContain('public');
    const calls = animate.mock.calls.length; view.rerender(<Fixture current={{ ...move, id: 'new' }} />);
    expect(animate).toHaveBeenCalledTimes(calls); expect(cancel).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5_000)); expect(view.container.querySelector('.juno-pizza-sprite')).toBeNull();
    expect(view.container.querySelectorAll('.juno-pizza-card,.juno-pizza-particle')).toHaveLength(0);
  });
  it('shows the pizza but no fabricated transfers for an all-zero exchange', () => {
    const view = render(<Fixture />); view.rerender(<Fixture current={{ ...move, pizzaTransfers: [] }} />);
    expect(view.container.querySelector('.juno-pizza-sprite')).toBeInTheDocument();
    expect(view.container.querySelector('.juno-pizza-card')).toBeNull();
  });
  it.each(['resize', 'disconnect', 'unmount'] as const)('cancels animation and all timers on %s without replay', mode => {
    const view = render(<Fixture />); view.rerender(<Fixture current={move} />);
    expect(animate).toHaveBeenCalled();
    if (mode === 'resize') act(() => window.dispatchEvent(new Event('resize')));
    if (mode === 'disconnect') view.rerender(<Fixture current={move} active={false} />);
    if (mode === 'unmount') view.unmount();
    expect(cancel).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    if (mode !== 'unmount') {
      view.rerender(<Fixture current={{ ...move }} />); expect(view.container.querySelector('.juno-pizza-sprite')).toBeNull();
    }
  });
  it('consumes reduced-motion moves without spinning, flying or later replaying them', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const view = render(<Fixture />); view.rerender(<Fixture current={move} />);
    expect(animate).not.toHaveBeenCalled(); expect(view.container.querySelector('.juno-pizza-sprite')).toBeNull();
    vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList);
    view.rerender(<Fixture current={{ ...move }} />); expect(animate).not.toHaveBeenCalled();
  });
  it('releases staged hands if geometry prevents animation', () => {
    vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue(DOMRect.fromRect({ width: 0, height: 0 }));
    const onStop = vi.fn(), view = render(<Fixture onStop={onStop} />);
    view.rerender(<Fixture current={move} onStop={onStop} />);
    expect(onStop).toHaveBeenCalledExactlyOnceWith('pizza');
    expect(animate).not.toHaveBeenCalled();
  });
  it('cancels travel and staged hands when reduced motion is enabled mid-flight', () => {
    const motion = new EventTarget() as EventTarget & { matches: boolean };
    motion.matches = false; vi.mocked(window.matchMedia).mockReturnValue(motion as MediaQueryList);
    const onStop = vi.fn(), view = render(<Fixture onStop={onStop} />);
    view.rerender(<Fixture current={move} onStop={onStop} />);
    act(() => { motion.matches = true; motion.dispatchEvent(new Event('change')); });
    expect(onStop).toHaveBeenCalledExactlyOnceWith('pizza');
    expect(cancel).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
