import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Editor, { type Monaco } from '@monaco-editor/react';
import type * as MonacoEditor from 'monaco-editor';
import { format as sqlFormat } from 'sql-formatter';
import { Play, Save, Trash2, WrapText, Plus, FolderPlus, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { api, type FileNode, type GraphDto } from '../../../lib/api';
import { useTheme } from '../../../lib/useTheme';
import NavRail from '../components/NavRail';
import { TreeItem } from './TreeItem';
import { DatabaseExplorer } from './DatabaseExplorer';
import type { ContextMenuState, QueryResult, RenameState, TreeNode } from './types';
import { updateNode } from './types';

const OPEN_KEY = (id: number) => `ws-open-${id}`;
const EXPANDED_KEY = (id: number) => `ws-expanded-${id}`;
const RESULTS_KEY = (id: number) => `ws-results-${id}`;
const CONTENT_KEY = (id: number | string, path: string) => `ws-content-${id}-${path}`;
const TAB_KEY = (id: number) => `ws-tab-${id}`;

const MIN_RESULTS_WIDTH = 200;
const DEFAULT_RESULTS_WIDTH = 360;
const MAX_RESULTS_WIDTH = 900;
const COLLAPSE_THRESHOLD = 80;

type EditorTab = 'code' | 'compiled';

function formatSql(sql: string): string {
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
    return sql;
  }
  return formatted.replace(/__JINJA_(\d+)__/g, (_, i) => tokens[Number(i)] ?? '');
}

function fileNodeToTree(node: FileNode): TreeNode {
  return {
    ...node,
    expanded: false,
    children: node.children?.map(fileNodeToTree),
  };
}

function ensureSqlExtension(name: string): string {
  const trimmed = name.trim();
  return trimmed.endsWith('.sql') ? trimmed : `${trimmed}.sql`;
}

export default function WorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);
  const theme = useTheme();
  const monacoTheme = theme === 'light' ? 'vs-light' : 'vs-dark';

  // Tree resize
  const [treeWidth, setTreeWidth] = useState(() => {
    try { const v = parseInt(localStorage.getItem('dbt-ui:ws-tree-width') ?? '', 10); return !isNaN(v) && v >= 150 && v <= 400 ? v : 240; } catch { return 240; }
  });
  const treeResizing = useRef(false);
  const treeWidthRef = useRef(treeWidth);

  // Vertical split: ratio of panel height given to the database explorer (0–1, default 0.5)
  const [explorerRatio, setExplorerRatio] = useState(() => {
    try { const v = parseFloat(localStorage.getItem('dbt-ui:ws-explorer-ratio') ?? ''); return !isNaN(v) && v >= 0.1 && v <= 0.9 ? v : 0.5; } catch { return 0.5; }
  });
  const explorerResizing = useRef(false);
  const explorerStartYRef = useRef(0);
  const explorerStartRatioRef = useRef(0);
  const explorerRatioRef = useRef(explorerRatio);
  const treePanelRef = useRef<HTMLDivElement>(null);

  // Results pane resize
  const [resultsWidth, setResultsWidth] = useState(() => {
    try { const v = parseInt(localStorage.getItem('dbt-ui:ws-results-width') ?? '', 10); return !isNaN(v) && v >= MIN_RESULTS_WIDTH && v <= MAX_RESULTS_WIDTH ? v : DEFAULT_RESULTS_WIDTH; } catch { return DEFAULT_RESULTS_WIDTH; }
  });
  const [resultsOpen, setResultsOpen] = useState(false);
  const resultsResizing = useRef(false);
  const lastResultsWidthRef = useRef(resultsWidth);
  const startXRef = useRef(0);
  const startWRef = useRef(0);

  // File tree state
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [filter, setFilter] = useState('');

  // New file modal state
  const [newFileModal, setNewFileModal] = useState<{ dirPath: string } | null>(null);
  const [newFileName, setNewFileName] = useState('');

  // Editor state
  const [activeTab, setActiveTab] = useState<EditorTab>('code');
  const [editorContent, setEditorContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<Parameters<NonNullable<Parameters<typeof Editor>[0]['onMount']>>[0] | null>(null);
  const handleRunRef = useRef<() => void>(() => {});
  const handleSaveRef = useRef<() => void>(() => {});

  // Compiled SQL state
  const [compiledSql, setCompiledSql] = useState<string | null>(null);
  const [compiledLoading, setCompiledLoading] = useState(false);
  const [compiledError, setCompiledError] = useState<string | null>(null);

  // Query results
  const [results, setResults] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);

  // Workspace path from backend
  const { data: wsPathData } = useQuery({
    queryKey: ['workspace-path', id],
    queryFn: () => api.workspace.getPath(id),
  });
  const wsRelPath = wsPathData?.relative_path ?? 'workspace';

  // Graph data for autocomplete
  const { data: graphData } = useQuery<GraphDto>({
    queryKey: ['graph', id],
    queryFn: () => api.models.graph(id),
  });
  const graphDataRef = useRef<GraphDto | undefined>(undefined);
  useEffect(() => { graphDataRef.current = graphData; }, [graphData]);
  const completionDisposableRef = useRef<MonacoEditor.IDisposable | null>(null);

  // Restore session state
  useEffect(() => {
    const savedPath = sessionStorage.getItem(OPEN_KEY(id));
    if (savedPath) setOpenPath(savedPath);

    const savedTab = sessionStorage.getItem(TAB_KEY(id)) as EditorTab | null;
    if (savedTab === 'code' || savedTab === 'compiled') setActiveTab(savedTab);

    const savedExpanded = sessionStorage.getItem(EXPANDED_KEY(id));
    if (savedExpanded) {
      try { setExpandedPaths(new Set(JSON.parse(savedExpanded))); } catch { /* ignore */ }
    }

    const savedResults = sessionStorage.getItem(RESULTS_KEY(id));
    if (savedResults) {
      try {
        const r = JSON.parse(savedResults) as QueryResult;
        setResults(r);
        setResultsOpen(true);
      } catch { /* ignore */ }
    }
  }, [id]);

  // Load tree when workspace path is known
  useEffect(() => {
    if (!wsRelPath) return;
    api.files.list(id, wsRelPath).then((nodes) => {
      setTree(nodes.map(fileNodeToTree));
    }).catch(() => {});
  }, [id, wsRelPath]);

  // Load file content when openPath changes; reset compiled state
  useEffect(() => {
    if (!openPath) return;
    setCompiledSql(null);
    setCompiledError(null);
    const cached = sessionStorage.getItem(CONTENT_KEY(id, openPath));
    if (cached !== null) {
      setEditorContent(cached);
      setIsDirty(false);
      return;
    }
    api.files.getContent(id, openPath).then((f) => {
      setEditorContent(f.content);
      setIsDirty(false);
    }).catch(() => {});
  }, [id, openPath]);

  // Mouse resize handlers
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (treeResizing.current) setTreeWidth((w) => {
        const next = Math.max(150, Math.min(400, w + e.movementX));
        treeWidthRef.current = next;
        return next;
      });
      if (explorerResizing.current) {
        const panelH = treePanelRef.current?.offsetHeight ?? 400;
        const delta = explorerStartYRef.current - e.clientY;
        const newRatio = Math.max(0.1, Math.min(0.9, explorerStartRatioRef.current + delta / panelH));
        explorerRatioRef.current = newRatio;
        setExplorerRatio(newRatio);
      }
      if (resultsResizing.current) {
        const delta = startXRef.current - e.clientX;
        const newW = Math.max(0, startWRef.current + delta);
        if (newW < COLLAPSE_THRESHOLD) {
          setResultsOpen(false);
          setResultsWidth(0);
        } else {
          setResultsOpen(true);
          setResultsWidth(Math.min(MAX_RESULTS_WIDTH, Math.max(MIN_RESULTS_WIDTH, newW)));
        }
      }
    };
    const onMouseUp = () => {
      if (treeResizing.current) {
        try { localStorage.setItem('dbt-ui:ws-tree-width', String(treeWidthRef.current)); } catch {}
      }
      if (explorerResizing.current) {
        try { localStorage.setItem('dbt-ui:ws-explorer-ratio', String(explorerRatioRef.current)); } catch {}
      }
      if (resultsResizing.current) {
        setResultsWidth((w) => {
          if (w >= MIN_RESULTS_WIDTH) try { localStorage.setItem('dbt-ui:ws-results-width', String(w)); } catch {}
          return w;
        });
      }
      treeResizing.current = false;
      explorerResizing.current = false;
      resultsResizing.current = false;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  const persistExpanded = useCallback((paths: Set<string>) => {
    try { sessionStorage.setItem(EXPANDED_KEY(id), JSON.stringify([...paths])); } catch { /* quota */ }
  }, [id]);

  const openFile = useCallback(async (path: string) => {
    setOpenPath(path);
    setActiveTab('code');
    sessionStorage.setItem(OPEN_KEY(id), path);
    sessionStorage.setItem(TAB_KEY(id), 'code');
    setIsDirty(false);
  }, [id]);

  const handleToggle = useCallback(async (node: TreeNode, pathParts: string[]) => {
    if (!node.is_dir) return;
    const alreadyExpanded = expandedPaths.has(node.path);
    if (!alreadyExpanded && (!node.children || node.children.length === 0)) {
      setLoadingPath(node.path);
      try {
        const children = await api.files.list(id, node.path);
        setTree((prev) => updateNode(prev, pathParts, (n) => ({
          ...n,
          expanded: true,
          children: children.map(fileNodeToTree),
        })));
        const next = new Set([...expandedPaths, node.path]);
        setExpandedPaths(next);
        persistExpanded(next);
      } finally {
        setLoadingPath(null);
      }
    } else {
      setTree((prev) => updateNode(prev, pathParts, (n) => ({ ...n, expanded: !n.expanded })));
      const next = new Set(expandedPaths);
      if (alreadyExpanded) next.delete(node.path); else next.add(node.path);
      setExpandedPaths(next);
      persistExpanded(next);
    }
  }, [id, expandedPaths, persistExpanded]);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode, pathParts: string[]) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node, pathParts });
  }, []);

  const refreshDir = useCallback(async (dirPath: string) => {
    const children = await api.files.list(id, dirPath);
    setTree((prev) => {
      function refresh(nodes: TreeNode[]): TreeNode[] {
        return nodes.map((n) => {
          if (n.path === dirPath) return { ...n, children: children.map(fileNodeToTree) };
          if (n.children) return { ...n, children: refresh(n.children) };
          return n;
        });
      }
      if (dirPath === wsRelPath) return children.map(fileNodeToTree);
      return refresh(prev);
    });
  }, [id, wsRelPath]);

  const openNewFileModal = (dirPath: string) => {
    setNewFileName('');
    setNewFileModal({ dirPath });
  };

  const handleNewFileSubmit = async () => {
    if (!newFileModal || !newFileName.trim()) return;
    const name = ensureSqlExtension(newFileName.trim());
    await api.files.newFile(id, name, newFileModal.dirPath, false);
    await refreshDir(newFileModal.dirPath);
    const newPath = `${newFileModal.dirPath}/${name}`;
    setNewFileModal(null);
    await openFile(newPath);
  };

  const handleNewFolder = async (dirPath: string) => {
    const name = prompt('Folder name:');
    if (!name) return;
    await api.files.newFile(id, name, dirPath, true);
    await refreshDir(dirPath);
  };

  const handleDelete = async (node: TreeNode) => {
    if (!confirm(`Delete '${node.name}'?`)) return;
    if (openPath === node.path) {
      setOpenPath(null);
      setEditorContent('');
      sessionStorage.removeItem(OPEN_KEY(id));
    }
    await api.files.delete(id, node.path);
    const parentPath = node.path.includes('/') ? node.path.split('/').slice(0, -1).join('/') : wsRelPath;
    await refreshDir(parentPath);
  };

  const handleRenameSubmit = async (newName: string) => {
    if (!renameState) return;
    if (newName !== renameState.currentName) {
      await api.files.rename(id, renameState.path, newName);
      const parentPath = renameState.path.includes('/')
        ? renameState.path.split('/').slice(0, -1).join('/')
        : wsRelPath;
      await refreshDir(parentPath);
      if (openPath === renameState.path) {
        const newPath = renameState.path.replace(/[^/]+$/, newName);
        await openFile(newPath);
      }
    }
    setRenameState(null);
  };

  const handleSave = async () => {
    if (!openPath || saving) return;
    setSaving(true);
    try {
      await api.files.putContent(id, openPath, editorContent);
      setIsDirty(false);
      sessionStorage.setItem(CONTENT_KEY(id, openPath), editorContent);
    } catch (e) {
      alert(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleFormat = () => {
    const formatted = formatSql(editorContent);
    setEditorContent(formatted);
    setIsDirty(true);
  };

  const fetchCompiled = async () => {
    if (!editorContent.trim()) return;
    setCompiledLoading(true);
    setCompiledError(null);
    try {
      const result = await api.workspace.compile(id, { sql: editorContent });
      setCompiledSql(result.compiled_sql);
    } catch (e: unknown) {
      setCompiledError(e instanceof Error ? e.message : String(e));
    } finally {
      setCompiledLoading(false);
    }
  };

  const handleTabChange = async (tab: EditorTab) => {
    setActiveTab(tab);
    sessionStorage.setItem(TAB_KEY(id), tab);
    if (tab === 'compiled' && !compiledSql && !compiledLoading) {
      await fetchCompiled();
    }
  };

  const handleRefreshCompiled = async () => {
    setCompiledSql(null);
    await fetchCompiled();
  };

  const handleRun = useCallback(async () => {
    if (running) return;
    const editor = editorRef.current;
    let sql = editorContent;
    if (editor) {
      const sel = editor.getSelection();
      if (sel && !sel.isEmpty()) {
        sql = editor.getModel()?.getValueInRange(sel) ?? editorContent;
      }
    }
    if (!sql.trim()) return;
    setRunning(true);
    setRunError(null);
    if (!resultsOpen) {
      setResultsOpen(true);
      setResultsWidth(lastResultsWidthRef.current || DEFAULT_RESULTS_WIDTH);
    }
    try {
      const data = await api.workspace.run(id, { sql });
      const result: QueryResult = {
        columns: data.columns,
        rows: data.rows,
        sql,
        timestamp: Date.now(),
      };
      setResults(result);
      try { sessionStorage.setItem(RESULTS_KEY(id), JSON.stringify(result)); } catch { /* quota */ }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setRunError(msg);
    } finally {
      setRunning(false);
    }
  }, [id, editorContent, running, resultsOpen]);

  useEffect(() => { handleRunRef.current = handleRun; }, [handleRun]);
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);

  // Cleanup completion provider on unmount
  useEffect(() => () => { completionDisposableRef.current?.dispose(); }, []);

  const handleEditorMount = useCallback((editor: NonNullable<typeof editorRef.current>, monaco: Monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSaveRef.current();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleRunRef.current();
    });

    editor.onDidChangeCursorSelection((e) => {
      setHasSelection(!e.selection.isEmpty());
    });

    // Clean up previous registration before re-registering
    completionDisposableRef.current?.dispose();
    completionDisposableRef.current = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ["'", '"', '.', ' ', ','],
      provideCompletionItems(model: MonacoEditor.editor.ITextModel, position: MonacoEditor.Position) {
        const graph = graphDataRef.current;
        if (!graph) return { suggestions: [] };

        // Range that covers the word fragment already typed — ensures replacement, not insertion
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

        // Build a sorted, prefix-filtered suggestion list
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

        // Extract the SQL statement surrounding the cursor (bounded by semicolons)
        function currentStatement(): string {
          const fullSql = model.getValue();
          const offset = model.getOffsetAt(position);
          const before = fullSql.lastIndexOf(';', offset - 1);
          const after = fullSql.indexOf(';', offset);
          const start = before === -1 ? 0 : before + 1;
          const end = after === -1 ? fullSql.length : after;
          return fullSql.slice(start, end);
        }

        // Parse which model names are referenced in the current statement (for column scoping)
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
        const g = graph; // narrowed non-optional reference for use inside nested functions

        // Helper: build suggestion detail + documentation for a node
        function nodeDetail(node: (typeof g.nodes)[number]): { detail: string; documentation?: { value: string } } {
          const parts: string[] = [];
          if (node.materialized) parts.push(node.materialized);
          if (node.schema_) parts.push(node.schema_);
          return {
            detail: parts.length ? `${parts.join(' · ')} (${node.resource_type})` : node.resource_type,
            documentation: node.description ? { value: node.description } : undefined,
          };
        }

        // --- Inside {{ ref('...') }} — replace only the name token ---
        const refInnerMatch = linePrefix.match(/\{\{\s*ref\s*\(\s*['"]([^'"]*)?$/);
        if (refInnerMatch) {
          const typed = refInnerMatch[1] ?? '';
          const refable = graph.nodes.filter((n) => ['model', 'seed', 'snapshot'].includes(n.resource_type));
          for (const { label, node } of rank(refable.map((n) => ({ label: n.name, node: n })), typed)) {
            const hasError = node.status === 'error' || node.status === 'stale';
            const { detail, documentation } = nodeDetail(node);
            suggestions.push({
              label: hasError ? `${label} ⚠` : label,
              kind: monaco.languages.CompletionItemKind.Reference,
              insertText: label,
              detail,
              documentation,
              range: tokenRange,
              sortText: label,
            });
          }
          return { suggestions };
        }

        // --- Inside {{ source('schema', '...') }} — second arg, replace only the name token ---
        const sourceInnerMatch = linePrefix.match(/\{\{\s*source\s*\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]*)?$/);
        if (sourceInnerMatch) {
          const typed = sourceInnerMatch[1] ?? '';
          const sources = graph.nodes.filter((n) => n.resource_type === 'source');
          for (const { label, node } of rank(sources.map((n) => ({ label: n.name, node: n })), typed)) {
            const { documentation } = nodeDetail(node);
            suggestions.push({
              label,
              kind: monaco.languages.CompletionItemKind.Reference,
              insertText: label,
              detail: node.source_name ? `source: ${node.source_name}` : 'source',
              documentation,
              range: tokenRange,
              sortText: label,
            });
          }
          return { suggestions };
        }

        // --- Inside {{ source('...') }} — first arg only, replace only the schema token ---
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
              kind: monaco.languages.CompletionItemKind.Module,
              insertText: label,
              detail: 'source schema',
              range: tokenRange,
              sortText: label,
            });
          }
          return { suggestions };
        }

        // --- Table autocomplete after FROM / JOIN — inserts full jinja snippet ---
        // Matches: "from ", "join ", "from ord", "join ord", etc.
        const tableTrigger = /(?:from|join)\s+\w*$/i.test(linePrefix);
        if (tableTrigger) {
          const typed = word.word; // partial text already typed (may be empty)
          const refable = graph.nodes.filter((n) => ['model', 'seed', 'snapshot'].includes(n.resource_type));
          const sources = graph.nodes.filter((n) => n.resource_type === 'source');

          for (const { label, node } of rank(refable.map((n) => ({ label: n.name, node: n })), typed)) {
            const hasError = node.status === 'error' || node.status === 'stale';
            const { detail, documentation } = nodeDetail(node);
            suggestions.push({
              label: hasError ? `${label} ⚠` : label,
              kind: monaco.languages.CompletionItemKind.Reference,
              insertText: `{{ ref('${label}') }}`,
              detail,
              documentation,
              range: tokenRange,
              sortText: `0_${label}`, // refs first
            });
          }

          for (const { label, node } of rank(sources.map((n) => ({ label: n.name, node: n })), typed)) {
            const { documentation } = nodeDetail(node);
            const schema = node.source_name ?? '';
            suggestions.push({
              label,
              kind: monaco.languages.CompletionItemKind.Reference,
              insertText: `{{ source('${schema}', '${label}') }}`,
              detail: schema ? `source: ${schema}` : 'source',
              documentation,
              range: tokenRange,
              sortText: `1_${label}`, // sources after refs
            });
          }

          return { suggestions };
        }

        // --- Column names — after SELECT / WHERE / ON / AND / OR / BY / , / . ---
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

          // Collect columns; track which nodes each column belongs to for detail
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
              kind: monaco.languages.CompletionItemKind.Field,
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

    // Compute spans for all ref/source calls in the editor text
    function computeRefSpans(text: string): Array<{ uid: string; startOffset: number; endOffset: number }> {
      const spans: Array<{ uid: string; startOffset: number; endOffset: number }> = [];
      const graph = graphDataRef.current;
      if (!graph) return spans;
      const refRe = /ref\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = refRe.exec(text)) !== null) {
        const node = graph.nodes.find((n) => n.name === m![1] && n.resource_type !== 'source');
        if (node) spans.push({ uid: node.unique_id, startOffset: m.index, endOffset: m.index + m[0].length });
      }
      const srcRe = /source\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;
      while ((m = srcRe.exec(text)) !== null) {
        const node = graph.nodes.find(
          (n) => n.resource_type === 'source' && n.source_name === m![1] && n.name === m![2]
        );
        if (node) spans.push({ uid: node.unique_id, startOffset: m.index, endOffset: m.index + m[0].length });
      }
      return spans;
    }

    let decorations = editor.createDecorationsCollection([]);

    function applyDecorations() {
      const mdl = editor.getModel();
      if (!mdl) return;
      const text = mdl.getValue();
      const spans = computeRefSpans(text);
      decorations.set(spans.map(({ startOffset, endOffset }) => {
        const start = mdl.getPositionAt(startOffset);
        const end = mdl.getPositionAt(endOffset);
        return {
          range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
          options: { inlineClassName: 'dbt-ref-link' },
        };
      }));
    }

    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'Control') applyDecorations();
    };
    const handleWindowKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'Control') decorations.clear();
    };
    window.addEventListener('keydown', handleWindowKeyDown);
    window.addEventListener('keyup', handleWindowKeyUp);

    const onMouseDown = editor.onMouseDown((e) => {
      if (!e.event.metaKey && !e.event.ctrlKey) return;
      const pos = e.target.position;
      if (!pos) return;
      const mdl = editor.getModel();
      if (!mdl) return;
      const clickOffset = mdl.getOffsetAt(pos);
      const spans = computeRefSpans(mdl.getValue());
      const hit = spans.find((s) => clickOffset >= s.startOffset && clickOffset <= s.endOffset);
      if (hit) {
        e.event.preventDefault();
        navigateRef.current(`/projects/${id}/files?model=${encodeURIComponent(hit.uid)}`);
      }
    });

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
      window.removeEventListener('keyup', handleWindowKeyUp);
      onMouseDown.dispose();
      decorations.clear();
    };
  }, []);

  const handleEditorChange = (value: string | undefined) => {
    const v = value ?? '';
    setEditorContent(v);
    setIsDirty(true);
    // Invalidate compiled SQL when code changes
    setCompiledSql(null);
    setCompiledError(null);
    if (openPath) {
      try { sessionStorage.setItem(CONTENT_KEY(id, openPath), v); } catch { /* quota */ }
    }
  };

  const toggleResults = () => {
    if (resultsOpen) {
      lastResultsWidthRef.current = resultsWidth;
      setResultsOpen(false);
      setResultsWidth(0);
    } else {
      const w = lastResultsWidthRef.current || DEFAULT_RESULTS_WIDTH;
      setResultsOpen(true);
      setResultsWidth(w);
    }
  };

  const visibleTree = filter
    ? tree.filter((n) => n.name.toLowerCase().includes(filter.toLowerCase()))
    : tree;

  const fileName = openPath?.split('/').pop() ?? null;

  return (
    <div className="flex h-full overflow-hidden" onClick={() => setContextMenu(null)}>
      {/* Nav panel */}
      <NavRail projectId={id} current="workspace" />

      {/* File tree + Database Explorer */}
      <div ref={treePanelRef} style={{ width: treeWidth }} className="shrink-0 bg-surface-panel border-r border-gray-800 flex flex-col overflow-hidden relative">
        {/* File tree section — takes remaining space above explorer */}
        <div className="flex flex-col min-h-0 overflow-hidden" style={{ flex: '1 1 0' }}>
          {/* Tree header */}
          <div className="flex items-center gap-1 px-2 py-2 border-b border-gray-800 shrink-0">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex-1 truncate">Workspace</span>
            <button
              onClick={() => openNewFileModal(wsRelPath)}
              title="New file"
              className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-surface-elevated transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleNewFolder(wsRelPath)}
              title="New folder"
              className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-surface-elevated transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          </div>
          {/* Filter */}
          <div className="px-2 py-1.5 border-b border-gray-800 shrink-0">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter files…"
              className="w-full bg-surface-elevated rounded px-2 py-1 text-xs text-gray-300 placeholder-gray-600 border border-gray-700 focus:outline-none focus:border-brand-500"
            />
          </div>
          {/* Tree */}
          <div className="flex-1 overflow-y-auto py-1">
            {tree.length === 0 ? (
              <p className="text-xs text-gray-600 italic px-3 py-2">No files yet. Click + to create one.</p>
            ) : (
              visibleTree.map((node, i) => (
                <TreeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  pathParts={[String(i)]}
                  onToggle={handleToggle}
                  onOpen={openFile}
                  activePath={openPath}
                  loadingPath={loadingPath}
                  onContextMenu={handleContextMenu}
                  renameState={renameState}
                  onRenameSubmit={handleRenameSubmit}
                />
              ))
            )}
          </div>
        </div>

        {/* Vertical drag handle between file tree and database explorer */}
        <div
          onMouseDown={(e) => {
            explorerResizing.current = true;
            explorerStartYRef.current = e.clientY;
            explorerStartRatioRef.current = explorerRatio;
          }}
          className="h-1 shrink-0 cursor-row-resize bg-gray-800 hover:bg-brand-500/40 transition-colors"
        />

        {/* Database explorer section */}
        <div style={{ flex: `0 0 ${explorerRatio * 100}%` }} className="min-h-0 overflow-hidden border-t border-gray-800">
          <DatabaseExplorer
            nodes={graphData?.nodes ?? []}
            onRefresh={() => qc.invalidateQueries({ queryKey: ['graph', id] })}
          />
        </div>

        {/* Tree/panel right resize handle */}
        <div
          onMouseDown={() => { treeResizing.current = true; }}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-brand-500/40 transition-colors"
        />
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Tab bar + actions */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 bg-surface-panel shrink-0 gap-3">
          <div className="flex items-center gap-1">
            {(['code', 'compiled'] as EditorTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => openPath && handleTabChange(tab)}
                disabled={!openPath}
                className={`px-3 py-1 text-xs rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed
                  ${activeTab === tab
                    ? 'bg-brand-900/50 text-brand-300'
                    : 'text-gray-500 hover:text-gray-300'
                  }`}
              >
                {tab === 'code' ? 'Code' : 'Compiled SQL'}
              </button>
            ))}
          </div>

          {activeTab === 'code' && (
            <div className="flex items-center gap-2 shrink-0">
              {openPath && (
                <span className="text-xs text-gray-500 font-mono truncate max-w-[200px]">
                  {fileName}
                  {isDirty && <span className="text-gray-600 ml-1">•</span>}
                </span>
              )}
              <button
                onClick={handleFormat}
                disabled={!openPath}
                title="Format SQL"
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-surface-elevated hover:bg-gray-700 text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors"
              >
                <WrapText className="w-3.5 h-3.5" />
                Format
              </button>
              <button
                onClick={handleSave}
                disabled={!openPath || saving || !isDirty}
                title="Save file (⌘S)"
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-surface-elevated hover:bg-gray-700 text-gray-300 disabled:opacity-40 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => openPath && handleDelete({ path: openPath, name: fileName ?? '', is_dir: false })}
                disabled={!openPath}
                title="Delete file"
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-surface-elevated hover:bg-red-900/40 text-gray-400 hover:text-red-400 disabled:opacity-40 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleRun}
                disabled={running || !openPath}
                title="Run query (⌘↵)"
                className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-40 transition-colors font-medium"
              >
                <Play className="w-3.5 h-3.5" />
                {running ? 'Running…' : hasSelection ? 'Run Selection' : 'Run'}
              </button>
            </div>
          )}

          {activeTab === 'compiled' && (
            <button
              onClick={handleRefreshCompiled}
              disabled={compiledLoading || !openPath}
              className="flex items-center gap-1.5 px-2 py-1 text-xs rounded bg-surface-elevated hover:bg-gray-700 text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors shrink-0"
              title="Recompile and refresh"
            >
              <RotateCw className={`w-3 h-3 ${compiledLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
        </div>

        {/* Editor content area */}
        <div
          className="flex-1 min-h-0 overflow-hidden"
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDrop={(e) => {
            e.preventDefault();
            const text = e.dataTransfer.getData('text/plain');
            if (!text || !editorRef.current) return;
            const editor = editorRef.current;
            const model = editor.getModel();
            if (!model) return;
            // Convert client coords to editor position
            const target = editor.getTargetAtClientPoint(e.clientX, e.clientY);
            const pos = target?.position ?? editor.getPosition();
            if (!pos) return;
            editor.focus();
            editor.executeEdits('drag-drop', [{
              range: {
                startLineNumber: pos.lineNumber,
                startColumn: pos.column,
                endLineNumber: pos.lineNumber,
                endColumn: pos.column,
              },
              text,
            }]);
            // Move cursor to end of inserted text
            const endPos = model.getPositionAt(model.getOffsetAt(pos) + text.length);
            editor.setPosition(endPos);
          }}
        >
          {!openPath ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              Select or create a file to start writing SQL
            </div>
          ) : activeTab === 'code' ? (
            <Editor
              key={openPath}
              language="sql"
              value={editorContent}
              onChange={handleEditorChange}
              theme={monacoTheme}
              onMount={handleEditorMount}
              options={{
                fontSize: 13,
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                lineNumbers: 'on',
                minimap: { enabled: false },
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
          ) : (
            /* Compiled SQL tab */
            compiledLoading ? (
              <div className="flex items-center justify-center h-32 text-gray-500 text-xs gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                </svg>
                Compiling…
              </div>
            ) : compiledError ? (
              <div className="p-4">
                <p className="text-xs font-semibold text-red-400 mb-2">Compile failed</p>
                <pre className="text-xs text-red-300 whitespace-pre-wrap font-mono bg-red-950/30 rounded p-3">{compiledError}</pre>
              </div>
            ) : compiledSql ? (
              <Editor
                key={`compiled-${openPath}`}
                language="sql"
                value={compiledSql}
                theme={monacoTheme}
                options={{
                  readOnly: true,
                  fontSize: 13,
                  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                  lineNumbers: 'on',
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: 'off',
                  tabSize: 2,
                  automaticLayout: true,
                  renderLineHighlight: 'all',
                  smoothScrolling: true,
                  padding: { top: 12 },
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-32 text-gray-600 text-xs">
                Click Refresh to compile
              </div>
            )
          )}
        </div>
      </div>

      {/* Results pane drag handle */}
      <div
        className="w-5 shrink-0 bg-surface-panel border-l border-gray-800 flex flex-col items-center justify-center cursor-col-resize hover:bg-surface-elevated transition-colors relative"
        onMouseDown={(e) => {
          resultsResizing.current = true;
          startXRef.current = e.clientX;
          startWRef.current = resultsOpen ? resultsWidth : 0;
        }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); toggleResults(); }}
          onMouseDown={(e) => e.stopPropagation()}
          className="text-gray-500 hover:text-gray-300 transition-colors"
          title={resultsOpen ? 'Hide results' : 'Show results'}
        >
          {resultsOpen ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
        <div className="flex flex-col gap-1 mt-2">
          <div className="w-0.5 h-4 bg-gray-700 rounded" />
          <div className="w-0.5 h-4 bg-gray-700 rounded" />
          <div className="w-0.5 h-4 bg-gray-700 rounded" />
        </div>
      </div>

      {/* Results pane */}
      <div
        style={{ width: resultsOpen ? resultsWidth : 0 }}
        className="shrink-0 bg-surface-panel border-l border-gray-800 flex flex-col overflow-hidden"
      >
        {resultsOpen && (
          <>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
              <span className="text-xs font-semibold text-gray-300">Query Results</span>
              {results && (
                <span className="text-xs text-gray-500">
                  {results.rows.length} row{results.rows.length !== 1 ? 's' : ''}
                </span>
              )}
              {results && (
                <span className="text-xs text-gray-600 ml-auto">
                  {new Date(results.timestamp).toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto">
              {running && (
                <div className="flex items-center justify-center h-32 text-gray-500 text-xs gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                  </svg>
                  Running query…
                </div>
              )}
              {!running && runError && (
                <div className="p-3">
                  <p className="text-xs font-semibold text-red-400 mb-1">Query failed</p>
                  <pre className="text-xs text-red-300 whitespace-pre-wrap font-mono bg-red-950/30 rounded p-2">{runError}</pre>
                </div>
              )}
              {!running && !runError && results && results.rows.length === 0 && (
                <p className="text-xs text-gray-600 italic px-3 py-4">No rows returned.</p>
              )}
              {!running && !runError && results && results.rows.length > 0 && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="sticky top-0 bg-surface-panel border-b border-gray-800">
                      {results.columns.map((col) => (
                        <th key={col} className="text-left px-3 py-2 font-semibold text-gray-400 whitespace-nowrap border-r border-gray-800 last:border-r-0">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.rows.map((row, ri) => (
                      <tr key={ri} className={ri % 2 === 0 ? 'bg-surface-app' : 'bg-surface-panel'}>
                        {(row as unknown[]).map((cell, ci) => (
                          <td key={ci} className="px-3 py-1.5 text-gray-300 whitespace-nowrap border-r border-gray-800/50 last:border-r-0 font-mono">
                            {cell === null || cell === undefined
                              ? <span className="text-gray-600 italic">null</span>
                              : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!running && !runError && !results && (
                <div className="flex items-center justify-center h-32 text-gray-600 text-xs text-center px-4">
                  Run a query to see results here
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-surface-elevated border border-gray-700 rounded shadow-lg py-1 text-xs min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.node.is_dir && (
            <>
              <button
                onClick={() => { openNewFileModal(contextMenu.node.path); setContextMenu(null); }}
                className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-panel transition-colors"
              >
                New File
              </button>
              <button
                onClick={() => { handleNewFolder(contextMenu.node.path); setContextMenu(null); }}
                className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-panel transition-colors"
              >
                New Folder
              </button>
              <div className="border-t border-gray-800 my-1" />
            </>
          )}
          <button
            onClick={() => { setRenameState({ path: contextMenu.node.path, currentName: contextMenu.node.name }); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface-panel transition-colors"
          >
            Rename
          </button>
          <button
            onClick={() => { handleDelete(contextMenu.node); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-red-950/30 transition-colors"
          >
            Delete
          </button>
        </div>
      )}

      {/* New file modal */}
      {newFileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setNewFileModal(null)}>
          <div
            className="bg-surface-panel border border-gray-700 rounded-lg shadow-xl w-full max-w-sm mx-4 p-5 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-gray-100">New SQL file</h2>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-400 font-medium">File name</label>
              <input
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNewFileSubmit();
                  if (e.key === 'Escape') setNewFileModal(null);
                }}
                placeholder="my_query"
                autoFocus
                className="bg-surface-elevated border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <p className="text-[11px] text-gray-600">
                Saved as{' '}
                <code className="font-mono text-gray-500">
                  {wsRelPath}/{ensureSqlExtension(newFileName || 'my_query')}
                </code>
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setNewFileModal(null)}
                className="px-3 py-1.5 text-xs rounded text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleNewFileSubmit}
                disabled={!newFileName.trim()}
                className="px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-40 transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
