import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api/client';
import { StickerLibraryPanel } from './StickerLibraryPanel';

const item = {
  id: 'item-1',
  packId: 'pack-1',
  versionId: 'version-1',
  assetId: 'a'.repeat(64),
  name: 'Original name',
  token: `sticker:https://chat.test/api/stickers/assets/${'a'.repeat(64)}.webp`,
  sortOrder: 0,
  status: 'active',
  createdAt: 1,
};

const pack = {
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

const favorite = {
  id: 'b'.repeat(64),
  name: 'Kept',
  token: `sticker:https://chat.test/api/stickers/assets/${'b'.repeat(64)}.webp`,
  createdAt: 1,
};

vi.mock('../../../api/client', () => ({
  api: {
    stickerLibrary: {
      get: vi.fn(),
      createPrivatePack: vi.fn(),
      renamePrivatePack: vi.fn(),
      deletePrivatePack: vi.fn(),
      addItem: vi.fn(),
      renameItem: vi.fn(),
      removeItem: vi.fn(),
      addFavoriteToPack: vi.fn(),
    },
    stickers: { remove: vi.fn() },
  },
}));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { id: 'alice' } }),
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
vi.mock('../../ui/ConfirmDialog', () => ({
  ConfirmDialog: (props: { isOpen: boolean; onConfirm: () => void }) => props.isOpen
    ? <button type="button" onClick={props.onConfirm}>confirm-delete</button>
    : null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:sticker');
    static revokeObjectURL = vi.fn();
  });
  vi.mocked(api.stickerLibrary.get).mockResolvedValue({
    privatePacks: [pack],
    spaces: [],
    favorites: [favorite],
  });
  vi.mocked(api.stickerLibrary.addItem).mockResolvedValue(item);
  vi.mocked(api.stickerLibrary.deletePrivatePack).mockResolvedValue({ success: true });
  vi.mocked(api.stickers.remove).mockResolvedValue({ success: true });
});

describe('StickerLibraryPanel', () => {
  it('uploads a picked file under its file name, editable before sending', async () => {
    const { container } = render(<StickerLibraryPanel />);
    await screen.findAllByText('My album');
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(fileInput, {
      target: { files: [new File(['image'], 'Cool Cat.png', { type: 'image/png' })] },
    });

    const name = screen.getByLabelText('settings:stickers.itemName');
    expect(name).toHaveValue('Cool Cat');
    fireEvent.change(name, { target: { value: 'Gato favorito' } });
    fireEvent.click(container.querySelector('form button[type="submit"]')!);

    await waitFor(() => expect(api.stickerLibrary.addItem).toHaveBeenCalledWith(
      'pack-1',
      expect.objectContaining({ name: 'Gato favorito' }),
    ));
  });

  it('deletes a private album after confirmation', async () => {
    vi.mocked(api.stickerLibrary.get)
      .mockResolvedValueOnce({ privatePacks: [pack], spaces: [], favorites: [favorite] })
      .mockResolvedValueOnce({ privatePacks: [], spaces: [], favorites: [favorite] });
    render(<StickerLibraryPanel />);
    await screen.findAllByText('My album');

    fireEvent.click(screen.getByRole('button', { name: 'settings:stickers.deletePack' }));
    fireEvent.click(screen.getByRole('button', { name: 'confirm-delete' }));

    await waitFor(() => expect(api.stickerLibrary.deletePrivatePack).toHaveBeenCalledWith('pack-1'));
    expect(await screen.findByText('settings:stickers.deletePackSuccess')).toBeInTheDocument();
  });

  it('removes a favorite from the collection', async () => {
    vi.mocked(api.stickerLibrary.get)
      .mockResolvedValueOnce({ privatePacks: [pack], spaces: [], favorites: [favorite] })
      .mockResolvedValueOnce({ privatePacks: [pack], spaces: [], favorites: [] });
    render(<StickerLibraryPanel />);
    await screen.findByAltText('Kept');

    fireEvent.click(screen.getByRole('button', { name: 'chat:stickers.remove: Kept' }));

    await waitFor(() => expect(api.stickers.remove).toHaveBeenCalledWith(favorite.id));
  });

  it('files a favorite into the open album under an edited name', async () => {
    const { container } = render(<StickerLibraryPanel />);
    await screen.findByAltText('Kept');

    fireEvent.click(screen.getByRole('button', { name: 'settings:stickers.itemName: Kept' }));
    const name = screen.getByLabelText('settings:stickers.itemName');
    fireEvent.change(name, { target: { value: 'Archived' } });
    fireEvent.click(container.querySelector('form button[type="submit"]')!);

    await waitFor(() => expect(api.stickerLibrary.addFavoriteToPack).toHaveBeenCalledWith(
      'pack-1',
      { favoriteId: favorite.id, name: 'Archived' },
    ));
  });

  it('creates a private album and selects it', async () => {
    vi.mocked(api.stickerLibrary.createPrivatePack).mockResolvedValue({ ...pack, id: 'pack-2', name: 'Second' });
    vi.mocked(api.stickerLibrary.get)
      .mockResolvedValueOnce({ privatePacks: [pack], spaces: [], favorites: [] })
      .mockResolvedValue({ privatePacks: [pack, { ...pack, id: 'pack-2', name: 'Second' }], spaces: [], favorites: [] });
    render(<StickerLibraryPanel />);
    await screen.findAllByText('My album');

    fireEvent.change(screen.getByPlaceholderText('settings:stickers.newPack'), { target: { value: 'Second' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings:stickers.createPack' }));

    await waitFor(() => expect(api.stickerLibrary.createPrivatePack).toHaveBeenCalledWith({ name: 'Second' }));
    expect(await screen.findByRole('button', { name: /Second/ })).toBeInTheDocument();
  });
});
