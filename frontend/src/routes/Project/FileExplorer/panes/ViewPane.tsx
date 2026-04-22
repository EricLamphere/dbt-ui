import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { RotateCw } from 'lucide-react';
import { format as sqlFormat } from 'sql-formatter';
import { api, type FileContentDto } from '../../../../lib/api';

type ViewTab = 'code' | 'compiled' | 'preview';

interface ViewPaneProps {
  projectId: number;
  openFile: FileContentDto;
  edited: string | undefined;
  onEdit: (value: string) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  saveStatus: 'idle' | 'saved' | 'error';
  saveError: string;
  isDirty: boolean;
  /** unique_id of the model this file belongs to, if known */
  modelUid: string | null;
}

function isSqlFile(path: string) {
  return path.endsWith('.sql');
}

function isJsonFile(path: string) {
  return path.endsWith('.json');
}

function formatSql(sql: string): string {
  // Mask Jinja expressions/blocks so sql-formatter doesn't break them
  const tokens: string[] = [];
  let idx = 0;
  const masked = sql.replace(/(\{\{[\s\S]*?\}\}|\{%-?[\s\S]*?-?%\}|\{#[\s\S]*?#\})/g, (match) => {
    const placeholder = `__JINJA_${idx++}__`;
    tokens.push(match);
    return placeholder;
  });

  let formatted: string;
  try {
    formatted = sqlFormat(masked, { language: 'sql', tabWidth: 4, keywordCase: 'lower' });
  } catch {
    return sql; // fallback to original on error
  }

  // Restore Jinja tokens
  return formatted.replace(/__JINJA_(\d+)__/g, (_, i) => tokens[Number(i)] ?? '');
}

export function ViewPane({
  projectId, openFile, edited, onEdit, onSave, onDelete,
  saving, saveStatus, saveError, isDirty, modelUid,
}: ViewPaneProps) {
  const [activeTab, setActiveTab] = useState<ViewTab>('code');
  const [compiledSql, setCompiledSql] = useState<string | null>(null);
  const [compiledLoading, setCompiledLoading] = useState(false);
  const [compiledError, setCompiledError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{ columns: string[]; rows: unknown[][] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const canCompile = !!modelUid && isSqlFile(openFile.path);

  // Reset sub-tabs when file changes
  useEffect(() => {
    setActiveTab('code');
    setCompiledSql(null);
    setPreviewData(null);
    setCompiledError(null);
    setPreviewError(null);
  }, [openFile.path]);

  const fetchCompiledSql = async () => {
    if (!canCompile || !modelUid) return;
    setCompiledLoading(true);
    setCompiledError(null);
    try {
      const result = await api.models.getCompiled(projectId, modelUid);
      setCompiledSql(result.compiled_sql);
    } catch (e) {
      setCompiledError(String(e));
    } finally {
      setCompiledLoading(false);
    }
  };

  const handleRefreshCompiled = async () => {
    if (!canCompile || !modelUid) return;
    setCompiledSql(null);
    setCompiledLoading(true);
    setCompiledError(null);
    try {
      await api.models.compile(projectId);
      const result = await api.models.getCompiled(projectId, modelUid);
      setCompiledSql(result.compiled_sql);
    } catch (e) {
      setCompiledError(String(e));
    } finally {
      setCompiledLoading(false);
    }
  };

  const handleTabChange = async (tab: ViewTab) => {
    setActiveTab(tab);
    if (tab === 'compiled' && !compiledSql && canCompile && modelUid) {
      await fetchCompiledSql();
    }
    if (tab === 'preview' && !previewData && canCompile && modelUid) {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const result = await api.models.show(projectId, modelUid, 1000);
        setPreviewData(result);
      } catch (e) {
        setPreviewError(String(e));
      } finally {
        setPreviewLoading(false);
      }
    }
  };

  const handleFormat = () => {
    const current = edited ?? openFile.content;
    if (isSqlFile(openFile.path)) {
      onEdit(formatSql(current));
    } else if (isJsonFile(openFile.path)) {
      try {
        onEdit(JSON.stringify(JSON.parse(current), null, 2));
      } catch {
        // not valid JSON, leave as-is
      }
    }
  };

  const canFormat = isSqlFile(openFile.path) || isJsonFile(openFile.path);

  const tabs: { id: ViewTab; label: string; disabled?: boolean }[] = [
    { id: 'code', label: 'Code' },
    { id: 'compiled', label: 'Compiled SQL', disabled: !canCompile },
    { id: 'preview', label: 'Data Preview', disabled: !canCompile },
  ];

  return (
    <div className="flex flex-col overflow-hidden h-full">
      {/* Tab bar + actions */}
      <div className="flex items-center justify-between px-4 py-2 bg-surface-panel border-b border-gray-800 shrink-0 gap-3">
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => !t.disabled && handleTabChange(t.id)}
              disabled={t.disabled}
              className={`px-3 py-1 text-xs rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed
                ${activeTab === t.id
                  ? 'bg-brand-900/50 text-brand-300'
                  : 'text-gray-500 hover:text-gray-300'
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'code' && (
          <div className="flex items-center gap-2 shrink-0">
            {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-brand-400 shrink-0" />}
            {saveStatus === 'error' && (
              <span className="text-xs text-red-400">{saveError}</span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-xs text-emerald-400">Saved ✓</span>
            )}
            {canFormat && (
              <button
                onClick={handleFormat}
                className="px-2 py-1 text-xs rounded bg-surface-elevated hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
                title="Format file"
              >
                Format
              </button>
            )}
            <button
              onClick={onSave}
              disabled={saving || !isDirty}
              className="px-3 py-1 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={onDelete}
              className="px-2 py-1 text-xs rounded bg-surface-elevated hover:bg-red-900/60 text-gray-500 hover:text-red-400 transition-colors"
              title="Delete file"
            >
              🗑
            </button>
          </div>
        )}
        {activeTab === 'compiled' && canCompile && (
          <button
            onClick={handleRefreshCompiled}
            disabled={compiledLoading}
            className="ml-auto flex items-center gap-1.5 px-2 py-1 text-xs rounded bg-surface-elevated hover:bg-gray-700 text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors shrink-0"
            title="Recompile and refresh"
          >
            <RotateCw className={`w-3 h-3 ${compiledLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'code' && (
          <Editor
            key={openFile.path}
            language={openFile.language}
            value={edited ?? openFile.content}
            onChange={(v) => onEdit(v ?? '')}
            theme="vs-dark"
            options={{
              fontSize: 13,
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
              padding: { top: 12 },
            }}
          />
        )}

        {activeTab === 'compiled' && (
          <div className="h-full">
            {compiledLoading && (
              <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                Compiling…
              </div>
            )}
            {compiledError && (
              <div className="flex items-center justify-center h-full text-red-400 text-sm px-8 text-center">
                {compiledError}
              </div>
            )}
            {!compiledLoading && !compiledError && compiledSql && (
              <Editor
                key={`compiled-${openFile.path}`}
                language="sql"
                value={compiledSql}
                theme="vs-dark"
                options={{
                  fontSize: 13,
                  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                  lineNumbers: 'on',
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  readOnly: true,
                  automaticLayout: true,
                  padding: { top: 12 },
                }}
              />
            )}
          </div>
        )}

        {activeTab === 'preview' && (
          <div className="h-full overflow-auto">
            {previewLoading && (
              <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                Running dbt show…
              </div>
            )}
            {previewError && (
              <div className="flex items-center justify-center h-full text-red-400 text-sm px-8 text-center">
                {previewError}
              </div>
            )}
            {!previewLoading && !previewError && previewData && (
              <table className="w-full text-xs text-gray-300 border-collapse">
                <thead>
                  <tr className="bg-surface-elevated sticky top-0">
                    {previewData.columns.map((col) => (
                      <th key={col} className="px-3 py-2 text-left text-gray-400 font-medium border-b border-gray-800 whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.rows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-800/50 hover:bg-surface-elevated/30">
                      {(row as unknown[]).map((cell, j) => (
                        <td key={j} className="px-3 py-1.5 font-mono whitespace-nowrap">{String(cell ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!previewLoading && !previewError && previewData && previewData.rows.length === 0 && (
              <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                No rows returned
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
