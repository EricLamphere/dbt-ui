import { useEffect, useRef, useState } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import type * as MonacoEditor from 'monaco-editor';
import { ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { format as sqlFormat } from 'sql-formatter';
import { api, type FileContentDto, type GraphDto, type ModelNode } from '../../../../lib/api';
import { useTheme } from '../../../../lib/useTheme';

type ViewTab = 'code' | 'compiled';

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
  /** YAML: test node to scroll the editor to when the file opens */
  targetTestNode?: ModelNode | null;
  /** YAML: called when the cursor moves into a test block; null if not in a test */
  onTestSelected?: (testNode: ModelNode | null) => void;
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

/**
 * For a YAML schema file, find the 1-based line number where a test is defined.
 * Searches for: model name block → column name block (if column_name) → test type.
 * Falls back to a simple text search for the test type name if the structured search fails.
 */
function findTestLineInYaml(
  content: string,
  testMetadataName: string | null,
  columnName: string | null,
  attachedNode: string | null,
): number | null {
  if (!testMetadataName) return null;
  const lines = content.split('\n');

  // Normalise attached_node to just the model name (last segment of uid)
  const modelName = attachedNode ? attachedNode.split('.').pop() ?? null : null;

  let inModelBlock = modelName === null; // if no model name, search everywhere
  let inColumnBlock = columnName === null; // if no column name, search everywhere
  let modelIndent = -1;
  let columnIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    if (!trimmed || trimmed.startsWith('#')) continue;

    // Detect model name block: "- name: <modelName>" under "models:"
    if (modelName && !inModelBlock) {
      const m = trimmed.match(/^-?\s*name:\s*(.+)$/);
      if (m && m[1].trim() === modelName) {
        inModelBlock = true;
        modelIndent = indent;
        continue;
      }
    }

    // Once inside a model block, detect when we leave it (dedent to same or lower level)
    if (inModelBlock && modelName && indent <= modelIndent && trimmed.startsWith('-')) {
      const m = trimmed.match(/^-?\s*name:\s*(.+)$/);
      if (m && m[1].trim() !== modelName) {
        inModelBlock = false;
        inColumnBlock = columnName === null;
        modelIndent = -1;
        columnIndent = -1;
        continue;
      }
    }

    if (!inModelBlock) continue;

    // Detect column name block: "- name: <columnName>" under "columns:"
    if (columnName && !inColumnBlock) {
      const m = trimmed.match(/^-?\s*name:\s*(.+)$/);
      if (m && m[1].trim() === columnName) {
        inColumnBlock = true;
        columnIndent = indent;
        continue;
      }
    }

    // Detect when we leave a column block
    if (inColumnBlock && columnName && indent <= columnIndent && trimmed.startsWith('-')) {
      const m = trimmed.match(/^-?\s*name:\s*(.+)$/);
      if (m && m[1].trim() !== columnName) {
        inColumnBlock = false;
        columnIndent = -1;
        continue;
      }
    }

    if (!inColumnBlock) continue;

    // Match test entry: "- <testName>" or "- <testName>:" or "- name: <testName>"
    const testSimple = trimmed.match(/^-\s*(\w+)\s*(?::|$)/);
    const testNamed = trimmed.match(/^-?\s*name:\s*(\w+)\s*$/);
    const matched = testSimple ? testSimple[1] : testNamed ? testNamed[1] : null;
    if (matched && matched === testMetadataName) {
      return i + 1; // 1-based line number
    }
  }

  // Fallback: search for the test name as a standalone YAML key/value
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed === `- ${testMetadataName}` || trimmed.startsWith(`- ${testMetadataName}:`)) {
      return i + 1;
    }
  }

  return null;
}

export function ViewPane({
  projectId, openFile, edited, onEdit, onSave, onDelete,
  saving, saveStatus, saveError, isDirty, modelUid, graph, onNavigateToFile,
  canGoBack, canGoForward, onGoBack, onGoForward,
  targetTestNode, onTestSelected,
}: ViewPaneProps) {
  const theme = useTheme();
  const monacoTheme = theme === 'light' ? 'vs-light' : 'vs-dark';

  const graphRef = useRef(graph);
  useEffect(() => { graphRef.current = graph; }, [graph]);

  const onNavigateToFileRef = useRef(onNavigateToFile);
  useEffect(() => { onNavigateToFileRef.current = onNavigateToFile; }, [onNavigateToFile]);

  const onTestSelectedRef = useRef(onTestSelected);
  useEffect(() => { onTestSelectedRef.current = onTestSelected; }, [onTestSelected]);

  const targetTestNodeRef = useRef(targetTestNode);
  useEffect(() => { targetTestNodeRef.current = targetTestNode; }, [targetTestNode]);

  // ref to the Monaco editor instance for imperative scroll/reveal
  const editorRef = useRef<MonacoEditor.editor.IStandaloneCodeEditor | null>(null);

  const completionDisposableRef = useRef<MonacoEditor.IDisposable | null>(null);
  useEffect(() => () => { completionDisposableRef.current?.dispose(); }, []);

  const [activeTab, setActiveTab] = useState<ViewTab>('code');
  const [compiledSql, setCompiledSql] = useState<string | null>(null);
  const [compiledLoading, setCompiledLoading] = useState(false);
  const [compiledError, setCompiledError] = useState<string | null>(null);
  const canCompile = !!modelUid && isSqlFile(openFile.path);

  // Reset sub-tabs when file changes
  useEffect(() => {
    setActiveTab('code');
    setCompiledSql(null);
    setCompiledError(null);
  }, [openFile.path]);

  // Scroll editor to targetTestNode's line when it changes (e.g. DAG deep-link)
  useEffect(() => {
    if (!targetTestNode) return;
    const content = edited ?? openFile.content;
    const lineNumber = findTestLineInYaml(
      content,
      targetTestNode.test_metadata_name,
      targetTestNode.column_name,
      targetTestNode.attached_node,
    );
    if (lineNumber && editorRef.current) {
      editorRef.current.revealLineInCenter(lineNumber);
      editorRef.current.setPosition({ lineNumber, column: 1 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTestNode]);

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

  const handleTabChange = async (tab: ViewTab) => {
    setActiveTab(tab);
    if (tab === 'compiled' && !compiledSql && canCompile && modelUid) {
      await fetchCompiledSql();
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

              // Store editor ref for imperative scroll
              editorRef.current = editor;

              // Scroll to targetTestNode if set (e.g. navigated from DAG for a test node)
              const initialTarget = targetTestNodeRef.current;
              if (initialTarget) {
                const content = editor.getModel()?.getValue() ?? '';
                const lineNumber = findTestLineInYaml(
                  content,
                  initialTarget.test_metadata_name,
                  initialTarget.column_name,
                  initialTarget.attached_node,
                );
                if (lineNumber) {
                  setTimeout(() => {
                    editor.revealLineInCenter(lineNumber);
                    editor.setPosition({ lineNumber, column: 1 });
                  }, 50);
                }
              }

              // YAML cursor tracking: when cursor moves, find which test block it's in
              const isYamlFile = openFile.path.endsWith('.yml') || openFile.path.endsWith('.yaml');
              const cursorDisposable = editor.onDidChangeCursorPosition((e) => {
                if (!onTestSelectedRef.current) return;
                if (!isYamlFile) return;
                const mdl = editor.getModel();
                if (!mdl) return;

                const cursorLine = e.position.lineNumber;
                const content = mdl.getValue();
                const graph = graphRef.current;
                if (!graph) return;

                // Build sorted list of (lineNumber, testNode) for tests in this file
                const filePath = openFile.path;
                const allTests = graph.nodes.filter((n) => n.resource_type === 'test');
                const testNodes = allTests.filter(
                  (n) => n.original_file_path &&
                    (filePath === n.original_file_path || filePath.endsWith('/' + n.original_file_path) || filePath.endsWith(n.original_file_path))
                );

                type TestLine = { line: number; node: ModelNode };
                const testLines: TestLine[] = [];
                for (const testNode of testNodes) {
                  const line = findTestLineInYaml(
                    content,
                    testNode.test_metadata_name,
                    testNode.column_name,
                    testNode.attached_node,
                  );
                  if (line != null) testLines.push({ line, node: testNode });
                }

                // Sort by line number and find the test whose block the cursor is in.
                // A test block extends from its line until the next test's line (exclusive).
                testLines.sort((a, b) => a.line - b.line);

                let matched: ModelNode | null = null;
                for (let i = 0; i < testLines.length; i++) {
                  const start = testLines[i].line;
                  const end = i + 1 < testLines.length ? testLines[i + 1].line - 1 : Infinity;
                  if (cursorLine >= start && cursorLine <= end) {
                    matched = testLines[i].node;
                    break;
                  }
                }
                onTestSelectedRef.current(matched);
              });

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
                cursorDisposable.dispose();
                decorations.clear();
                editorRef.current = null;
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

      </div>
    </div>
  );
}
