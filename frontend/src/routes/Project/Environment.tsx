import { useRef, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, Trash2, Check, Lock, Download } from 'lucide-react';
import { api, type EnvVarDto, type ProfileDto, type Project } from '../../lib/api';
import ProjectNav from './components/ProjectNav';

// ---- Collapsible tile wrapper ----

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-surface-panel hover:bg-surface-elevated/40 transition-colors text-left"
      >
        {open
          ? <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
          : <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
        }
        <span className="text-sm font-semibold text-gray-200">{title}</span>
      </button>
      {open && (
        <div className="border-t border-gray-800 p-6 flex flex-col gap-6 bg-surface-app">
          {children}
        </div>
      )}
    </div>
  );
}

export default function EnvironmentPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);

  const [navWidth, setNavWidth] = useState(192);
  const navResizing = useRef(false);

  const { data: appSettings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => api.settings.get(),
  });

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.projects.get(id),
  });

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (navResizing.current) setNavWidth((w) => Math.max(120, Math.min(320, w + e.movementX)));
    };
    const onMouseUp = () => { navResizing.current = false; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      <div style={{ width: navWidth }} className="shrink-0 bg-surface-panel border-r border-gray-800 flex flex-col overflow-hidden relative">
        <ProjectNav projectId={id} current="environment" />
        <div
          onMouseDown={() => { navResizing.current = true; }}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-brand-500/40 transition-colors"
        />
      </div>

      <div className="flex-1 overflow-auto p-6 flex flex-col gap-4">
        <Tile title="Settings">
          <GlobalSettingsSection appSettings={appSettings ?? null} />
          <ProjectSettingsSection projectId={id} project={project ?? null} />
        </Tile>

        <Tile title="Environment">
          <EnvironmentVariablesSection projectId={id} />
          <ProfilesSection projectId={id} />
        </Tile>
      </div>
    </div>
  );
}

// ---- Global Settings ----

function GlobalSettingsSection({ appSettings }: { appSettings: { dbt_projects_path: string | null; data_dir: string | null; log_level: string | null; global_requirements_path: string | null } | null }) {
  const rows: { label: string; value: string | null | undefined; example?: string }[] = [
    { label: 'DBT_UI_PROJECTS_PATH', value: appSettings?.dbt_projects_path, example: '/home/user/dbt-projects' },
    { label: 'DBT_UI_GLOBAL_REQUIREMENTS_PATH', value: appSettings?.global_requirements_path, example: '/home/user/dbt-projects/requirements.txt' },
    { label: 'DBT_UI_DATA_DIR', value: appSettings?.data_dir, example: 'data/' },
    { label: 'DBT_UI_LOG_LEVEL', value: appSettings?.log_level, example: 'INFO' },
  ];

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Global</h3>
      <p className="text-xs text-gray-500 mb-3">System-level configuration shared across all projects. Edit via the Global Settings panel.</p>
      <div className="flex flex-col gap-1.5">
        {!appSettings && <p className="text-xs text-gray-600 italic">Loading…</p>}
        {appSettings && rows.map(({ label, value, example }) => (
          <div key={label} className="flex items-center gap-2 px-3 py-2 bg-surface-panel rounded border border-gray-800/60 text-xs opacity-75">
            <Lock className="w-3 h-3 text-gray-600 shrink-0" />
            <span className="font-mono text-gray-500 w-48 shrink-0 truncate">{label}</span>
            <span className="text-gray-600">=</span>
            <span className="flex-1 font-mono text-gray-400 truncate">
              {value ?? <span className="italic text-gray-600">{example ? `e.g. ${example}` : 'not set'}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Project Settings ----

interface ProjectSettingRowProps {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (val: string) => Promise<void>;
}

function ProjectSettingRow({ label, value, placeholder, onSave }: ProjectSettingRowProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const handleClick = () => {
    setEditValue(value);
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(editValue.trim());
      setEditing(false);
    } catch (e) {
      alert(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-surface-panel rounded border border-gray-800 text-xs">
      <span className="font-mono text-brand-300 w-44 shrink-0 truncate">{label}</span>
      <span className="text-gray-600">=</span>
      {editing ? (
        <>
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') setEditing(false);
            }}
            placeholder={placeholder}
            className="flex-1 bg-surface-elevated border border-brand-500 rounded px-2 py-0.5 text-gray-100 font-mono focus:outline-none"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-brand-400 hover:text-brand-300 p-1 disabled:opacity-40"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setEditing(false)} className="text-gray-600 hover:text-gray-400 p-1 text-xs">✕</button>
        </>
      ) : (
        <span
          className="flex-1 font-mono text-gray-300 truncate cursor-pointer hover:text-gray-100"
          onClick={handleClick}
        >
          {value || <span className="text-gray-600 italic">{placeholder ? `e.g. ${placeholder}` : 'click to set'}</span>}
        </span>
      )}
    </div>
  );
}

function ProjectSettingsSection({ projectId, project }: { projectId: number; project: Project | null }) {
  const qc = useQueryClient();

  const { data: envVars = [] } = useQuery({
    queryKey: ['env-vars', projectId],
    queryFn: () => api.init.getEnvVars(projectId),
  });

  const requirementsPath = envVars.find((v) => v.key === 'REQUIREMENTS_PATH')?.value ?? '';

  const handleSaveInitScriptPath = async (val: string) => {
    await api.projects.updateSettings(projectId, { init_script_path: val || 'init' });
    qc.invalidateQueries({ queryKey: ['project', projectId] });
  };

  const handleSaveRequirementsPath = async (val: string) => {
    if (val) {
      await api.init.setEnvVar(projectId, 'REQUIREMENTS_PATH', val);
    } else {
      await api.init.deleteEnvVar(projectId, 'REQUIREMENTS_PATH');
    }
    qc.invalidateQueries({ queryKey: ['env-vars', projectId] });
    qc.invalidateQueries({ queryKey: ['init-steps', projectId] });
  };

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Project</h3>
      <p className="text-xs text-gray-500 mb-3">Configuration specific to this project. Click a value to edit.</p>
      <div className="flex flex-col gap-1.5">
        {!project ? (
          <p className="text-xs text-gray-600 italic">Loading…</p>
        ) : (
          <>
            <ProjectSettingRow
              label="INIT_SCRIPT_PATH"
              value={project.init_script_path ?? ''}
              placeholder="init"
              onSave={handleSaveInitScriptPath}
            />
            <ProjectSettingRow
              label="REQUIREMENTS_PATH"
              value={requirementsPath}
              placeholder="/path/to/requirements.txt"
              onSave={handleSaveRequirementsPath}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---- Environment Variables ----

function EnvironmentVariablesSection({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { data: envVars = [] } = useQuery({
    queryKey: ['env-vars', projectId],
    queryFn: () => api.init.getEnvVars(projectId),
  });

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleAdd = async () => {
    if (!newKey.trim()) return;
    setSaving(true);
    try {
      await api.init.setEnvVar(projectId, newKey.trim(), newValue);
      setNewKey('');
      setNewValue('');
      qc.invalidateQueries({ queryKey: ['env-vars', projectId] });
    } catch (e) {
      alert(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (key: string) => {
    if (!confirm(`Delete '${key}'?`)) return;
    try {
      await api.init.deleteEnvVar(projectId, key);
      qc.invalidateQueries({ queryKey: ['env-vars', projectId] });
    } catch (e) {
      alert(String(e));
    }
  };

  const handleEditSave = async (key: string) => {
    try {
      await api.init.setEnvVar(projectId, key, editValue);
      setEditingKey(null);
      qc.invalidateQueries({ queryKey: ['env-vars', projectId] });
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Environment Variables</h3>
      <p className="text-xs text-gray-500 mb-3">Applied to all init script runs. Profile variables override these.</p>
      <div className="flex flex-col gap-1.5 mb-3">
        {envVars.length === 0 && (
          <p className="text-xs text-gray-600 italic">No environment variables.</p>
        )}
        {envVars.map((v: EnvVarDto) => (
          <div key={v.key} className="flex items-center gap-2 px-3 py-2 bg-surface-panel rounded border border-gray-800 text-xs">
            <span className="font-mono text-brand-300 w-40 shrink-0 truncate">{v.key}</span>
            <span className="text-gray-600">=</span>
            {editingKey === v.key ? (
              <>
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEditSave(v.key);
                    if (e.key === 'Escape') setEditingKey(null);
                  }}
                  className="flex-1 bg-surface-elevated border border-brand-500 rounded px-2 py-0.5 text-gray-100 font-mono focus:outline-none"
                />
                <button onClick={() => handleEditSave(v.key)} className="text-brand-400 hover:text-brand-300 p-1">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setEditingKey(null)} className="text-gray-600 hover:text-gray-400 p-1 text-xs">✕</button>
              </>
            ) : (
              <>
                <span
                  className="flex-1 font-mono text-gray-300 truncate cursor-pointer hover:text-gray-100"
                  onClick={() => { setEditingKey(v.key); setEditValue(v.value); }}
                >
                  {v.value || <span className="text-gray-600 italic">empty</span>}
                </span>
                <button onClick={() => handleDelete(v.key)} className="text-gray-600 hover:text-red-400 p-1 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          placeholder="KEY"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          className="w-40 bg-surface-elevated border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <span className="text-gray-600 text-xs">=</span>
        <input
          placeholder="value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          className="flex-1 bg-surface-elevated border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <button
          onClick={handleAdd}
          disabled={saving || !newKey.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-40 transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>
    </div>
  );
}

// ---- Profiles ----

function ProfilesSection({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles', projectId],
    queryFn: () => api.profiles.list(projectId),
  });
  const { data: globalProfiles = [] } = useQuery({
    queryKey: ['global-profiles'],
    queryFn: () => api.globalProfiles.list(),
  });

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [activating, setActivating] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.profiles.create(projectId, newName.trim());
      setNewName('');
      qc.invalidateQueries({ queryKey: ['profiles', projectId] });
    } catch (e) {
      alert(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleActivate = async (profile: ProfileDto) => {
    if (profile.is_active) return;
    setActivating(profile.id);
    try {
      await api.profiles.activate(projectId, profile.id);
      qc.invalidateQueries({ queryKey: ['profiles', projectId] });
    } catch (e) {
      alert(String(e));
    } finally {
      setActivating(null);
    }
  };

  const handleDeactivate = async (profile: ProfileDto) => {
    setActivating(profile.id);
    try {
      await api.profiles.deactivate(projectId, profile.id);
      qc.invalidateQueries({ queryKey: ['profiles', projectId] });
    } catch (e) {
      alert(String(e));
    } finally {
      setActivating(null);
    }
  };

  const handleDelete = async (profile: ProfileDto) => {
    if (!confirm(`Delete profile '${profile.name}'?`)) return;
    try {
      await api.profiles.delete(projectId, profile.id);
      qc.invalidateQueries({ queryKey: ['profiles', projectId] });
    } catch (e) {
      alert(String(e));
    }
  };

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = async (globalProfileId: number, name: string) => {
    setImporting(true);
    setImportOpen(false);
    try {
      await api.globalProfiles.importIntoProject(projectId, globalProfileId, name);
      qc.invalidateQueries({ queryKey: ['profiles', projectId] });
    } catch (e) {
      alert(String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Environment Profiles</h3>
      <p className="text-xs text-gray-500 mb-3">Named variable sets — the active profile overrides environment variables during init runs.</p>

      <div className="flex flex-col gap-2 mb-4">
        {profiles.map((profile: ProfileDto) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            projectId={projectId}
            expanded={expanded.has(profile.id)}
            activating={activating === profile.id}
            onToggleExpand={() => toggleExpand(profile.id)}
            onActivate={() => handleActivate(profile)}
            onDeactivate={() => handleDeactivate(profile)}
            onDelete={() => handleDelete(profile)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          placeholder="New profile name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          className="flex-1 bg-surface-elevated border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-40 transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Create
        </button>

        {/* Import from global */}
        <div className="relative shrink-0">
          <button
            onClick={() => setImportOpen((v) => !v)}
            disabled={importing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 disabled:opacity-40 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Import
          </button>
          {importOpen && (
            <div className="absolute bottom-full mb-1 right-0 bg-surface-panel border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px] z-10">
              {globalProfiles.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-600 italic">No global profiles defined.</p>
              ) : (
                globalProfiles.map((gp) => (
                  <button
                    key={gp.id}
                    onClick={() => handleImport(gp.id, gp.name)}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-surface-elevated transition-colors flex items-center justify-between gap-2"
                  >
                    <span>{gp.name}</span>
                    <span className="text-gray-600">{gp.vars.length}v</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ProfileCardProps {
  profile: ProfileDto;
  projectId: number;
  expanded: boolean;
  activating: boolean;
  onToggleExpand: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
}

function ProfileCard({ profile, projectId, expanded, activating, onToggleExpand, onActivate, onDeactivate, onDelete }: ProfileCardProps) {
  const qc = useQueryClient();
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [savingVar, setSavingVar] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleAddVar = async () => {
    if (!newKey.trim()) return;
    setSavingVar(true);
    try {
      await api.profiles.setVar(projectId, profile.id, newKey.trim(), newValue);
      setNewKey('');
      setNewValue('');
      qc.invalidateQueries({ queryKey: ['profiles', projectId] });
    } catch (e) {
      alert(String(e));
    } finally {
      setSavingVar(false);
    }
  };

  const handleDeleteVar = async (key: string) => {
    try {
      await api.profiles.deleteVar(projectId, profile.id, key);
      qc.invalidateQueries({ queryKey: ['profiles', projectId] });
    } catch (e) {
      alert(String(e));
    }
  };

  const handleEditSave = async (key: string) => {
    try {
      await api.profiles.setVar(projectId, profile.id, key, editValue);
      setEditingKey(null);
      qc.invalidateQueries({ queryKey: ['profiles', projectId] });
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5 bg-surface-panel">
        <button onClick={onToggleExpand} className="text-gray-600 hover:text-gray-400 shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <span className="flex-1 text-sm text-gray-200 font-medium">{profile.name}</span>
        {profile.is_default && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-elevated text-gray-500 font-mono">default</span>
        )}
        {profile.is_active && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-900/60 text-brand-300 font-mono">active</span>
        )}
        <span className="text-xs text-gray-600">{profile.vars.length} var{profile.vars.length !== 1 ? 's' : ''}</span>
        {profile.is_active ? (
          <button
            onClick={onDeactivate}
            disabled={activating}
            className="px-2.5 py-1 text-xs rounded border border-gray-700 text-gray-500 hover:border-red-700 hover:text-red-400 transition-colors disabled:opacity-40 shrink-0"
          >
            Deactivate
          </button>
        ) : (
          <button
            onClick={onActivate}
            disabled={activating}
            className="px-2.5 py-1 text-xs rounded border border-gray-700 text-gray-400 hover:border-brand-600 hover:text-brand-300 transition-colors disabled:opacity-40 shrink-0"
          >
            {activating ? '…' : 'Activate'}
          </button>
        )}
        <button onClick={onDelete} className="text-gray-600 hover:text-red-400 p-1 shrink-0">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="bg-surface-app border-t border-gray-800 p-3 flex flex-col gap-2">
          {profile.vars.length === 0 && (
            <p className="text-xs text-gray-600 italic">No variables.</p>
          )}
          {profile.vars.map((v) => (
            <div key={v.key} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-brand-300 w-36 shrink-0 truncate">{v.key}</span>
              <span className="text-gray-600">=</span>
              {editingKey === v.key ? (
                <>
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleEditSave(v.key);
                      if (e.key === 'Escape') setEditingKey(null);
                    }}
                    className="flex-1 bg-surface-elevated border border-brand-500 rounded px-2 py-0.5 text-gray-100 font-mono focus:outline-none"
                  />
                  <button onClick={() => handleEditSave(v.key)} className="text-brand-400 hover:text-brand-300 p-1">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditingKey(null)} className="text-gray-600 hover:text-gray-400 p-1">✕</button>
                </>
              ) : (
                <>
                  <span
                    className="flex-1 font-mono text-gray-300 truncate cursor-pointer hover:text-gray-100"
                    onClick={() => { setEditingKey(v.key); setEditValue(v.value); }}
                  >
                    {v.value || <span className="text-gray-600 italic">empty</span>}
                  </span>
                  <button onClick={() => handleDeleteVar(v.key)} className="text-gray-600 hover:text-red-400 p-1 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}

          <div className="flex items-center gap-2 mt-1">
            <input
              placeholder="KEY"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddVar(); }}
              className="w-36 bg-surface-elevated border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <span className="text-gray-600 text-xs">=</span>
            <input
              placeholder="value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddVar(); }}
              className="flex-1 bg-surface-elevated border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <button
              onClick={handleAddVar}
              disabled={savingVar || !newKey.trim()}
              className="px-2.5 py-1 text-xs rounded bg-surface-elevated hover:bg-gray-700 text-gray-300 border border-gray-700 disabled:opacity-40 transition-colors shrink-0"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
