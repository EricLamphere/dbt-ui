import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { FolderOpen, Plus, RefreshCw, Settings2 } from 'lucide-react';
import type { Project } from '../lib/api';

// ---- Types ----

type CommandCategory = 'project' | 'action';

interface Command {
  id: string;
  category: CommandCategory;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onExecute: () => void;
}

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  project: 'Projects',
  action: 'Actions',
};

// ---- Filter ----

function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  const order: Record<CommandCategory, number> = { project: 0, action: 1 };
  const matched = commands.filter(
    (c) => c.title.toLowerCase().includes(q) || (c.subtitle?.toLowerCase().includes(q) ?? false)
  );
  matched.sort((a, b) => {
    const catDiff = order[a.category] - order[b.category];
    if (catDiff !== 0) return catDiff;
    const aPrefix = a.title.toLowerCase().startsWith(q) ? 0 : 1;
    const bPrefix = b.title.toLowerCase().startsWith(q) ? 0 : 1;
    return aPrefix - bPrefix;
  });
  return matched.slice(0, 50);
}

// ---- Sub-components ----

interface CommandRowProps {
  command: Command;
  isSelected: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}

function CommandRow({ command, isSelected, onMouseEnter, onClick }: CommandRowProps) {
  return (
    <button
      data-selected={isSelected}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
        isSelected ? 'bg-brand-900/40 text-brand-300' : 'text-gray-300 hover:bg-surface-elevated'
      }`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="w-4 h-4 shrink-0 text-gray-500">{command.icon}</span>
      <span className="flex-1 min-w-0">
        <span className="text-sm block truncate">{command.title}</span>
        {command.subtitle && (
          <span className="block text-xs text-gray-600 truncate">{command.subtitle}</span>
        )}
      </span>
    </button>
  );
}

// ---- Main component ----

interface HomeCommandPaletteProps {
  projects: Project[];
  onNavigateToProject: (project: Project) => void;
  onNewProject: () => void;
  onRescan: () => void;
  onOpenGlobalSettings: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  onClose: () => void;
}

export function HomeCommandPalette({
  projects,
  onNavigateToProject,
  onNewProject,
  onRescan,
  onOpenGlobalSettings,
  query,
  onQueryChange,
  onClose,
}: HomeCommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const allCommands = useMemo<Command[]>(() => {
    const projectCommands: Command[] = projects
      .filter((p) => !p.ignored)
      .map((p) => ({
        id: `project-${p.id}`,
        category: 'project',
        title: `Open ${p.name}`,
        subtitle: p.path,
        icon: <FolderOpen size={14} />,
        onExecute: () => onNavigateToProject(p),
      }));

    const actionCommands: Command[] = [
      {
        id: 'action-new-project',
        category: 'action',
        title: 'New project',
        icon: <Plus size={14} />,
        onExecute: onNewProject,
      },
      {
        id: 'action-rescan',
        category: 'action',
        title: 'Rescan projects',
        icon: <RefreshCw size={14} />,
        onExecute: onRescan,
      },
      {
        id: 'action-global-settings',
        category: 'action',
        title: 'Global settings',
        icon: <Settings2 size={14} />,
        onExecute: onOpenGlobalSettings,
      },
    ];

    return [...projectCommands, ...actionCommands];
  }, [projects, onNavigateToProject, onNewProject, onRescan, onOpenGlobalSettings]);

  const filtered = useMemo(() => filterCommands(allCommands, query), [allCommands, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const execute = useCallback(
    (cmd: Command) => {
      onClose();
      cmd.onExecute();
    },
    [onClose]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[selectedIndex];
      if (cmd) execute(cmd);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const groups = useMemo(() => {
    const map = new Map<CommandCategory, Command[]>();
    for (const cmd of filtered) {
      const list = map.get(cmd.category) ?? [];
      list.push(cmd);
      map.set(cmd.category, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const absoluteIndexOf = useCallback((cmd: Command) => filtered.indexOf(cmd), [filtered]);

  const palette = (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[18vh]"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="bg-surface-panel border border-gray-700 rounded-xl shadow-2xl w-[560px] max-h-[60vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 shrink-0">
          <FolderOpen size={14} className="text-gray-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Open a project or run an action…"
            className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 focus:outline-none"
          />
          <kbd className="text-[10px] text-gray-600 border border-gray-700 rounded px-1.5 py-0.5 shrink-0">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-600">No matches</div>
          ) : (
            groups.map(([category, items]) => (
              <div key={category}>
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold sticky top-0 bg-surface-panel border-b border-gray-800/50">
                  {CATEGORY_LABELS[category]}
                </div>
                {items.map((cmd) => {
                  const absIdx = absoluteIndexOf(cmd);
                  return (
                    <CommandRow
                      key={cmd.id}
                      command={cmd}
                      isSelected={absIdx === selectedIndex}
                      onMouseEnter={() => setSelectedIndex(absIdx)}
                      onClick={() => execute(cmd)}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(palette, document.body);
}
