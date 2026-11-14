import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@veyvox/shared';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useComposerStore } from '../../stores/composerStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useTransferStore, type Transfer } from '../../stores/transferStore';
import { usePendingMessageStore } from '../../stores/pendingMessageStore';
import { MessageInput } from './MessageInput';
import { prepareForUpload } from '../../utils/mediaCompression';

vi.mock('../../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));
vi.mock('../../utils/mediaCompression', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/mediaCompression')>()),
  shouldTryCompression: () => true,
  compressionKind: () => 'image' as const,
  prepareForUpload: vi.fn(),
}));

const me: User = {
  id: 'me',
  username: 'alice',
  displayName: 'Alice',
  avatar: null,
  banner: null,
  accentColor: null,
  avatarColor: null,
  bio: null,
  status: 'online',
  customStatus: null,
  isAdmin: false,
  createdAt: 1,
};

beforeEach(() => {
  useTransferStore.setState({ transfers: new Map() });
  window.history.replaceState({}, '', '/channels/@me/dm-1');
  useAuthStore.setState({ user: me });
  useSpaceStore.getState().reset();
  useSpaceStore.getState().populateFromReady([], [], [{
    id: 'dm-1', ownerId: null, createdAt: 1, name: null, icon: null, members: [me],
    lastMessage: null,
  }]);
  useComposerStore.setState({ states: new Map() });
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('MessageInput compression wait', () => {
  it('holds the caption until the shrinking file is staged, then ships them together', async () => {
    let finishPrepare!: (result: { file: File; compressed: boolean }) => void;
    const preparing = new Promise<{ file: File; compressed: boolean }>((resolve) => { finishPrepare = resolve; });
    vi.mocked(prepareForUpload).mockReturnValue(preparing);

    vi.spyOn(useTransferStore.getState(), 'startUpload').mockImplementation(async (file, opts) => {
      const transfer: Transfer = {
        id: 'upload-shrunk',
        type: 'upload',
        state: 'completed',
        file: { name: file.name, size: file.size, mimetype: 'image/jpeg' },
        progress: { loaded: file.size, total: file.size },
        channelId: opts.channelId,
        tray: true,
      };
      useTransferStore.setState({ transfers: new Map([[transfer.id, transfer]]) });
      useComposerStore.getState().attach('dm-1', transfer.id);
      return transfer.id;
    });
    const send = vi.spyOn(useChatStore.getState(), 'sendMessage').mockResolvedValue(undefined);

    const { container } = render(<MessageInput channelId="dm-1" channelName="@Bob" />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('file input not rendered');
    const photo = new File(['x'.repeat(1024)], 'photo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [photo] } });

    // A caption typed while the photo shrinks must not go out alone.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Caption' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await act(async () => { await Promise.resolve(); });
    expect(send).not.toHaveBeenCalled();
    expect(useComposerStore.getState().get('dm-1').draftText).toBe('Caption');

    // The encode ends: the file stages, the waiting Enter ships both together.
    const shrunk = new File(['y'.repeat(512)], 'photo.jpg', { type: 'image/jpeg' });
    expect(prepareForUpload).toHaveBeenCalled();
    await act(async () => { finishPrepare({ file: shrunk, compressed: true }); });
    await waitFor(() => expect(usePendingMessageStore.getState().bubbles.get('dm-1')).toHaveLength(1));
    const [bubble] = usePendingMessageStore.getState().bubbles.get('dm-1')!;
    expect(bubble).toMatchObject({ content: 'Caption', transferIds: ['upload-shrunk'] });
    expect(send).not.toHaveBeenCalled();
  });
});
