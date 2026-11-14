import { useMemo } from 'react';
import type { User } from '@veyvox/shared';
import { useSpaceStore } from '../../stores/spaceStore';

/** An author as the client currently knows them. */
export interface BookmarkAuthor {
  user: User;
  displayName: string;
  avatar: string | null;
  avatarColor: User['avatarColor'];
}

/**
 * The people the client knows, looked up by the row id a bookmark names as its
 * author. Built from the user-view cache, so a changed avatar or name shows in
 * the list without a reload; an author the cache has not seen is simply absent,
 * and the row falls back to the saved name and initials.
 */
export function useBookmarkAuthors(): ReadonlyMap<string, BookmarkAuthor> {
  const userViews = useSpaceStore((s) => s.userViews);
  return useMemo(() => {
    const index = new Map<string, BookmarkAuthor>();
    for (const entry of userViews.values()) {
      const { user } = entry;
      const known = index.get(user.id);
      if (known) continue;
      index.set(user.id, {
        user,
        displayName: user.displayName ?? user.username,
        avatar: user.avatar,
        avatarColor: user.avatarColor,
      });
    }
    return index;
  }, [userViews]);
}
