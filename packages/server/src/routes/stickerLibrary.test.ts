import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { buildNativeDatabase } from '../testing/standaloneUpgrade.js';

const settings = vi.hoisted(() => ({ uploadDir: '', publicOrigin: 'https://chat.test' }));
let db: ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let app: FastifyInstance;
vi.mock('../db/index.js', () => ({ getDb: () => db, schema }));
vi.mock('../config.js', () => ({ config: settings }));
vi.mock('../utils/auth.js', () => ({
  authenticate: async (request: { userId: string; username: string; headers: Record<string, string> }, reply: { code: (code: number) => { send: () => void } }) => {
    if (!request.headers.authorization) return reply.code(401).send();
    request.userId = request.headers.authorization;
    request.username = request.headers.authorization;
  },
}));
import { stickerLibraryRoutes, _resetStickerLibraryRateLimit } from './stickerLibrary.js';

const as = (user: string) => ({ headers: { authorization: user } });

beforeEach(async () => {
  _resetStickerLibraryRateLimit();
  settings.uploadDir = await mkdtemp(path.join(tmpdir(), 'veyvox-library-'));
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  buildNativeDatabase(sqlite);
  for (const id of ['owner', 'member']) {
    db.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
  db.insert(schema.spaces).values({ id: 'space', name: 'Space', ownerId: 'owner', createdAt: 1 }).run();
  db.insert(schema.spaceMembers).values({ spaceId: 'space', userId: 'owner', joinedAt: 1 }).run();
  db.insert(schema.spaceMembers).values({ spaceId: 'space', userId: 'member', joinedAt: 1 }).run();
  app = Fastify();
  await app.register(stickerLibraryRoutes);
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  await rm(settings.uploadDir, { recursive: true, force: true });
});

async function imageB64(): Promise<string> {
  const image = await sharp({ create: { width: 8, height: 8, channels: 4, background: 'red' } }).png().toBuffer();
  return image.toString('base64');
}

async function createPrivatePack(name = 'Mine'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/private-sticker-packs', ...as('owner'), payload: { name } });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe('sticker library', () => {
  it('lists nothing for a fresh account', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sticker-library', ...as('owner') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ privatePacks: [], favorites: [] });
    expect(res.json().spaces).toEqual([expect.objectContaining({ spaceId: 'space', pack: null })]);
  });

  it('creates, renames and deletes a private pack, and only its own', async () => {
    const id = await createPrivatePack();
    const renamed = await app.inject({ method: 'PATCH', url: `/api/private-sticker-packs/${id}`, ...as('owner'), payload: { name: 'Renamed' } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe('Renamed');

    expect((await app.inject({ method: 'PATCH', url: `/api/private-sticker-packs/${id}`, ...as('member'), payload: { name: 'Theirs' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/private-sticker-packs/${id}`, ...as('member') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/private-sticker-packs/${id}`, ...as('owner') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/sticker-library', ...as('owner') })).json().privatePacks).toEqual([]);
  });

  it('refuses a nameless private pack', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/private-sticker-packs', ...as('owner'), payload: { name: '  ' } })).statusCode).toBe(400);
  });

  it('creates one album per space, for whoever may add stickers', async () => {
    // A member with no sticker permission cannot create the space album.
    expect((await app.inject({ method: 'POST', url: '/api/spaces/space/sticker-pack', ...as('member') })).statusCode).toBe(403);
    const first = await app.inject({ method: 'POST', url: '/api/spaces/space/sticker-pack', ...as('owner') });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ scopeType: 'space', spaceId: 'space' });
    const second = await app.inject({ method: 'POST', url: '/api/spaces/space/sticker-pack', ...as('owner') });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect((await app.inject({ method: 'POST', url: '/api/spaces/missing/sticker-pack', ...as('owner') })).statusCode).toBe(404);
  });

  it('holds images in an album, renames and removes them', async () => {
    const id = await createPrivatePack();
    const image = await imageB64();
    const added = await app.inject({ method: 'POST', url: `/api/sticker-library/packs/${id}/items`, ...as('owner'), payload: { name: 'Red', image } });
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({ packId: id, name: 'Red' });
    expect(typeof added.json().token).toBe('string');

    const itemId = added.json().id as string;
    const renamed = await app.inject({ method: 'PATCH', url: `/api/sticker-library/packs/${id}/items/${itemId}`, ...as('owner'), payload: { name: 'Crimson' } });
    expect(renamed.json().name).toBe('Crimson');

    expect((await app.inject({ method: 'DELETE', url: `/api/sticker-library/packs/${id}/items/${itemId}`, ...as('member') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/sticker-library/packs/${id}/items/${itemId}`, ...as('owner') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/sticker-library', ...as('owner') })).json().privatePacks[0].itemCount).toBe(0);
  });

  it('files a sticker of the own collection into a private album', async () => {
    db.insert(schema.stickerAssets).values({ id: 'a'.repeat(64), createdAt: 1 }).run();
    db.insert(schema.personalStickers).values({ userId: 'owner', stickerId: 'a'.repeat(64), name: 'Kept', createdAt: 1 }).run();
    const id = await createPrivatePack();
    const filed = await app.inject({
      method: 'POST', url: `/api/private-sticker-packs/${id}/items/from-favorite`, ...as('owner'),
      payload: { favoriteId: 'a'.repeat(64) },
    });
    expect(filed.statusCode).toBe(201);
    expect(filed.json()).toMatchObject({ packId: id, assetId: 'a'.repeat(64), name: 'Kept' });
    expect((await app.inject({
      method: 'POST', url: `/api/private-sticker-packs/${id}/items/from-favorite`, ...as('owner'),
      payload: { favoriteId: 'b'.repeat(64) },
    })).statusCode).toBe(404);
  });

  it('never mixes store packs into the library', async () => {
    db.insert(schema.stickerPacks).values({
      id: 'store-pack', name: 'Store', scopeType: 'store', creatorId: 'owner', creatorName: 'owner',
      currentVersion: 1, status: 'approved', createdAt: 1, updatedAt: 1,
    }).run();
    const library = (await app.inject({ method: 'GET', url: '/api/sticker-library', ...as('owner') })).json();
    expect(library.privatePacks).toEqual([]);
    expect(library.spaces[0].pack).toBeNull();
  });
});
