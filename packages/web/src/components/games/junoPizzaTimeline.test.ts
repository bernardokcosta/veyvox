import { describe, expect, it } from 'vitest';
import type { JunoView } from '@veyvox/shared/src/juno';
import { junoGame } from './junoTestFixtures';
import { pizzaFlights, projectPizzaHands } from './junoPizzaTimeline';

function exchange() {
  const before = junoGame('playing');
  before.hand = [
    { id: 'pizza', face: 'pizza', color: null }, { id: 'out', face: '2', color: 'mint' },
    { id: 'stay', face: '3', color: 'coral', floured: true },
  ];
  before.players[0]!.cardCount = 3; before.players[0]!.flouredCardCount = 1;
  before.players[1]!.cardCount = 7; before.players[1]!.flouredCardCount = 0;
  const after: JunoView = { ...before, hand: [before.hand[2]!, { id: 'in', face: '4', color: 'sky', floured: true }],
    players: before.players.map(p => ({ ...p, cardCount: p.userId === 'a' ? 2 : 7, flouredCardCount: p.userId === 'a' ? 2 : 1 })),
    lastMove: { id: 'exchange', type: 'play', userId: 'a', card: before.hand[0],
      pizzaTransfers: [{ fromUserId: 'a', toUserId: 'b', amount: 1 }, { fromUserId: 'b', toUserId: 'a', amount: 1 }] },
    pizzaResolution: { id: 'exchange', remainingMs: 5_000 } };
  return { before, after };
}
describe('shared pizza departure/arrival timeline', () => {
  it.each([2, 3, 4])('uses integer departure and arrival boundaries for %i players', count => {
    const { after } = exchange();
    after.players = Array.from({ length: count }, (_, i) => ({ userId: String(i), name: String(i), cardCount: 7, announced: false }));
    after.lastMove!.userId = '0';
    after.lastMove!.pizzaTransfers = after.players.map((p, i) => ({ fromUserId: p.userId, toUserId: String((i + 1) % count), amount: 5 }));
    expect(pizzaFlights(after).every(f => Number.isInteger(f.departureMs) && Number.isInteger(f.arrivalMs))).toBe(true);
  });
  it('schedules the complete six-player exchange with every arrival inside five seconds', () => {
    const { after } = exchange();
    after.players = Array.from({ length: 6 }, (_, i) => ({ userId: String(i), name: String(i), cardCount: 7, announced: false }));
    after.lastMove!.userId = '0';
    after.lastMove!.pizzaTransfers = after.players.map((p, i) => ({ fromUserId: p.userId, toUserId: String((i + 1) % 6), amount: 5 }));
    const flights = pizzaFlights(after);
    expect(flights).toHaveLength(30);
    expect(flights.every(f => Number.isInteger(f.departureMs) && Number.isInteger(f.arrivalMs))).toBe(true);
    expect(Math.max(...flights.map(f => f.arrivalMs))).toBeLessThanOrEqual(5_000);
    expect(flights.filter(f => f.fromUserId === '5').every(f => f.arrivalMs <= 5_000)).toBe(true);
  });
  it('uses the same author/direction schedule for all viewers and completes flights inside five seconds', () => {
    const { after } = exchange();
    expect(pizzaFlights(after)).toEqual([
      { fromUserId: 'a', toUserId: 'b', departureMs: 100, arrivalMs: 800 },
      { fromUserId: 'b', toUserId: 'a', departureMs: 2600, arrivalMs: 3300 },
    ]);
    after.direction = -1;
    after.players.push(...['c', 'd'].map(userId => ({ userId, name: userId, announced: false, cardCount: 7 })));
    after.lastMove!.pizzaTransfers = after.players.map(p => ({ fromUserId: p.userId, toUserId: p.userId === 'a' ? 'b' : 'a', amount: 5 }));
    const flights = pizzaFlights(after);
    expect(flights).toHaveLength(20);
    expect(flights.filter(f => f.fromUserId === 'd')[0]!.departureMs).toBe(1350);
    expect(Math.max(...flights.map(f => f.arrivalMs))).toBeLessThan(5_000);
  });
  it('removes the played pizza immediately, removes outgoing cards on departure and adds floured incoming cards only on arrival', () => {
    const { before, after } = exchange(), flights = pizzaFlights(after);
    const at = (elapsed: number) => projectPizzaHands(before, after, flights, 'a', elapsed);
    expect(at(0).hand.map(c => c.id)).toEqual(['out', 'stay']);
    expect(at(99).players.map(p => p.cardCount)).toEqual([2, 7]);
    expect(at(100).hand.map(c => c.id)).toEqual(['stay']);
    expect(at(799).players.map(p => p.cardCount)).toEqual([1, 7]);
    expect(at(800).players.map(p => p.cardCount)).toEqual([1, 8]);
    expect(at(2600).players.map(p => p.cardCount)).toEqual([1, 7]);
    expect(at(3299).hand.map(c => c.id)).toEqual(['stay']);
    expect(at(3300).hand).toEqual(after.hand);
    expect(at(5000).players).toEqual(after.players);
    expect(before.hand).toHaveLength(3);
  });
  it('uses only aggregate opponent flour counts and never restores a masked private hand', () => {
    const { before, after } = exchange();
    after.hand = []; after.maskedHand = [{ id: 'masked' }]; after.memoryCurse = { id: 'curse', targetUserId: 'a' };
    const view = projectPizzaHands(before, after, pizzaFlights(after), 'a', 0);
    expect(view.hand).toEqual([]);
    expect(view.maskedHand).toEqual(after.maskedHand);
    expect(view.players.map(p => p.flouredCardCount)).toEqual([1, 0]);
    expect(projectPizzaHands(before, after, pizzaFlights(after), 'a', 800).players[1]!.flouredCardCount).toBe(1);
  });
});
