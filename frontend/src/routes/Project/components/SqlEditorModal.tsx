import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Editor from '@monaco-editor/react';
import { api } from '../../../lib/api';

interface Props {
  projectId: number;
  uniqueId: string;
  onClose: () => void;
}

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'sql') return 'sql';
  if (ext === 'yml' || ext === 'yaml') return 'yaml';
  if (ext === 'md') return 'markdown';
  if (ext === 'py') return 'python';
  if (ext === 'json') return 'json';
  return 'sql'; // default for dbt models
}

export default function SqlEditorModal({ projectId, uniqueId, onClose }: Props) {
  const qc = useQueryClient();
  const [edited, setEdited] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['sql', projectId, uniqueId],
    queryFn: () => api.models.sql(projectId, uniqueId),
  });

  const content = edited ?? data?.content ?? '';
  const language = data?.path ? detectLanguage(data.path) : 'sql';
  const isDirty = edited !== undefined && edited !== data?.content;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await api.models.saveSql(projectId, uniqueId, content);
      qc.invalidateQueries({ queryKey: ['sql', projectId, uniqueId] });
      setEdited(undefined);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  // Cmd/Ctrl+S to save
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (isDirty) handleSave();
    }
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gray-950"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-mono text-gray-400 truncate">
            {data?.path ?? uniqueId}
          </span>
          {isDirty && (
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" title="Unsaved changes" />
          )}
          <span className="text-[10px] text-gray-600 uppercase tracking-wider shrink-0">
            {language}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {saveError && <span className="text-xs text-red-400">{saveError}</span>}
          {saved && <span className="text-xs text-emerald-400">Saved ✓</span>}
          <span className="text-[10px] text-gray-600 hidden sm:inline">⌘S to save · Esc to close</span>
          <button
            onClick={handleSave}
            disabled={saving || isLoading || !isDirty}
            className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            className="px-2 py-1.5 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* Editor — full remaining height */}
      <div className="flex-1 min-h-0">
        {isLoading && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Loading…
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-full text-red-400 text-sm">
            {String(error)}
          </div>
        )}
        {!isLoading && !error && (
          <Editor
            language={language}
            value={content}
            onChange={(v) => setEdited(v ?? '')}
            theme="vs-dark"
            options={{
              fontSize: 14,
              fontFamily: 'Menlo, Monaco, "Courier New", monospace',
              lineNumbers: 'on',
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              wordWrap: 'off',
              tabSize: 2,
              automaticLayout: true,
              renderLineHighlight: 'all',
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true, indentation: true },
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              folding: true,
              renderWhitespace: 'selection',
              padding: { top: 12 },
            }}
          />
        )}
      </div>
    </div>
  );
}
