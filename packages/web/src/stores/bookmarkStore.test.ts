import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bookmark } from '@veyvox/shared/src/bookmarks';

const { keys, list, add, remove } = vi.hoisted(() => ({
  keys: vi.fn(), list: vi.fn(), add: vi.fn(), remove: vi.fn(),
}));
vi.mock('../api/client', async original => ({
  ...await original<typeof import('../api/client')>(),
  api: { bookmarks: { keys, list, add, remove } },
}));

import { bookmarkKey, selectIsBookmarked, useBookmarkStore } from './bookmarkStore';

const store = () => useBookmarkStore.getState();

function bookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'b1', kind: 'channel', messageId: 'm1', channelId: 'chat', spaceId: 'space',
    content: 'hello', authorId: 'other', authorName: 'other', spaceName: 'Space', channelName: 'general',
    messageCreatedAt: 10, createdAt: 20, attachments: [], status: 'ok', ...overrides,
  };
}

beforeEach(() => {
  keys.mockReset();
  list.mockReset();
  add.mockReset();
  remove.mockReset();
  store().reset();
});

describe('bookmark store', () => {
  it('reads the bookmarked messages of a conversation once', async () => {
    keys.mockResolvedValue(['m1']);
    await store().loadConversation('channel', 'chat');
    await store().loadConversation('channel', 'chat');
    expect(keys).toHaveBeenCalledOnce();
    expect(selectIsBookmarked(store(), 'channel', 'm1')).toBe(true);
    expect(selectIsBookmarked(store(), 'dm', 'm1')).toBe(false);
  });

  it('layers changes that arrived while the conversation was being read over its answer', async () => {
    let finish!: (ids: string[]) => void;
    keys.mockReturnValue(new Promise<string[]>(resolve => { finish = resolve; }));
    const reading = store().loadConversation('channel', 'chat');
    store().applyAdded(bookmark());
    store().applyRemoved('channel', 'chat', 'gone');
    finish(['saved', 'gone']);
    await reading;
    expect(selectIsBookmarked(store(), 'channel', 'saved')).toBe(true);
    expect(selectIsBookmarked(store(), 'channel', 'm1')).toBe(true);
    expect(selectIsBookmarked(store(), 'channel', 'gone')).toBe(false);
  });

  it('keeps a failed read unloaded, so the next open asks again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    keys.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(['m1']);
    await store().loadConversation('channel', 'chat');
    await store().loadConversation('channel', 'chat');
    expect(keys).toHaveBeenCalledTimes(2);
    expect(selectIsBookmarked(store(), 'channel', 'm1')).toBe(true);
  });

  it('saves a message once and prepends it to the list it already has', async () => {
    list.mockResolvedValue({ items: [bookmark({ id: 'older', messageId: 'm0', createdAt: 5 })], nextCursor: null });
    await store().loadList();
    add.mockResolvedValue(bookmark());
    await store().add('channel', 'm1');
    expect(store().list.items.map(item => item.id)).toEqual(['b1', 'older']);
    expect(selectIsBookmarked(store(), 'channel', 'm1')).toBe(true);
    // The push for the caller's other session is the same bookmark, not a second row.
    store().applyAdded(bookmark());
    expect(store().list.items.map(item => item.id)).toEqual(['b1', 'older']);
  });

  it('removes a bookmark from the keys and from the list', async () => {
    add.mockResolvedValue(bookmark());
    await store().add('channel', 'm1');
    remove.mockResolvedValue({ success: true });
    await store().remove('channel', 'chat', 'm1');
    expect(selectIsBookmarked(store(), 'channel', 'm1')).toBe(false);
    expect(store().list.items).toEqual([]);
  });

  it('pages with the cursor and drops a row a second page repeats', async () => {
    list.mockResolvedValueOnce({ items: [bookmark()], nextCursor: '20:b1' });
    await store().loadList();
    list.mockResolvedValueOnce({
      items: [bookmark({ id: 'b0', messageId: 'm0', createdAt: 1 }), bookmark()],
      nextCursor: null,
    });
    await store().loadMore();
    expect(list).toHaveBeenLastCalledWith({ cursor: '20:b1', limit: expect.any(Number) });
    expect(store().list.items.map(item => item.id)).toEqual(['b1', 'b0']);
    expect(store().list.nextCursor).toBeNull();
  });

  it('forgets what it read on resync and on reset', async () => {
    list.mockResolvedValue({ items: [], nextCursor: null });
    keys.mockResolvedValue(['m1']);
    await store().loadConversation('channel', 'chat');
    store().resync();
    expect(store().loadedConversations.size).toBe(0);
    expect(store().keys.size).toBe(0);
    store().applyAdded(bookmark());
    store().reset();
    expect(store().keys.size).toBe(0);
    expect(store().list.items).toEqual([]);
    expect(bookmarkKey('dm', 'd1')).not.toBe(bookmarkKey('channel', 'd1'));
  });

  it('drops an answer that belongs to the previous session', async () => {
    let finish!: (ids: string[]) => void;
    keys.mockReturnValue(new Promise<string[]>(resolve => { finish = resolve; }));
    const reading = store().loadConversation('channel', 'chat');
    store().reset();
    finish(['m1']);
    await reading;
    expect(store().keys.size).toBe(0);
  });
});
