import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JunoSnapshot } from '@veyvox/shared/src/juno.js';
import { createJunoPreview } from './junoPreview.js';

const origin = { origin: 'http://127.0.0.1:5173' };
afterEach(() => { vi.useRealTimers(); });
describe('isolated playable pizza preview', () => {
  it.each([2, 3, 4])('starts a real %i-player practice round with pizza owned by the player, and uses real exchanges', async count => {
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
