import type { JunoPerson, JunoPlace, JunoStanding, JunoView } from '@veyvox/shared/src/juno.js';
import { junoDynamicXp } from '@veyvox/shared/src/juno.js';

/** Freeze public counts, never private cards; absent starters abandoned the round. */
export function buildJunoStandings(
  starters: readonly JunoPerson[],
  finishers: readonly { userId: string; cardCount: number }[],
  winnerId: string | null,
  result: NonNullable<JunoView['result']>,
): JunoStanding[] {
  const ranked = result === 'emptyHand' && winnerId !== null;
  const rows: JunoStanding[] = starters.map(person => {
    const finisher = finishers.find(p => p.userId === person.userId);
    return { userId: person.userId, name: person.name, ...(person.computer ? { computer: person.computer } : {}), place: null, xp: 0,
      cardCount: finisher?.cardCount ?? null,
      outcome: !finisher ? 'abandoned' : ranked ? 'completed' : 'unranked' };
  });
  if (!ranked) return rows;
  const completed = rows.filter(r => r.outcome === 'completed').sort((a, b) =>
    a.userId === winnerId ? -1 : b.userId === winnerId ? 1 : a.cardCount! - b.cardCount!);
  for (let i = 0; i < completed.length; i++) {
    const row = completed[i]!; const previous = completed[i - 1];
    row.place = previous && row.cardCount === previous.cardCount ? previous.place : (i + 1) as JunoPlace;
    const totalCards = completed.reduce((sum, r) => sum + r.cardCount!, 0);
    const abandoned = rows.length - completed.length;
    row.xp = junoDynamicXp(row.place!, row.cardCount!, totalCards, completed.length, abandoned);
  }
  return [...completed, ...rows.filter(r => r.outcome !== 'completed')];
}

/**
 * Duo overlay for a computed base table: the winner's team shares place 1
 * and the winner's exact XP. The other team shares place 2, with the usual
 * dynamic bonus per finisher.
 * Abandoned starters keep no place or XP but retain their team. Without a
 * winner, there are no places or awards to change.
 */
export function applyDuoResults(standings: JunoStanding[], winnerId: string | null, teams: { a: string[]; b: string[] }): JunoStanding[] {
  const teamOf = (userId: string): 1 | 2 | null =>
    teams.a.includes(userId) ? 1 : teams.b.includes(userId) ? 2 : null;
  const rows = standings.map(row => ({ ...row, team: teamOf(row.userId) }));
  if (winnerId === null) return rows;
  const winnerTeam = teamOf(winnerId);
  const winnerRow = rows.find(row => row.userId === winnerId)!;
  const completed = rows.filter(row => row.outcome === 'completed');
  const totalCards = completed.reduce((sum, row) => sum + row.cardCount!, 0);
  const abandoned = rows.length - completed.length;
  for (const row of completed) {
    if (row.team === winnerTeam) { row.place = 1; row.xp = winnerRow.xp; }
    else {
      row.place = 2;
      row.xp = junoDynamicXp(2, row.cardCount!, totalCards, completed.length, abandoned);
    }
  }
  return [...completed.filter(row => row.team === winnerTeam),
    ...completed.filter(row => row.team !== winnerTeam),
    ...rows.filter(row => row.outcome !== 'completed')];
}
