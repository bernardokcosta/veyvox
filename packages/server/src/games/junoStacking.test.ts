import { describe, expect, it } from 'vitest';
import { canPlayJuno, type JunoCard } from '@veyvox/shared/src/juno.js';
import { createJunoDeck, startRound, actInRound, type JunoRound } from './juno.js';

const card = (id: string, face: JunoCard['face'] = '3', color: JunoCard['color'] = 'coral'): JunoCard => ({ id, face, color });
function stackingRound(): JunoRound {
  return {
    players: [
      { userId: 'a', name: 'a', hand: [card('a-draw2', 'draw2', 'coral'), card('a-other', '5', 'mint')], announced: false },
      { userId: 'b', name: 'b', hand: [card('b-draw2', 'draw2', 'sky'), card('b-other', '7', 'amber')], announced: false },
      { userId: 'c', name: 'c', hand: [card('c1', '1', 'coral'), card('c2', '2', 'sky')], announced: false },
    ],
    drawPile: Array.from({ length: 40 }, (_, i) => card(`d${i}`, '9', 'amber')),
    discard: [card('top', '4', 'coral')], color: 'coral', direction: 1, turn: 0, drawnCardId: null,
    deadline: 45_000, winnerId: null, result: null, lastMove: null, blockedTurns: 0, reportWindows: [],
    specials: true, stacking: true, stackDraw: 0,
  };
}
describe('Juno stacking engine', () => {
  it('deals a classic 108 deck without rare faces when specials are off', () => {
    expect(createJunoDeck(true, true, true, false)).toHaveLength(108);
    expect(createJunoDeck(true, true, true, false).some(c => c.face === 'memory' || c.face === 'intoxicated' || c.face === 'pizza')).toBe(false);
    const state = startRound([{ userId: 'a', name: 'a' }, { userId: 'b', name: 'b' }], 0, false, false, false, false, false);
    expect(state.specials).toBe(false); expect(state.stacking).toBe(false);
    expect([...state.drawPile, ...state.discard, ...state.players.flatMap(p => p.hand)]).toHaveLength(108);
  });
  it('keeps rare cards when specials are on and freezes both options into the round', () => {
    const state = startRound([{ userId: 'a', name: 'a' }, { userId: 'b', name: 'b' }], 0, true, true, true, true, true);
    expect(state.specials).toBe(true); expect(state.stacking).toBe(true); expect(state.stackDraw).toBe(0);
    expect(createJunoDeck(true, true, true, true)).toHaveLength(111);
  });
  it('stacks an off-color +2 onto a pending +2 instead of drawing', () => {
    const state = stackingRound();
    actInRound(state, 'a', { type: 'play', cardId: 'a-draw2' }, 0);
    expect(state.stackDraw).toBe(2); expect(state.turn).toBe(1);
    // b's +2 is sky on a coral top: illegal without the stack, legal as a continuation.
    expect(canPlayJuno(card('b-draw2', 'draw2', 'sky'), [{ id: 'x', face: '3', color: 'coral' }], card('top', '4', 'coral'), 'coral')).toBe(false);
    actInRound(state, 'b', { type: 'play', cardId: 'b-draw2' }, 1);
    expect(state.stackDraw).toBe(4); expect(state.turn).toBe(2);
  });
  it('lets a +4 join any pending stack and makes the victim take the exact total', () => {
    const state = stackingRound();
    state.players[1]!.hand = [card('b-draw4', 'draw4', null), card('b-other', '7', 'amber')];
    actInRound(state, 'a', { type: 'play', cardId: 'a-draw2' }, 0);
    actInRound(state, 'b', { type: 'play', cardId: 'b-draw4', color: 'mint' }, 1);
    expect(state.stackDraw).toBe(6); expect(state.turn).toBe(2);
    const before = state.players[2]!.hand.length;
    actInRound(state, 'c', { type: 'draw' }, 2);
    expect(state.players[2]!.hand.length).toBe(before + 6);
    expect(state.stackDraw).toBe(0); expect(state.turn).toBe(0);
    expect(state.lastMove).toMatchObject({ type: 'draw', userId: 'c', amount: 6 });
  });
  it('refuses passes and ordinary plays while a stack is pending, but allows JUNO calls', () => {
    const state = stackingRound();
    actInRound(state, 'a', { type: 'play', cardId: 'a-draw2' }, 0);
    expect(() => actInRound(state, 'b', { type: 'pass' }, 1)).toThrow('juno_invalid_move');
    expect(() => actInRound(state, 'b', { type: 'play', cardId: 'b-other' }, 1)).toThrow('juno_invalid_move');
    actInRound(state, 'b', { type: 'announce' }, 1);
    expect(state.players[1]!.announced).toBe(true); expect(state.stackDraw).toBe(2);
  });
  it('wins immediately on a final-card stack without victim draws', () => {
    const state = stackingRound();
    state.players[0]!.hand = [card('a-draw2', 'draw2', 'coral')];
    actInRound(state, 'a', { type: 'play', cardId: 'a-draw2' }, 0);
    expect(state.winnerId).toBe('a'); expect(state.result).toBe('emptyHand');
    expect(state.players[1]!.hand).toHaveLength(2);
  });
  it('freezes lobby options at start and refuses mid-round changes', async () => {
    const { JunoRooms } = await import('./juno.js');
    let now = 0;
    const rooms = new JunoRooms({ present: () => true, changed: () => {}, now: () => now });
    rooms.command('voice', { userId: 'a', name: 'a' }, { type: 'create' }, true, true, true);
    const lobby = rooms.read('voice', 'a', true, true, true);
    expect(lobby.game!.options).toMatchObject({ specials: true, stacking: false });
    rooms.command('voice', { userId: 'a', name: 'a' },
      { type: 'options', gameId: lobby.game!.id, revision: lobby.revision, stacking: true }, true, true, true);
    const send = (id: string, action: { type: 'join' } | { type: 'start' }) => {
      const view = rooms.read('voice', id, true, true, true);
      return rooms.command('voice', { userId: id, name: id }, { ...action, gameId: view.game!.id, revision: view.revision }, true, true, true);
    };
    send('b', { type: 'join' });
    send('a', { type: 'start' });
    const started = rooms.read('voice', 'a', true, true, true).game!;
    expect(started.options).toMatchObject({ specials: true, stacking: true });
    const mid = rooms.read('voice', 'a', true, true, true);
    expect(() => rooms.command('voice', { userId: 'a', name: 'a' },
      { type: 'options', gameId: mid.game!.id, revision: mid.revision, stacking: false }, true, true, true))
      .toThrow('juno_in_progress');
    expect(() => rooms.command('voice', { userId: 'b', name: 'b' },
      { type: 'options', gameId: started.id, revision: rooms.read('voice', 'b', true, true, true).revision, stacking: false }, true, true, true))
      .toThrow('juno_host_required');
  });
  it('draws the pending total on timeout instead of a single card', async () => {
    const { JunoRooms } = await import('./juno.js');
    let now = 0;
    const rooms = new JunoRooms({ present: () => true, changed: () => {}, now: () => now });
    rooms.command('voice', { userId: 'a', name: 'a' }, { type: 'create' }, true, true, true);
    const tables = rooms as unknown as { tables: Map<string, { round: JunoRound | null }> };
    const play = (id: string, action: { type: 'join' } | { type: 'start' } | { type: 'options'; stacking: boolean }) => {
      const view = rooms.read('voice', id, true, true, true);
      return rooms.command('voice', { userId: id, name: id }, { ...action, gameId: view.game!.id, revision: view.revision }, true, true, true);
    };
    play('a', { type: 'options', stacking: true });
    play('b', { type: 'join' });
    play('a', { type: 'start' });
    const round = tables.tables.get('voice')!.round!;
    round.players[0]!.hand = [card('a-draw2', 'draw2', 'coral'), card('a-filler', '5', 'mint')];
    round.players[1]!.hand = [card('b1', '1', 'sky'), card('b2', '2', 'amber')];
    round.discard = [card('top', '4', 'coral')]; round.color = 'coral';
    const dealt = rooms.read('voice', 'a', true, true, true);
    rooms.command('voice', { userId: 'a', name: 'a' },
      { type: 'play', cardId: 'a-draw2', gameId: dealt.game!.id, revision: dealt.revision }, true, true, true);
    expect(tables.tables.get('voice')!.round!.stackDraw).toBe(2);
    now += 45_001; rooms.tick();
    const done = tables.tables.get('voice')!.round!;
    expect(done.stackDraw).toBe(0);
    expect(done.players[1]!.hand.length).toBe(2 + 2);
    expect(done.turn).toBe(0);
  });
});
