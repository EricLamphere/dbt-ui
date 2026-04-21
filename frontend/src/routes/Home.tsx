import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api } from '../lib/api';
import NewProjectModal from './Project/components/NewProjectModal';

const PLATFORM_ICONS: Record<string, string> = {
  postgres: '🐘',
  bigquery: '☁️',
  snowflake: '❄️',
  redshift: '⬡',
  duckdb: '🦆',
  spark: '⚡',
  databricks: '🧱',
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

export default function Home() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);

  const { data: appSettings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => api.settings.get(),
  });

  const isConfigured = appSettings?.configured ?? true; // optimistic until loaded

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

  useEffect(() => {
    const handler = () => setGlobalSettingsOpen(true);
    window.addEventListener('dbt-ui:global-settings', handler);
    return () => window.removeEventListener('dbt-ui:global-settings', handler);
  }, []);

  const filtered = projects.filter((p) => {
    const matchName = p.name.toLowerCase().includes(search.toLowerCase());
    const matchPlatform = !platformFilter || p.platform === platformFilter;
    return matchName && matchPlatform;
  });

  const platforms = Array.from(new Set(projects.map((p) => p.platform))).sort();

  const handleRescan = async () => {
    await api.projects.rescan();
    qc.invalidateQueries({ queryKey: ['projects'] });
  };

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-6 max-w-5xl mx-auto w-full">

      {/* Configuration required banner */}
      {appSettings && !isConfigured && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 bg-amber-950/40 border border-amber-800/60 rounded-lg">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-amber-300">DBT_PROJECTS_PATH is not set</p>
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
      {isConfigured && !isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-gray-600">
          <p className="text-lg mb-2">No dbt projects found</p>
          <p className="text-xs font-mono text-gray-700">{appSettings?.dbt_projects_path}</p>
        </div>
      )}

      <div className="grid gap-3">
        {filtered.map((project) => (
          <button
            key={project.id}
            onClick={() => navigate(`/projects/${project.id}`)}
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
        ))}
      </div>

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

function GlobalSettingsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: appSettings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => api.settings.get(),
  });

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const rows: { key: string; label: string; value: string | undefined }[] = [
    { key: 'dbt_projects_path', label: 'DBT_PROJECTS_PATH', value: appSettings?.dbt_projects_path },
  ];

  const handleSave = async (key: string) => {
    if (key !== 'dbt_projects_path') return;
    setSaving(true);
    try {
      await api.settings.update({ dbt_projects_path: editValue });
      setEditingKey(null);
      qc.invalidateQueries({ queryKey: ['app-settings'] });
    } catch (e) {
      alert(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-panel border border-gray-700 rounded-lg shadow-2xl w-[900px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-200">Global Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <p className="text-xs text-gray-500">Configuration shared across all projects.</p>
          <div className="flex flex-col gap-1.5">
            {!appSettings && <p className="text-xs text-gray-600">Loading…</p>}
            {rows.map(({ key, label, value }) => (
              <div key={key} className="flex items-center gap-2 px-3 py-2 bg-surface-elevated rounded border border-gray-800 text-xs">
                <span className="font-mono text-brand-300 w-44 shrink-0 truncate">{label}</span>
                <span className="text-gray-600">=</span>
                {editingKey === key ? (
                  <>
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSave(key);
                        if (e.key === 'Escape') setEditingKey(null);
                      }}
                      className="flex-1 bg-surface-panel border border-brand-500 rounded px-2 py-0.5 text-gray-100 font-mono focus:outline-none"
                    />
                    <button
                      onClick={() => handleSave(key)}
                      disabled={saving}
                      className="text-brand-400 hover:text-brand-300 p-1 disabled:opacity-40"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setEditingKey(null)} className="text-gray-600 hover:text-gray-400 p-1">✕</button>
                  </>
                ) : (
                  <span
                    className="flex-1 font-mono text-gray-300 truncate cursor-pointer hover:text-gray-100"
                    onClick={() => { setEditingKey(key); setEditValue(value ?? ''); }}
                  >
                    {value ?? <span className="text-gray-600 italic">not set</span>}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end px-5 py-4 border-t border-gray-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded bg-surface-elevated hover:bg-gray-700 text-gray-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
