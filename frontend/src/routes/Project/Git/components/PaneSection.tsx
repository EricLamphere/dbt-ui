import { useCallback, useState, type ReactNode } from 'react';

function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStored(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable — not persisted */ }
}

/** Open/closed state remembered in localStorage under `key` ('1' / '0'). */
export function usePersistedOpen(key: string, defaultOpen: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    const stored = readStored(key);
    return stored === null ? defaultOpen : stored === '1';
  });
  const toggle = useCallback(() => {
    setOpen((o) => {
      writeStored(key, o ? '0' : '1');
      return !o;
    });
  }, [key]);
  return [open, toggle];
}

interface PaneSectionHeaderProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  /** Shown as a badge after the title. */
  count?: number;
  /** Extra controls on the right; clicks don't toggle the section. */
  actions?: ReactNode;
}

/** VS Code-style collapsible section header for the Source Control panel. */
export function PaneSectionHeader({ title, open, onToggle, count, actions }: PaneSectionHeaderProps) {
  return (
    <div className="group flex items-center h-7 pr-2 border-t border-zinc-800 shrink-0 select-none hover:bg-surface-elevated/60">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex-1 min-w-0 flex items-center gap-1.5 h-full pl-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200"
      >
        <svg className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="truncate">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="px-1.5 rounded-full bg-zinc-800 text-[10px] font-normal tracking-normal tabular-nums text-zinc-400">
            {count}
          </span>
        )}
      </button>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </div>
  );
}
