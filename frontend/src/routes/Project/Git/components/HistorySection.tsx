import { useRef, useState, type PointerEvent } from 'react';
import { HistoryPanel } from './HistoryPanel';

const HEIGHT_KEY = 'dbt-ui:git-history-height';
const OPEN_KEY = 'dbt-ui:git-history-open';
const MIN_HEIGHT = 96;
const MAX_HEIGHT = 900;
const DEFAULT_HEIGHT = 192;

export function clampHistoryHeight(h: number): number {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(h)));
}

function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStored(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable — not persisted */ }
}

interface Props {
  projectId: number;
  selectedPath: string | null;
}

/** Collapsible History section with a drag handle on its top edge to resize it. */
export function HistorySection({ projectId, selectedPath }: Props) {
  const [open, setOpen] = useState(() => readStored(OPEN_KEY) === '1');
  const [height, setHeight] = useState(() => {
    const v = parseInt(readStored(HEIGHT_KEY) ?? '', 10);
    return Number.isNaN(v) ? DEFAULT_HEIGHT : clampHistoryHeight(v);
  });
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);

  const toggle = () => {
    setOpen((o) => {
      writeStored(OPEN_KEY, o ? '0' : '1');
      return !o;
    });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startHeight: height };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    // dragging up grows the panel
    setHeight(clampHistoryHeight(drag.current.startHeight - (e.clientY - drag.current.startY)));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    writeStored(HEIGHT_KEY, String(height));
  };

  return (
    <div className="shrink-0 border-t border-zinc-800">
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={() => { setHeight(DEFAULT_HEIGHT); writeStored(HEIGHT_KEY, String(DEFAULT_HEIGHT)); }}
          className="h-1 -mt-0.5 cursor-row-resize hover:bg-brand-500 transition-colors"
        />
      )}
      <button
        onClick={toggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-500 hover:text-gray-300 hover:bg-surface-elevated"
      >
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        History
      </button>
      {open && (
        <div className="border-t border-zinc-800" style={{ height }}>
          <HistoryPanel projectId={projectId} selectedPath={selectedPath} />
        </div>
      )}
    </div>
  );
}
