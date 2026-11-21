import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createJunoTestDb, seedJunoTestDb, junoTestSettlement as settlement } from './junoTestDb.js';
import { buildJunoStandings } from './junoStandings.js';
import * as schema from '../db/schema.js';
import { settleJunoRound } from './junoProgression.js';
let fixture: ReturnType<typeof createJunoTestDb>;
beforeEach(() => { fixture = createJunoTestDb(); seedJunoTestDb(fixture.db); });
afterEach(() => fixture.sqlite.close());
describe('durable Juno progression', () => {
  it('accepts the expanded rare-card deck with dynamic XP and still refuses impossible hand counts', () => {
    const two = [{ userId: 'a', name: 'a' }, { userId: 'b', name: 'b' }];
    const duo = buildJunoStandings(two, [{ userId: 'a', cardCount: 0 }, { userId: 'b', cardCount: 109 }], 'a', 'emptyHand');
    const input = { roundId: 'duo', spaceId: 'space', channelId: 'voice', finishedAt: 100, scoringVersion: 1 as const, result: 'emptyHand' as const, standings: duo, duos: null };
    expect(settleJunoRound(input, fixture.db).standings[1]).toMatchObject({ place: 2, xp: 85, cardCount: 109 });
    // A coherent proposal above the 111-card deck is still structurally impossible.
    const over = buildJunoStandings(two, [{ userId: 'a', cardCount: 0 }, { userId: 'b', cardCount: 112 }], 'a', 'emptyHand');
    expect(() => settleJunoRound({ roundId: 'over', spaceId: 'space', channelId: 'voice', finishedAt: 100, scoringVersion: 1, result: 'emptyHand', standings: over, duos: null }, fixture.db))
      .toThrow('Invalid Juno settlement');
    // Two zero-card finishers would record two winners.
    const double = buildJunoStandings(two, [{ userId: 'a', cardCount: 0 }, { userId: 'b', cardCount: 0 }], 'a', 'emptyHand');
    expect(() => settleJunoRound({ roundId: 'double', spaceId: 'space', channelId: 'voice', finishedAt: 100, scoringVersion: 1, result: 'emptyHand', standings: double, duos: null }, fixture.db))
      .toThrow('Invalid Juno settlement');
    const invalid = settlement('invalid'); invalid.standings[1]!.cardCount = 111;
    expect(() => settleJunoRound(invalid, fixture.db)).toThrow('Invalid Juno settlement');
    // A structurally valid proposal with altered XP is still refused.
    const altered = settlement('altered'); altered.standings[0]!.xp += 1;
    expect(() => settleJunoRound(altered, fixture.db)).toThrow('Invalid Juno award');
  });
  it('never writes any progression for a computer practice settlement', () => {
    const input = settlement(); input.standings[1]!.computer = 1;
    expect(settleJunoRound(input, fixture.db)).toMatchObject({ status: 'unranked' });
    expect(fixture.db.select().from(schema.junoRoundResults).all()).toEqual([]);
    expect(fixture.db.select().from(schema.junoRoundParticipants).all()).toEqual([]);
    expect(fixture.db.select().from(schema.junoPlayerStats).all()).toEqual([]);
  });
  it('credits original native participants even if obsolete redirect data is supplied', () => {
    const input = { ...settlement(), recipientIds: new Map([['a', 'b']]) };
    const result = settleJunoRound(input, fixture.db);
    expect(result.standings.find(row => row.userId === 'a')).toMatchObject({ place: 1, xp: 133 });
    expect(result.standings.find(row => row.userId === 'b')).toMatchObject({ place: 2, xp: 93 });
    expect(fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'b')).get())
      .toMatchObject({ totalXp: 93, wins: 0, completedRounds: 1 });
    // Every participant retains their own frozen award across retries.
    expect(result.standings.find(row => row.userId === 'd')).toMatchObject({ place: 4, xp: 31 });
    for (let i = 0; i < 100; i++) settleJunoRound(input, fixture.db);
    expect(fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'b')).get()?.totalXp).toBe(93);
  });
  it('keeps abandoned starters after ranked finishers without awarding counters', () => {
    const starters = ['a', 'b', 'c', 'd'].map(userId => ({ userId, name: userId }));
    const rows = buildJunoStandings(starters, [{ userId: 'a', cardCount: 0 }, { userId: 'b', cardCount: 2 }, { userId: 'd', cardCount: 7 }], 'a', 'emptyHand');
    const input = { roundId: 'abandoned', spaceId: 'space', channelId: 'voice', finishedAt: 100, scoringVersion: 1 as const, result: 'emptyHand' as const, standings: rows, duos: null };
    const result = settleJunoRound(input, fixture.db);
    expect(result.standings.map(row => row.userId)).toEqual(['a', 'b', 'd', 'c']);
    expect(fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'c')).all()).toEqual([]);
  });
  it('records one credit across 100 retries and never trusts a changed duplicate proposal', () => {
    const input = settlement();
    for (let i = 0; i < 100; i++) expect(settleJunoRound(input, fixture.db).status).toBe('credited');
    const repeated = settlement(); repeated.standings[0]!.xp = 999;
    expect(settleJunoRound(repeated, fixture.db).standings[0]!.xp).toBe(133);
    expect(fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'a')).get())
      .toMatchObject({ totalXp: 133, wins: 1, completedRounds: 1 });
    expect(fixture.db.select().from(schema.junoRoundParticipants).all()).toHaveLength(4);
  });
  it('combines different rounds without mixing spaces', () => {
    settleJunoRound(settlement('one'), fixture.db); settleJunoRound(settlement('two'), fixture.db);
    settleJunoRound(settlement('three', 'other'), fixture.db);
    const rows = fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'a')).all();
    expect(rows.map(r => [r.spaceId, r.totalXp]).sort()).toEqual([['other', 133], ['space', 266]]);
    expect(() => settleJunoRound(settlement('one', 'other'), fixture.db)).toThrow();
  });
  it('credits a six-player round with places 1-6 and refuses a seventh starter', () => {
    for (const id of ['e', 'f']) {
      fixture.db.insert(schema.users).values({ id, username: id, passwordHash: 'test-not-a-password', displayName: id.toUpperCase(), avatar: `${id}.webp`, createdAt: 1 }).run();
      fixture.db.insert(schema.spaceMembers).values({ spaceId: 'space', userId: id, joinedAt: 1 }).run();
    }
    const people = ['a', 'b', 'c', 'd', 'e', 'f'].map(userId => ({ userId, name: userId }));
    const standings = buildJunoStandings(people, [0, 1, 3, 5, 9, 12].map((cardCount, i) => ({ userId: people[i]!.userId, cardCount })), 'a', 'emptyHand');
    const result = settleJunoRound({ roundId: 'six', spaceId: 'space', channelId: 'voice', finishedAt: 100, scoringVersion: 1, result: 'emptyHand', standings, duos: null }, fixture.db);
    expect(result).toMatchObject({ status: 'credited' });
    expect(result.standings.map(r => r.place)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.standings.map(r => r.xp)).toEqual([141, 100, 60, 40, 29, 23]);
    expect(fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'f')).get()).toMatchObject({ totalXp: 23, completedRounds: 1 });
    const seventh = [...standings, { userId: 'watcher', name: 'watcher', place: 6 as const, cardCount: 20, xp: 5, outcome: 'completed' as const }];
    expect(() => settleJunoRound({ roundId: 'seven', spaceId: 'space', channelId: 'voice', finishedAt: 100, scoringVersion: 1, result: 'emptyHand', standings: seventh, duos: null }, fixture.db)).toThrow('Invalid Juno settlement');
  });
  it('rolls the whole settlement back on a real SQLite failure, then retries once', () => {
    fixture.sqlite.exec("CREATE TRIGGER fail_juno BEFORE INSERT ON juno_round_participants WHEN NEW.user_id = 'b' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
    expect(() => settleJunoRound(settlement(), fixture.db)).toThrow('injected failure');
    expect(fixture.db.select().from(schema.junoRoundResults).all()).toEqual([]);
    expect(fixture.db.select().from(schema.junoPlayerStats).all()).toEqual([]);
    fixture.sqlite.exec('DROP TRIGGER fail_juno');
    expect(settleJunoRound(settlement(), fixture.db).status).toBe('credited');
  });
  it('does not award no-winner results or resurrect deleted people/spaces', () => {
    const input = settlement(); input.result = 'playersLeft';
    expect(settleJunoRound(input, fixture.db).status).toBe('unranked');
    expect(fixture.db.select().from(schema.junoPlayerStats).all()).toEqual([]);
    fixture.db.update(schema.users).set({ isDeleted: 1 }).where(eq(schema.users.id, 'a')).run();
    expect(settleJunoRound(settlement(), fixture.db).standings.some(r => r.userId === 'a')).toBe(false);
    expect(fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'a')).all()).toEqual([]);
    fixture.db.delete(schema.spaces).where(eq(schema.spaces.id, 'space')).run();
    expect(settleJunoRound(settlement('later'), fixture.db).status).toBe('unranked');
  });
  it('keeps XP when a channel is deleted and removes it with the space', () => {
    settleJunoRound(settlement(), fixture.db);
    fixture.db.delete(schema.channels).where(eq(schema.channels.id, 'voice')).run();
    expect(fixture.db.select().from(schema.junoRoundResults).get()?.channelId).toBeNull();
    expect(fixture.db.select().from(schema.junoPlayerStats).all()).toHaveLength(4);
    fixture.db.delete(schema.spaces).where(eq(schema.spaces.id, 'space')).run();
    expect(fixture.db.select().from(schema.junoPlayerStats).all()).toEqual([]);
  });
  it('survives reopening SQLite and interleaved writes from two connections', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'juno-durable-')); const filename = path.join(directory, 'test.db');
    const first = createJunoTestDb(filename); seedJunoTestDb(first.db);
    const second = createJunoTestDb(filename);
    try {
      settleJunoRound(settlement('first'), first.db); settleJunoRound(settlement('second'), second.db);
      settleJunoRound(settlement('first'), second.db);
    } finally { first.sqlite.close(); second.sqlite.close(); }
    const reopened = createJunoTestDb(filename);
    try { expect(reopened.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'a')).get()?.totalXp).toBe(266); }
    finally { reopened.sqlite.close(); }
  });
});
