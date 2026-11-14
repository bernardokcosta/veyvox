import { describe, expect, it, vi } from 'vitest';
import type { MessageWithUser } from '@veyvox/shared';
import { buildMessageMenuItems } from './messageMenuItems';

// The menu reaches the transfer store, which reaches the audio manager; a
// worklet cannot be built in the test environment and the menu never uses it.
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));

const message = {
  id: 'm1', channelId: 'chat', userId: 'other', content: 'hello', createdAt: 1,
  user: { id: 'other', username: 'other', displayName: null },
} as unknown as MessageWithUser;

function items(overrides: Partial<Parameters<typeof buildMessageMenuItems>[0]> = {}) {
  return buildMessageMenuItems({
    message,
    selectedText: '',
    previousMessageId: 'm0',
    isAuthor: false,
    isDm: false,
    canAddReactions: true,
    canSendMessages: true,
    canManageMessages: false,
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onReaction: vi.fn(),
    onOpenEmojiPicker: vi.fn(),
    onMarkUnread: vi.fn(),
    isPinned: false,
    canPin: false,
    onTogglePin: vi.fn(),
    canBookmark: true,
    isBookmarked: false,
    onToggleBookmark: vi.fn(),
    ...overrides,
  });
}

const bookmarkItem = (list: ReturnType<typeof items>) => list.find((item) => item.key === 'bookmark');

describe('the bookmark entry of the message menu', () => {
  it('offers to save a message, and to remove it when it is saved', () => {
    expect(bookmarkItem(items())?.type).toBe('action');
    expect(bookmarkItem(items({ isBookmarked: true }))?.type).toBe('action');
  });

  it('runs the toggle it was given', () => {
    const onToggleBookmark = vi.fn();
    const item = bookmarkItem(items({ onToggleBookmark }));
    if (item?.type !== 'action') throw new Error('expected an action');
    item.onClick();
    expect(onToggleBookmark).toHaveBeenCalledOnce();
  });

  it('is left out for a message that cannot be bookmarked', () => {
    expect(bookmarkItem(items({ canBookmark: false }))).toBeUndefined();
  });
});
