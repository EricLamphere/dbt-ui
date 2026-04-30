import { useEffect, useRef, useState } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import type * as MonacoEditor from 'monaco-editor';
import { ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { format as sqlFormat } from 'sql-formatter';
import { api, type FileContentDto, type GraphDto } from '../../../../lib/api';
import { useTheme } from '../../../../lib/useTheme';

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
  /** graph data for ref/source link navigation */
  graph: GraphDto | null;
  /** called when a ref/source link is cmd+clicked */
  onNavigateToFile: (path: string) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  /** session-scoped dbt show cache from parent (survives route navigation) */
  previewCache: Map<string, { columns: string[]; rows: unknown[][] }>;
  onPreviewCached: (uid: string, data: { columns: string[]; rows: unknown[][] }) => void;
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
  saving, saveStatus, saveError, isDirty, modelUid, graph, onNavigateToFile,
  canGoBack, canGoForward, onGoBack, onGoForward,
  previewCache, onPreviewCached,
}: ViewPaneProps) {
  const theme = useTheme();
  const monacoTheme = theme === 'light' ? 'vs-light' : 'vs-dark';

  const graphRef = useRef(graph);
  useEffect(() => { graphRef.current = graph; }, [graph]);

  const onNavigateToFileRef = useRef(onNavigateToFile);
  useEffect(() => { onNavigateToFileRef.current = onNavigateToFile; }, [onNavigateToFile]);

  const completionDisposableRef = useRef<MonacoEditor.IDisposable | null>(null);
  useEffect(() => () => { completionDisposableRef.current?.dispose(); }, []);

  const [activeTab, setActiveTab] = useState<ViewTab>('code');
  const [compiledSql, setCompiledSql] = useState<string | null>(null);
  const [compiledLoading, setCompiledLoading] = useState(false);
  const [compiledError, setCompiledError] = useState<string | null>(null);
  const previewData = modelUid ? (previewCache.get(modelUid) ?? null) : null;
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const canCompile = !!modelUid && isSqlFile(openFile.path);

  // Reset sub-tabs when file changes (preview data is in the parent cache, not reset here)
  useEffect(() => {
    setActiveTab('code');
    setCompiledSql(null);
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
      // force=true skips the manifest cache and recompiles just this model synchronously
      const result = await api.models.getCompiled(projectId, modelUid, true);
      setCompiledSql(result.compiled_sql);
    } catch (e) {
      setCompiledError(String(e));
    } finally {
      setCompiledLoading(false);
    }
  };

  const handleRefreshPreview = async () => {
    if (!canCompile || !modelUid) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await api.models.show(projectId, modelUid, 1000);
      onPreviewCached(modelUid, result);
    } catch (e) {
      setPreviewError(String(e));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleTabChange = async (tab: ViewTab) => {
    setActiveTab(tab);
    if (tab === 'compiled' && !compiledSql && canCompile && modelUid) {
      await fetchCompiledSql();
    }
    if (tab === 'preview' && !previewCache.get(modelUid!) && canCompile && modelUid) {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const result = await api.models.show(projectId, modelUid, 1000);
        onPreviewCached(modelUid, result);
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
          <button
            onClick={onGoBack}
            disabled={!canGoBack}
            title="Go back (Alt+Left)"
            className="p-0.5 rounded text-gray-500 hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onGoForward}
            disabled={!canGoForward}
            title="Go forward (Alt+Right)"
            className="p-0.5 rounded text-gray-500 hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors mr-2"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
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
        {activeTab === 'preview' && canCompile && (
          <button
            onClick={handleRefreshPreview}
            disabled={previewLoading}
            className="ml-auto flex items-center gap-1.5 px-2 py-1 text-xs rounded bg-surface-elevated hover:bg-gray-700 text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors shrink-0"
            title="Re-run dbt show"
          >
            <RotateCw className={`w-3 h-3 ${previewLoading ? 'animate-spin' : ''}`} />
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
            theme={monacoTheme}
            onMount={(editor, monacoInstance: Monaco) => {
              type IRange = Monaco['Range'] extends new (...a: infer _) => infer R ? R : never;

              // SQL autocomplete for ref/source/column names
              completionDisposableRef.current?.dispose();
              completionDisposableRef.current = monacoInstance.languages.registerCompletionItemProvider('sql', {
                triggerCharacters: ["'", '"', '.', ' ', ','],
                provideCompletionItems(model: MonacoEditor.editor.ITextModel, position: MonacoEditor.Position) {
                  const graph = graphRef.current;
                  if (!graph) return { suggestions: [] };

                  const word = model.getWordUntilPosition(position);
                  const tokenRange: MonacoEditor.IRange = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: position.column,
                  };

                  const linePrefix = model.getValueInRange({
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: 1,
                    endColumn: position.column,
                  });

                  function rank<T extends { label: string }>(items: T[], typed: string): T[] {
                    const t = typed.toLowerCase();
                    return items
                      .filter((s) => s.label.toLowerCase().startsWith(t))
                      .sort((a, b) => {
                        const al = a.label.toLowerCase();
                        const bl = b.label.toLowerCase();
                        if (al === t) return -1;
                        if (bl === t) return 1;
                        return al.localeCompare(bl);
                      });
                  }

                  function currentStatement(): string {
                    const fullSql = model.getValue();
                    const offset = model.getOffsetAt(position);
                    const before = fullSql.lastIndexOf(';', offset - 1);
                    const after = fullSql.indexOf(';', offset);
                    const start = before === -1 ? 0 : before + 1;
                    const end = after === -1 ? fullSql.length : after;
                    return fullSql.slice(start, end);
                  }

                  function referencedNames(): Set<string> {
                    const stmt = currentStatement();
                    const names = new Set<string>();
                    for (const m of stmt.matchAll(/\{\{\s*ref\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g))
                      names.add(m[1]);
                    for (const m of stmt.matchAll(/\{\{\s*source\s*\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g))
                      names.add(m[1]);
                    return names;
                  }

                  const suggestions: MonacoEditor.languages.CompletionItem[] = [];
                  const g = graph;

                  function nodeDetail(node: (typeof g.nodes)[number]): { detail: string; documentation?: { value: string } } {
                    const parts: string[] = [];
                    if (node.materialized) parts.push(node.materialized);
                    if (node.schema_) parts.push(node.schema_);
                    return {
                      detail: parts.length ? `${parts.join(' · ')} (${node.resource_type})` : node.resource_type,
                      documentation: node.description ? { value: node.description } : undefined,
                    };
                  }

                  const refInnerMatch = linePrefix.match(/\{\{\s*ref\s*\(\s*['"]([^'"]*)?$/);
                  if (refInnerMatch) {
                    const typed = refInnerMatch[1] ?? '';
                    const refable = graph.nodes.filter((n) => ['model', 'seed', 'snapshot'].includes(n.resource_type));
                    for (const { label, node } of rank(refable.map((n) => ({ label: n.name, node: n })), typed)) {
                      const hasError = node.status === 'error' || node.status === 'stale';
                      const { detail, documentation } = nodeDetail(node);
                      suggestions.push({
                        label: hasError ? `${label} ⚠` : label,
                        kind: monacoInstance.languages.CompletionItemKind.Reference,
                        insertText: label,
                        detail,
                        documentation,
                        range: tokenRange,
                        sortText: label,
                      });
                    }
                    return { suggestions };
                  }

                  const sourceInnerMatch = linePrefix.match(/\{\{\s*source\s*\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]*)?$/);
                  if (sourceInnerMatch) {
                    const typed = sourceInnerMatch[1] ?? '';
                    const sources = graph.nodes.filter((n) => n.resource_type === 'source');
                    for (const { label, node } of rank(sources.map((n) => ({ label: n.name, node: n })), typed)) {
                      const { documentation } = nodeDetail(node);
                      suggestions.push({
                        label,
                        kind: monacoInstance.languages.CompletionItemKind.Reference,
                        insertText: label,
                        detail: node.source_name ? `source: ${node.source_name}` : 'source',
                        documentation,
                        range: tokenRange,
                        sortText: label,
                      });
                    }
                    return { suggestions };
                  }

                  const sourceSchemaInnerMatch = linePrefix.match(/\{\{\s*source\s*\(\s*['"]([^'"]*)?$/);
                  if (sourceSchemaInnerMatch) {
                    const typed = sourceSchemaInnerMatch[1] ?? '';
                    const schemaNames = [
                      ...new Set(
                        graph.nodes
                          .filter((n) => n.resource_type === 'source' && n.source_name)
                          .map((n) => n.source_name as string)
                      ),
                    ];
                    for (const { label } of rank(schemaNames.map((s) => ({ label: s })), typed)) {
                      suggestions.push({
                        label,
                        kind: monacoInstance.languages.CompletionItemKind.Module,
                        insertText: label,
                        detail: 'source schema',
                        range: tokenRange,
                        sortText: label,
                      });
                    }
                    return { suggestions };
                  }

                  const tableTrigger = /(?:from|join)\s+\w*$/i.test(linePrefix);
                  if (tableTrigger) {
                    const typed = word.word;
                    const refable = graph.nodes.filter((n) => ['model', 'seed', 'snapshot'].includes(n.resource_type));
                    const sources = graph.nodes.filter((n) => n.resource_type === 'source');

                    for (const { label, node } of rank(refable.map((n) => ({ label: n.name, node: n })), typed)) {
                      const hasError = node.status === 'error' || node.status === 'stale';
                      const { detail, documentation } = nodeDetail(node);
                      suggestions.push({
                        label: hasError ? `${label} ⚠` : label,
                        kind: monacoInstance.languages.CompletionItemKind.Reference,
                        insertText: `{{ ref('${label}') }}`,
                        detail,
                        documentation,
                        range: tokenRange,
                        sortText: `0_${label}`,
                      });
                    }

                    for (const { label, node } of rank(sources.map((n) => ({ label: n.name, node: n })), typed)) {
                      const { documentation } = nodeDetail(node);
                      const schema = node.source_name ?? '';
                      suggestions.push({
                        label,
                        kind: monacoInstance.languages.CompletionItemKind.Reference,
                        insertText: `{{ source('${schema}', '${label}') }}`,
                        detail: schema ? `source: ${schema}` : 'source',
                        documentation,
                        range: tokenRange,
                        sortText: `1_${label}`,
                      });
                    }

                    return { suggestions };
                  }

                  const colTrigger =
                    /(?:select|where|on|and|or|by)\s+\w*$/i.test(linePrefix) ||
                    /,\s*\w*$/.test(linePrefix) ||
                    /\.\w*$/.test(linePrefix);
                  if (colTrigger) {
                    const typed = word.word;
                    const refNames = referencedNames();
                    const scopedNodes = refNames.size > 0
                      ? graph.nodes.filter((n) => refNames.has(n.name))
                      : graph.nodes;

                    const colMap = new Map<string, { dataType: string; description: string; nodeNames: string[] }>();
                    for (const node of scopedNodes) {
                      for (const col of node.columns) {
                        const existing = colMap.get(col.name);
                        if (existing) {
                          existing.nodeNames.push(node.name);
                        } else {
                          colMap.set(col.name, {
                            dataType: col.data_type || '',
                            description: col.description || '',
                            nodeNames: [node.name],
                          });
                        }
                      }
                    }

                    const colItems = [...colMap.entries()].map(([name, meta]) => ({ label: name, meta }));
                    for (const { label, meta } of rank(colItems, typed)) {
                      const detail = [meta.dataType, meta.nodeNames.length > 1 ? `${meta.nodeNames.length} models` : meta.nodeNames[0]]
                        .filter(Boolean).join(' · ');
                      suggestions.push({
                        label,
                        kind: monacoInstance.languages.CompletionItemKind.Field,
                        insertText: label,
                        detail: detail || undefined,
                        documentation: meta.description ? { value: meta.description } : undefined,
                        range: tokenRange,
                        sortText: label,
                      });
                    }
                  }

                  return { suggestions };
                },
              });

              // Compute spans for all ref/source calls in the current model text
              function computeRefSpans(text: string): Array<{ filePath: string; startOffset: number; endOffset: number }> {
                const spans: Array<{ filePath: string; startOffset: number; endOffset: number }> = [];
                const refRe = /ref\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
                let m: RegExpExecArray | null;
                while ((m = refRe.exec(text)) !== null) {
                  const node = graphRef.current?.nodes.find((n) => n.name === m![1] && n.resource_type !== 'source');
                  if (node?.original_file_path) {
                    spans.push({ filePath: node.original_file_path, startOffset: m.index, endOffset: m.index + m[0].length });
                  }
                }
                const srcRe = /source\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;
                while ((m = srcRe.exec(text)) !== null) {
                  const node = graphRef.current?.nodes.find(
                    (n) => n.resource_type === 'source' && n.source_name === m![1] && n.name === m![2]
                  );
                  if (node?.original_file_path) {
                    spans.push({ filePath: node.original_file_path, startOffset: m.index, endOffset: m.index + m[0].length });
                  }
                }
                return spans;
              }

              // Decoration collection for cmd-hover underlines
              let decorations = editor.createDecorationsCollection([]);

              function applyDecorations() {
                const mdl = editor.getModel();
                if (!mdl) return;
                const text = mdl.getValue();
                const spans = computeRefSpans(text);
                const newDecos = spans.map(({ startOffset, endOffset }) => {
                  const start = mdl.getPositionAt(startOffset);
                  const end = mdl.getPositionAt(endOffset);
                  return {
                    range: new monacoInstance.Range(start.lineNumber, start.column, end.lineNumber, end.column) as IRange,
                    options: { inlineClassName: 'dbt-ref-link' },
                  };
                });
                decorations.set(newDecos);
              }

              function clearDecorations() {
                decorations.clear();
              }

              // Track Cmd/Ctrl state on window so releases outside the editor are caught
              const handleWindowKeyDown = (e: KeyboardEvent) => {
                if (e.key === 'Meta' || e.key === 'Control') applyDecorations();
              };
              const handleWindowKeyUp = (e: KeyboardEvent) => {
                if (e.key === 'Meta' || e.key === 'Control') clearDecorations();
              };
              window.addEventListener('keydown', handleWindowKeyDown);
              window.addEventListener('keyup', handleWindowKeyUp);

              // Cmd+click → navigate
              const onMouseDown = editor.onMouseDown((e) => {
                if (!e.event.metaKey && !e.event.ctrlKey) return;
                const pos = e.target.position;
                if (!pos) return;
                const mdl = editor.getModel();
                if (!mdl) return;
                const clickOffset = mdl.getOffsetAt(pos);
                const text = mdl.getValue();
                const spans = computeRefSpans(text);
                const hit = spans.find((s) => clickOffset >= s.startOffset && clickOffset <= s.endOffset);
                if (hit) {
                  e.event.preventDefault();
                  onNavigateToFileRef.current(hit.filePath);
                }
              });

              return () => {
                window.removeEventListener('keydown', handleWindowKeyDown);
                window.removeEventListener('keyup', handleWindowKeyUp);
                onMouseDown.dispose();
                decorations.clear();
              };
            }}
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
                theme={monacoTheme}
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
