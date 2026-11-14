import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(1);
let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let currentUserId = 'owner';
const sendToUser = vi.fn();
vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));
vi.mock('../utils/auth.js', () => ({ authenticate: async (req: { userId?: string }) => { req.userId = currentUserId; } }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { sendToUser: (...args: unknown[]) => sendToUser(...args) } }));

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle') });
  testDb = drizzle(sqlite, { schema });
  currentUserId = 'owner';
  sendToUser.mockClear();
  for (const id of ['owner', 'other']) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: 'space', name: 'Space', ownerId: 'owner', createdAt: 1 }).run();
  for (const userId of ['owner', 'other']) {
    testDb.insert(schema.spaceMembers).values({ spaceId: 'space', userId, joinedAt: 1 }).run();
  }
  testDb.insert(schema.channels).values({ id: 'chat', spaceId: 'space', name: 'general', type: 'text', createdAt: 1 }).run();
  // 'other' is not in this DM.
  testDb.insert(schema.dmChannels).values({ id: 'dm', createdAt: 1 }).run();
  testDb.insert(schema.dmMembers).values({ dmChannelId: 'dm', userId: 'owner' }).run();
  const { bookmarkRoutes } = await import('./bookmarks.js');
  app = Fastify();
  await app.register(bookmarkRoutes);
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

const as = (user: string) => { currentUserId = user; };
const channelMessage = (id: string, content = 'hello') => {
  testDb.insert(schema.messages).values({ id, channelId: 'chat', userId: 'other', content, createdAt: 1 }).run();
};
const dmMessage = (id: string, content = 'psst') => {
  testDb.insert(schema.dmMessages).values({ id, dmChannelId: 'dm', userId: 'owner', content, createdAt: 1 }).run();
};

describe('bookmarks', () => {
  it('saves a message once, then answers the same bookmark with 200', async () => {
    channelMessage('m1');
    const first = await app.inject({ method: 'PUT', url: '/api/bookmarks/channel/m1' });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      kind: 'channel', messageId: 'm1', channelId: 'chat', spaceId: 'space',
      content: 'hello', authorId: 'other', authorName: 'other',
      spaceName: 'Space', channelName: 'general', status: 'ok',
    });
    expect(first.json()).not.toHaveProperty('instanceOrigin');
    expect(sendToUser).toHaveBeenCalledWith('owner', expect.objectContaining({ type: 'bookmark_added' }));

    const second = await app.inject({ method: 'PUT', url: '/api/bookmarks/channel/m1' });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(sendToUser).toHaveBeenCalledTimes(1);
  });

  it('refuses a message the caller cannot read, and system messages', async () => {
    channelMessage('m1');
    testDb.insert(schema.messages).values({ id: 'sys', channelId: 'chat', userId: 'other', content: 'joined', type: 'system', createdAt: 1 }).run();
    dmMessage('d1');
    as('other');
    expect((await app.inject({ method: 'PUT', url: '/api/bookmarks/dm/d1' })).statusCode).toBe(404);
    as('owner');
    expect((await app.inject({ method: 'PUT', url: '/api/bookmarks/channel/missing' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: '/api/bookmarks/channel/sys' })).statusCode).toBe(400);
  });

  it('lists the caller bookmarks newest first, pages with a cursor, and reports the keys of a conversation', async () => {
    channelMessage('m1');
    channelMessage('m2');
    dmMessage('d1');
    await app.inject({ method: 'PUT', url: '/api/bookmarks/channel/m1' });
    await app.inject({ method: 'PUT', url: '/api/bookmarks/channel/m2' });
    await app.inject({ method: 'PUT', url: '/api/bookmarks/dm/d1' });

    const keys = await app.inject({ method: 'GET', url: '/api/bookmarks/keys?kind=channel&channelId=chat' });
    expect(keys.statusCode).toBe(200);
    expect(keys.json().sort()).toEqual(['m1', 'm2']);

    const page = await app.inject({ method: 'GET', url: '/api/bookmarks?limit=2' });
    expect(page.statusCode).toBe(200);
    expect(page.json().items).toHaveLength(2);
    const cursor = page.json().nextCursor as string;
    expect(cursor).toMatch(/^\d+:\w+$/);
    const next = await app.inject({ method: 'GET', url: `/api/bookmarks?limit=2&cursor=${encodeURIComponent(cursor)}` });
    expect(next.statusCode).toBe(200);
    expect(next.json().items).toHaveLength(1);
    expect(next.json().nextCursor).toBeNull();

    expect((await app.inject({ method: 'GET', url: '/api/bookmarks?cursor=not-a-cursor' })).statusCode).toBe(400);
  });

  it('works out what became of the original on every read', async () => {
    channelMessage('m1', 'saved text');
    channelMessage('m2', 'saved text');
    await app.inject({ method: 'PUT', url: '/api/bookmarks/channel/m1' });
    await app.inject({ method: 'PUT', url: '/api/bookmarks/channel/m2' });

    testDb.update(schema.messages).set({ content: 'edited text' }).run();
    const edited = await app.inject({ method: 'GET', url: '/api/bookmarks' });
    expect(edited.json().items.every((item: { status: string }) => item.status === 'edited')).toBe(true);

    testDb.delete(schema.messages).run();
    const deleted = await app.inject({ method: 'GET', url: '/api/bookmarks' });
    expect(deleted.json().items.every((item: { status: string }) => item.status === 'deleted')).toBe(true);
    expect(deleted.json().items[0].content).toBe('saved text');
  });

  it('removes a bookmark idempotently and announces the removal once', async () => {
    channelMessage('m1');
    await app.inject({ method: 'PUT', url: '/api/bookmarks/channel/m1' });
    sendToUser.mockClear();

    const first = await app.inject({ method: 'DELETE', url: '/api/bookmarks/channel/m1' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ success: true });
    expect(sendToUser).toHaveBeenCalledWith('owner', {
      type: 'bookmark_removed', kind: 'channel', channelId: 'chat', messageId: 'm1',
    });

    const second = await app.inject({ method: 'DELETE', url: '/api/bookmarks/channel/m1' });
    expect(second.statusCode).toBe(200);
    expect(sendToUser).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown kind before touching the database', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/bookmarks/thread/m1' })).statusCode).toBe(400);
  });
});
