import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StickerPicker } from './StickerPicker';
import { api } from '../../api/client';

const item = {
  id: 'item-1',
  packId: 'pack-1',
  versionId: 'version-1',
  assetId: 'a'.repeat(64),
  name: 'Album sticker',
  token: `sticker:https://chat.test/api/stickers/assets/${'a'.repeat(64)}.webp`,
  sortOrder: 0,
  status: 'active',
  createdAt: 1,
};

const userPack = {
  id: 'pack-1',
  name: 'My album',
  description: null,
  scopeType: 'user',
  creatorId: 'alice',
  creatorName: 'Alice',
  currentVersion: 1,
  status: 'active',
  canManage: true,
  canAdd: true,
  itemCount: 1,
  itemLimit: 30,
  items: [item],
};

const spacePack = {
  ...userPack,
  id: 'pack-2',
  name: 'Space album',
  scopeType: 'space',
  spaceId: 'space',
};

const favorite = {
  id: 'b'.repeat(64),
  name: 'Kept',
  token: `sticker:https://chat.test/api/stickers/assets/${'b'.repeat(64)}.webp`,
  createdAt: 1,
};

vi.mock('../../api/client', async importOriginal => ({
  ...await importOriginal<typeof import('../../api/client')>(),
  api: {
    stickers: { list: vi.fn(), remove: vi.fn(), collect: vi.fn(), rename: vi.fn() },
    stickerStore: { myPacks: vi.fn().mockResolvedValue([]), getPack: vi.fn().mockResolvedValue(null) },
    stickerLibrary: { get: vi.fn() },
    instance: { info: vi.fn().mockResolvedValue({}) },
  },
}));
vi.mock('../../stores/authStore', () => ({ useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'alice' } }) }));
vi.mock('../../stores/uiStore', () => ({ useUIStore: (selector: (s: unknown) => unknown) => selector({ openImagePreview: vi.fn() }) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.stickers.list).mockResolvedValue([]);
  vi.mocked(api.stickerLibrary.get).mockResolvedValue({
    privatePacks: [userPack],
    spaces: [{ spaceId: 'space', name: 'Space', canCreate: true, canManage: true, pack: spacePack }],
    favorites: [favorite],
  });
});

describe('picker library tabs', () => {
  it('opens the favorites tab and sends from it', async () => {
    const onSelect = vi.fn();
    render(<StickerPicker onSelect={onSelect} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Favorite stickers' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Kept' }));
    expect(onSelect).toHaveBeenCalledWith(favorite.token);
  });

  it('opens a private album and a space album', async () => {
    const onSelect = vi.fn();
    render(<StickerPicker onSelect={onSelect} />);

    fireEvent.click(await screen.findByRole('button', { name: 'My album' }));
    expect(await screen.findByText('My album')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Album sticker' }));
    expect(onSelect).toHaveBeenCalledWith(item.token);

    fireEvent.click(screen.getByRole('button', { name: 'Space album' }));
    expect(await screen.findByText('Space album')).toBeInTheDocument();
  });

  it('hides the favorites tab when there are no favorites', async () => {
    vi.mocked(api.stickerLibrary.get).mockResolvedValue({ privatePacks: [userPack], spaces: [], favorites: [] });
    render(<StickerPicker onSelect={vi.fn()} />);
    await screen.findByRole('button', { name: 'My album' });
    expect(screen.queryByRole('button', { name: 'Favorite stickers' })).not.toBeInTheDocument();
  });
});
