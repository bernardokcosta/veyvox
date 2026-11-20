import type { JunoPerson } from '@veyvox/shared/src/juno';

export type JunoSeatPosition = 'top' | 'topLeft' | 'topRight' | 'left' | 'right' | 'bottom';
export type JunoSeats<T> = Record<JunoSeatPosition, T | null>;

const EMPTY: JunoSeats<never> = { top: null, topLeft: null, topRight: null, left: null, right: null, bottom: null };

/** Fixed relative layout: the viewer stays below; with five seats the top row
 *  splits in two, with six the top row holds three. */
export function junoSeats<T extends JunoPerson>(players: readonly T[], selfId?: string): JunoSeats<T> {
  const seats: JunoSeats<T> = { ...EMPTY };
  const index = players.findIndex(p => p.userId === selfId);
  if (index < 0) {
    if (players.length <= 4) return { ...EMPTY, top: players[0] ?? null, left: players[1] ?? null, right: players[2] ?? null, bottom: players[3] ?? null };
    if (players.length === 5) return { ...EMPTY, topLeft: players[0] ?? null, topRight: players[1] ?? null, left: players[2] ?? null, right: players[3] ?? null, bottom: players[4] ?? null };
    return { ...EMPTY, top: players[0] ?? null, topLeft: players[1] ?? null, topRight: players[2] ?? null, left: players[3] ?? null, right: players[4] ?? null, bottom: players[5] ?? null };
  }
  seats.bottom = players[index]!;
  const opponents = [...players.slice(index + 1), ...players.slice(0, index)];
  if (opponents.length === 1) seats.top = opponents[0]!;
  else if (opponents.length === 2) { seats.left = opponents[0]!; seats.right = opponents[1]!; }
  else if (opponents.length === 3) { seats.left = opponents[0] ?? null; seats.top = opponents[1] ?? null; seats.right = opponents[2] ?? null; }
  else if (opponents.length === 4) { seats.left = opponents[0] ?? null; seats.topLeft = opponents[1] ?? null; seats.topRight = opponents[2] ?? null; seats.right = opponents[3] ?? null; }
  else { seats.left = opponents[0] ?? null; seats.topLeft = opponents[1] ?? null; seats.top = opponents[2] ?? null; seats.topRight = opponents[3] ?? null; seats.right = opponents[4] ?? null; }
  return seats;
}
