import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BookmarkKind } from '@veyvox/shared/src/bookmarks';
import { describeError } from '../i18n/errors';
import { bookmarkConversationKey, selectIsBookmarked, useBookmarkStore } from '../stores/bookmarkStore';
import { isDmChannel } from '../stores/spaceStore';
import { useUIStore } from '../stores/uiStore';

/** Which bookmark table a conversation's messages are in. */
export function bookmarkKindOf(channelId: string): BookmarkKind {
  return isDmChannel(channelId) ? 'dm' : 'channel';
}

/**
 * Keeps the bookmarked messages of the open conversation read. Mounted by the
 * list; the read happens once per conversation, and again after the socket
 * reconnects (`resync` clears what was read).
 */
export function useBookmarkedConversation(channelId: string | null | undefined): void {
  const kind = channelId ? bookmarkKindOf(channelId) : null;
  const loaded = useBookmarkStore((s) => (
    channelId && kind ? s.loadedConversations.has(bookmarkConversationKey(kind, channelId)) : true
  ));

  useEffect(() => {
    if (!channelId || !kind || loaded) return;
    void useBookmarkStore.getState().loadConversation(kind, channelId);
  }, [channelId, kind, loaded]);
}

interface MessageBookmarkParams {
  channelId: string;
  messageId: string;
}

export interface MessageBookmark {
  bookmarked: boolean;
  /** A request for this message is in flight. */
  busy: boolean;
  /** Saves the message, or removes its bookmark; failures are shown as a toast. */
  toggle: () => Promise<void>;
}

/** The bookmark state of one message and the one action on it. */
export function useMessageBookmark({ channelId, messageId }: MessageBookmarkParams): MessageBookmark {
  const { t } = useTranslation('bookmarks');
  const kind = bookmarkKindOf(channelId);
  const bookmarked = useBookmarkStore((s) => selectIsBookmarked(s, kind, messageId));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const toggle = useCallback(async () => {
    if (!channelId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const store = useBookmarkStore.getState();
    const removing = selectIsBookmarked(store, kind, messageId);
    try {
      if (removing) await store.remove(kind, channelId, messageId);
      else await store.add(kind, messageId);
    } catch (err) {
      useUIStore.getState().addToast(
        t(removing ? 'toast.removeFailed' : 'toast.addFailed', { reason: describeError(err) }),
        'warning',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [kind, channelId, messageId, t]);

  return { bookmarked, busy, toggle };
}
