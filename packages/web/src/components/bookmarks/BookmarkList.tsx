import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Bookmark } from '@veyvox/shared/src/bookmarks';
import { useBookmarkStore } from '../../stores/bookmarkStore';
import { useJumpStore } from '../../stores/jumpStore';
import { useUIStore } from '../../stores/uiStore';
import { describeError } from '../../i18n/errors';
import { BookmarkRow } from './BookmarkRow';
import { useBookmarkAuthors } from './useBookmarkAuthors';

interface BookmarkListProps {
  /** Called after a bookmark was opened, so the surface holding the list can close. */
  onOpened?: () => void;
}

/**
 * The user's bookmarks, newest saved first. "Show more" reads the next page.
 * A read that failed leaves what was already shown in place; opening the
 * surface again reads once more.
 */
export function BookmarkList({ onOpened }: BookmarkListProps) {
  const { t } = useTranslation('bookmarks');
  const list = useBookmarkStore((s) => s.list);
  const authors = useBookmarkAuthors();
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    void useBookmarkStore.getState().loadList();
  }, []);

  const entries = useMemo(
    () => [...list.items].sort((a, b) => b.createdAt - a.createdAt),
    [list.items],
  );

  const loading = list.status === 'loading' && entries.length === 0;
  const hasMore = list.status === 'loaded' && list.nextCursor !== null;

  const open = useCallback((bookmark: Bookmark) => {
    const jumped = useJumpStore.getState().requestJump(
      bookmark.kind === 'dm' || !bookmark.spaceId
        ? { kind: 'dm', channelId: bookmark.channelId }
        : { kind: 'channel', spaceId: bookmark.spaceId, channelId: bookmark.channelId },
      bookmark.messageId,
    );
    if (jumped) onOpened?.();
  }, [onOpened]);

  const remove = useCallback(async (bookmark: Bookmark) => {
    setRemoving((current) => new Set(current).add(bookmark.id));
    try {
      await useBookmarkStore.getState().remove(bookmark.kind, bookmark.channelId, bookmark.messageId);
    } catch (err) {
      useUIStore.getState().addToast(t('toast.removeFailed', { reason: describeError(err) }), 'warning');
    } finally {
      setRemoving((current) => {
        const next = new Set(current);
        next.delete(bookmark.id);
        return next;
      });
    }
  }, [t]);

  if (loading) {
    return <div className="p-6 text-center text-ui-label text-txt-tertiary">{t('list.loading')}</div>;
  }

  return (
    <div className="flex flex-col">
      {entries.length === 0 && (
        <div className="p-8 text-center">
          <div className="text-ui-body text-txt-secondary">{t('list.empty')}</div>
          <div className="mt-1 text-ui-caption text-txt-tertiary">{t('list.emptyHint')}</div>
        </div>
      )}
      {entries.map((bookmark) => (
        <BookmarkRow
          key={bookmark.id}
          bookmark={bookmark}
          author={authors.get(bookmark.authorId)}
          removing={removing.has(bookmark.id)}
          onOpen={open}
          onRemove={(b) => { void remove(b); }}
        />
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={() => { void useBookmarkStore.getState().loadMore(); }}
          disabled={list.loadingMore}
          className="mx-3 my-3 py-2 rounded text-ui-label text-accent-primary hover:bg-interactive-hover disabled:opacity-50 transition-colors"
        >
          {list.loadingMore ? t('list.loading') : t('list.showMore')}
        </button>
      )}
    </div>
  );
}
