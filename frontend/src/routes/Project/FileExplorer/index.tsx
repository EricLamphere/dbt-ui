import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronsDownUp } from 'lucide-react';
import { api, type FileContentDto, type GraphDto, type ModelNode } from '../../../lib/api';
import { useProjectEvents } from '../../../lib/sse';
import NavRail from '../components/NavRail';
import { SidePane, type FailedRowsCache } from '../components/SidePane';
import { ContextMenu } from './ContextMenu';
import { TreeItem } from './TreeItem';
import { ViewPane } from './panes/ViewPane';
import type { ContextMenuState, RenameState, TreeNode } from './types';
import { filterTree, updateNode } from './types';
import { useReportSelectedNode } from '../lib/selectedNodeContext';

/** File path a ?model= deep-link points at (unit tests aren't graph nodes — use their YAML file). */
function resolveDeepLinkPath(graph: GraphDto, uid: string | null): string | null {
  if (!uid) return null;
  return graph.nodes.find((n) => n.unique_id === uid)?.original_file_path
    || graph.unit_tests?.find((u) => u.unique_id === uid)?.original_file_path
    || null;
}

function readSessionPath(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

export default function FileExplorerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // ?path= is the open file (so opening files lands in back/forward history);
  // ?model= is the inbound deep-link (DAG/Docs/⌘K), resolved to a path on arrival
  const pathParam = searchParams.get('path');
  const modelParam = searchParams.get('model');

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [filterText, setFilterText] = useState('');
  const [openFile, setOpenFile] = useState<FileContentDto | null>(null);
  const [edited, setEdited] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  /** model node corresponding to the open file, if any */
  const [selectedModel, setSelectedModel] = useState<ModelNode | null>(null);
  /** unique_id of the model corresponding to the open file, for ViewPane compiled SQL */
  const [modelUid, setModelUid] = useState<string | null>(null);
  /** for YAML schema files: the test node currently active in the editor / SidePane */
  const [selectedTestNode, setSelectedTestNode] = useState<ModelNode | null>(null);
  /** test node to scroll the editor to on open (from deep-link) */
  const [targetTestNode, setTargetTestNode] = useState<ModelNode | null>(null);
  const PREVIEW_CACHE_KEY = `preview-cache-${id}`;
  const FAILED_ROWS_KEY = `failed-rows-cache-${id}`;

  /** dbt show results keyed by modelUid — persisted to sessionStorage so it survives route navigation */
  const [previewCache, setPreviewCache] = useState<Map<string, { columns: string[]; rows: unknown[][] }>>(() => {
    try {
      const raw = sessionStorage.getItem(`preview-cache-${id}`);
      return raw ? new Map(JSON.parse(raw) as [string, { columns: string[]; rows: unknown[][] }][]) : new Map();
    } catch {
      return new Map();
    }
  });

  /** failing test rows keyed by test uid — same session key as DAG page */
  const [failedRowsCache, setFailedRowsCache] = useState<FailedRowsCache>(() => {
    try {
      const raw = sessionStorage.getItem(`failed-rows-cache-${id}`);
      return raw ? new Map(JSON.parse(raw) as [string, { columns: string[]; rows: unknown[][] }][]) : new Map();
    } catch {
      return new Map();
    }
  });

  const [failedTestUid, setFailedTestUid] = useState<string | null>(null);

  /** `${path}\n${model}` last loaded from the URL — stops graph refetches reloading (and discarding edits) */
  const loadedKeyRef = useRef<string | null>(null);
  /** bumped per load so a slow earlier load can't overwrite a later one (fast back/forward) */
  const loadSeqRef = useRef(0);

  // Resizable panels
  const [treeWidth, setTreeWidth] = useState(256);
  const treeResizing = useRef(false);

  // Fetch graph so we can resolve model uid from file path
  const { data: graph } = useQuery({
    queryKey: ['models', id],
    queryFn: () => api.models.graph(id),
    refetchInterval: false,
  });

  useReportSelectedNode((selectedTestNode ?? selectedModel)?.unique_id ?? null);

  // When graph re-fetches (e.g. after statuses_changed), refresh stale node references
  // so selectedTestNode always has the current status (needed for SidePane tab bar condition)
  useEffect(() => {
    if (!graph) return;
    setSelectedTestNode((prev) => {
      if (!prev) return prev;
      return graph.nodes.find((n) => n.unique_id === prev.unique_id) ?? prev;
    });
    setSelectedModel((prev) => {
      if (!prev) return prev;
      return graph.nodes.find((n) => n.unique_id === prev.unique_id) ?? prev;
    });
  }, [graph]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (treeResizing.current) {
        setTreeWidth((w) => Math.max(150, Math.min(500, w + e.movementX)));
      }
    };
    const onMouseUp = () => {
      treeResizing.current = false;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    window.addEventListener('mousedown', dismiss);
    return () => window.removeEventListener('mousedown', dismiss);
  }, [contextMenu]);

  const SESSION_KEY = `file-explorer-open-${id}`;
  const EXPANDED_KEY = `file-explorer-expanded-${id}`;

  const getExpandedPaths = useCallback((): Set<string> => {
    try {
      const raw = sessionStorage.getItem(EXPANDED_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  }, [EXPANDED_KEY]);

  const saveExpandedPaths = useCallback((paths: Set<string>) => {
    sessionStorage.setItem(EXPANDED_KEY, JSON.stringify([...paths]));
  }, [EXPANDED_KEY]);

  // Re-expand a flat tree by replaying the saved expanded paths breadth-first
  const reexpandTree = useCallback(async (rootNodes: TreeNode[], expandedPaths: Set<string>): Promise<TreeNode[]> => {
    if (expandedPaths.size === 0) return rootNodes;

    let current = rootNodes;

    // Walk each saved path and expand it, loading children if needed
    const expand = async (nodes: TreeNode[], parts: string[]): Promise<TreeNode[]> => {
      if (parts.length === 0) return nodes;
      const [head, ...rest] = parts;
      const results = await Promise.all(nodes.map(async (n) => {
        if (!n.is_dir || n.name !== head) return n;
        const children = n.children?.length ? n.children : (await api.files.list(id, n.path) as TreeNode[]);
        const expandedChildren = rest.length > 0 ? await expand(children, rest) : children;
        return { ...n, expanded: true, children: expandedChildren };
      }));
      return results;
    };

    for (const p of expandedPaths) {
      const parts = p.split('/');
      current = await expand(current, parts);
    }
    return current;
  }, [id]);

  const reloadDir = useCallback(async () => {
    const root = await api.files.list(id);
    const expandedPaths = getExpandedPaths();
    const reexpanded = await reexpandTree(root as TreeNode[], expandedPaths);
    setTree(reexpanded);
  }, [id, getExpandedPaths, reexpandTree]);

  useEffect(() => {
    reloadDir();
  }, [reloadDir]);

  useProjectEvents(id, useCallback((event) => {
    if (event.type === 'test_failed') {
      const d = event.data as { test_uid: string };
      setFailedTestUid(d.test_uid);
    }
  }, []));

  const loadFile = useCallback(async (path: string, testNode: ModelNode | null) => {
    const seq = ++loadSeqRef.current;
    setLoadingPath(path);
    setEdited(undefined);
    setSaveStatus('idle');
    setTargetTestNode(testNode);
    try {
      const file = await api.files.getContent(id, path);
      if (seq !== loadSeqRef.current) return;
      setOpenFile(file);
      // Resolve model for this file
      if (graph) {
        const node = graph.nodes.find((n) => n.original_file_path && path.endsWith(n.original_file_path));
        if (node) {
          setModelUid(node.unique_id);
          setSelectedModel(node);
        } else {
          setModelUid(null);
          setSelectedModel(null);
        }

        // For YAML files: auto-select a test node in the SidePane
        if (path.endsWith('.yml') || path.endsWith('.yaml')) {
          if (testNode) {
            // Specific test requested (e.g. from DAG deep-link)
            setSelectedTestNode(testNode);
          } else {
            // Auto-select first test defined in this file
            const firstTest = graph.nodes.find(
              (n) => n.resource_type === 'test' && n.original_file_path && path.endsWith(n.original_file_path)
            );
            setSelectedTestNode(firstTest ?? null);
          }
        } else {
          setSelectedTestNode(null);
        }
      }
    } catch (e) {
      // e.g. going back to a file that has since been deleted or renamed
      console.error(e);
      if (seq === loadSeqRef.current) setOpenFile(null);
    } finally {
      if (seq === loadSeqRef.current) setLoadingPath(null);
    }
  }, [id, graph]);

  /** Opens a file as a new history entry; the URL effect below does the actual load. */
  const openFileNode = useCallback((path: string) => {
    if (path === pathParam) return;
    setSearchParams({ path });
  }, [pathParam, setSearchParams]);

  /** Clears the open file (after delete/rename) without leaving a stale ?path= or session restore behind. */
  const closeFile = useCallback(() => {
    setOpenFile(null);
    setEdited(undefined);
    setModelUid(null);
    setSelectedModel(null);
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage unavailable */ }
    loadedKeyRef.current = null;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('path');
      next.delete('model');
      return next;
    }, { replace: true });
  }, [SESSION_KEY, setSearchParams]);

  // Persist open file path to sessionStorage whenever it changes
  useEffect(() => {
    if (openFile) {
      sessionStorage.setItem(SESSION_KEY, openFile.path);
    }
  }, [openFile, SESSION_KEY]);

  // Expand all ancestor directories of a file path so the file is visible in the tree.
  // Fetches all levels upfront, then applies a single setTree update to avoid stale-closure issues.
  const expandToPath = useCallback(async (filePath: string) => {
    const parts = filePath.split('/');
    const dirSegments = parts.slice(0, -1);
    if (dirSegments.length === 0) return;

    // Fetch children for every ancestor directory in parallel
    const childrenByPath: Record<string, TreeNode[]> = {};
    await Promise.all(
      dirSegments.map(async (_, i) => {
        const dirPath = dirSegments.slice(0, i + 1).join('/');
        childrenByPath[dirPath] = (await api.files.list(id, dirPath)) as TreeNode[];
      })
    );

    // Single tree update: walk down by segment name, expanding and injecting fetched children.
    // We only replace children for a directory when it has no children yet (first open); otherwise
    // we keep the existing subtree so already-expanded nested folders are not collapsed.
    setTree((prev) => {
      const expand = (nodes: TreeNode[], remaining: string[], depth: number): TreeNode[] =>
        nodes.map((n) => {
          if (!n.is_dir || n.name !== remaining[0]) return n;
          const dirPath = dirSegments.slice(0, depth + 1).join('/');
          const existingChildren = n.children ?? [];
          const children = existingChildren.length > 0 ? existingChildren : ((childrenByPath[dirPath] ?? []) as TreeNode[]);
          if (remaining.length === 1) {
            return { ...n, expanded: true, children };
          }
          return {
            ...n,
            expanded: true,
            children: expand(children, remaining.slice(1), depth + 1),
          };
        });
      return expand(prev, dirSegments, 0);
    });

    // Persist all expanded directory paths
    const expandedPaths = getExpandedPaths();
    dirSegments.forEach((_, i) => {
      expandedPaths.add(dirSegments.slice(0, i + 1).join('/'));
    });
    saveExpandedPaths(expandedPaths);
  }, [id, getExpandedPaths, saveExpandedPaths]);

  // The URL's ?path= is the open file: load it whenever it changes (click, back/forward).
  // Arriving without one, resolve the ?model= deep-link or the last-open file and write
  // it back with replace, so every history entry names its file.
  useEffect(() => {
    if (!graph) return;

    if (!pathParam) {
      const target = resolveDeepLinkPath(graph, modelParam) ?? readSessionPath(SESSION_KEY);
      if (target) {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set('path', target);
          return next;
        }, { replace: true });
      }
      return;
    }

    const key = `${pathParam}\n${modelParam ?? ''}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    // For test deep-links, scroll the editor to that test
    const testNode = graph.nodes.find((n) => n.unique_id === modelParam && n.resource_type === 'test') ?? null;
    expandToPath(pathParam);
    loadFile(pathParam, testNode);
  }, [graph, pathParam, modelParam, SESSION_KEY, setSearchParams, expandToPath, loadFile]);

  const loadChildren = useCallback(async (node: TreeNode, pathParts: string[]) => {
    if (!node.is_dir) return;
    const children = await api.files.list(id, node.path);
    const willExpand = !node.expanded;
    setTree((prev) => updateNode(prev, pathParts, (n) => ({
      ...n,
      expanded: willExpand,
      children: willExpand ? (children as TreeNode[]) : n.children,
    })));
    const expandedPaths = getExpandedPaths();
    if (willExpand) {
      expandedPaths.add(node.path);
    } else {
      // Collapse this folder and all descendants
      for (const p of expandedPaths) {
        if (p === node.path || p.startsWith(node.path + '/')) {
          expandedPaths.delete(p);
        }
      }
    }
    saveExpandedPaths(expandedPaths);
  }, [id, getExpandedPaths, saveExpandedPaths]);

  const collapseAll = useCallback(() => {
    saveExpandedPaths(new Set());
    setTree((prev) => {
      const collapse = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map((n) => ({ ...n, expanded: false, children: n.children ? collapse(n.children) : n.children }));
      return collapse(prev);
    });
  }, [saveExpandedPaths]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (openFile && edited !== undefined) handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFile, edited]);

  const handleSave = async () => {
    if (!openFile) return;
    setSaving(true);
    setSaveStatus('idle');
    try {
      const content = edited ?? openFile.content;
      const updated = await api.files.putContent(id, openFile.path, content);
      setOpenFile(updated);
      setEdited(undefined);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (e) {
      setSaveError(String(e));
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFile = async () => {
    if (!openFile) return;
    if (!confirm(`Delete '${openFile.path}'? This cannot be undone.`)) return;
    try {
      await api.files.delete(id, openFile.path);
      closeFile();
      await reloadDir();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteModel = async () => {
    if (!selectedModel) return;
    if (!confirm(`Delete model '${selectedModel.name}'? This removes the file from disk.`)) return;
    try {
      await api.models.delete(id, selectedModel.unique_id);
      closeFile();
      await reloadDir();
    } catch (e) {
      console.error(e);
    }
  };

  const handleContextRename = (node: TreeNode) => {
    setContextMenu(null);
    setRenameState({ path: node.path, currentName: node.name });
  };

  const handleContextDelete = async (node: TreeNode) => {
    setContextMenu(null);
    const label = node.is_dir ? `folder '${node.name}' and all its contents` : `'${node.name}'`;
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
    try {
      await api.files.delete(id, node.path);
      if (openFile?.path === node.path || openFile?.path.startsWith(node.path + '/')) {
        closeFile();
      }
      await reloadDir();
    } catch (e) {
      console.error(e);
    }
  };

  const handleContextNewFile = async (node: TreeNode) => {
    setContextMenu(null);
    const dirPath = node.is_dir ? node.path : node.path.split('/').slice(0, -1).join('/');
    const name = prompt('New file name:');
    if (!name?.trim()) return;
    try {
      await api.files.newFile(id, name.trim(), dirPath, false);
      await reloadDir();
    } catch (e) {
      alert(String(e));
    }
  };

  const handleContextNewFolder = async (node: TreeNode) => {
    setContextMenu(null);
    const dirPath = node.is_dir ? node.path : node.path.split('/').slice(0, -1).join('/');
    const name = prompt('New folder name:');
    if (!name?.trim()) return;
    try {
      await api.files.newFile(id, name.trim(), dirPath, true);
      await reloadDir();
    } catch (e) {
      alert(String(e));
    }
  };

  const handleContextCopyPath = (node: TreeNode) => {
    setContextMenu(null);
    navigator.clipboard.writeText(node.path).catch(console.error);
  };

  const handleContextCopyRelativePath = (node: TreeNode) => {
    setContextMenu(null);
    navigator.clipboard.writeText(node.path).catch(console.error);
  };

  const handleRenameSubmit = async (newName: string) => {
    if (!renameState) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === renameState.currentName) {
      setRenameState(null);
      return;
    }
    try {
      await api.files.rename(id, renameState.path, trimmed);
      if (openFile?.path === renameState.path) {
        closeFile();
      }
      await reloadDir();
    } catch (e) {
      alert(String(e));
    } finally {
      setRenameState(null);
    }
  };

  const isDirty = edited !== undefined && edited !== openFile?.content;
  const visibleTree = filterText.trim() ? filterTree(tree, filterText) : tree;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Side rail */}
      <NavRail projectId={id} current="files" />

      {/* File tree */}
      <div style={{ width: treeWidth }} className="shrink-0 bg-surface-app border-r border-gray-800 flex flex-col overflow-hidden relative">
        <div className="flex items-center gap-1 px-2 py-2 border-b border-gray-800 shrink-0">
          <input
            type="search"
            placeholder="Filter files…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="flex-1 bg-surface-elevated border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <button
            onClick={collapseAll}
            title="Collapse all folders"
            className="shrink-0 p-1 text-gray-600 hover:text-gray-300 transition-colors"
          >
            <ChevronsDownUp className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="overflow-auto flex-1 py-1">
          {visibleTree.map((node, i) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              pathParts={[String(i)]}
              onToggle={loadChildren}
              onOpen={openFileNode}
              activePath={openFile?.path ?? null}
              loadingPath={loadingPath}
              onContextMenu={(e, n, pp) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, node: n, pathParts: pp });
              }}
              renameState={renameState}
              onRenameSubmit={handleRenameSubmit}
            />
          ))}
        </div>
        <div
          onMouseDown={() => { treeResizing.current = true; }}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-brand-500/40 transition-colors"
        />
      </div>

      {/* Main editor area */}
      <div className="flex-1 overflow-hidden">
        {openFile ? (
          <ViewPane
            projectId={id}
            openFile={openFile}
            edited={edited}
            onEdit={setEdited}
            onSave={handleSave}
            onDelete={handleDeleteFile}
            saving={saving}
            saveStatus={saveStatus}
            saveError={saveError}
            isDirty={isDirty}
            modelUid={modelUid}
            graph={graph ?? null}
            onNavigateToFile={openFileNode}
            targetTestNode={targetTestNode}
            onTestSelected={(testNode) => setSelectedTestNode(testNode)}
          />
        ) : (
          <div className="flex items-center justify-center text-gray-600 text-sm select-none h-full">
            Select a file to view or edit
          </div>
        )}
      </div>

      {/* Side panel */}
      <SidePane
        projectId={id}
        model={selectedTestNode ?? selectedModel}
        graph={graph ?? null}
        page="files"
        onNavigateToDag={() => {
          const nav = selectedTestNode ?? selectedModel;
          nav && navigate(`/projects/${id}/models?model=${encodeURIComponent(nav.unique_id)}`);
        }}
        onViewDocs={() => {
          const nav = selectedTestNode ?? selectedModel;
          nav && navigate(`/projects/${id}/docs?node=${encodeURIComponent(nav.unique_id)}`);
        }}
        onDelete={handleDeleteModel}
        onNavigateToFile={openFileNode}
        previewCache={previewCache}
        onPreviewCached={(uid, data) => setPreviewCache((prev) => {
          const next = new Map(prev).set(uid, data);
          try { sessionStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify([...next])); } catch { /* quota */ }
          return next;
        })}
        failedTestUid={failedTestUid}
        onFailedTestConsumed={() => setFailedTestUid(null)}
        failedRowsCache={failedRowsCache}
        onFailedRowsCached={(uid, data) => setFailedRowsCache((prev) => {
          const next = new Map(prev).set(uid, data);
          try { sessionStorage.setItem(FAILED_ROWS_KEY, JSON.stringify([...next])); } catch { /* quota */ }
          return next;
        })}
      />

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          onRename={() => handleContextRename(contextMenu.node)}
          onDelete={() => handleContextDelete(contextMenu.node)}
          onNewFile={() => handleContextNewFile(contextMenu.node)}
          onNewFolder={() => handleContextNewFolder(contextMenu.node)}
          onCopyPath={() => handleContextCopyPath(contextMenu.node)}
          onCopyRelativePath={() => handleContextCopyRelativePath(contextMenu.node)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
