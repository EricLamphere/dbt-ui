import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { api, type GlobalProfileDto } from '../lib/api';

export function GlobalSettingsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: appSettings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => api.settings.get(),
  });

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const rows: { key: string; label: string; value: string | null | undefined; hint?: string; example?: string }[] = [
    { key: 'dbt_projects_path', label: 'DBT_UI_PROJECTS_PATH', value: appSettings?.dbt_projects_path, example: '/home/user/dbt-projects' },
    { key: 'global_requirements_path', label: 'DBT_UI_GLOBAL_REQUIREMENTS_PATH', value: appSettings?.global_requirements_path, hint: 'requirements.txt installed via Run global setup', example: '/home/user/dbt-projects/requirements.txt' },
    { key: 'data_dir', label: 'DBT_UI_DATA_DIR', value: appSettings?.data_dir, hint: 'takes effect on restart', example: 'data/' },
    { key: 'log_level', label: 'DBT_UI_LOG_LEVEL', value: appSettings?.log_level, hint: 'takes effect on restart', example: 'INFO' },
  ];

  const handleSave = async (key: string) => {
    setSaving(true);
    try {
      await api.settings.update({ [key]: editValue });
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

        <div className="p-5 flex flex-col gap-6 overflow-auto">
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Settings</h3>
            <p className="text-xs text-gray-500">Configuration shared across all projects.</p>
            <div className="flex flex-col gap-1.5">
              {!appSettings && <p className="text-xs text-gray-600">Loading…</p>}
              {rows.map(({ key, label, value, hint, example }) => (
                <div key={key} className="flex items-center gap-2 px-3 py-2 bg-surface-elevated rounded border border-gray-800 text-xs">
                  <div className="w-60 shrink-0">
                    <span className="font-mono text-brand-300 truncate block">{label}</span>
                    {hint && <span className="text-gray-600 italic">{hint}</span>}
                  </div>
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
                        placeholder={example ? `e.g. ${example}` : undefined}
                        className="flex-1 bg-surface-panel border border-brand-500 rounded px-2 py-0.5 text-gray-100 font-mono focus:outline-none placeholder-gray-600"
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
                      {value ?? <span className="text-gray-600 italic">{example ? `e.g. ${example}` : 'not set'}</span>}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-800" />
          <GlobalProfilesSection />
        </div>

        <div className="flex justify-end px-5 py-4 border-t border-gray-800 shrink-0">
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

function GlobalProfilesSection() {
  const qc = useQueryClient();
  const { data: profiles = [] } = useQuery({
    queryKey: ['global-profiles'],
    queryFn: () => api.globalProfiles.list(),
  });

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await api.globalProfiles.create(name);
      setNewName('');
      qc.invalidateQueries({ queryKey: ['global-profiles'] });
    } catch (e) {
      alert(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (profile: GlobalProfileDto) => {
    if (!confirm(`Delete global profile '${profile.name}'? Projects that already imported it are unaffected.`)) return;
    try {
      await api.globalProfiles.delete(profile.id);
      qc.invalidateQueries({ queryKey: ['global-profiles'] });
    } catch (e) {
      alert(String(e));
    }
  };

  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Global Profiles</h3>
        <p className="text-xs text-gray-500">Reusable env var templates. Import into any project to copy the vars as a local profile.</p>
      </div>

      <div className="flex flex-col gap-2">
        {profiles.map((profile) => (
          <GlobalProfileCard
            key={profile.id}
            profile={profile}
            expanded={expanded.has(profile.id)}
            onToggle={() => toggleExpand(profile.id)}
            onDelete={() => handleDelete(profile)}
          />
        ))}
        {profiles.length === 0 && (
          <p className="text-xs text-gray-600 italic">No global profiles yet.</p>
        )}
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
      </div>
    </div>
  );
}

interface GlobalProfileCardProps {
  profile: GlobalProfileDto;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}

function GlobalProfileCard({ profile, expanded, onToggle, onDelete }: GlobalProfileCardProps) {
  const qc = useQueryClient();
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [savingVar, setSavingVar] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleAddVar = async () => {
    const key = newKey.trim();
    if (!key) return;
    setSavingVar(true);
    try {
      await api.globalProfiles.setVar(profile.id, key, newValue);
      setNewKey('');
      setNewValue('');
      qc.invalidateQueries({ queryKey: ['global-profiles'] });
    } catch (e) {
      alert(String(e));
    } finally {
      setSavingVar(false);
    }
  };

  const handleEditSave = async (key: string) => {
    try {
      await api.globalProfiles.setVar(profile.id, key, editValue);
      setEditingKey(null);
      qc.invalidateQueries({ queryKey: ['global-profiles'] });
    } catch (e) {
      alert(String(e));
    }
  };

  const handleDeleteVar = async (key: string) => {
    try {
      await api.globalProfiles.deleteVar(profile.id, key);
      qc.invalidateQueries({ queryKey: ['global-profiles'] });
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5 bg-surface-panel">
        <button onClick={onToggle} className="text-gray-600 hover:text-gray-400 shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <span className="flex-1 text-sm text-gray-200 font-medium">{profile.name}</span>
        <span className="text-xs text-gray-600">{profile.vars.length} var{profile.vars.length !== 1 ? 's' : ''}</span>
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
