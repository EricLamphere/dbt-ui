import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FolderOpen, Pin, Plus, RefreshCw, Settings2, Database } from 'lucide-react';
import { api, type Project } from '../lib/api';
import NewProjectModal from './Project/components/NewProjectModal';
import { GlobalSettingsModal } from '../components/GlobalSettingsModal';

// ── Platform config ───────────────────────────────────────────────────────────

const PLATFORM_META: Record<string, { icon: string; accent: string }> = {
  postgres:   { icon: '🐘', accent: 'border-blue-700/60' },
  bigquery:   { icon: '☁️', accent: 'border-sky-700/60' },
  snowflake:  { icon: '❄️', accent: 'border-cyan-700/60' },
  redshift:   { icon: '🔴', accent: 'border-red-700/60' },
  duckdb:     { icon: '🦆', accent: 'border-yellow-700/60' },
  spark:      { icon: '⚡', accent: 'border-orange-700/60' },
  databricks: { icon: '🧱', accent: 'border-orange-800/60' },
  athena:     { icon: '🦉', accent: 'border-purple-700/60' },
  trino:      { icon: '🔷', accent: 'border-indigo-700/60' },
  clickhouse: { icon: '🏡', accent: 'border-yellow-600/60' },
  unknown:    { icon: '⬡',  accent: 'border-gray-700/60' },
};

function platformMeta(platform: string) {
  return PLATFORM_META[platform.toLowerCase()] ?? PLATFORM_META.unknown;
}

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'last_opened' | 'models';
const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  last_opened: 'Last opened',
  models: 'Model count',
};
const SORT_STORAGE_KEY = 'dbt-ui:home-sort';

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: 'status-badge-success border',
    error:   'status-badge-error border',
    warn:    'status-badge-warn border',
    running: 'status-badge-running border',
  };
  const cls = map[status] ?? 'bg-zinc-800 text-zinc-400 border border-zinc-700';
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cls}`}>
      {status}
    </span>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const RESOURCE_COLOR: Record<string, string> = {
  models:  'text-brand-400',
  sources: 'text-blue-400',
  seeds:   'text-emerald-400',
  tests:   'text-red-400',
};

function CountChip({ label, count }: { label: string; count: number }) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-gray-500">
      <span className={`font-medium ${RESOURCE_COLOR[label] ?? 'text-gray-400'}`}>{count}</span>
      {label}
    </span>
  );
}

// ── Project card ──────────────────────────────────────────────────────────────

interface ProjectCardProps {
  project: Project;
  focused: boolean;
  shortcutKey?: number;
  cardRef: (el: HTMLButtonElement | null) => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onFocus: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
}

function ProjectCard({ project, focused, shortcutKey, cardRef, onClick, onContextMenu, onFocus, onKeyDown }: ProjectCardProps) {
  const meta = platformMeta(project.platform);

  const { data: history } = useQuery({
    queryKey: ['run-history-latest', project.id],
    queryFn: () => api.runHistory.list(project.id, { limit: 1 }),
    staleTime: 60_000,
  });

  const { data: graph } = useQuery({
    queryKey: ['graph', project.id],
    queryFn: () => api.models.graph(project.id),
    staleTime: 5 * 60_000,
  });

  const latest = history?.items[0];

  const counts = graph
    ? {
        models:  graph.nodes.filter((n: { resource_type: string }) => n.resource_type === 'model').length,
        sources: graph.nodes.filter((n: { resource_type: string }) => n.resource_type === 'source').length,
        seeds:   graph.nodes.filter((n: { resource_type: string }) => n.resource_type === 'seed').length,
        tests:   graph.nodes.filter((n: { resource_type: string }) => n.resource_type === 'test').length,
      }
    : null;

  return (
    <button
      ref={cardRef}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className={[
        'group flex flex-col gap-3 bg-surface-panel border rounded-xl p-4 text-left',
        'hover:border-brand-600/70 hover:bg-surface-elevated/60 transition-all duration-150',
        'focus:outline-none',
        focused
          ? 'ring-2 ring-brand-500 border-brand-600/70'
          : `border-gray-800 ${meta.accent}`,
      ].join(' ')}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base leading-none">{meta.icon}</span>
          <span className="font-semibold text-gray-100 truncate">{project.name}</span>
          {project.pinned && (
            <Pin className="w-3 h-3 text-brand-400 shrink-0 fill-brand-400" />
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {shortcutKey !== undefined && (
            <span className="text-[10px] font-mono text-gray-600 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 leading-none">
              {shortcutKey}
            </span>
          )}
          {latest && <StatusPill status={latest.status} />}
        </div>
      </div>

      {/* Path */}
      <span className="text-[11px] text-gray-600 truncate font-mono leading-none">
        {project.path}
      </span>

      {/* Footer: node type counts + last opened */}
      <div className="flex items-center gap-2.5 mt-auto pt-2 border-t border-gray-800/60">
        {counts ? (
          <>
            <CountChip label="models"  count={counts.models} />
            <span className="text-gray-700 text-[11px]">·</span>
            <CountChip label="sources" count={counts.sources} />
            <span className="text-gray-700 text-[11px]">·</span>
            <CountChip label="seeds"   count={counts.seeds} />
            <span className="text-gray-700 text-[11px]">·</span>
            <CountChip label="tests"   count={counts.tests} />
          </>
        ) : (
          <span className="text-[11px] text-gray-700 italic">loading…</span>
        )}
        {project.last_opened_at && (
          <span className="ml-auto text-[11px] text-gray-600">
            {timeAgo(project.last_opened_at)}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar({ projects, lastRunAt }: { projects: Project[]; lastRunAt: string | null }) {
  const platforms = Array.from(new Set(projects.map((p) => p.platform))).sort();

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs text-gray-500">
      <span>
        <span className="font-medium text-gray-300">{projects.length}</span>{' '}
        {projects.length === 1 ? 'project' : 'projects'}
      </span>
      {platforms.length > 0 && (
        <span className="flex items-center gap-2">
          {platforms.map((p) => {
            const m = platformMeta(p);
            const count = projects.filter((pr) => pr.platform === p).length;
            return (
              <span key={p} className="flex items-center gap-1">
                <span>{m.icon}</span>
                <span className="capitalize">{p}</span>
                {count > 1 && <span className="text-gray-600">×{count}</span>}
              </span>
            );
          })}
        </span>
      )}
      {lastRunAt && (
        <span className="ml-auto">
          last run <span className="text-gray-400">{timeAgo(lastRunAt)}</span>
        </span>
      )}
    </div>
  );
}

// ── Context menu ──────────────────────────────────────────────────────────────

interface CardMenuState {
  id: number;
  x: number;
  y: number;
  isIgnored: boolean;
  isPinned: boolean;
}

function ProjectCardMenu({ menu, onIgnore, onPin, onClose }: {
  menu: CardMenuState;
  onIgnore: (id: number, ignored: boolean) => void;
  onPin: (id: number, pinned: boolean) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: Math.min(menu.y, window.innerHeight - 100),
        left: Math.min(menu.x, window.innerWidth - 160),
        zIndex: 50,
      }}
      className="bg-surface-panel border border-gray-700 rounded-lg shadow-xl py-1 w-36"
    >
      <button
        onClick={() => { onPin(menu.id, !menu.isPinned); onClose(); }}
        className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-surface-elevated transition-colors"
      >
        {menu.isPinned ? 'Unpin' : 'Pin to top'}
      </button>
      <button
        onClick={() => { onIgnore(menu.id, !menu.isIgnored); onClose(); }}
        className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-surface-elevated transition-colors"
      >
        {menu.isIgnored ? 'Un-ignore' : 'Ignore'}
      </button>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ isConfigured, projectsPath, onNew }: {
  isConfigured: boolean;
  projectsPath: string | undefined;
  onNew: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-surface-elevated border border-gray-800 flex items-center justify-center">
        <FolderOpen className="w-7 h-7 text-gray-600" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-base font-medium text-gray-400">No dbt projects found</p>
        {projectsPath && (
          <p className="text-xs font-mono text-gray-700">{projectsPath}</p>
        )}
      </div>
      {isConfigured && (
        <button
          onClick={onNew}
          className="mt-2 flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add your first project
        </button>
      )}
    </div>
  );
}

// ── Sort helpers ──────────────────────────────────────────────────────────────

function sortProjects(projects: Project[], key: SortKey, modelCounts: Map<number, number>): Project[] {
  return [...projects].sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name);
    if (key === 'last_opened') {
      const ta = a.last_opened_at ? new Date(a.last_opened_at).getTime() : 0;
      const tb = b.last_opened_at ? new Date(b.last_opened_at).getTime() : 0;
      return tb - ta;
    }
    if (key === 'models') {
      return (modelCounts.get(b.id) ?? 0) - (modelCounts.get(a.id) ?? 0);
    }
    return 0;
  });
}

// ── Project grid ──────────────────────────────────────────────────────────────

const COLS = 3;

interface ProjectGridProps {
  projects: Project[];
  focusedIdx: number | null;
  cardRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>;
  idxOffset: number;
  showShortcuts: boolean;
  onNavigate: (project: Project) => void;
  onContextMenu: (e: React.MouseEvent, project: Project) => void;
  onFocus: (idx: number) => void;
  onKeyDown: (idx: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => void;
}

function ProjectGrid({ projects, focusedIdx, cardRefs, idxOffset, showShortcuts, onNavigate, onContextMenu, onFocus, onKeyDown }: ProjectGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {projects.map((project, i) => {
        const idx = idxOffset + i;
        const shortcutNum = idx + 1;
        return (
          <ProjectCard
            key={project.id}
            project={project}
            focused={focusedIdx === idx}
            shortcutKey={showShortcuts && shortcutNum <= 9 ? shortcutNum : undefined}
            cardRef={(el) => { cardRefs.current[idx] = el; }}
            onClick={() => onNavigate(project)}
            onContextMenu={(e) => onContextMenu(e, project)}
            onFocus={() => onFocus(idx)}
            onKeyDown={onKeyDown(idx)}
          />
        );
      })}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [sort, setSort] = useState<SortKey>(() => {
    const saved = localStorage.getItem(SORT_STORAGE_KEY);
    return (saved as SortKey) || 'last_opened';
  });
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [ignoredOpen, setIgnoredOpen] = useState(false);
  const [cardMenu, setCardMenu] = useState<CardMenuState | null>(null);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { data: appSettings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => api.settings.get(),
  });

  const { data: dbtCoreStatus } = useQuery({
    queryKey: ['dbt-core-status'],
    queryFn: () => api.init.dbtCoreStatus(),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const isConfigured = appSettings?.configured ?? true;

  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: api.projects.list,
    enabled: isConfigured,
  });

  // Most recent run across all projects for the stats bar
  const { data: lastRunAt = null } = useQuery({
    queryKey: ['run-history-all-recent', projects.map((p) => p.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        projects.slice(0, 10).map((p) => api.runHistory.list(p.id, { limit: 1 }))
      );
      const items = results.flatMap((r) => r.items);
      items.sort((a, b) => {
        const ta = a.finished_at ? new Date(a.finished_at).getTime() : 0;
        const tb = b.finished_at ? new Date(b.finished_at).getTime() : 0;
        return tb - ta;
      });
      return items[0]?.finished_at ?? null;
    },
    enabled: isConfigured && projects.length > 0,
    staleTime: 60_000,
  });

  // Model counts for sort-by-models (pulled from cached graph queries)
  const modelCounts = new Map<number, number>(
    projects.map((p) => {
      const graph = qc.getQueryData<{ nodes: { resource_type: string }[] }>(['graph', p.id]);
      const count = graph?.nodes.filter((n) => n.resource_type === 'model').length ?? 0;
      return [p.id, count];
    })
  );

  useEffect(() => {
    const handler = () => {
      if (!isConfigured) setGlobalSettingsOpen(true);
      else setNewProjectOpen(true);
    };
    window.addEventListener('dbt-ui:new-project', handler);
    return () => window.removeEventListener('dbt-ui:new-project', handler);
  }, [isConfigured]);

  const activeProjects = projects.filter((p) => !p.ignored);
  const ignoredProjects = projects.filter((p) => p.ignored);

  const activeFiltered = activeProjects.filter((p) => {
    const matchName = p.name.toLowerCase().includes(search.toLowerCase());
    const matchPlatform = !platformFilter || p.platform === platformFilter;
    return matchName && matchPlatform;
  });

  const pinnedProjects = sortProjects(
    activeFiltered.filter((p) => p.pinned),
    sort,
    modelCounts,
  );
  const unpinnedProjects = sortProjects(
    activeFiltered.filter((p) => !p.pinned),
    sort,
    modelCounts,
  );

  // Flat ordered list for keyboard navigation (pinned first)
  const allVisible = [...pinnedProjects, ...unpinnedProjects];

  const platforms = Array.from(new Set(activeProjects.map((p) => p.platform))).sort();

  const handleSortChange = (key: SortKey) => {
    setSort(key);
    localStorage.setItem(SORT_STORAGE_KEY, key);
  };

  const handleRescan = async () => {
    await api.projects.rescan();
    qc.invalidateQueries({ queryKey: ['projects'] });
  };

  const handleIgnore = useCallback(async (id: number, ignored: boolean) => {
    try {
      await api.projects.ignore(id, ignored);
      qc.invalidateQueries({ queryKey: ['projects'] });
    } catch (e) {
      alert(String(e));
    }
  }, [qc]);

  const handlePin = useCallback(async (id: number, pinned: boolean) => {
    try {
      await api.projects.pin(id, pinned);
      qc.invalidateQueries({ queryKey: ['projects'] });
    } catch (e) {
      alert(String(e));
    }
  }, [qc]);

  const openCardMenu = (e: React.MouseEvent, project: Project) => {
    e.preventDefault();
    setCardMenu({ id: project.id, x: e.clientX, y: e.clientY, isIgnored: project.ignored, isPinned: project.pinned });
  };

  // Number key shortcuts: 1–9 navigate directly to that card
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9) {
        const project = allVisible[n - 1];
        if (project) navigate(`/projects/${project.id}`);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [allVisible, navigate]);

  // Arrow key navigation: bootstrap focus onto the grid when no card is currently focused
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (allVisible.length === 0) return;
      const isArrow = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      if (!isArrow) return;
      const activeEl = document.activeElement;
      if (cardRefs.current.some((el) => el === activeEl)) return; // card already focused — its onKeyDown handles it
      if (activeEl instanceof HTMLSelectElement) return;
      e.preventDefault();
      const startIdx = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? allVisible.length - 1 : 0;
      setFocusedIdx(startIdx);
      cardRefs.current[startIdx]?.focus();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [allVisible]);

  // Arrow key navigation + Enter to open
  const makeCardKeyDown = useCallback((idx: number): ((e: React.KeyboardEvent<HTMLButtonElement>) => void) => {
    return (e) => {
      const len = allVisible.length;
      let next = idx;
      if (e.key === 'ArrowRight')      { e.preventDefault(); next = Math.min(idx + 1, len - 1); }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); next = Math.max(idx - 1, 0); }
      else if (e.key === 'ArrowDown')  { e.preventDefault(); next = Math.min(idx + COLS, len - 1); }
      else if (e.key === 'ArrowUp')    { e.preventDefault(); next = Math.max(idx - COLS, 0); }
      else if (e.key === 'Enter')      { e.preventDefault(); const p = allVisible[idx]; if (p) navigate(`/projects/${p.id}`); return; }
      else { return; }
      setFocusedIdx(next);
      cardRefs.current[next]?.focus();
    };
  }, [allVisible, navigate]);

  const showShortcuts = allVisible.length > 1;

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-5 max-w-6xl mx-auto w-full">

      {/* Config banner */}
      {appSettings && !isConfigured && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 bg-amber-950/40 border border-amber-800/60 rounded-lg">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-amber-300">DBT_UI_PROJECTS_PATH is not set</p>
            <p className="text-xs text-amber-500">Set the path to your dbt projects folder before scanning or creating projects.</p>
          </div>
          <button
            onClick={() => setGlobalSettingsOpen(true)}
            className="shrink-0 px-3 py-1.5 text-xs rounded bg-amber-700 hover:bg-amber-600 text-white font-medium transition-colors"
          >
            Configure
          </button>
        </div>
      )}

      {/* dbt not found banner */}
      {dbtCoreStatus && !dbtCoreStatus.installed && (
        <div className="flex items-center gap-4 px-4 py-3 bg-red-950/40 border border-red-800/60 rounded-lg">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-red-300">dbt is not installed</p>
            <p className="text-xs text-red-500">
              Add <code className="font-mono">dbt-core</code> and an adapter to your global requirements file, then click Run global setup in the header.
            </p>
          </div>
        </div>
      )}

      {/* Workbench header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-surface-elevated border border-gray-800 flex items-center justify-center shrink-0">
            <Database className="w-4 h-4 text-brand-400" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-semibold text-gray-100 leading-tight">Projects</span>
            {dbtCoreStatus?.version && (
              <span className="text-[11px] text-gray-600 leading-tight">dbt {dbtCoreStatus.version}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setGlobalSettingsOpen(true)}
            title="Global settings"
            className="p-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-surface-elevated transition-colors"
          >
            <Settings2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleRescan}
            disabled={!isConfigured}
            title="Rescan projects"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-surface-elevated hover:bg-gray-700 text-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed border border-gray-800"
          >
            <RefreshCw className="w-3 h-3" />
            Rescan
          </button>
          <button
            onClick={() => isConfigured ? setNewProjectOpen(true) : setGlobalSettingsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors"
          >
            <Plus className="w-3 h-3" />
            New project
          </button>
        </div>
      </div>

      {/* Search + filter + sort */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search projects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={!isConfigured}
          className="flex-1 min-w-[200px] bg-surface-elevated border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-40"
        />
        {platforms.length > 1 && (
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="bg-surface-elevated border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All platforms</option>
            {platforms.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}
        <select
          value={sort}
          onChange={(e) => handleSortChange(e.target.value as SortKey)}
          disabled={!isConfigured}
          className="bg-surface-elevated border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-40"
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
            <option key={k} value={k}>{SORT_LABELS[k]}</option>
          ))}
        </select>
      </div>

      {/* Stats bar */}
      {isConfigured && !isLoading && activeProjects.length > 0 && (
        <StatsBar
          projects={activeFiltered.length < activeProjects.length ? activeFiltered : activeProjects}
          lastRunAt={lastRunAt}
        />
      )}

      {/* Loading / error */}
      {isLoading && isConfigured && (
        <p className="text-gray-500 text-sm">Discovering projects…</p>
      )}
      {error && (
        <p className="text-red-400 text-sm">Error: {String(error)}</p>
      )}

      {/* Empty state */}
      {isConfigured && !isLoading && activeFiltered.length === 0 && ignoredProjects.length === 0 && (
        <EmptyState
          isConfigured={isConfigured}
          projectsPath={appSettings?.dbt_projects_path ?? undefined}
          onNew={() => setNewProjectOpen(true)}
        />
      )}

      {/* Pinned section */}
      {pinnedProjects.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 px-1">
            <Pin className="w-3 h-3 text-gray-600 fill-gray-600" />
            <span className="text-xs text-gray-600 font-medium">Pinned</span>
          </div>
          <ProjectGrid
            projects={pinnedProjects}
            focusedIdx={focusedIdx}
            cardRefs={cardRefs}
            idxOffset={0}
            showShortcuts={showShortcuts}
            onNavigate={(p) => navigate(`/projects/${p.id}`)}
            onContextMenu={openCardMenu}
            onFocus={setFocusedIdx}
            onKeyDown={makeCardKeyDown}
          />
        </div>
      )}

      {/* Main grid */}
      {unpinnedProjects.length > 0 && (
        <div className="flex flex-col gap-2">
          {pinnedProjects.length > 0 && (
            <span className="text-xs text-gray-600 font-medium px-1">All projects</span>
          )}
          <ProjectGrid
            projects={unpinnedProjects}
            focusedIdx={focusedIdx}
            cardRefs={cardRefs}
            idxOffset={pinnedProjects.length}
            showShortcuts={showShortcuts}
            onNavigate={(p) => navigate(`/projects/${p.id}`)}
            onContextMenu={openCardMenu}
            onFocus={setFocusedIdx}
            onKeyDown={makeCardKeyDown}
          />
        </div>
      )}

      {/* Ignored section */}
      {ignoredProjects.length > 0 && (
        <div className="flex flex-col gap-2 mt-2">
          <button
            onClick={() => setIgnoredOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            {ignoredOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <span>Ignored ({ignoredProjects.length})</span>
          </button>
          {ignoredOpen && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 opacity-50">
              {ignoredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  focused={false}
                  cardRef={() => {}}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  onContextMenu={(e) => openCardMenu(e, project)}
                  onFocus={() => {}}
                  onKeyDown={() => {}}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {cardMenu && (
        <ProjectCardMenu
          menu={cardMenu}
          onIgnore={handleIgnore}
          onPin={handlePin}
          onClose={() => setCardMenu(null)}
        />
      )}

      {newProjectOpen && (
        <NewProjectModal
          onClose={(newId) => {
            setNewProjectOpen(false);
            qc.invalidateQueries({ queryKey: ['projects'] });
            if (newId) navigate(`/projects/${newId}`);
          }}
        />
      )}

      {globalSettingsOpen && (
        <GlobalSettingsModal onClose={() => setGlobalSettingsOpen(false)} />
      )}
    </div>
  );
}
