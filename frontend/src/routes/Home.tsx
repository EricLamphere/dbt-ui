import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api, type Project } from '../lib/api';
import NewProjectModal from './Project/components/NewProjectModal';
import { GlobalSettingsModal } from '../components/GlobalSettingsModal';

const PLATFORM_ICONS: Record<string, string> = {
  postgres: '🐘',
  bigquery: '☁️',
  snowflake: '❄️',
  redshift: '🔴',
  duckdb: '🦆',
  spark: '⚡',
  databricks: '🧱',
  athena: '🦉',
  trino: '🔷',
  clickhouse: '🏡',
  unknown: '⬡',
};

function PlatformBadge({ platform }: { platform: string }) {
  const icon = PLATFORM_ICONS[platform.toLowerCase()] ?? PLATFORM_ICONS.unknown;
  return (
    <span className="flex items-center gap-1 text-xs text-gray-400 bg-surface-elevated px-2 py-0.5 rounded-full">
      <span>{icon}</span>
      <span className="capitalize">{platform}</span>
    </span>
  );
}

interface ProjectCardProps {
  project: Project;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function ProjectCard({ project, onClick, onContextMenu }: ProjectCardProps) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="w-full flex items-center justify-between bg-surface-panel border border-gray-800 rounded-xl px-5 py-4 hover:border-brand-700 hover:bg-surface-elevated/60 transition-colors text-left"
    >
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-100">{project.name}</span>
          <PlatformBadge platform={project.platform} />
        </div>
        <span className="text-xs text-gray-500 truncate font-mono">{project.path}</span>
      </div>
      <svg className="w-4 h-4 text-gray-600 shrink-0 ml-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

interface CardMenuState {
  id: number;
  x: number;
  y: number;
  isIgnored: boolean;
}

interface ProjectCardMenuProps {
  menu: CardMenuState;
  onIgnore: (id: number, ignored: boolean) => void;
  onClose: () => void;
}

function ProjectCardMenu({ menu, onIgnore, onClose }: ProjectCardMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Clamp to viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(menu.y, window.innerHeight - 80),
    left: Math.min(menu.x, window.innerWidth - 160),
    zIndex: 50,
  };

  return (
    <div ref={ref} style={style} className="bg-surface-panel border border-gray-700 rounded-lg shadow-xl py-1 w-36">
      <button
        onClick={() => { onIgnore(menu.id, !menu.isIgnored); onClose(); }}
        className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-surface-elevated transition-colors"
      >
        {menu.isIgnored ? 'Un-ignore' : 'Ignore'}
      </button>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [ignoredOpen, setIgnoredOpen] = useState(false);
  const [cardMenu, setCardMenu] = useState<CardMenuState | null>(null);

  const { data: appSettings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => api.settings.get(),
  });

  const isConfigured = appSettings?.configured ?? true;

  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: api.projects.list,
    enabled: isConfigured,
  });

  useEffect(() => {
    const handler = () => {
      if (!isConfigured) {
        setGlobalSettingsOpen(true);
      } else {
        setNewProjectOpen(true);
      }
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

  const platforms = Array.from(new Set(activeProjects.map((p) => p.platform))).sort();

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

  const openCardMenu = (e: React.MouseEvent, project: Project) => {
    e.preventDefault();
    setCardMenu({ id: project.id, x: e.clientX, y: e.clientY, isIgnored: project.ignored });
  };

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-6 max-w-5xl mx-auto w-full">

      {/* Configuration required banner */}
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

      {/* Toolbar */}
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
        <button
          onClick={handleRescan}
          disabled={!isConfigured}
          className="px-3 py-2 text-sm rounded-lg bg-surface-elevated hover:bg-gray-700 text-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ↻ Rescan
        </button>
      </div>

      {/* Project list */}
      {isLoading && isConfigured && (
        <p className="text-gray-500 text-sm">Discovering projects…</p>
      )}
      {error && (
        <p className="text-red-400 text-sm">Error: {String(error)}</p>
      )}
      {isConfigured && !isLoading && activeFiltered.length === 0 && ignoredProjects.length === 0 && (
        <div className="text-center py-16 text-gray-600">
          <p className="text-lg mb-2">No dbt projects found</p>
          <p className="text-xs font-mono text-gray-700">{appSettings?.dbt_projects_path}</p>
        </div>
      )}

      <div className="grid gap-3">
        {activeFiltered.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            onClick={() => navigate(`/projects/${project.id}`)}
            onContextMenu={(e) => openCardMenu(e, project)}
          />
        ))}
      </div>

      {/* Ignored section */}
      {ignoredProjects.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setIgnoredOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            {ignoredOpen
              ? <ChevronDown className="w-3 h-3" />
              : <ChevronRight className="w-3 h-3" />
            }
            <span>Ignored ({ignoredProjects.length})</span>
          </button>
          {ignoredOpen && (
            <div className="grid gap-2 opacity-50">
              {ignoredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  onContextMenu={(e) => openCardMenu(e, project)}
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

