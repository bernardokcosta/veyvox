import { randomInt } from 'node:crypto';
import type { JunoCard, JunoPizzaTransfer } from '@veyvox/shared/src/juno.js';

/** Select from original hands, then commit once: incoming cards cannot cascade. */
export function redistributeJunoPizza(players: readonly { userId: string; hand: JunoCard[] }[]): JunoPizzaTransfer[] {
  if (players.length < 2) return [];
  const selected: { source: number; destination: number; card: JunoCard }[] = [];
  for (let source = 0; source < players.length; source++) {
    const pool = [...players[source]!.hand];
    const count = Math.min(randomInt(5) + 1, Math.max(0, pool.length - 1));
    for (let i = 0; i < count; i++) {
      const card = pool.splice(randomInt(pool.length), 1)[0]!;
      const other = randomInt(players.length - 1);
      selected.push({ source, destination: other >= source ? other + 1 : other, card });
    }
  }
  for (const { source, card } of selected) {
    const hand = players[source]!.hand;
    hand.splice(hand.indexOf(card), 1);
  }
  const transfers: JunoPizzaTransfer[] = [];
  for (const { source, destination, card } of selected) {
    card.floured = true;
    players[destination]!.hand.push(card);
    const fromUserId = players[source]!.userId, toUserId = players[destination]!.userId;
    const group = transfers.find(t => t.fromUserId === fromUserId && t.toUserId === toUserId);
    if (group) group.amount++;
    else transfers.push({ fromUserId, toUserId, amount: 1 });
  }
  return transfers;
}
