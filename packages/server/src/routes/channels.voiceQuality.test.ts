import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(3);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;
let currentUserId = 'member';

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../utils/auth.js', () => ({
  authenticate: async (req: { userId?: string }) => {
    req.userId = currentUserId;
  },
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: vi.fn(),
    sendToChannel: vi.fn(),
    sendToSpace: vi.fn(),
    sendToDmMembers: vi.fn(),
    sendToRoom: vi.fn(),
    sendToAdmins: vi.fn(),
    getUserRoom: () => undefined,
    getRoom: () => undefined,
    getAllRooms: () => new Map(),
    getAllOnlineUserIds: () => [],
    getUserSpaceEntries: () => new Map<string, Set<string>>(),
  },
}));

vi.mock('../ws/events.js', () => ({
  checkVoicePermissions: vi.fn(),
}));

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sqlText = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    for (const stmt of sqlText.split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

beforeEach(async () => {
  sqlite = new Database(':memory:');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  currentUserId = 'owner';
  testDb.insert(schema.users).values({ id: 'owner', username: 'owner', passwordHash: 'x', isAdmin: 1, createdAt: 1 }).run();
  testDb.insert(schema.users).values({ id: 'member', username: 'member', passwordHash: 'x', createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: 'space', name: 'Space', ownerId: 'owner', createdAt: 1 }).run();
  testDb.insert(schema.spaceMembers).values({ spaceId: 'space', userId: 'owner', joinedAt: 1 }).run();
  testDb.insert(schema.spaceMembers).values({ spaceId: 'space', userId: 'member', joinedAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: 'general', spaceId: 'space', name: 'general', type: 'text', createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: 'voice', spaceId: 'space', name: 'Voice', type: 'voice', createdAt: 1 }).run();
  const { channelRoutes } = await import('./channels.js');
  app = Fastify();
  await app.register(channelRoutes);
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

describe('voice channel quality', () => {
  it('a new voice channel defaults to 128 kbps and reports it', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/channels/voice', payload: { name: 'Lounge' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().voiceBitrateKbps).toBe(128);
  });

  it('a text channel reports no voice quality', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/channels/general', payload: { name: 'chat' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('voiceBitrateKbps');
  });

  it.each([64, 128, 256])('stores the %i kbps preset', async (kbps) => {
    const res = await app.inject({ method: 'PATCH', url: '/api/channels/voice', payload: { voiceBitrateKbps: kbps } });
    expect(res.statusCode).toBe(200);
    expect(res.json().voiceBitrateKbps).toBe(kbps);
    expect(testDb.select().from(schema.channels).all().find((c) => c.id === 'voice')?.voiceBitrateKbps).toBe(kbps);
  });

  it('a value that is not a preset → voice_bitrate_invalid, nothing stored', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/channels/voice', payload: { voiceBitrateKbps: 96 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('voice_bitrate_invalid');
    expect(res.json().details).toEqual({ allowed: '64, 128, 256' });
    expect(testDb.select().from(schema.channels).all().find((c) => c.id === 'voice')?.voiceBitrateKbps).toBe(128);
  });

  it('a text channel has no voice quality → voice_bitrate_text_channel', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/channels/general', payload: { voiceBitrateKbps: 128 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('voice_bitrate_text_channel');
  });

  it('a member without MANAGE_CHANNELS cannot change it', async () => {
    currentUserId = 'member';
    const res = await app.inject({ method: 'PATCH', url: '/api/channels/voice', payload: { voiceBitrateKbps: 256 } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('missing_permission');
  });
});
