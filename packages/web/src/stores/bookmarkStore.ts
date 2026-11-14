import { create } from 'zustand';
import { BOOKMARKS_PAGE_DEFAULT, type Bookmark, type BookmarkKind } from '@veyvox/shared/src/bookmarks';
import { api } from '../api/client';

/**
 * The signed-in user's bookmarks (docs/systems/bookmarks.md).
 *
 * Two things are held:
 *
 * - `keys`: which messages the user has bookmarked, for the "is bookmarked"
 *   state of the message in front of them. Loaded one conversation at a time
 *   when it opens (`loadConversation`), never as the user's whole list: a user
 *   has no bookmark limit.
 * - `list`: the bookmark list the window shows, paged newest first
 *   (`loadList`, `loadMore`).
 *
 * Sources: the REST answers to the user's own add and remove, and
 * `bookmark_added` / `bookmark_removed` from the socket (`applyAdded`,
 * `applyRemoved`), which also keep a second tab in step.
 *
 * The store imports no other store, so components and `useWebSocket` can use it
 * without import cycles.
 */

const SEP = '\u0000';

/** Key of one bookmarked message: the kind, then the message id. */
export function bookmarkKey(kind: BookmarkKind, messageId: string): string {
  return `${kind}${SEP}${messageId}`;
}

/** Key of one conversation whose bookmarked messages are loaded. */
export function bookmarkConversationKey(kind: BookmarkKind, channelId: string): string {
  return `${kind}${SEP}${channelId}`;
}

export type BookmarkListStatus = 'loading' | 'loaded' | 'error';

export interface BookmarkListState {
  items: readonly Bookmark[];
  /** The cursor of the next page; null when the last page has been read. */
  nextCursor: string | null;
  status: BookmarkListStatus;
  /** True while a page after the first is being read. */
  loadingMore: boolean;
}

interface BookmarkState {
  keys: ReadonlySet<string>;
  /** Conversations whose `keys` have been read. */
  loadedConversations: ReadonlySet<string>;
  list: BookmarkListState;

  /** Read which messages of a conversation are bookmarked. A no-op once read; errors are logged. */
  loadConversation: (kind: BookmarkKind, channelId: string) => Promise<void>;
  /** Save a message. Resolves to the bookmark; rejects with the API error. */
  add: (kind: BookmarkKind, messageId: string) => Promise<Bookmark>;
  /** Remove a bookmark. Rejects with the API error. */
  remove: (kind: BookmarkKind, channelId: string, messageId: string) => Promise<void>;
  /** Read the first page of the list, replacing what was held. */
  loadList: () => Promise<void>;
  /** Read the next page of the list. */
  loadMore: () => Promise<void>;
  /** A bookmark the server pushed (`bookmark_added`). */
  applyAdded: (bookmark: Bookmark) => void;
  /** A removal the server pushed (`bookmark_removed`). */
  applyRemoved: (kind: BookmarkKind, channelId: string, messageId: string) => void;
  /** The socket reconnected: events may have been missed, read again on next use. */
  resync: () => void;
  reset: () => void;
}

/**
 * Changes that arrived for a conversation while its `keys` were being read.
 * The answer may have been read before or after them, so they are laid over it.
 */
const changedDuringLoad = new Map<string, Map<string, boolean>>();
/** The latest list read; an answer for an older one is dropped. */
let listSeq = 0;
/**
 * Changes that arrived for the list while a page was being read, keyed by
 * bookmarked message. The answer may have been read before or after them,
 * so they are laid over it.
 */
const changedDuringListLoad = new Map<string, Bookmark | null>();
/** List reads in flight; changes are only recorded while one is. */
let listLoadsInFlight = 0;
/** Bumped by `reset`, so an answer for the previous session is dropped. */
let sessionGeneration = 0;

function withKey(keys: ReadonlySet<string>, key: string, present: boolean): ReadonlySet<string> {
  if (keys.has(key) === present) return keys;
  const next = new Set(keys);
  if (present) next.add(key);
  else next.delete(key);
  return next;
}

const EMPTY_LIST: BookmarkListState = { items: [], nextCursor: null, status: 'loaded', loadingMore: false };

export const useBookmarkStore = create<BookmarkState>((set, get) => {
  /** Record a change for the conversation it belongs to, if that conversation is being read. */
  function noteChange(kind: BookmarkKind, channelId: string, messageId: string, present: boolean): void {
    changedDuringLoad.get(bookmarkConversationKey(kind, channelId))?.set(bookmarkKey(kind, messageId), present);
  }

  function putList(update: (list: BookmarkListState) => BookmarkListState): void {
    set((state) => ({ list: update(state.list) }));
  }

  /**
   * Lay the changes that arrived during a list read over its answer: added
   * bookmarks go first when the answer missed them, removed ones come out
   * even when the answer still holds them. Consumes the journal; a stale
   * read never runs, so it never consumes.
   */
  function withListChanges(items: readonly Bookmark[]): Bookmark[] {
    if (changedDuringListLoad.size === 0) return [...items];
    const changes = [...changedDuringListLoad];
    changedDuringListLoad.clear();
    const removed = new Set<string>();
    const added: Bookmark[] = [];
    for (const [key, bookmark] of changes) {
      if (bookmark) added.push(bookmark);
      else removed.add(key);
    }
    const kept = items.filter((item) => !removed.has(bookmarkKey(item.kind, item.messageId)));
    const known = new Set(kept.map((item) => item.id));
    const removedIds = new Set(added.filter((item) => removed.has(bookmarkKey(item.kind, item.messageId))).map((item) => item.id));
    return [...added.filter((item) => !known.has(item.id) && !removedIds.has(item.id)), ...kept];
  }

  return {
    keys: new Set(),
    loadedConversations: new Set(),
    list: { items: [], nextCursor: null, status: 'loading', loadingMore: false },

    loadConversation: async (kind, channelId) => {
      const conversationKey = bookmarkConversationKey(kind, channelId);
      if (get().loadedConversations.has(conversationKey) || changedDuringLoad.has(conversationKey)) return;
      const generation = sessionGeneration;
      changedDuringLoad.set(conversationKey, new Map());
      try {
        const ids = await api.bookmarks.keys(kind, channelId);
        if (generation !== sessionGeneration) return;
        const changes = changedDuringLoad.get(conversationKey) ?? new Map<string, boolean>();
        set((state) => {
          const keys = new Set(state.keys);
          for (const id of ids) keys.add(bookmarkKey(kind, id));
          for (const [key, present] of changes) {
            if (present) keys.add(key);
            else keys.delete(key);
          }
          const loadedConversations = new Set(state.loadedConversations);
          loadedConversations.add(conversationKey);
          return { keys, loadedConversations };
        });
      } catch (err) {
        // Without the answer no message shows as bookmarked; the next open asks again.
        console.error('[bookmarks] could not read the bookmarked messages of a conversation:', err);
      } finally {
        changedDuringLoad.delete(conversationKey);
      }
    },

    add: async (kind, messageId) => {
      const generation = sessionGeneration;
      const bookmark = await api.bookmarks.add(kind, messageId);
      if (generation === sessionGeneration) get().applyAdded(bookmark);
      return bookmark;
    },

    remove: async (kind, channelId, messageId) => {
      const generation = sessionGeneration;
      await api.bookmarks.remove(kind, messageId);
      if (generation === sessionGeneration) get().applyRemoved(kind, channelId, messageId);
    },

    loadList: async () => {
      const generation = sessionGeneration;
      const seq = ++listSeq;
      set((state) => ({
        list: { items: state.list.items, nextCursor: state.list.nextCursor, status: 'loading', loadingMore: false },
      }));
      listLoadsInFlight += 1;
      try {
        const page = await api.bookmarks.list({ limit: BOOKMARKS_PAGE_DEFAULT });
        if (generation !== sessionGeneration || listSeq !== seq) return;
        putList(() => {
          const items = withListChanges(page.items);
          return { items, nextCursor: page.nextCursor, status: 'loaded', loadingMore: false };
        });
      } catch (err) {
        if (generation !== sessionGeneration || listSeq !== seq) return;
        console.error('[bookmarks] could not read the list:', err);
        putList((list) => ({ ...list, status: 'error', loadingMore: false }));
      } finally {
        listLoadsInFlight -= 1;
      }
    },

    loadMore: async () => {
      const list = get().list;
      if (list.status !== 'loaded' || list.loadingMore || list.nextCursor === null) return;
      const generation = sessionGeneration;
      const seq = listSeq;
      putList((current) => ({ ...current, loadingMore: true }));
      listLoadsInFlight += 1;
      try {
        const page = await api.bookmarks.list({ cursor: list.nextCursor, limit: BOOKMARKS_PAGE_DEFAULT });
        if (generation !== sessionGeneration || listSeq !== seq) return;
        putList((current) => {
          const known = new Set(current.items.map((item) => item.id));
          const items = withListChanges([...current.items, ...page.items.filter((item) => !known.has(item.id))]);
          return { ...current, items, nextCursor: page.nextCursor, loadingMore: false };
        });
      } catch (err) {
        if (generation !== sessionGeneration || listSeq !== seq) return;
        console.error('[bookmarks] could not read the next page of the list:', err);
        putList((current) => ({ ...current, loadingMore: false }));
      } finally {
        listLoadsInFlight -= 1;
      }
    },

    applyAdded: (bookmark) => {
      noteChange(bookmark.kind, bookmark.channelId, bookmark.messageId, true);
      if (listLoadsInFlight > 0) changedDuringListLoad.set(bookmarkKey(bookmark.kind, bookmark.messageId), bookmark);
      set((state) => {
        const keys = withKey(state.keys, bookmarkKey(bookmark.kind, bookmark.messageId), true);
        if (state.list.items.some((item) => item.id === bookmark.id)) {
          return keys === state.keys ? state : { keys };
        }
        return { keys, list: { ...state.list, items: [bookmark, ...state.list.items] } };
      });
    },

    applyRemoved: (kind, channelId, messageId) => {
      noteChange(kind, channelId, messageId, false);
      if (listLoadsInFlight > 0) changedDuringListLoad.set(bookmarkKey(kind, messageId), null);
      set((state) => {
        const keys = withKey(state.keys, bookmarkKey(kind, messageId), false);
        const items = state.list.items.filter((item) => !(item.kind === kind && item.messageId === messageId));
        if (items.length === state.list.items.length) return keys === state.keys ? state : { keys };
        return { keys, list: { ...state.list, items } };
      });
    },

    resync: () => {
      set((state) => {
        if (state.loadedConversations.size === 0 && state.keys.size === 0) return state;
        return { loadedConversations: new Set(), keys: new Set() };
      });
      get().loadList().catch(() => undefined);
    },

    reset: () => {
      sessionGeneration += 1;
      listSeq += 1;
      changedDuringLoad.clear();
      changedDuringListLoad.clear();
      set({ keys: new Set(), loadedConversations: new Set(), list: EMPTY_LIST });
    },
  };
});

/** Whether the user has bookmarked this message, as far as the conversation's keys have been read. */
export function selectIsBookmarked(state: Pick<BookmarkState, 'keys'>, kind: BookmarkKind, messageId: string): boolean {
  return state.keys.has(bookmarkKey(kind, messageId));
}
