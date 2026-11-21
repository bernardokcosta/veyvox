import Fastify from 'fastify';
import cors from '@fastify/cors';
import { JUNO_COLORS, type JunoCard, type JunoCommand } from '@veyvox/shared/src/juno.js';
import { JunoError, JunoRooms, type JunoRound } from '../games/juno.js';

const player = { userId: 'preview-player', name: 'Você' };
const origins = ['http://127.0.0.1:5173', 'http://localhost:5173'];

/**
 * Reproducible stacking opening for the workbench demo: the player holds a
 * legal +2 of the active color and the next bot holds an answering +2.
 * Swaps preserve every hand size and never overwrite a pizza seat. The bot
 * draws from the pile and other bots first, so it cannot steal the player's
 * only staged card; the player swaps last and may reuse its own hand.
 * Throws JunoError when the table cannot stage the opening.
 */
export function ensureStackingOpening(round: JunoRound): void {
  const player = round.players[0], next = round.players[1];
  if (!player || !next || round.players.length < 2) throw new JunoError('preview_invalid_request');
  const pizzaSafeSlot = (hand: JunoCard[]): number => hand.findIndex(c => c.face !== 'pizza');
  const findSwap = (skipHands: JunoCard[][], color?: JunoCard['color']) => {
    const preferred = [round.drawPile, ...round.players.flatMap(p => skipHands.includes(p.hand) ? [] : [p.hand])];
    const fallback = [round.drawPile, ...round.players.map(p => p.hand)].filter(h => !preferred.includes(h));
    for (const source of [...preferred, ...fallback]) {
      const index = source.findIndex(c => c.face === 'draw2' && (!color || c.color === color));
      if (index >= 0) return { source, index };
    }
    return undefined;
  };
  const doSwap = (hand: JunoCard[], color: JunoCard['color'] | undefined, skipPlayer: boolean) => {
    const slot = pizzaSafeSlot(hand);
    if (slot < 0) throw new JunoError('preview_invalid_request');
    const found = findSwap(skipPlayer ? [player.hand] : [], color);
    if (!found) throw new JunoError('preview_invalid_request');
    [hand[slot], found.source[found.index]] = [found.source[found.index]!, hand[slot]!];
  };
  doSwap(next.hand, undefined, true);
  doSwap(player.hand, round.color, false);
}

/** Separate in-memory workbench. Never registered on the production API. */
export function createJunoPreview() {
  const app = Fastify({ bodyLimit: 4096 });
  let clock = Date.now(), lastTick = clock, started = false;
  const rooms = new JunoRooms({ present: () => true, changed: () => {}, now: () => clock });
  function reset(count: number, stacking = false) {
    clock = Date.now(); lastTick = clock; started = false;
    rooms.dispose();
    let view = rooms.command('preview', player, { type: 'create' }, true, true, true, true, true);
    if (stacking) {
      view = rooms.command('preview', player,
        { type: 'options', stacking: true, gameId: view.game!.id, revision: view.revision }, true, true, true, true, true);
    }
    for (let i = 1; i < count; i++) view = rooms.command('preview', player,
      { type: 'addBot', gameId: view.game!.id, revision: view.revision }, true, true, true, true, true);
    view = rooms.command('preview', player, { type: 'start', gameId: view.game!.id, revision: view.revision }, true, true, true, true, true);
    // Fixture-only swap, preserving the real deck's identities and all normal rules.
    const round = (rooms as unknown as { tables: Map<string, { round: JunoRound }> }).tables.get('preview')!.round;
    const hand = round.players[0]!.hand;
    if (!hand.some(c => c.face === 'pizza')) {
      const source = [round.drawPile, ...round.players.slice(1).map(p => p.hand)].find(cards => cards.some(c => c.face === 'pizza'))!;
      const index = source.findIndex(c => c.face === 'pizza');
      [hand[0], source[index]] = [source[index]!, hand[0]!];
    }
    if (stacking && count > 1) ensureStackingOpening(round);
    return rooms.read('preview', player.userId, true, true, true, true, true);
  }
  reset(4);
  void app.register(cors, { origin: origins });
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'POST' && !origins.includes(request.headers.origin ?? '')) {
      return reply.code(403).send({ error: 'preview_origin_required' });
    }
    reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof JunoError) return reply.code(409).send({ error: error.message });
    return reply.code(400).send({ error: 'preview_invalid_request' });
  });
  app.get<{ Querystring: { viewer?: 'player' | 'spectator' } }>('/snapshot', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { viewer: { type: 'string', enum: ['player', 'spectator'] } } } },
  }, request => rooms.read('preview', request.query.viewer === 'spectator' ? 'preview-spectator' : player.userId, true, true, true, true, true));
  app.post<{ Body: { players: number; stacking?: boolean } }>('/reset', {
    schema: { body: { type: 'object', required: ['players'], additionalProperties: false, properties: { players: { type: 'integer', minimum: 2, maximum: 6 }, stacking: { type: 'boolean' } } } },
  }, request => reset(request.body.players, request.body.stacking ?? false));
  app.post<{ Body: JunoCommand }>('/action', {
    schema: { body: {
      type: 'object', required: ['type', 'gameId', 'revision'], additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['play', 'draw', 'pass', 'announce', 'report', 'leave'] },
        gameId: { type: 'string', minLength: 1, maxLength: 64 }, revision: { type: 'integer', minimum: 0 },
        cardId: { type: 'string', minLength: 1, maxLength: 64 }, color: { type: 'string', enum: [...JUNO_COLORS] }, announce: { type: 'boolean' },
        targetUserId: { type: 'string', minLength: 1, maxLength: 64 }, opportunityId: { type: 'string', minLength: 1, maxLength: 64 },
      },
      allOf: [
        { if: { properties: { type: { const: 'play' } } }, then: { required: ['cardId'] } },
        { if: { properties: { type: { const: 'report' } } }, then: { required: ['targetUserId', 'opportunityId'] } },
      ],
    } },
  }, request => {
    if (!started) { started = true; lastTick = Date.now(); }
    return rooms.command('preview', player, request.body, true, true, true, true, true);
  });
  const timer = setInterval(() => {
    const now = Date.now();
    if (started) clock += now - lastTick;
    lastTick = now;
    rooms.tick();
  }, 125); timer.unref();
  app.addHook('onClose', async () => { clearInterval(timer); rooms.dispose(); });
  return app;
}
