import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { canPlayJuno, type JunoAction, type JunoSnapshot, type JunoRankingPage } from '@veyvox/shared/src/juno.js';
import { spawnInstance, stopInstance, type SpawnedInstance } from './helpers/instanceHarness.js';
import { registerLocal, type TestUser } from './helpers/testUsers.js';
import { connectWs, type WsCapture } from './helpers/wsListener.js';

vi.setConfig({ testTimeout: 60_000 });
let instance: SpawnedInstance;
let directory: string;
let channelId: string;
let spaceId: string;
const users: TestUser[] = [];
const sockets: WsCapture[] = [];
async function call(user: TestUser, method: string, url: string, body?: unknown): Promise<Response> {
  return fetch(`${instance.origin}${url}`, { method, headers: { Authorization: `Bearer ${user.token}`,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function read(user: TestUser, query = 'six=1'): Promise<JunoSnapshot> {
  const res = await call(user, 'GET', `/api/channels/${channelId}/juno?${query}`); expect(res.status).toBe(200); return res.json() as Promise<JunoSnapshot>;
}
async function act(user: TestUser, action: JunoAction | { type: 'create' }, query = 'six=1'): Promise<JunoSnapshot> {
  const previous = await read(user, query);
  const body = action.type === 'create' ? action : { ...action, gameId: previous.game!.id, revision: previous.revision };
  const res = await call(user, 'POST', `/api/channels/${channelId}/juno?${query}`, body);
  expect(res.status, await res.clone().text()).toBe(200); return res.json() as Promise<JunoSnapshot>;
}
async function finishRound(snapshot: JunoSnapshot, testReport = false, query = 'six=1'): Promise<JunoSnapshot> {
  let reported = false;
  for (let step = 0; step < 1_000 && snapshot.game!.phase === 'playing'; step++) {
    const user = users.find(u => u.id === snapshot.game!.currentPlayerId)!;
    const own = (await read(user, query)).game!;
    const playable = own.hand.find(card => (!own.drawnCardId || own.drawnCardId === card.id) && canPlayJuno(card, own.hand, own.topCard!, own.color!));
    const miss = testReport && !reported && own.hand.length === 2 && !!playable;
    snapshot = await act(user, playable ? { type: 'play', cardId: playable.id, color: 'mint', announce: !miss }
      : { type: own.drawnCardId ? 'pass' : 'draw' }, query);
    if (miss) {
      const opportunity = snapshot.game!.reportOpportunities!.find(w => w.targetUserId === user.id)!;
      expect(opportunity).toBeTruthy(); expect(snapshot.game!.hand).toHaveLength(1);
      const reporter = users.find(u => u.id !== user.id && u.id !== snapshot.game!.currentPlayerId && snapshot.game!.players.some(p => p.userId === u.id))!;
      const before = (await read(reporter, query)).game!;
      const action: JunoAction = { type: 'report', targetUserId: user.id, opportunityId: opportunity.id };
      const spectator = await read(users[4]!, query);
      expect((await call(users[4]!, 'POST', `/api/channels/${channelId}/juno?${query}`, { ...action, gameId: spectator.game!.id, revision: spectator.revision })).status).toBe(400);
      snapshot = await act(reporter, action, query);
      expect((await read(user, query)).game!.hand).toHaveLength(3);
      expect(snapshot.game!.lastMove).toMatchObject({ type: 'report', userId: reporter.id, targetUserId: user.id, amount: 2 });
      expect(snapshot.game!.currentPlayerId).toBe(before.currentPlayerId);
      expect(snapshot.game!.remainingMs).toBeLessThanOrEqual(before.remainingMs);
      const privateCards = (await read(user, query)).game!.hand;
      for (const card of privateCards) expect(JSON.stringify(snapshot)).not.toContain(card.id);
      expect((await call(reporter, 'POST', `/api/channels/${channelId}/juno?${query}`, { ...action, gameId: snapshot.game!.id, revision: snapshot.revision })).status).toBe(400);
      reported = true;
    }
  }
  if (testReport) expect(reported).toBe(true);
  return snapshot;
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'backspace-juno-e2e-'));
  const uploads = path.join(directory, 'uploads'); await mkdir(uploads);
  instance = await spawnInstance({ domain: 'juno.test.local', dbPath: path.join(directory, 'test.db'), storagePath: uploads,
    jwtSecret: randomBytes(32).toString('hex'), logPath: path.join(directory, 'server.log'), environment: { PASSWORD_HASH_COST: '4' } });
  for (const name of ['ada', 'bo', 'clem', 'dee', 'watcher', 'fay', 'gus']) users.push(await registerLocal(instance, name));
  const owner = users[0]!;
  const response = await call(owner, 'POST', '/api/spaces', { name: 'Juno acceptance' }); expect(response.status).toBe(201);
  const space = await response.json() as { id: string; inviteCode: string };
  spaceId = space.id;
  for (const user of users.slice(1)) expect((await call(user, 'POST', `/api/spaces/${space.id}/join`, { inviteCode: space.inviteCode })).status).toBe(200);
  const channel = await call(owner, 'POST', `/api/spaces/${space.id}/channels`, { name: 'juno-table', type: 'voice' });
  expect(channel.status).toBe(201); channelId = ((await channel.json()) as { id: string }).id;
  for (const user of users) {
    const ws = await connectWs(instance.origin, user.token); sockets.push(ws);
    expect((await ws.waitForEvent('ready')).supportsJuno).toBe(true);
    ws.send({ type: 'voice_join', channelId });
    expect(await ws.waitForEvent('voice_state_update')).toMatchObject({ userId: user.id, action: 'join' });
  }
}, 90_000);
afterAll(async () => {
  for (const ws of sockets) ws.close();
  if (instance?.proc.exitCode === null && instance.proc.signalCode === null) {
    await stopInstance(instance);
  }
  if (directory) await rm(directory, { recursive: true, force: true }); // Only this suite's unique fixture.
});
describe('real Juno server with four independently authenticated voice sockets', () => {
  it('plays a complete four-player round, keeps private hands secret and supports a spectator', async () => {
    await act(users[0]!, { type: 'create' });
    for (const user of users.slice(1, 4)) await act(user, { type: 'join' });
    await act(users[0]!, { type: 'start' });
    const views = await Promise.all(users.map(u => read(u)));
    expect(views[4]!.game!.hand).toEqual([]);
    for (let i = 0; i < 4; i++) {
      expect(views[i]!.game!.hand).toHaveLength(7);
      for (let j = 0; j < 5; j++) if (i !== j) for (const card of views[i]!.game!.hand) expect(JSON.stringify(views[j])).not.toContain(card.id);
    }
    const snapshot = await finishRound(views[0]!, true);
    expect(snapshot.game!.phase).toBe('finished'); expect(snapshot.game!.winnerId).toBeTruthy();
    expect(sockets.every(ws => ws.events.some(e => e.type === 'juno_updated'))).toBe(true);
    for (const ws of sockets) for (const event of ws.events.filter(e => e.type === 'juno_updated')) expect(Object.keys(event).sort()).toEqual(['channelId', 'type']);
    expect(snapshot.game!.scoreboard?.status).toBe('credited');
    const board = snapshot.game!.scoreboard!;
    const ranking = await (await call(users[4]!, 'GET', `/api/spaces/${spaceId}/juno/ranking`)).json() as JunoRankingPage;
    expect(ranking.entries).toHaveLength(4); expect(ranking.me.totalXp).toBe(0);
    for (const row of board.standings) expect(ranking.entries.find(r => r.user.id === row.userId)?.totalXp).toBe(row.xp);
    for (let i = 0; i < 10; i++) expect((await read(users[0]!)).game!.scoreboard).toEqual(board);
  });
  it('plays a complete six-player round with dynamic places 1-6 and a spectator', async () => {
    const seated = [users[0]!, users[1]!, users[2]!, users[3]!, users[5]!, users[6]!];
    await act(users[0]!, { type: 'rematch' });
    for (const user of seated.slice(1)) await act(user, { type: 'join' });
    await act(users[0]!, { type: 'start' });
    const views = await Promise.all(users.map(u => read(u)));
    expect(views[4]!.game!.hand).toEqual([]);
    for (let i = 0; i < 7; i++) {
      if (i === 4) continue;
      expect(views[i]!.game!.hand).toHaveLength(7);
    }
    const snapshot = await finishRound(views[0]!, false);
    expect(snapshot.game!.phase).toBe('finished'); expect(snapshot.game!.winnerId).toBeTruthy();
    expect(snapshot.game!.scoreboard?.status).toBe('credited');
    const board = snapshot.game!.scoreboard!;
    expect(board.standings).toHaveLength(6);
    expect(board.standings.every(s => s.outcome === 'completed')).toBe(true);
    // Returned order is winner-first, then ascending remaining cards.
    expect(board.standings[0]!.userId).toBe(snapshot.game!.winnerId);
    expect(board.standings[0]).toMatchObject({ place: 1, cardCount: 0 });
    const counts = board.standings.map(s => s.cardCount!);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    // Dynamic XP without calling the implementation: base awards from the
    // documented table, bounded bonuses, ties sharing XP, winner strictly first.
    const base = [120, 80, 40, 20, 10, 5];
    for (const row of board.standings) {
      expect(row.xp).toBeGreaterThanOrEqual(base[row.place! - 1]!);
      expect(row.xp).toBeLessThanOrEqual(base[row.place! - 1]! + 20 + 10 + 5);
    }
    for (const row of board.standings.slice(1)) expect(row.xp).toBeLessThan(board.standings[0]!.xp);
    for (let i = 1; i < board.standings.length; i++) {
      if (board.standings[i]!.cardCount === board.standings[i - 1]!.cardCount) {
        expect(board.standings[i]!.xp).toBe(board.standings[i - 1]!.xp);
        expect(board.standings[i]!.place).toBe(board.standings[i - 1]!.place);
      }
    }
    const total = counts.reduce((sum, count) => sum + count, 0);
    expect(total).toBeGreaterThan(0); expect(total).toBeLessThanOrEqual(111);
    // Private-hand isolation across all six hands.
    const finals = await Promise.all(seated.map(u => read(u)));
    for (const [index, view] of finals.entries()) {
      const self = seated[index]!;
      expect(view.game!.hand).toHaveLength(view.game!.players.find(p => p.userId === self.id)!.cardCount);
      for (const other of finals) {
        if (other === view) continue;
        for (const card of view.game!.hand) expect(JSON.stringify(other.game)).not.toContain(`"${card.id}"`);
      }
    }
  });
  it('plays a complete duos round where both teammates share the win and the partner hand', async () => {
    const duo = 'six=1&duos=1';
    const seated = [users[0]!, users[1]!, users[2]!, users[3]!];
    await act(users[0]!, { type: 'rematch' }, duo);
    const lobby = await act(users[0]!, { type: 'options', mode: 'duo' }, duo);
    expect(lobby.game!.options).toMatchObject({ mode: 'duo' });
    for (const user of seated.slice(1)) await act(user, { type: 'join' }, duo);
    const started = (await act(users[0]!, { type: 'start' }, duo)).game!;
    expect(started.mode).toBe('duo');
    expect(started.teams).toEqual({ a: [users[0]!.id, users[1]!.id], b: [users[2]!.id, users[3]!.id] });
    // Partner hands are shared; everyone else sees only backs.
    const views = await Promise.all(seated.map(u => read(u, duo)));
    for (const [index, view] of views.entries()) {
      const partner = seated[index === 0 ? 1 : index === 1 ? 0 : index === 2 ? 3 : 2]!;
      const partnerView = views[seated.indexOf(partner)]!;
      expect(view.game!.partnerHand.map(c => c.id).sort()).toEqual(partnerView.game!.hand.map(c => c.id).sort());
      expect(view.game!.partnerHand.length).toBeGreaterThan(0);
    }
    const watcher = await read(users[4]!, duo);
    expect(watcher.game!.partnerHand).toEqual([]);
    expect(watcher.game!.teams).toEqual({ a: [users[0]!.id, users[1]!.id], b: [users[2]!.id, users[3]!.id] });
    const done = await finishRound(await read(users[0]!, duo), false, duo);
    expect(done.game!.phase).toBe('finished'); expect(done.game!.winnerId).toBeTruthy();
    expect(done.game!.scoreboard?.status).toBe('credited');
    const board = done.game!.scoreboard!;
    const winners = board.standings.filter(s => s.place === 1);
    expect(winners).toHaveLength(2);
    expect(winners[0]!.xp).toBe(winners[1]!.xp);
    expect(new Set(winners.map(w => w.userId))).toEqual(new Set(done.game!.teams![done.game!.teams!.a.includes(done.game!.winnerId!) ? 'a' : 'b']));
    expect(board.standings.map(row => row.place)).toEqual([1, 1, 2, 2]);
    const ranking = await (await call(users[0]!, 'GET', `/api/spaces/${spaceId}/juno/ranking`)).json() as JunoRankingPage;
    for (const w of winners) {
      const entry = ranking.entries.find(r => r.user.id === w.userId)!;
      expect(entry.completedRounds).toBeGreaterThanOrEqual(1); expect(entry.wins).toBeGreaterThanOrEqual(1);
    }
  });
  it('adds a private-hand computer through HTTP, observes a paced server move and leaves rankings unchanged', async () => {
    const owner = users[0]!;
    const rankingUrl = `/api/spaces/${spaceId}/juno/ranking`;
    const before = await (await call(owner, 'GET', rankingUrl)).json() as JunoRankingPage;
    const duo = 'six=1&duos=1';
    await act(owner, { type: 'rematch' }, duo);
    await act(owner, { type: 'options', mode: 'single' }, duo);
    const lobby = await act(owner, { type: 'addBot' });
    const bot = lobby.game!.players.find(p => p.computer)!;
    expect(bot.name).not.toBe('Deleted User'); expect(bot.user).toBeUndefined();
    const snapshot = await act(owner, { type: 'start' });
    expect(snapshot.game!.practice).toBe(true); expect(snapshot.game!.hand).toHaveLength(7);
    let own = snapshot;
    for (let n = 0; n < 2 && own.game!.currentPlayerId === owner.id; n++) own = await act(owner, { type: own.game!.drawnCardId ? 'pass' : 'draw' });
    await expect.poll(async () => (await read(owner)).game!.lastMove?.userId === bot.userId, { timeout: 6000 }).toBe(true);
    const move = (await read(owner)).game!.lastMove!;
    expect(move.id).toBeTruthy(); expect((await read(owner)).game!.lastMove!.id).toBe(move.id);
    expect((await read(users[4]!)).game!.hand).toEqual([]);
    await act(owner, { type: 'leave' });
    expect((await read(owner)).game).toBeNull();
    const after = await (await call(owner, 'GET', rankingUrl)).json() as JunoRankingPage;
    expect(after.entries.map(r => [r.user.id, r.totalXp, r.wins, r.completedRounds])).toEqual(before.entries.map(r => [r.user.id, r.totalXp, r.wins, r.completedRounds]));
  });
  it('combines another channel, survives host restart and isolates another space', async () => {
    const channel = await call(users[0]!, 'POST', `/api/spaces/${spaceId}/channels`, { name: 'second-table', type: 'voice' });
    channelId = ((await channel.json()) as { id: string }).id;
    for (let i = 0; i < 2; i++) {
      sockets[i]!.send({ type: 'voice_join', channelId });
      await expect.poll(() => sockets[i]!.events.some(e => e.type === 'voice_state_update' && e.channelId === channelId && e.userId === users[i]!.id && e.action === 'join'), { timeout: 5000 }).toBe(true);
    }
    await act(users[0]!, { type: 'create' }); await act(users[1]!, { type: 'join' });
    expect((await finishRound(await act(users[0]!, { type: 'start' }))).game!.scoreboard?.status).toBe('credited');
    const before = await (await call(users[0]!, 'GET', `/api/spaces/${spaceId}/juno/ranking`)).json() as JunoRankingPage;
    expect(before.me.completedRounds).toBe(4);
    for (const ws of sockets) ws.close();
    await stopInstance(instance);
    instance = await spawnInstance({ domain: instance.domain, dbPath: instance.dbPath, storagePath: instance.storagePath,
      jwtSecret: instance.jwtSecret, logPath: path.join(directory, 'restarted.log') });
    const after = await (await call(users[0]!, 'GET', `/api/spaces/${spaceId}/juno/ranking`)).json() as JunoRankingPage;
    expect(after.me).toMatchObject({ totalXp: before.me.totalXp, wins: before.me.wins,
      completedRounds: before.me.completedRounds, rank: before.me.rank, user: { id: before.me.user.id } });
    const another = await (await call(users[0]!, 'POST', '/api/spaces', { name: 'Independent XP' })).json() as { id: string };
    const empty = await (await call(users[0]!, 'GET', `/api/spaces/${another.id}/juno/ranking`)).json() as JunoRankingPage;
    expect(empty.total).toBe(0); expect(empty.me.totalXp).toBe(0);
  });
});
