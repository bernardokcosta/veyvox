import { describe, expect, it } from 'vitest';
import { buildJunoStandings } from './junoStandings.js';

const starters = ['a', 'b', 'c', 'd'].map(userId => ({ userId, name: userId }));
const six = ['a', 'b', 'c', 'd', 'e', 'f'].map(userId => ({ userId, name: userId }));
describe('Juno final standings', () => {
  it('ranks [0,2,2,7] as [1,2,2,4] with dynamic card/field/stability bonuses', () => {
    const rows = buildJunoStandings(starters, [0, 2, 2, 7].map((cardCount, i) => ({ userId: starters[i]!.userId, cardCount })), 'a', 'emptyHand');
    expect(rows.map(r => r.place)).toEqual([1, 2, 2, 4]);
    expect(rows.map(r => r.xp)).toEqual([133, 93, 93, 31]);
  });
  it.each([[2, [127, 85]], [3, [128, 87, 46]]] as const)('awards only %s actual finishers and keeps inputs immutable', (count, xp) => {
    const people = starters.slice(0, count); const before = JSON.stringify(people);
    const rows = buildJunoStandings(people, people.map((p, i) => ({ userId: p.userId, cardCount: i * 2 })), 'a', 'emptyHand');
    expect(rows.map(r => r.xp)).toEqual(xp);
    rows[0]!.name = 'changed'; expect(JSON.stringify(people)).toBe(before);
  });
  it('retains abandoned starters without reserving a ranked place', () => {
    const rows = buildJunoStandings(starters, [{ userId: 'a', cardCount: 0 }, { userId: 'c', cardCount: 5 }], 'a', 'emptyHand');
    expect(rows.filter(r => r.outcome === 'completed').map(r => [r.userId, r.place, r.xp])).toEqual([['a', 1, 125], ['c', 2, 80]]);
    expect(rows.find(r => r.userId === 'b')).toMatchObject({ outcome: 'abandoned', place: null, xp: 0, cardCount: null });
  });
  it('ranks six finishers [0,1,3,5,9,12] as [1,2,3,4,5,6] with base 120/80/40/20/10/5 plus bonuses', () => {
    const rows = buildJunoStandings(six, [0, 1, 3, 5, 9, 12].map((cardCount, i) => ({ userId: six[i]!.userId, cardCount })), 'a', 'emptyHand');
    expect(rows.map(r => r.place)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.map(r => r.xp)).toEqual([141, 100, 60, 40, 29, 23]);
    expect(rows.every(r => r.xp >= [120, 80, 40, 20, 10, 5][rows.indexOf(r)]!)).toBe(true);
  });
  it('keeps tied six-player XP identical', () => {
    const rows = buildJunoStandings(six, [0, 4, 4, 4, 9, 9].map((cardCount, i) => ({ userId: six[i]!.userId, cardCount })), 'a', 'emptyHand');
    expect(rows.map(r => r.place)).toEqual([1, 2, 2, 2, 5, 5]);
    expect(rows.filter(r => r.place === 2).map(r => r.xp)).toEqual([100, 100, 100]);
    expect(rows.filter(r => r.place === 5).map(r => r.xp)).toEqual([29, 29]);
  });
  it('awards the average opposing hand: a 0/10 duel pays the winner 135 XP', () => {
    const rows = buildJunoStandings([{ userId: 'a', name: 'a' }, { userId: 'b', name: 'b' }],
      [{ userId: 'a', cardCount: 0 }, { userId: 'b', cardCount: 10 }], 'a', 'emptyHand');
    expect(rows.map(r => [r.place, r.xp])).toEqual([[1, 135], [2, 85]]);
  });
  it.each(['playersLeft', 'stalemate', 'expired'] as const)('never awards a %s round', result => {
    const rows = buildJunoStandings(starters, starters.map(p => ({ userId: p.userId, cardCount: 4 })), null, result);
    expect(rows.every(r => r.xp === 0 && r.place === null && r.outcome === 'unranked')).toBe(true);
  });
});
