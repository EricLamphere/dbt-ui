import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type EnvVarDto } from '../../../../lib/api';

interface SetupPaneProps {
  projectId: number;
}

export function SetupPane({ projectId }: SetupPaneProps) {
  const qc = useQueryClient();
  const { data: envVars = [] } = useQuery({
    queryKey: ['env-vars', projectId],
    queryFn: () => api.init.getEnvVars(projectId),
  });

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [savingNew, setSavingNew] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleAdd = async () => {
    if (!newKey.trim()) return;
    setSavingNew(true);
    try {
      await api.init.setEnvVar(projectId, newKey.trim(), newValue);
      setNewKey('');
      setNewValue('');
      qc.invalidateQueries({ queryKey: ['env-vars', projectId] });
    } catch (e) {
      alert(String(e));
    } finally {
      setSavingNew(false);
    }
  };

  const handleDelete = async (key: string) => {
    if (!confirm(`Delete env var '${key}'?`)) return;
    try {
      await api.init.deleteEnvVar(projectId, key);
      qc.invalidateQueries({ queryKey: ['env-vars', projectId] });
    } catch (e) {
      alert(String(e));
    }
  };

  const startEdit = (v: EnvVarDto) => {
    setEditingKey(v.key);
    setEditValue(v.value);
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
    <div className="p-4 flex flex-col gap-5 overflow-auto">
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Global Environment Variables</h3>
        <p className="text-xs text-gray-600">These variables are set before init scripts run.</p>

        {/* Existing vars */}
        <div className="flex flex-col gap-1">
          {envVars.length === 0 && (
            <p className="text-xs text-gray-600 italic">No variables set.</p>
          )}
          {envVars.map((v) => (
            <div key={v.key} className="flex items-center gap-2 px-3 py-2 bg-surface-elevated rounded text-xs">
              <span className="font-mono text-brand-300 shrink-0">{v.key}</span>
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
                    className="flex-1 bg-surface-app border border-brand-500 rounded px-1.5 py-0.5 text-gray-100 font-mono focus:outline-none"
                  />
                  <button onClick={() => handleEditSave(v.key)} className="text-brand-400 hover:text-brand-300 shrink-0">✓</button>
                  <button onClick={() => setEditingKey(null)} className="text-gray-600 hover:text-gray-400 shrink-0">✕</button>
                </>
              ) : (
                <>
                  <span className="flex-1 font-mono text-gray-300 truncate">{v.value}</span>
                  <button onClick={() => startEdit(v)} className="text-gray-600 hover:text-gray-400 shrink-0">✎</button>
                  <button onClick={() => handleDelete(v.key)} className="text-gray-600 hover:text-red-400 shrink-0">✕</button>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Add new */}
        <div className="flex items-center gap-2">
          <input
            placeholder="KEY"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            className="w-32 bg-surface-elevated border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
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
            disabled={savingNew || !newKey.trim()}
            className="px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-40 transition-colors shrink-0"
          >
            Add
          </button>
        </div>
      </section>
    </div>
  );
}
