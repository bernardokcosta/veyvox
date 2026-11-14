import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { deleteOldestMedia } from './storageJanitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let testDb: TestDb;
let testRawDb: Database.Database;
let tmpUploadDir: string;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => testRawDb,
  schema,
}));

vi.mock('../config.js', async () => {
  const real = await import('../config.js');
  return {
    config: new Proxy(real.config, {
      get(target, prop: string) {
        if (prop === 'uploadDir') return tmpUploadDir;
        return (target as Record<string, unknown>)[prop];
      },
    }),
  };
});

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    for (const stmt of fs.readFileSync(path.join(migrationsDir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) db.exec(stmt.trim());
    }
  }
}

beforeEach(() => {
  tmpUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyvox-pressure-'));
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  testRawDb = sqlite;
  testDb.insert(schema.users).values({ id: 'u', username: 'u', passwordHash: 'x', createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: 's', name: 'S', ownerId: 'u', createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: 'c', spaceId: 's', name: 'c', type: 'text', createdAt: 1 }).run();
  testDb.insert(schema.messages).values({ id: 'm', channelId: 'c', userId: 'u', content: 'hi', createdAt: 1 }).run();
});

afterEach(() => {
  testRawDb.close();
  fs.rmSync(tmpUploadDir, { recursive: true, force: true });
});

function attachment(id: string, filename: string, ageDays: number, size = 8) {
  testDb.insert(schema.attachments).values({
    id, messageId: 'm', uploaderId: 'u', filename, originalName: filename,
    mimetype: 'image/png', size, createdAt: Date.now() - ageDays * 24 * 60 * 60 * 1000,
  }).run();
}

describe('deleteOldestMedia', () => {
  it('deletes old files with their rows and counts the bytes', () => {
    fs.writeFileSync(path.join(tmpUploadDir, 'old.png'), '12345678');
    attachment('a1', 'old.png', 40);
    const result = deleteOldestMedia(30, () => false);
    expect(result).toMatchObject({ dryRun: false, deletedFiles: 1, freedBytes: 8, deletedAttachmentRecords: 1, errors: [] });
    expect(fs.existsSync(path.join(tmpUploadDir, 'old.png'))).toBe(false);
    expect(testDb.select().from(schema.attachments).all()).toEqual([]);
  });

  it('drops the row of an already missing file without an error and without counting bytes', () => {
    attachment('a1', 'gone.png', 40, 100);
    const result = deleteOldestMedia(30, () => false);
    expect(result.errors).toEqual([]);
    expect(result.deletedFiles).toBe(0);
    expect(result.freedBytes).toBe(0);
    expect(result.deletedAttachmentRecords).toBe(1);
    expect(testDb.select().from(schema.attachments).all()).toEqual([]);
  });

  it('touches nothing newer than the floor or when told to stop', () => {
    fs.writeFileSync(path.join(tmpUploadDir, 'new.png'), '12345678');
    attachment('a1', 'new.png', 2);
    expect(deleteOldestMedia(30, () => false)).toMatchObject({ deletedFiles: 0, deletedAttachmentRecords: 0 });
    expect(fs.existsSync(path.join(tmpUploadDir, 'new.png'))).toBe(true);
    expect(deleteOldestMedia(30, () => true)).toMatchObject({ deletedFiles: 0, deletedAttachmentRecords: 0 });
    expect(testDb.select().from(schema.attachments).all()).toHaveLength(1);
  });
});
