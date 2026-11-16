import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageWithUser, PinWithMessage, User } from '@veyvox/shared';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { PermissionBits, permissionsToString } from '../../utils/permissions';
import { Message } from './Message';

/**
 * The hover action bar of a message row. A moderator pins from it, before the
 * bookmark, and the row edits with a pencil — the gear read as settings on a
 * message that has none.
 */

vi.mock('../../hooks/useWebSocket', () => ({ wsSend: vi.fn(() => true) }));
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

const CHANNEL = 'space-ch-1';

function makeUser(id: string, username: string): User {
  return {
    id, username, displayName: null, avatar: null, banner: null, accentColor: null, avatarColor: null,
    bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1,
  };
}

const me = makeUser('me', 'alice');
const bob = makeUser('bob', 'bob');

function makeMessage(author: User): MessageWithUser {
  return {
    id: 'msg-1',
    channelId: CHANNEL,
    userId: author.id,
    content: 'hello',
    createdAt: 1000,
    user: author,
    attachments: [],
    embeds: [],
    reactions: [],
  } as unknown as MessageWithUser;
}

function pinOf(messageId: string): PinWithMessage {
  return { id: 'pin-1', channelId: CHANNEL, messageId, pinnedById: me.id, createdAt: 2, message: null };
}

const pinMessage = vi.fn(() => Promise.resolve());
const unpinMessage = vi.fn(() => Promise.resolve());

function renderRow(author: User = bob): void {
  render(<Message message={makeMessage(author)} isCompact={false} isFirstInGroup previousMessageId={null} />);
  // The bar only exists while the pointer is over the row.
  fireEvent.mouseEnter(document.getElementById('msg-msg-1')!);
}

/** The bar the buttons hang off, read from any one of them. */
function barOf(button: HTMLElement): HTMLElement {
  return button.parentElement!;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  pinMessage.mockClear();
  unpinMessage.mockClear();
  useAuthStore.setState({ user: me });
  useUIStore.setState({ isMobile: false });
  useSpaceStore.setState({
    currentSpaceId: 'space-1',
    dmChannels: [],
    members: [],
    channelToSpaceMap: new Map([[CHANNEL, 'space-1']]),
    channelPermissions: new Map([
      [CHANNEL, permissionsToString(PermissionBits.MANAGE_MESSAGES | PermissionBits.SEND_MESSAGES)],
    ]),
  });
  useChatStore.setState({ pinnedByChannel: new Map(), pinMessage, unpinMessage });
});

afterEach(() => {
  useAuthStore.setState({ user: null });
  useUIStore.setState({ isMobile: false });
  useSpaceStore.setState({
    currentSpaceId: null, dmChannels: [], members: [],
    channelToSpaceMap: new Map(), channelPermissions: new Map(),
  });
  useChatStore.setState({ pinnedByChannel: new Map() });
});

describe('the message hover action bar', () => {
  it('edits with a pencil', () => {
    renderRow(me);

    const path = screen.getByTitle('Edit').querySelector('path')!;
    expect(path.getAttribute('d')).toMatch(/^M3 17\.25V21h3\.75L17\.81 9\.94/);
  });

  it('offers Pin to a moderator, ahead of Bookmark, and pins the message', () => {
    renderRow();

    const pin = screen.getByTitle('Pin Message');
    const bookmark = screen.getByTitle('Bookmark');
    expect(barOf(pin)).toBe(barOf(bookmark));
    const buttons = Array.from(barOf(pin).querySelectorAll('button'));
    expect(buttons.indexOf(pin)).toBeLessThan(buttons.indexOf(bookmark));

    fireEvent.click(pin);
    expect(pinMessage).toHaveBeenCalledWith('msg-1', CHANNEL);
    expect(unpinMessage).not.toHaveBeenCalled();
  });

  it('reads Unpin once the message is pinned, and unpins it', () => {
    useChatStore.setState({ pinnedByChannel: new Map([[CHANNEL, [pinOf('msg-1')]]]) });
    renderRow();

    const unpin = screen.getByTitle('Unpin Message');
    expect(unpin).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(unpin);

    expect(unpinMessage).toHaveBeenCalledWith('msg-1', CHANNEL);
    expect(pinMessage).not.toHaveBeenCalled();
  });

  it('keeps Pin out of the bar for a reader without MANAGE_MESSAGES', () => {
    useSpaceStore.setState({ channelPermissions: new Map([[CHANNEL, '0']]) });
    renderRow();

    expect(screen.queryByTitle('Pin Message')).toBeNull();
    expect(screen.getByTitle('Reply')).toBeInTheDocument();
  });
});
