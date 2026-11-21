import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomInt } from 'node:crypto';
import { canPlayJuno, type JunoCard } from '@veyvox/shared/src/juno.js';
import { actInRound, createJunoDeck, JunoRooms, startRound, type JunoRound } from './juno.js';
import { chooseJunoBlindCard, chooseJunoBotAction } from './junoBot.js';
import { redistributeJunoPizza } from './junoPizza.js';

vi.mock('node:crypto', async original => ({ ...await original<typeof import('node:crypto')>(), randomInt: vi.fn(() => 0) }));
const random = vi.mocked(randomInt as (max: number) => number);
beforeEach(() => { random.mockReset().mockReturnValue(0); });
const card = (id: string, face: JunoCard['face'] = '3', color: JunoCard['color'] = 'mint'): JunoCard => ({ id, face, color });
function round(count = 3): JunoRound {
  return { players: Array.from({ length: count }, (_, i) => ({ userId: String(i), name: String(i), announced: false,
    hand: [...(i === 0 ? [card('pizza', 'pizza', null)] : []), ...Array.from({ length: 7 }, (_, j) => card(`${i}:${j}`))] })),
  drawPile: [card('draw')], discard: [card('top', '8', 'sky')], color: 'sky', direction: 1, turn: 0,
  drawnCardId: null, deadline: 45_000, winnerId: null, result: null, lastMove: null, blockedTurns: 0,
  reportWindows: [], memoryEnabled: true, intoxicatedEnabled: true, pizzaEnabled: true, specials: true, stacking: false, stackDraw: 0, duos: false, teams: null };
}
const cards = (state: JunoRound) => [...state.drawPile, ...state.discard, ...state.players.flatMap(p => p.hand)];
const play = (state: JunoRound, now = 100) => actInRound(state, '0', { type: 'play', cardId: 'pizza' }, now);
function room(count = 3, capable = true) {
  let now = 0;
  const rooms = new JunoRooms({ now: () => now, present: () => true, changed: vi.fn() });
  let view = rooms.command('voice', { userId: '0', name: '0' }, { type: 'create' }, true, true, true);
  for (let i = 1; i < count; i++) view = rooms.command('voice', { userId: String(i), name: String(i) },
    { type: 'join', gameId: view.game!.id, revision: view.revision }, true, true, capable);
  view = rooms.command('voice', { userId: '0', name: '0' }, { type: 'start', gameId: view.game!.id, revision: view.revision }, true, true, true);
  const table = (rooms as unknown as { tables: Map<string, { round: JunoRound; people: { userId: string; computer?: 1 | 2 | 3 }[] }> }).tables.get('voice')!;
  return { rooms, table, view, setNow: (value: number) => { now = value; } };
}

describe('Pizza Maluca authoritative exchange', () => {
  it.each([1, 2, 3, 4, 5])('rolls %i from the same five-way range before clamping small hands', rolled => {
    const players = Array.from({ length: 7 }, (_, i) => ({
      userId: String(i), hand: Array.from({ length: i + 1 }, (_, j) => card(`${i}:${j}`)),
    }));
    for (let source = 0; source < players.length; source++) {
      random.mockImplementationOnce(max => { expect(max).toBe(5); return rolled - 1; });
      for (let i = 0; i < Math.min(rolled, source); i++) random.mockReturnValueOnce(0).mockReturnValueOnce(0);
    }
    const transfers = redistributeJunoPizza(players);
    for (let source = 0; source < players.length; source++) {
      expect(transfers.filter(t => t.fromUserId === String(source)).reduce((n, t) => n + t.amount, 0))
        .toBe(Math.min(rolled, source));
      expect(players[source]!.hand.some(c => c.id.startsWith(`${source}:`))).toBe(true);
    }
  });
  it.each([2, 3, 4])('exchanges at least one original card per eligible hand at the minimum roll with %i players', count => {
    const state = round(count); const before = state.players.map(p => p.hand.filter(c => c.face !== 'pizza').map(c => c.id));
    play(state);
    for (let i = 0; i < count; i++) {
      expect(state.lastMove!.pizzaTransfers!.filter(t => t.fromUserId === String(i)).reduce((n, t) => n + t.amount, 0)).toBe(1);
      expect(state.players[i]!.hand.map(c => c.id)).not.toEqual(before[i]);
    }
    expect(cards(state).filter(c => c.floured)).toHaveLength(count);
    if (count === 2) expect(state.players.map(p => p.hand.length)).toEqual([7, 7]);
  });
  it('can send every source card to one equally eligible recipient who receives more than five overall', () => {
    const players = round(4).players.map(p => ({ ...p, hand: p.hand.filter(c => c.face !== 'pizza') }));
    const original = players.flatMap(p => p.hand.map(c => c.id)).sort();
    random.mockImplementation(max => max === 5 ? 4 : 0);
    const transfers = redistributeJunoPizza(players);
    expect(transfers).toEqual([
      { fromUserId: '0', toUserId: '1', amount: 5 },
      { fromUserId: '1', toUserId: '0', amount: 5 },
      { fromUserId: '2', toUserId: '0', amount: 5 },
      { fromUserId: '3', toUserId: '0', amount: 5 },
    ]);
    expect(players[0]!.hand.filter(c => c.floured)).toHaveLength(15);
    expect(players.map(p => p.hand.length)).toEqual([17, 7, 2, 2]);
    expect(players.flatMap(p => p.hand.map(c => c.id)).sort()).toEqual(original);
  });
  it.each([2, 3, 4])('maps each equally likely recipient index to another player with %i seats', count => {
    for (let recipient = 0; recipient < count - 1; recipient++) {
      const players = round(count).players.map(p => ({ ...p, hand: p.hand.filter(c => c.face !== 'pizza') }));
      random.mockReset().mockImplementation(max => max === count - 1 ? recipient : 0);
      const transfers = redistributeJunoPizza(players);
      expect(random.mock.calls.filter(([max]) => max === count - 1)).toHaveLength(count);
      expect(transfers).toEqual(players.map((person, source) => ({
        fromUserId: person.userId, toUserId: String(recipient >= source ? recipient + 1 : recipient), amount: 1,
      })));
    }
  });
  it('adds one pizza only to the enhanced deck and starts with a numeric discard', () => {
    expect(createJunoDeck()).toHaveLength(108);
    expect(createJunoDeck(true)).toHaveLength(109);
    expect(createJunoDeck(true, true)).toHaveLength(110);
    const deck = createJunoDeck(true, true, true);
    expect(deck).toHaveLength(111); expect(deck.filter(c => c.face === 'pizza')).toHaveLength(1);
    const state = startRound([{ userId: '0', name: 'A' }, { userId: '1', name: 'B' }], 0, true, true, true);
    expect(cards(state)).toHaveLength(111); expect(state.discard[0]!.face).toMatch(/^\d$/);
  });
  it.each([1, -1] as const)('plays over any color/face, keeps color, and advances in direction %i', direction => {
    const state = round(); state.direction = direction;
    expect(canPlayJuno(state.players[0]!.hand[0]!, state.players[0]!.hand, state.discard[0]!, state.color)).toBe(true);
    play(state);
    expect(state.color).toBe('sky'); expect(state.turn).toBe(direction === 1 ? 1 : 2);
    expect(state.lastMove).toMatchObject({ type: 'play', card: { face: 'pizza' } });
    expect(state.lastMove!.pizzaTransfers!.reduce((n, t) => n + t.amount, 0)).toBe(3);
    expect(cards(state).filter(c => c.floured)).toHaveLength(3);
  });
  it.each([2, 3, 4])('sends up to five original cards per source without emptying any of %i hands', count => {
    const state = round(count); const original = cards(state).map(c => c.id).sort();
    random.mockImplementation(max => max - 1); play(state);
    expect(state.players.every(p => p.hand.length >= 1)).toBe(true);
    expect(state.lastMove?.pizzaTransfers?.reduce((n, t) => n + t.amount, 0)).toBe(5 * count);
    for (const source of state.players) {
      const outgoing = state.lastMove!.pizzaTransfers!.filter(t => t.fromUserId === source.userId);
      expect(outgoing.reduce((n, t) => n + t.amount, 0)).toBe(5);
      expect(outgoing.every(t => t.toUserId !== source.userId)).toBe(true);
    }
    expect(cards(state).map(c => c.id).sort()).toEqual(original);
    expect(cards(state).filter(c => c.floured)).toHaveLength(5 * count);
    expect(state.result).toBeNull();
  });
  it('never selects incoming cards again and permits split recipients', () => {
    const state = round(4); let seed = 9;
    random.mockImplementation(max => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max; });
    play(state);
    const transfers = state.lastMove!.pizzaTransfers!;
    expect(transfers.length).toBeGreaterThan(4);
    for (const source of state.players) {
      const moved = cards(state).filter(c => c.floured && c.id.startsWith(`${source.userId}:`));
      expect(moved).toHaveLength(transfers.filter(t => t.fromUserId === source.userId).reduce((n, t) => n + t.amount, 0));
      for (const c of moved) expect(source.hand).not.toContainEqual(c);
    }
  });
  it('protects one-card hands and preserves an already floured identity', () => {
    const state = round(); state.players[0]!.hand = [card('pizza', 'pizza', null), { ...card('one'), floured: true }];
    state.players[1]!.hand = [card('only')]; random.mockImplementation(max => max - 1);
    play(state);
    expect(state.players[0]!.hand).toContainEqual({ ...card('one'), floured: true });
    expect(state.players[1]!.hand).toContainEqual(card('only'));
    expect(state.lastMove!.pizzaTransfers!.some(t => t.fromUserId === '0' || t.fromUserId === '1')).toBe(false);
  });
  it('lets a normal last-card pizza win immediately without an exchange', () => {
    const state = round(); state.players[0]!.hand = [card('pizza', 'pizza', null)];
    random.mockClear(); play(state);
    expect(state.winnerId).toBe('0'); expect(state.result).toBe('emptyHand');
    expect(state.pizzaResolution).toBeUndefined(); expect(random).not.toHaveBeenCalled();
  });
  it('marks a card permanently through subsequent play and discard recycling', () => {
    const state = round(2); random.mockImplementation(max => Math.min(1, max - 1)); play(state);
    const current = state.players[state.turn]!;
    const marked = current.hand.find(c => c.floured)!;
    expect(marked).toBeDefined(); state.color = marked.color!;
    actInRound(state, current.userId, { type: 'play', cardId: marked.id }, 5_100);
    expect(state.discard.at(-1)?.floured).toBe(true); expect(state.lastMove?.card?.floured).toBe(true);
    const actor = state.players[state.turn]!; state.color = 'mint';
    actInRound(state, actor.userId, { type: 'play', cardId: actor.hand.find(c => c.color === 'mint')!.id }, 5_101);
    state.drawPile = []; state.drawnCardId = null;
    actInRound(state, state.players[state.turn]!.userId, { type: 'draw' }, 5_102);
    expect(cards(state).find(c => c.id === marked.id)?.floured).toBe(true);
  });
  it.each([2, 3, 4])('conserves every ID through seeded complete %i-player rounds', count => {
    for (let sample = 1; sample <= 4; sample++) {
      let seed = sample;
      random.mockImplementation(max => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max; });
      const state = startRound(Array.from({ length: count }, (_, i) => ({ userId: String(i), name: String(i) })), 0, true, true, true);
      const original = cards(state).map(c => c.id).sort(); let now = 0, moves = 0;
      while (!state.result && moves++ < 5000) {
        now = Math.max(now + 1, state.pizzaResolution?.endsAt ?? 0);
        const player = state.players[state.turn]!;
        const action = state.memoryCurse ? { type: 'play' as const, cardId: chooseJunoBlindCard(player.hand.map(c => c.id)), announce: true }
          : chooseJunoBotAction(player.hand, state.discard.at(-1)!, state.color, state.drawnCardId);
        actInRound(state, player.userId, action, now);
        expect(cards(state).map(c => c.id).sort()).toEqual(original);
        if (!state.result) expect(state.players.every(p => p.hand.length >= 1)).toBe(true);
      }
      expect(state.result).toBeTruthy();
    }
  });
});

describe('Pizza Maluca resolution and projection', () => {
  it('keeps the next full turn after five seconds and refuses actions without RNG during resolution', () => {
    const state = round(); play(state); random.mockClear();
    expect(state.pizzaResolution).toMatchObject({ startedAt: 100, endsAt: 5_100 });
    expect(state.deadline).toBe(50_100);
    const before = JSON.stringify(state);
    for (const action of [{ type: 'draw' }, { type: 'pass' }, { type: 'announce' }, { type: 'play', cardId: '1:0' },
      { type: 'report', targetUserId: '0', opportunityId: 'miss' }] as const) {
      expect(() => actInRound(state, '1', action, 5_099)).toThrow('juno_invalid_move');
    }
    expect(JSON.stringify(state)).toBe(before); expect(random).not.toHaveBeenCalled();
    actInRound(state, '1', { type: 'draw' }, 5_100); expect(state.pizzaResolution).toBeUndefined();
  });
  it('freezes valid report windows, removes expired ones, and starts an ordinary pizza miss after the pause', () => {
    const state = round(); state.players[0]!.hand.splice(2);
    state.players[1]!.hand.splice(1); state.players[2]!.hand.splice(1);
    state.reportWindows = [{ id: 'valid', targetUserId: '2', deadline: 1_000 }, { id: 'expired', targetUserId: '2', deadline: 99 }];
    play(state);
    expect(state.reportWindows.find(w => w.id === 'valid')?.deadline).toBe(6_000);
    expect(state.reportWindows.find(w => w.id === 'expired')).toBeUndefined();
    expect(state.reportWindows.find(w => w.targetUserId === '0')?.deadline).toBe(15_100);
  });
  it('clears recipients calls/reports and never creates a report for a hand reduced solely by transfer', () => {
    const state = round(2); state.players[0]!.hand.splice(2); state.players[0]!.announced = true;
    state.players[1]!.hand.splice(3); random.mockImplementation(max => max - 1);
    play(state);
    expect(state.players[0]!.hand).toHaveLength(3); expect(state.players[0]!.announced).toBe(false);
    expect(state.players[1]!.hand).toHaveLength(1); expect(state.reportWindows).toEqual([]);
  });
  it('freezes a 111-card capable cohort and preserves a mixed 110-card cohort', () => {
    const enhanced = room(); expect(enhanced.view.supportsPizza).toBe(true);
    expect(enhanced.table.round.pizzaEnabled).toBe(true); expect(cards(enhanced.table.round)).toHaveLength(111);
    const mixed = room(3, false); expect(mixed.table.round.pizzaEnabled).toBe(false); expect(cards(mixed.table.round)).toHaveLength(110);
    expect(() => enhanced.rooms.read('voice', 'watcher', true, true)).toThrow('juno_update_required');
    expect(() => enhanced.rooms.command('voice', { userId: '0', name: '0' },
      { type: 'draw', gameId: enhanced.view.game!.id, revision: enhanced.view.revision }, true, true)).toThrow('juno_update_required');
    expect(enhanced.rooms.command('voice', { userId: '2', name: '2' },
      { type: 'leave', gameId: enhanced.view.game!.id, revision: enhanced.view.revision }, true, true).game).toBeNull();
  });
  it('projects only own marked cards, aggregate opponent counts and public transfer quantities', () => {
    const { rooms, table, view, setNow } = room(); table.round = round(); setNow(100);
    random.mockImplementation(max => Math.min(1, max - 1));
    const result = rooms.command('voice', { userId: '0', name: '0' },
      { type: 'play', cardId: 'pizza', gameId: view.game!.id, revision: view.revision }, true, true, true);
    expect(result.game?.pizzaResolution).toEqual({ id: result.game?.lastMove?.id, remainingMs: 5_000 });
    expect(result.game?.remainingMs).toBe(45_000);
    const spectator = rooms.read('voice', 'watcher', true, true, true).game!;
    expect(spectator.hand).toEqual([]); expect(spectator.players.map(p => p.flouredCardCount)).toEqual([0, 2, 4]);
    expect(JSON.stringify(spectator)).not.toMatch(/0:|1:|2:/);
    expect(spectator.lastMove!.pizzaTransfers!.every(t => Object.keys(t).sort().join(',') === 'amount,fromUserId,toUserId')).toBe(true);
    table.round.memoryCurse = { id: 'curse', targetUserId: '1' };
    const masked = rooms.read('voice', '1', true, true, true).game!;
    expect(masked.hand).toEqual([]); expect(masked.maskedHand!.every(slot => Object.keys(slot).join(',') === 'id')).toBe(true);
  });
  it('does not consume RNG on invalid owned-card or stale rerolls', () => {
    const { rooms, table, view } = room(); table.round = round(); random.mockClear();
    expect(() => actInRound(table.round, '0', { type: 'play', cardId: 'unowned' }, 0)).toThrow();
    expect(random).not.toHaveBeenCalled();
    const command = { type: 'play' as const, cardId: 'pizza', gameId: view.game!.id, revision: view.revision };
    rooms.command('voice', { userId: '0', name: '0' }, command, true, true, true); random.mockClear();
    expect(() => rooms.command('voice', { userId: '0', name: '0' }, command, true, true, true)).toThrow('juno_stale');
    expect(random).not.toHaveBeenCalled();
  });
  it('cancels travel on departure but retains committed flour, elapsed report pause and a full next timer', () => {
    const { rooms, table, view, setNow } = room(); table.round = round(); table.round.players[0]!.hand.splice(2);
    table.round.players[1]!.hand.splice(1); table.round.players[2]!.hand.splice(1);
    setNow(100);
    const active = rooms.command('voice', { userId: '0', name: '0' },
      { type: 'play', cardId: 'pizza', gameId: view.game!.id, revision: view.revision }, true, true, true);
    table.round.players[0]!.hand[0]!.floured = true; setNow(2_100);
    const left = rooms.command('voice', { userId: '2', name: '2' },
      { type: 'leave', gameId: view.game!.id, revision: active.revision }, true, true, true);
    expect(left.game?.pizzaResolution).toBeUndefined(); expect(left.game?.remainingMs).toBe(45_000);
    expect(table.round.players[0]!.hand[0]!.floured).toBe(true);
    expect(table.round.reportWindows[0]?.deadline).toBe(12_100);
  });
  it('starts computer pacing only after the pause and preserves the confirmed move ID on completion', () => {
    const { rooms, table, view, setNow } = room(); table.round = round();
    table.people[1]!.computer = 1; table.round.players[1]!.computer = 1; setNow(100);
    const active = rooms.command('voice', { userId: '0', name: '0' },
      { type: 'play', cardId: 'pizza', gameId: view.game!.id, revision: view.revision }, true, true, true);
    setNow(5_099); rooms.tick(); expect(table.round.lastMove?.id).toBe(active.game?.lastMove?.id);
    setNow(5_100); rooms.tick(); expect(table.round.pizzaResolution).toBeUndefined();
    expect(table.round.lastMove?.id).toBe(active.game?.lastMove?.id);
    setNow(5_999); rooms.tick(); expect(table.round.lastMove?.id).toBe(active.game?.lastMove?.id);
    setNow(6_000); rooms.tick(); expect(table.round.lastMove?.id).not.toBe(active.game?.lastMove?.id);
  });
  it('accepts the first command at pause end without manufacturing a stale revision from elapsed time alone', () => {
    const { rooms, table, view, setNow } = room(); table.round = round(); setNow(100);
    const active = rooms.command('voice', { userId: '0', name: '0' },
      { type: 'play', cardId: 'pizza', gameId: view.game!.id, revision: view.revision }, true, true, true);
    setNow(5_100);
    const result = rooms.command('voice', { userId: '1', name: '1' },
      { type: 'draw', gameId: view.game!.id, revision: active.revision }, true, true, true);
    expect(result.game?.lastMove?.type).toBe('draw'); expect(result.game?.pizzaResolution).toBeUndefined();
  });
  it('resolves a blind pizza normally but does not activate it on an intoxicated miss', () => {
    const blind = round(); blind.memoryCurse = { id: 'memory', targetUserId: '0' }; play(blind);
    expect(blind.memoryCurse).toBeUndefined(); expect(blind.pizzaResolution).toBeDefined();
    const drunk = round(); drunk.intoxication = { id: 'drunk', targetUserId: '0' }; play(drunk);
    expect(drunk.lastMove?.type).toBe('intoxicated_miss'); expect(drunk.pizzaResolution).toBeUndefined();
    expect(cards(drunk).some(c => c.floured)).toBe(false);
  });
});
