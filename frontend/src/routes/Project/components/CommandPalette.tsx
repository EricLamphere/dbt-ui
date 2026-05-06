import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { NavigateFunction, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Braces,
  FileCode,
  FlaskConical,
  GitBranch,
  Hammer,
  HeartPulse,
  LayoutDashboard,
  Play,
  RefreshCw,
  Search,
  Settings,
  Terminal,
  Zap,
} from 'lucide-react';
import { api, GraphDto, ModelNode } from '../../../lib/api';

// ---- Types ----

type CommandCategory = 'navigation' | 'model' | 'project';

interface Command {
  id: string;
  category: CommandCategory;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  shortcutHint?: string;
  onExecute: () => void;
}

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  navigation: 'Navigation',
  model: 'Models',
  project: 'Project',
};

// ---- Command builders ----

function buildNavCommands(projectId: number, navigate: NavigateFunction): Command[] {
  const base = `/projects/${projectId}`;
  return [
    {
      id: 'nav-dag',
      category: 'navigation',
      title: 'Go to DAG',
      icon: <LayoutDashboard size={14} />,
      onExecute: () => navigate(`${base}/models`),
    },
    {
      id: 'nav-files',
      category: 'navigation',
      title: 'Go to Files',
      icon: <FileCode size={14} />,
      onExecute: () => navigate(`${base}/files`),
    },
    {
      id: 'nav-docs',
      category: 'navigation',
      title: 'Go to Docs',
      icon: <BookOpen size={14} />,
      onExecute: () => navigate(`${base}/docs`),
    },
    {
      id: 'nav-workspace',
      category: 'navigation',
      title: 'Go to SQL Workspace',
      icon: <Terminal size={14} />,
      onExecute: () => navigate(`${base}/workspace`),
    },
    {
      id: 'nav-git',
      category: 'navigation',
      title: 'Go to Source Control',
      icon: <GitBranch size={14} />,
      onExecute: () => navigate(`${base}/git`),
    },
    {
      id: 'nav-health',
      category: 'navigation',
      title: 'Go to Health',
      icon: <HeartPulse size={14} />,
      onExecute: () => navigate(`${base}/health`),
    },
    {
      id: 'nav-environment',
      category: 'navigation',
      title: 'Go to Environment',
      icon: <Settings size={14} />,
      onExecute: () => navigate(`${base}/environment`),
    },
    {
      id: 'nav-init',
      category: 'navigation',
      title: 'Go to Init Scripts',
      icon: <Zap size={14} />,
      onExecute: () => navigate(`${base}/init`),
    },
  ];
}

function buildProjectCommands(projectId: number, navigate: NavigateFunction): Command[] {
  const base = `/projects/${projectId}`;
  return [
    {
      id: 'proj-run-all',
      category: 'project',
      title: 'Run all models',
      icon: <Play size={14} />,
      onExecute: () => api.runs.run(projectId, '', 'only'),
    },
    {
      id: 'proj-build-all',
      category: 'project',
      title: 'Build all models',
      icon: <Hammer size={14} />,
      onExecute: () => api.runs.build(projectId, '', 'only'),
    },
    {
      id: 'proj-test-all',
      category: 'project',
      title: 'Test all models',
      icon: <FlaskConical size={14} />,
      onExecute: () => api.runs.test(projectId, '', 'only'),
    },
    {
      id: 'proj-compile',
      category: 'project',
      title: 'Compile project',
      icon: <Braces size={14} />,
      onExecute: () => api.models.compile(projectId),
    },
    {
      id: 'proj-gen-docs',
      category: 'project',
      title: 'Generate docs',
      icon: <BookOpen size={14} />,
      onExecute: () => api.docs.generate(projectId),
    },
    {
      id: 'proj-health',
      category: 'project',
      title: 'Check health',
      icon: <HeartPulse size={14} />,
      onExecute: () => navigate(`${base}/health?tab=health-check`),
    },
    {
      id: 'proj-freshness',
      category: 'project',
      title: 'Check source freshness',
      icon: <RefreshCw size={14} />,
      onExecute: () => {
        navigate(`${base}/health?tab=source-freshness`);
        api.freshness.start(projectId);
      },
    },
    {
      id: 'proj-drift',
      category: 'project',
      title: 'Check schema drift',
      icon: <RefreshCw size={14} />,
      onExecute: () => {
        navigate(`${base}/health?tab=schema-drift`);
        api.drift.start(projectId);
      },
    },
  ];
}

function buildModelCommands(
  nodes: ModelNode[],
  projectId: number,
  navigate: NavigateFunction,
): Command[] {
  const base = `/projects/${projectId}`;
  const cmds: Command[] = [];
  for (const node of nodes) {
    if (node.resource_type !== 'model') continue;
    const sub = node.original_file_path ?? undefined;
    cmds.push(
      {
        id: `model-dag-${node.unique_id}`,
        category: 'model',
        title: `Show DAG: ${node.name}`,
        subtitle: sub,
        icon: <LayoutDashboard size={14} />,
        onExecute: () => navigate(`${base}/models?model=${node.unique_id}`),
      },
      {
        id: `model-file-${node.unique_id}`,
        category: 'model',
        title: `Open file: ${node.name}`,
        subtitle: sub,
        icon: <FileCode size={14} />,
        onExecute: () => {
          if (node.original_file_path) {
            sessionStorage.setItem(`file-explorer-open-${projectId}`, node.original_file_path);
          }
          navigate(`${base}/files?model=${node.unique_id}`);
        },
      },
      {
        id: `model-docs-${node.unique_id}`,
        category: 'model',
        title: `View docs: ${node.name}`,
        subtitle: sub,
        icon: <BookOpen size={14} />,
        onExecute: () => navigate(`${base}/docs`),
      },
      {
        id: `model-run-${node.unique_id}`,
        category: 'model',
        title: `Run: ${node.name}`,
        subtitle: sub,
        icon: <Play size={14} />,
        onExecute: () => api.runs.run(projectId, node.unique_id, 'only'),
      },
      {
        id: `model-run-up-${node.unique_id}`,
        category: 'model',
        title: `Run upstream: ${node.name}`,
        subtitle: sub,
        icon: <Play size={14} />,
        onExecute: () => api.runs.run(projectId, node.unique_id, 'upstream'),
      },
      {
        id: `model-run-down-${node.unique_id}`,
        category: 'model',
        title: `Run downstream: ${node.name}`,
        subtitle: sub,
        icon: <Play size={14} />,
        onExecute: () => api.runs.run(projectId, node.unique_id, 'downstream'),
      },
      {
        id: `model-build-${node.unique_id}`,
        category: 'model',
        title: `Build: ${node.name}`,
        subtitle: sub,
        icon: <Hammer size={14} />,
        onExecute: () => api.runs.build(projectId, node.unique_id, 'only'),
      },
      {
        id: `model-test-${node.unique_id}`,
        category: 'model',
        title: `Test: ${node.name}`,
        subtitle: sub,
        icon: <FlaskConical size={14} />,
        onExecute: () => api.runs.test(projectId, node.unique_id, 'only'),
      },
    );
  }
  return cmds;
}

// ---- Filter ----

function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return commands.filter((c) => c.category !== 'model');
  }
  const order: Record<CommandCategory, number> = { navigation: 0, project: 1, model: 2 };
  const matched = commands.filter(
    (c) =>
      c.title.toLowerCase().includes(q) || (c.subtitle?.toLowerCase().includes(q) ?? false),
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
      {command.shortcutHint && (
        <kbd className="text-[10px] text-gray-600 border border-gray-700 rounded px-1 shrink-0">
          {command.shortcutHint}
        </kbd>
      )}
    </button>
  );
}

// ---- Main component ----

interface CommandPaletteProps {
  projectId: number;
  graph: GraphDto | null;
  query: string;
  onQueryChange: (q: string) => void;
  onClose: () => void;
}

export function CommandPalette({
  projectId,
  graph,
  query,
  onQueryChange,
  onClose,
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const allCommands = useMemo<Command[]>(() => {
    const nav = buildNavCommands(projectId, navigate);
    const proj = buildProjectCommands(projectId, navigate);
    const models = graph ? buildModelCommands(graph.nodes, projectId, navigate) : [];
    return [...nav, ...proj, ...models];
  }, [projectId, navigate, graph]);

  const filtered = useMemo(() => filterCommands(allCommands, query), [allCommands, query]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const execute = useCallback(
    (cmd: Command) => {
      onClose();
      cmd.onExecute();
    },
    [onClose],
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

  // Group filtered results by category
  const groups = useMemo(() => {
    const map = new Map<CommandCategory, Command[]>();
    for (const cmd of filtered) {
      const list = map.get(cmd.category) ?? [];
      list.push(cmd);
      map.set(cmd.category, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  // Build a flat index → absolute position map for selection tracking
  const absoluteIndexOf = useCallback(
    (cmd: Command) => filtered.indexOf(cmd),
    [filtered],
  );

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
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 shrink-0">
          <Search size={14} className="text-gray-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands…"
            className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 focus:outline-none"
          />
          <kbd className="text-[10px] text-gray-600 border border-gray-700 rounded px-1.5 py-0.5 shrink-0">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-600">No commands found</div>
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
