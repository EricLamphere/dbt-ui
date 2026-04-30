import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, Trash2, Check } from 'lucide-react';
import { api, type EnvVarDto, type Project } from '../../lib/api';
import NavRail from './components/NavRail';

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

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.projects.get(id),
  });

  return (
    <div className="flex h-full overflow-hidden">
      <NavRail projectId={id} current="environment" />

      <div className="flex-1 overflow-auto p-6 flex flex-col gap-4">
        <Tile title="Settings">
          <ProjectSettingsSection projectId={id} project={project ?? null} />
        </Tile>

        <Tile title="Environment">
          <GlobalProfileSelector projectId={id} />
          <EnvironmentVariablesSection projectId={id} />
        </Tile>
      </div>
    </div>
  );
}

// ---- Global Profile Selector ----

function GlobalProfileSelector({ projectId }: { projectId: number }) {
  const qc = useQueryClient();

  const { data: globalProfiles = [] } = useQuery({
    queryKey: ['global-profiles'],
    queryFn: () => api.globalProfiles.list(),
  });

  const { data: activeData } = useQuery({
    queryKey: ['active-global-profile', projectId],
    queryFn: () => api.globalProfiles.getActiveForProject(projectId),
  });

  const handleChange = async (value: string) => {
    try {
      if (value === '') {
        await api.globalProfiles.clearActiveForProject(projectId);
      } else {
        await api.globalProfiles.setActiveForProject(projectId, Number(value));
      }
      qc.invalidateQueries({ queryKey: ['active-global-profile', projectId] });
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Active Profile</h3>
      <p className="text-xs text-gray-500 mb-3">Global profile whose variables are applied during init runs.</p>
      <select
        value={activeData?.profile_id ?? ''}
        onChange={(e) => handleChange(e.target.value)}
        className="bg-surface-elevated border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
      >
        <option value="">None</option>
        {globalProfiles.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
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
  const workspacePath = envVars.find((v) => v.key === 'WORKSPACE_PATH')?.value ?? '';

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

  const handleSaveWorkspacePath = async (val: string) => {
    if (val) {
      await api.init.setEnvVar(projectId, 'WORKSPACE_PATH', val);
    } else {
      await api.init.deleteEnvVar(projectId, 'WORKSPACE_PATH');
    }
    qc.invalidateQueries({ queryKey: ['env-vars', projectId] });
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
            <ProjectSettingRow
              label="WORKSPACE_PATH"
              value={workspacePath}
              placeholder="workspace"
              onSave={handleSaveWorkspacePath}
            />
          </>
        )}
      </div>
    </div>
  );
}

// Keys managed by other UI sections — excluded from the user-facing env vars list
const RESERVED_ENV_KEYS = new Set(['REQUIREMENTS_PATH', 'WORKSPACE_PATH', 'active_global_profile_id', 'dbt_target']);

// ---- Environment Variables ----

function EnvironmentVariablesSection({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { data: allEnvVars = [] } = useQuery({
    queryKey: ['env-vars', projectId],
    queryFn: () => api.init.getEnvVars(projectId),
  });

  const envVars = allEnvVars.filter((v) => !RESERVED_ENV_KEYS.has(v.key));

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleAdd = async () => {
    if (!newKey.trim() || RESERVED_ENV_KEYS.has(newKey.trim())) return;
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
