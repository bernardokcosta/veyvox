import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JunoCard, JunoSnapshot } from '@veyvox/shared/src/juno.js';
import type { JunoRound } from '../games/juno.js';
import { createJunoPreview } from './junoPreview.js';
const card = (id: string, face: JunoCard['face'], color: JunoCard['color']): JunoCard => ({ id, face, color });

const origin = { origin: 'http://127.0.0.1:5173' };
afterEach(() => { vi.useRealTimers(); });
describe('isolated playable pizza preview', () => {
  it.each([2, 3, 4, 5, 6])('starts a real %i-player practice round with pizza owned by the player, and uses real exchanges', async count => {
    const app = createJunoPreview();
    try {
      await app.inject({ method: 'POST', url: '/reset', headers: origin, payload: { players: count } });
      const before = (await app.inject('/snapshot')).json<JunoSnapshot>();
      expect(before.game!.players).toHaveLength(count);
      expect(before.game!.players.filter(p => p.computer)).toHaveLength(count - 1);
      expect(before.game!.practice).toBe(true);
      const pizza = before.game!.hand.find(c => c.face === 'pizza')!;
      expect(pizza).toBeDefined();
      expect(before.game!.currentPlayerId).toBe('preview-player');
      const played = await app.inject({ method: 'POST', url: '/action', headers: origin,
        payload: { type: 'play', cardId: pizza.id, gameId: before.game!.id, revision: before.revision } });
      expect(played.statusCode).toBe(200);
      const after = played.json<JunoSnapshot>();
      expect(after.game!.pizzaResolution?.remainingMs).toBeGreaterThan(0);
      expect(after.game!.lastMove!.pizzaTransfers!.reduce((n, t) => n + t.amount, 0)).toBeGreaterThanOrEqual(count);
      expect(after.game!.players.every(p => p.cardCount >= 1)).toBe(true);
      const spectator = (await app.inject('/snapshot?viewer=spectator')).json<JunoSnapshot>();
      expect(spectator.game!.hand).toEqual([]);
      expect(spectator.game!.players).toEqual(after.game!.players);
    } finally { await app.close(); }
  });
  it('guarantees a reproducible stacking opening without touching the pizza seat', async () => {
    const { ensureStackingOpening } = await import('./junoPreview.js');
    const adjustable = (cards: [string, JunoCard['face'], JunoCard['color']][]): JunoCard[] =>
      cards.map(([id, face, color]) => ({ id, face, color }));
    const topColor = 'coral' as const;
    function rigged(playerHand: [string, JunoCard['face'], JunoCard['color']][], botHand: [string, JunoCard['face'], JunoCard['color']][]): JunoRound {
      return {
        players: [
          { userId: 'preview-player', name: 'Você', hand: adjustable(playerHand), announced: false },
          { userId: 'bot', name: 'Bot', hand: adjustable(botHand), announced: false },
        ],
        drawPile: [card('filler', '3', 'mint')],
        discard: [card('top', '4', topColor)], color: topColor, direction: 1 as const, turn: 0, drawnCardId: null,
        deadline: 45_000, winnerId: null, result: null, lastMove: null, blockedTurns: 0, reportWindows: [],
        memoryEnabled: true, intoxicatedEnabled: false, pizzaEnabled: false,
        specials: true, stacking: true, stackDraw: 0, duos: false, teams: null,
      };
    }
    // Both +2 of the active color already in hand: nothing is taken away.
    const reuse = rigged(
      [['own2a', 'draw2', 'coral'], ['own2b', 'draw2', 'coral'], ['other', '5', 'mint']],
      [['answer', 'draw2', 'sky'], ['filler', '7', 'amber']]);
    ensureStackingOpening(reuse);
    expect(reuse.players[0]!.hand.filter(c => c.face === 'draw2' && c.color === 'coral').length).toBeGreaterThanOrEqual(1);
    expect(reuse.players[1]!.hand.some(c => c.face === 'draw2')).toBe(true);
    expect(reuse.players[0]!.hand).toHaveLength(3); expect(reuse.players[1]!.hand).toHaveLength(2);
    // Pizza sitting in slot 1 moves out of the way instead of being overwritten.
    const pizza = rigged(
      [['keep', '3', 'mint'], ['rare', 'pizza', null], ['other', '5', 'mint']],
      [['answer', 'draw2', 'sky'], ['filler', '7', 'amber'], ['spare', 'draw2', 'coral']]);
    ensureStackingOpening(pizza);
    expect(pizza.players[0]!.hand.some(c => c.face === 'pizza')).toBe(true);
    expect(pizza.players[0]!.hand.some(c => c.face === 'draw2' && c.color === 'coral')).toBe(true);
    expect(pizza.players.every(p => p.hand.length === 3)).toBe(true);
  });
  it('starts a stacking practice round on request and keeps classic rules otherwise', async () => {
    const app = createJunoPreview();
    try {
      const classic = await app.inject({ method: 'POST', url: '/reset', headers: origin, payload: { players: 2 } });
      expect(classic.json<JunoSnapshot>().game!.options).toMatchObject({ specials: true, stacking: false });
      const stacked = await app.inject({ method: 'POST', url: '/reset', headers: origin, payload: { players: 3, stacking: true } });
      expect(stacked.statusCode).toBe(200);
      const game = stacked.json<JunoSnapshot>().game!;
      expect(game.players).toHaveLength(3);
      expect(game.options).toMatchObject({ specials: true, stacking: true });
      const opener = game.hand.find(c => c.face === 'draw2' && c.color === game.color);
      expect(opener).toBeDefined();
      expect((await app.inject('/snapshot?viewer=spectator')).json<JunoSnapshot>().game!.players.every(p => p.cardCount === 7)).toBe(true);
      expect((await app.inject({ method: 'POST', url: '/reset', headers: origin, payload: { players: 8 } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/reset', headers: origin, payload: { players: 2, stacking: 'yes' } })).statusCode).toBe(400);
    } finally { await app.close(); }
  });
  it('rejects cross-site mutations, invalid seats and malformed commands without changing the table', async () => {
    const app = createJunoPreview();
    try {
      const before = (await app.inject('/snapshot')).json<JunoSnapshot>();
      expect((await app.inject({ method: 'POST', url: '/reset', headers: { origin: 'https://untrusted.example' }, payload: { players: 2 } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/reset', headers: origin, payload: { players: 8 } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/action', headers: origin, payload: { type: 'play' } })).statusCode).toBe(400);
      expect((await app.inject('/snapshot')).json<JunoSnapshot>().game!.id).toBe(before.game!.id);
    } finally { await app.close(); }
  });
  it('keeps pizza ready while the user has not started and preserves monotonic revisions on reset', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); vi.setSystemTime(0);
    const app = createJunoPreview();
    try {
      const before = (await app.inject('/snapshot')).json<JunoSnapshot>();
      vi.advanceTimersByTime(180_000);
      const idle = (await app.inject('/snapshot')).json<JunoSnapshot>();
      expect(idle.revision).toBe(before.revision);
      expect(idle.game!.hand).toHaveLength(7);
      expect(idle.game!.remainingMs).toBe(45_000);
      const reset = (await app.inject({ method: 'POST', url: '/reset', headers: origin, payload: { players: 2 } })).json<JunoSnapshot>();
      expect(reset.revision).toBeGreaterThan(before.revision);
      expect(reset.game!.id).not.toBe(before.game!.id);
    } finally { await app.close(); }
  });
});
