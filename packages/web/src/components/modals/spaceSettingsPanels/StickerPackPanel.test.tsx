import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api/client';
import { StickerPackPanel } from './StickerPackPanel';

const item = {
  id: 'item-1',
  packId: 'pack-1',
  versionId: 'version-1',
  assetId: 'a'.repeat(64),
  name: 'Red',
  token: `sticker:https://chat.test/api/stickers/assets/${'a'.repeat(64)}.webp`,
  sortOrder: 0,
  status: 'active',
  createdAt: 1,
};

const pack = {
  id: 'pack-1',
  name: 'Space',
  description: null,
  scopeType: 'space',
  spaceId: 'space',
  creatorId: 'owner',
  creatorName: 'Owner',
  currentVersion: 1,
  status: 'active',
  canManage: true,
  canAdd: true,
  itemCount: 1,
  itemLimit: 50,
  items: [item],
};

vi.mock('../../../api/client', () => ({
  api: {
    stickerLibrary: {
      get: vi.fn(),
      createSpacePack: vi.fn(),
      addItem: vi.fn(),
      renameItem: vi.fn(),
      removeItem: vi.fn(),
    },
  },
}));
vi.mock('../../../stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({ instanceSettings: { maxStickerSizeMb: 5 } }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string; count?: number }) => {
      if (values?.name) return `${key}:${values.name}`;
      if (values?.count !== undefined) return `${key}:${values.count}`;
      return key;
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:sticker');
    static revokeObjectURL = vi.fn();
  });
  vi.mocked(api.stickerLibrary.get).mockResolvedValue({
    privatePacks: [],
    spaces: [{ spaceId: 'space', name: 'Space', canCreate: true, canManage: true, pack }],
    favorites: [],
  });
  vi.mocked(api.stickerLibrary.createSpacePack).mockResolvedValue(pack);
  vi.mocked(api.stickerLibrary.addItem).mockResolvedValue(item);
});

describe('StickerPackPanel', () => {
  it('offers to create the album when the space has none', async () => {
    vi.mocked(api.stickerLibrary.get).mockResolvedValue({
      privatePacks: [],
      spaces: [{ spaceId: 'space', name: 'Space', canCreate: true, canManage: false, pack: null }],
      favorites: [],
    });
    render(<StickerPackPanel spaceId="space" />);

    fireEvent.click(await screen.findByRole('button', { name: 'spaces:stickers.create' }));

    await waitFor(() => expect(api.stickerLibrary.createSpacePack).toHaveBeenCalledWith('space'));
  });

  it('uploads a picked file under an edited name', async () => {
    const { container } = render(<StickerPackPanel spaceId="space" />);
    await screen.findByAltText('Red');

    fireEvent.click(screen.getByRole('button', { name: 'spaces:stickers.add' }));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(fileInput, {
      target: { files: [new File(['image'], 'Blue Sky.png', { type: 'image/png' })] },
    });

    const name = screen.getByLabelText('settings:stickers.itemName');
    expect(name).toHaveValue('Blue Sky');
    fireEvent.click(container.querySelector('form button[type="submit"]')!);

    await waitFor(() => expect(api.stickerLibrary.addItem).toHaveBeenCalledWith(
      'pack-1',
      expect.objectContaining({ name: 'Blue Sky' }),
    ));
  });

  it('renames and removes an entry when managing', async () => {
    const { container } = render(<StickerPackPanel spaceId="space" />);
    await screen.findByAltText('Red');

    fireEvent.click(screen.getByRole('button', { name: 'chat:stickers.renameNamed:Red' }));
    const name = screen.getByLabelText('settings:stickers.itemName');
    fireEvent.change(name, { target: { value: 'Crimson' } });
    fireEvent.click(container.querySelector('form button[type="submit"]')!);

    await waitFor(() => expect(api.stickerLibrary.renameItem).toHaveBeenCalledWith('pack-1', 'item-1', 'Crimson'));

    vi.mocked(api.stickerLibrary.get).mockResolvedValue({
      privatePacks: [],
      spaces: [{ spaceId: 'space', name: 'Space', canCreate: true, canManage: true, pack: { ...pack, items: [] } }],
      favorites: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'chat:stickers.remove' }));
    await waitFor(() => expect(api.stickerLibrary.removeItem).toHaveBeenCalledWith('pack-1', 'item-1'));
  });
});
