import { JUNO_PIZZA_MS, type JunoView } from '@veyvox/shared/src/juno';

export interface PizzaFlight {
  fromUserId: string;
  toUserId: string;
  departureMs: number;
  arrivalMs: number;
}

/** Public quantities only; every viewer uses the author's same roster/direction clock. */
export function pizzaFlights(game: Pick<JunoView, 'players' | 'direction' | 'lastMove'>): PizzaFlight[] {
  const author = game.players.findIndex(p => p.userId === game.lastMove?.userId);
  if (author < 0 || game.players.length < 2) return [];
  const flights: PizzaFlight[] = [], sent = new Map<string, number>();
  for (const transfer of game.lastMove?.pizzaTransfers ?? []) {
    const source = game.players.findIndex(p => p.userId === transfer.fromUserId);
    if (source < 0 || transfer.fromUserId === transfer.toUserId || !game.players.some(p => p.userId === transfer.toUserId)
      || !Number.isInteger(transfer.amount) || transfer.amount < 1) continue;
    const sourceIndex = (game.direction * (source - author) + game.players.length) % game.players.length;
    for (let i = 0; i < transfer.amount && (sent.get(transfer.fromUserId) ?? 0) < 5; i++) {
      const index = sent.get(transfer.fromUserId) ?? 0;
      const departureMs = Math.min(Math.ceil(sourceIndex / game.players.length * JUNO_PIZZA_MS) + 100 + index * 45, JUNO_PIZZA_MS - 700);
      flights.push({ fromUserId: transfer.fromUserId, toUserId: transfer.toUserId, departureMs, arrivalMs: departureMs + 700 });
      sent.set(transfer.fromUserId, index + 1);
    }
  }
  return flights;
}

/** Cosmetic slot ordering never asserts a hidden card-to-recipient identity mapping. */
export function projectPizzaHands(before: JunoView, after: JunoView, flights: readonly PizzaFlight[], viewerId: string | undefined, elapsed: number): JunoView {
  if (elapsed >= JUNO_PIZZA_MS) return after;
  const players = after.players.map(person => {
    const previous = before.players.find(p => p.userId === person.userId);
    if (!previous) return person;
    const outgoing = flights.filter(f => f.fromUserId === person.userId);
    const incoming = flights.filter(f => f.toUserId === person.userId);
    const departed = outgoing.filter(f => f.departureMs <= elapsed).length;
    const arrived = incoming.filter(f => f.arrivalMs <= elapsed).length;
    const oldFlourSent = Math.max(0, (previous.flouredCardCount ?? 0) + incoming.length - (person.flouredCardCount ?? 0));
    return { ...person,
      cardCount: previous.cardCount - (person.userId === after.lastMove?.userId ? 1 : 0) - departed + arrived,
      flouredCardCount: Math.max(0, (previous.flouredCardCount ?? 0) - Math.min(departed, oldFlourSent) + arrived) };
  });
  if (!viewerId || before.maskedHand || after.maskedHand) return { ...after, players };
  const finalIds = new Set(after.hand.map(c => c.id)), oldIds = new Set(before.hand.map(c => c.id));
  const original = before.hand.filter(c => c.id !== after.lastMove?.card?.id);
  const outgoing = original.filter(c => !finalIds.has(c.id));
  const incoming = after.hand.filter(c => !oldIds.has(c.id));
  const departed = flights.filter(f => f.fromUserId === viewerId && f.departureMs <= elapsed).length;
  const arrived = flights.filter(f => f.toUserId === viewerId && f.arrivalMs <= elapsed).length;
  const gone = new Set(outgoing.slice(0, departed).map(c => c.id));
  return { ...after, players, hand: [...original.filter(c => !gone.has(c.id)), ...incoming.slice(0, arrived)] };
}
