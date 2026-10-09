import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavHistory } from '../lib/navHistoryContext';

const BUTTON_CLASSES =
  'p-1 rounded text-gray-500 transition-colors hover:text-gray-300 hover:bg-surface-elevated disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500 disabled:cursor-default';

/** Header back/forward arrows over the last 25 in-app pages and page tabs. */
export function NavArrows() {
  const { canGoBack, canGoForward, goBack, goForward } = useNavHistory();

  return (
    <div className="flex items-center gap-0.5">
      <button onClick={goBack} disabled={!canGoBack} title="Back (⌘[)" aria-label="Back" className={BUTTON_CLASSES}>
        <ChevronLeft size={16} />
      </button>
      <button onClick={goForward} disabled={!canGoForward} title="Forward (⌘])" aria-label="Forward" className={BUTTON_CLASSES}>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
