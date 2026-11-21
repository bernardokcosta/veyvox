import { describe, expect, it, vi } from 'vitest';
import type { JunoAction } from '@veyvox/shared/src/juno.js';
import { JunoRooms } from './juno.js';

function setup(options: Partial<ConstructorParameters<typeof JunoRooms>[0]> = {}) {
  let now = 0;
  const rooms = new JunoRooms({ present: () => true, changed: () => {}, now: () => now, ...options });
  const send = (id: string, action: JunoAction, ...flags: [boolean, boolean, boolean, boolean, boolean, boolean]) => {
    const view = rooms.read('voice', id, ...flags);
    return rooms.command('voice', { userId: id, name: id }, { ...action, gameId: view.game!.id, revision: view.revision }, ...flags);
  };
  const full: [boolean, boolean, boolean, boolean, boolean, boolean] = [true, true, true, true, true, true];
  const old: [boolean, boolean, boolean, boolean, boolean, boolean] = [true, true, true, true, true, false];
  rooms.command('voice', { userId: 'a', name: 'a' }, { type: 'create' }, ...full);
  return { rooms, send, full, old, advance: (ms: number) => { now += ms; rooms.tick(); } };
}

describe('Juno duos partnerships', () => {
  it('stores the host mode in the lobby and freezes it at start', () => {
    const { rooms, send, full } = setup();
    const lobby = rooms.read('voice', 'a', ...full);
    expect(lobby.game!.options).toMatchObject({ mode: 'single' });
    send('a', { type: 'options', mode: 'duo' }, ...full);
    expect(rooms.read('voice', 'a', ...full).game!.options).toMatchObject({ mode: 'duo' });
    for (const id of ['b', 'c', 'd']) send(id, { type: 'join' }, ...full);
    send('a', { type: 'start' }, ...full);
    const started = rooms.read('voice', 'a', ...full).game!;
    expect(started.mode).toBe('duo');
    expect(started.options).toMatchObject({ mode: 'duo' });
    expect(started.teams).toEqual({ a: ['a', 'b'], b: ['c', 'd'] });
  });
  it('refuses the duo switch and duo-sized joins beyond four without mutating the lobby', () => {
    const { rooms, send, full } = setup();
    for (const id of ['b', 'c', 'd', 'e', 'f']) send(id, { type: 'join' }, ...full);
    const before = rooms.read('voice', 'a', ...full);
    expect(() => send('a', { type: 'options', mode: 'duo', specials: false, stacking: true }, ...full)).toThrow('juno_invalid_move');
    expect(rooms.read('voice', 'a', ...full).game!.options).toEqual(before.game!.options);
    expect(rooms.read('voice', 'a', ...full).revision).toBe(before.revision);
  });
  it('requires exactly four seated players to start a duo round', () => {
    const { rooms, send, full } = setup();
    send('a', { type: 'options', mode: 'duo' }, ...full);
    send('b', { type: 'join' }, ...full);
    expect(() => send('a', { type: 'start' }, ...full)).toThrow('juno_need_players');
    expect(rooms.read('voice', 'a', ...full).game!.phase).toBe('lobby');
  });
  it('caps duo tables at four seats', () => {
    const { rooms, send, full } = setup();
    send('a', { type: 'options', mode: 'duo' }, ...full);
    for (const id of ['b', 'c', 'd']) send(id, { type: 'join' }, ...full);
    const before = rooms.read('voice', 'a', ...full);
    expect(() => send('e', { type: 'join' }, ...full)).toThrow('juno_table_full');
    expect(rooms.read('voice', 'a', ...full).game!.players).toHaveLength(4);
    expect(rooms.read('voice', 'a', ...full).revision).toBe(before.revision);
  });
  it('shows each partner the full allied hand while others see backs', () => {
    const { rooms, send, full } = setup();
    send('a', { type: 'options', mode: 'duo' }, ...full);
    for (const id of ['b', 'c', 'd']) send(id, { type: 'join' }, ...full);
    send('a', { type: 'start' }, ...full);
    const a = rooms.read('voice', 'a', ...full).game!;
    const b = rooms.read('voice', 'b', ...full).game!;
    expect(a.partnerHand).toHaveLength(7);
    expect(a.partnerHand.map(c => c.id).sort()).toEqual(b.hand.map(c => c.id).sort());
    expect(b.partnerHand.map(c => c.id).sort()).toEqual(a.hand.map(c => c.id).sort());
    const watcher = rooms.read('voice', 'watcher', ...full).game!;
    expect(watcher.partnerHand).toEqual([]);
    expect(watcher.hand).toEqual([]);
    expect(rooms.read('voice', 'c', ...full).game!.teams).toEqual({ a: ['a', 'b'], b: ['c', 'd'] });
  });
  it('refuses duo rounds to clients without duos support', () => {
    const { rooms, send, full, old } = setup();
    send('a', { type: 'options', mode: 'duo' }, ...full);
    for (const id of ['b', 'c', 'd']) send(id, { type: 'join' }, ...full);
    send('a', { type: 'start' }, ...full);
    expect(() => rooms.read('voice', 'watcher', ...old)).toThrow('juno_update_required');
    expect(() => rooms.command('voice', { userId: 'a', name: 'a' },
      { type: 'draw', gameId: rooms.read('voice', 'a', ...full).game!.id, revision: rooms.read('voice', 'a', ...full).revision }, ...old))
      .toThrow('juno_update_required');
  });
  it('downgrades mixed cohorts to single at start', () => {
    const { rooms, send, full, old } = setup();
    send('a', { type: 'options', mode: 'duo' }, ...full);
    send('b', { type: 'join' }, ...full);
    send('c', { type: 'join' }, ...old);
    send('d', { type: 'join' }, ...full);
    send('a', { type: 'start' }, ...full);
    const game = rooms.read('voice', 'a', ...full).game!;
    expect(game.mode).toBe('single');
    expect(game.teams).toBeNull();
    expect(game.partnerHand).toEqual([]);
    expect(() => rooms.read('voice', 'c', ...old)).not.toThrow();
  });
  it('shares first place and winner XP, and awards both opponents second place despite different hand counts', async () => {
    const { buildJunoStandings } = await import('./junoStandings.js');
    const { applyDuoResults } = await import('./junoStandings.js');
    const starters = ['a', 'b', 'c', 'd'].map(userId => ({ userId, name: userId }));
    const base = buildJunoStandings(starters,
      [{ userId: 'a', cardCount: 0 }, { userId: 'b', cardCount: 5 }, { userId: 'c', cardCount: 2 }, { userId: 'd', cardCount: 9 }],
      'a', 'emptyHand');
    const teams = { a: ['a', 'b'], b: ['c', 'd'] };
    const rows = applyDuoResults(base, 'a', teams);
    expect(rows.filter(r => r.team === 1).map(r => [r.userId, r.place, r.xp])).toEqual([['a', 1, rows[0]!.xp], ['b', 1, rows[0]!.xp]]);
    expect(rows.filter(r => r.team === 2).map(r => [r.userId, r.place])).toEqual([['c', 2], ['d', 2]]);
    expect(rows.find(r => r.userId === 'c')!.xp).toBeGreaterThan(rows.find(r => r.userId === 'd')!.xp!);
  });
  it('recycles a leaver hand and lets the partner continue solo in turn order', () => {
    const { rooms, send, full } = setup();
    send('a', { type: 'options', mode: 'duo' }, ...full);
    for (const id of ['b', 'c', 'd']) send(id, { type: 'join' }, ...full);
    send('a', { type: 'start' }, ...full);
    const before = rooms.read('voice', 'a', ...full).game!;
    expect(before.players.map(p => p.userId)).toEqual(['a', 'b', 'c', 'd']);
    send('b', { type: 'leave' }, ...full);
    const after = rooms.read('voice', 'a', ...full).game!;
    expect(after.players.map(p => p.userId)).toEqual(['a', 'c', 'd']);
    expect(after.phase).toBe('playing');
    expect(after.teams).toEqual({ a: ['a', 'b'], b: ['c', 'd'] });
  });
  it('shows shared first place with a teammate bot but never settles practice XP', () => {
    const settle = vi.fn(() => { throw new Error('practice must not settle'); });
    const { rooms, send, full } = setup({ spaceIdForChannel: () => 'space', settle });
    send('a', { type: 'options', mode: 'duo' }, ...full);
    send('a', { type: 'addBot' }, ...full);
    for (const id of ['c', 'd']) send(id, { type: 'join' }, ...full);
    send('a', { type: 'start' }, ...full);
    const tables = rooms as unknown as { tables: Map<string, { round: import('./juno.js').JunoRound | null }> };
    const round = tables.tables.get('voice')!.round!;
    round.turn = 0;
    round.players[0]!.hand = [{ ...round.discard.at(-1)!, id: 'winner' }];
    const result = send('a', { type: 'play', cardId: 'winner' }, ...full).game!.scoreboard!;
    expect(result.status).toBe('unranked');
    expect(result.standings.map(row => [row.team, row.place, row.xp])).toEqual([[1, 1, 0], [1, 1, 0], [2, 2, 0], [2, 2, 0]]);
    expect(settle).not.toHaveBeenCalled();
  });
  it('keeps duos mode across rematch with a fresh solo lobby', async () => {
    const { rooms, send, full } = setup();
    send('a', { type: 'options', mode: 'duo' }, ...full);
    for (const id of ['b', 'c', 'd']) send(id, { type: 'join' }, ...full);
    send('a', { type: 'start' }, ...full);
    expect(rooms.read('voice', 'a', ...full).game!.mode).toBe('duo');
    const tables = rooms as unknown as { tables: Map<string, { round: import('./juno.js').JunoRound | null }> };
    const round = tables.tables.get('voice')!.round!;
    const current = round.players[round.turn]!;
    const top = round.discard[round.discard.length - 1]!;
    current.hand = [{ id: 'winner', color: top.color, face: top.face }];
    const view = rooms.read('voice', current.userId, ...full);
    rooms.command('voice', { userId: current.userId, name: current.userId },
      { type: 'play', cardId: 'winner', gameId: view.game!.id, revision: view.revision }, ...full);
    const done = rooms.read('voice', 'a', ...full).game!;
    expect(done.phase).toBe('finished');
    expect(done.winnerId).toBe(current.userId);
    expect([done.teams!.a, done.teams!.b].some(team => team.includes(done.winnerId!))).toBe(true);
    const host = rooms.read('voice', done.hostId, ...full);
    rooms.command('voice', { userId: done.hostId, name: done.hostId },
      { type: 'rematch', gameId: host.game!.id, revision: host.revision }, ...full);
    const fresh = rooms.read('voice', done.hostId, ...full).game!;
    expect(fresh.phase).toBe('lobby');
    expect(fresh.players).toHaveLength(1);
    expect(fresh.options).toMatchObject({ mode: 'duo' });
    expect(fresh.mode).toBe('single');
  });
});
