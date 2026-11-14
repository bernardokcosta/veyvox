import { Tooltip } from '../ui/Tooltip';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { BookmarkIcon } from '../ui/BookmarkIcon';

/**
 * Top-bar button that opens the bookmarks window. It sits with the other
 * conversation utility buttons, so they read as one group.
 */
export function BookmarksButton() {
  const { t } = useTranslation('bookmarks');
  const openModal = useUIStore((s) => s.openModal);
  const open = useUIStore((s) => s.activeModal === 'bookmarks');
  return (
    <Tooltip content={t('title')} position="bottom">
      <button
        type="button"
        onClick={() => openModal('bookmarks')}
        className={`w-8 h-8 flex items-center justify-center transition-colors rounded-[6px] ${open ? 'text-txt-primary bg-interactive-active' : 'text-txt-tertiary hover:text-txt-primary hover:bg-interactive-hover'}`}
        aria-label={t('title')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <BookmarkIcon size={20} />
      </button>
    </Tooltip>
  );
}
