import { useRef, useState, type PointerEvent } from 'react';
import { HistoryPanel } from './HistoryPanel';
import { PaneSectionHeader, usePersistedOpen } from './PaneSection';

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

/** Collapsible Commit History section (collapsed by default) with a drag handle on its top edge to resize it. */
export function HistorySection({ projectId, selectedPath }: Props) {
  const [open, toggle] = usePersistedOpen(OPEN_KEY, false);
  const [height, setHeight] = useState(() => {
    const v = parseInt(readStored(HEIGHT_KEY) ?? '', 10);
    return Number.isNaN(v) ? DEFAULT_HEIGHT : clampHistoryHeight(v);
  });
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);

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
    <div className="shrink-0">
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={() => { setHeight(DEFAULT_HEIGHT); writeStored(HEIGHT_KEY, String(DEFAULT_HEIGHT)); }}
          className="relative z-10 h-1 -mb-1 cursor-row-resize hover:bg-brand-500 transition-colors"
        />
      )}
      <PaneSectionHeader title="Commit History" open={open} onToggle={toggle} />
      {open && (
        <div className="border-t border-zinc-800" style={{ height }}>
          <HistoryPanel projectId={projectId} selectedPath={selectedPath} />
        </div>
      )}
    </div>
  );
}
