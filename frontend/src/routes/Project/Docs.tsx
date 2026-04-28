import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, BookOpen, Search, ChevronRight, ChevronDown,
  Database, FileCode2, Layers, FlaskConical, Sprout, Wrench,
  Copy, Check, Folder, FolderOpen, LayoutGrid, Package, ChevronsDownUp, Share2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { api, type DocsNodeDto, type DocsMacroDto } from '../../lib/api';
import { useProjectEvents } from '../../lib/sse';
import ProjectNav from './components/ProjectNav';

// ---- tree types ----

interface TreeLeaf {
  kind: 'leaf';
  uid: string;
  name: string;
  resourceType: string;
}

interface TreeDir {
  kind: 'dir';
  name: string;
  children: TreeNode[];
}

type TreeNode = TreeDir | TreeLeaf;

// ---- tree builders ----

/** Strip the leading resource-type directory from a path, e.g. "models/example/foo.sql" → ["example","foo.sql"] */
function pathSegments(rawPath: string | null, stripFirst = true): string[] {
  if (!rawPath) return [];
  const parts = rawPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return stripFirst && parts.length > 1 ? parts.slice(1) : parts;
}

function insertLeaf(root: TreeDir, segments: string[], leaf: TreeLeaf) {
  if (segments.length === 1) {
    root.children.push(leaf);
    return;
  }
  const dirName = segments[0];
  let dir = root.children.find((c): c is TreeDir => c.kind === 'dir' && c.name === dirName);
  if (!dir) {
    dir = { kind: 'dir', name: dirName, children: [] };
    root.children.push(dir);
  }
  insertLeaf(dir, segments.slice(1), leaf);
}

function sortTree(node: TreeDir) {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) {
    if (child.kind === 'dir') sortTree(child);
  }
}

/** Build a path-based folder tree from a flat list of nodes */
function buildNodeTree(items: DocsNodeDto[]): TreeDir {
  const root: TreeDir = { kind: 'dir', name: '', children: [] };
  for (const n of items) {
    const segs = pathSegments(n.path, true);
    const leaf: TreeLeaf = { kind: 'leaf', uid: n.unique_id, name: n.name, resourceType: n.resource_type };
    insertLeaf(root, segs.length > 0 ? segs : [n.name], leaf);
  }
  sortTree(root);
  return root;
}

/** Build database → schema → node tree */
function buildDatabaseTree(nodes: DocsNodeDto[]): TreeDir {
  const root: TreeDir = { kind: 'dir', name: '', children: [] };
  // Only include nodes that have database/schema info (models, seeds, snapshots, sources)
  const relevant = nodes.filter((n) =>
    ['model', 'seed', 'snapshot', 'source'].includes(n.resource_type)
  );
  for (const n of relevant) {
    const db = n.database || '(no database)';
    const schema = n.schema || '(no schema)';
    const leaf: TreeLeaf = { kind: 'leaf', uid: n.unique_id, name: n.name, resourceType: n.resource_type };
    insertLeaf(root, [db, schema, n.name], leaf);
  }
  sortTree(root);
  return root;
}

/** Build group → node tree. Nodes without a group go into "No Group". */
function buildGroupTree(nodes: DocsNodeDto[]): TreeDir {
  const root: TreeDir = { kind: 'dir', name: '', children: [] };
  const relevant = nodes.filter((n) =>
    ['model', 'seed', 'snapshot', 'source', 'analysis'].includes(n.resource_type)
  );
  for (const n of relevant) {
    const group = n.group || 'No Group';
    const leaf: TreeLeaf = { kind: 'leaf', uid: n.unique_id, name: n.name, resourceType: n.resource_type };
    insertLeaf(root, [group, n.name], leaf);
  }
  sortTree(root);
  return root;
}

/** For macros: project macros use their path tree; others are bucketed by package_name.
 *  "dbt" package → "Built-in" label. */
function buildMacroTopLevel(macros: DocsMacroDto[], projectName: string): TreeDir {
  const root: TreeDir = { kind: 'dir', name: '', children: [] };

  const byPkg = new Map<string, DocsMacroDto[]>();
  for (const m of macros) {
    const pkg = m.package_name ?? '';
    const list = byPkg.get(pkg) ?? [];
    list.push(m);
    byPkg.set(pkg, list);
  }

  // Project macros first — inline tree from path
  if (byPkg.has(projectName)) {
    const projectMacros = byPkg.get(projectName)!;
    const projectDir: TreeDir = { kind: 'dir', name: projectName, children: [] };
    for (const m of projectMacros) {
      const segs = pathSegments(m.path, true);
      const leaf: TreeLeaf = { kind: 'leaf', uid: m.unique_id, name: m.name, resourceType: 'macro' };
      insertLeaf(projectDir, segs.length > 0 ? segs : [m.name], leaf);
    }
    sortTree(projectDir);
    root.children.push(projectDir);
    byPkg.delete(projectName);
  }

  const BUILTIN_PKGS = new Set(['dbt']);
  const builtinMacros: DocsMacroDto[] = [];
  const otherPkgs = new Map<string, DocsMacroDto[]>();
  for (const [pkg, list] of byPkg) {
    if (BUILTIN_PKGS.has(pkg)) builtinMacros.push(...list);
    else otherPkgs.set(pkg, list);
  }

  if (builtinMacros.length > 0) {
    const builtinDir: TreeDir = { kind: 'dir', name: 'Built-in', children: [] };
    for (const m of builtinMacros) {
      const segs = pathSegments(m.path, true);
      const leaf: TreeLeaf = { kind: 'leaf', uid: m.unique_id, name: m.name, resourceType: 'macro' };
      insertLeaf(builtinDir, segs.length > 0 ? segs : [m.name], leaf);
    }
    sortTree(builtinDir);
    root.children.push(builtinDir);
  }

  for (const [pkg, list] of [...otherPkgs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const pkgDir: TreeDir = { kind: 'dir', name: pkg, children: [] };
    for (const m of list) {
      const segs = pathSegments(m.path, true);
      const leaf: TreeLeaf = { kind: 'leaf', uid: m.unique_id, name: m.name, resourceType: 'macro' };
      insertLeaf(pkgDir, segs.length > 0 ? segs : [m.name], leaf);
    }
    sortTree(pkgDir);
    root.children.push(pkgDir);
  }

  return root;
}

/** Collect all leaf UIDs in a tree matching a filter string */
function collectMatching(node: TreeNode, q: string): Set<string> {
  const result = new Set<string>();
  function walk(n: TreeNode) {
    if (n.kind === 'leaf') {
      if (n.name.toLowerCase().includes(q)) result.add(n.uid);
    } else {
      for (const c of n.children) walk(c);
    }
  }
  walk(node);
  return result;
}

/** Collect all dir paths that contain at least one matching leaf */
function expandedDirsForFilter(node: TreeDir, q: string): Set<string> {
  const expanded = new Set<string>();
  function walk(n: TreeDir, path: string): boolean {
    let hasMatch = false;
    for (const child of n.children) {
      if (child.kind === 'leaf') {
        if (child.name.toLowerCase().includes(q)) hasMatch = true;
      } else {
        if (walk(child, path + '/' + child.name)) hasMatch = true;
      }
    }
    if (hasMatch) expanded.add(path);
    return hasMatch;
  }
  walk(node, node.name);
  return expanded;
}

// ---- icons / colors ----

const TYPE_ORDER: Record<string, number> = {
  model: 0, seed: 1, snapshot: 2, source: 3, analysis: 4, test: 5, macro: 6,
};

const TYPE_LABELS: Record<string, string> = {
  model: 'Models', seed: 'Seeds', snapshot: 'Snapshots',
  source: 'Sources', analysis: 'Analyses', test: 'Tests', macro: 'Macros',
};

function resourceIcon(type: string, cls = 'w-3.5 h-3.5 shrink-0') {
  switch (type) {
    case 'model':    return <FileCode2 className={cls} />;
    case 'seed':     return <Sprout className={cls} />;
    case 'source':   return <Database className={cls} />;
    case 'snapshot': return <Layers className={cls} />;
    case 'test':     return <FlaskConical className={cls} />;
    case 'macro':    return <Wrench className={cls} />;
    default:         return <FileCode2 className={cls} />;
  }
}

function resourceColor(type: string) {
  switch (type) {
    case 'model':    return 'text-brand-400';
    case 'seed':     return 'text-emerald-400';
    case 'source':   return 'text-blue-400';
    case 'snapshot': return 'text-amber-400';
    case 'test':     return 'text-red-400';
    case 'macro':    return 'text-purple-400';
    default:         return 'text-gray-400';
  }
}

// ---- persistent expanded state ----

/** Find the path keys that must be open to reveal a leaf uid in the tree */
function findPathToUid(node: TreeDir, targetUid: string, prefix: string): string[] | null {
  for (const child of node.children) {
    if (child.kind === 'leaf') {
      if (child.uid === targetUid) return [prefix];
    } else {
      const childPath = prefix + '/' + child.name;
      const found = findPathToUid(child, targetUid, childPath);
      if (found) return [prefix, ...found];
    }
  }
  return null;
}

function useExpandedSet(storageKey: string): [Set<string>, (key: string, open: boolean) => void, () => void, (keys: string[]) => void] {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  const toggle = useCallback((key: string, open: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) {
        next.add(key);
      } else {
        // Also remove all descendants
        for (const k of next) {
          if (k === key || k.startsWith(key + '/')) next.delete(k);
        }
      }
      sessionStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });
  }, [storageKey]);

  const expandMany = useCallback((keys: string[]) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      sessionStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });
  }, [storageKey]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
    sessionStorage.removeItem(storageKey);
  }, [storageKey]);

  return [expanded, toggle, collapseAll, expandMany];
}

// ---- tab type ----

type DocsTab = 'project' | 'database' | 'group';

// ---- Docs page ----

export default function DocsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const [navWidth, setNavWidth] = useState(192);
  const [listWidth, setListWidth] = useState(300);
  const navResizing = useRef(false);
  const listResizing = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState('');
  const [docsTab, setDocsTab] = useState<DocsTab>('project');
  const autoGenerateTriggered = useRef(false);

  const [projectExpanded, setProjectExpanded, collapseProject, expandProjectMany] = useExpandedSet(`docs-expanded-project-${id}`);
  const [databaseExpanded, setDatabaseExpanded, collapseDatabase, expandDatabaseMany] = useExpandedSet(`docs-expanded-database-${id}`);
  const [groupExpanded, setGroupExpanded, collapseGroup, expandGroupMany] = useExpandedSet(`docs-expanded-group-${id}`);

  const collapseAll = docsTab === 'project' ? collapseProject : docsTab === 'database' ? collapseDatabase : collapseGroup;

  const selectedUid = searchParams.get('node') ?? null;

  const { data: status } = useQuery({
    queryKey: ['docs-status', id],
    queryFn: () => api.docs.status(id),
    refetchInterval: false,
  });

  const { data: docsData, isLoading: docsLoading } = useQuery({
    queryKey: ['docs-data', id],
    queryFn: () => api.docs.data(id),
    enabled: !!status?.generated_at,
    refetchInterval: false,
  });

  const hasDoc = !!status?.generated_at;
  const projectName = docsData?.project_name ?? '';

  useProjectEvents(id, useCallback((event) => {
    if (event.type === 'docs_generating') setGenerating(true);
    if (event.type === 'docs_generated') {
      setGenerating(false);
      qc.invalidateQueries({ queryKey: ['docs-status', id] });
      qc.invalidateQueries({ queryKey: ['docs-data', id] });
    }
  }, [id, qc]));

  useEffect(() => {
    if (autoGenerateTriggered.current) return;
    if (!status) return;
    if (!status.generated_at) {
      autoGenerateTriggered.current = true;
      setGenerating(true);
      api.docs.generate(id).catch(() => setGenerating(false));
    }
  }, [status, id]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (navResizing.current)  setNavWidth((w)  => Math.max(120, Math.min(320, w + e.movementX)));
      if (listResizing.current) setListWidth((w) => Math.max(160, Math.min(520, w + e.movementX)));
    };
    const onUp = () => { navResizing.current = false; listResizing.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const handleRefresh = async () => {
    setGenerating(true);
    try { await api.docs.generate(id); } catch { setGenerating(false); }
  };

  // Build trees for all three tab views
  const { projectSections, databaseTree, groupTree, nodeMap, macroMap } = useMemo(() => {
    const nodes = docsData?.nodes ?? [];
    const macros = docsData?.macros ?? [];

    const nMap = new Map<string, DocsNodeDto>(nodes.map((n) => [n.unique_id, n]));
    const mMap = new Map<string, DocsMacroDto>(macros.map((m) => [m.unique_id, m]));

    // Project tab: group nodes by resource_type
    const byType = new Map<string, DocsNodeDto[]>();
    for (const n of nodes) {
      const list = byType.get(n.resource_type) ?? [];
      list.push(n);
      byType.set(n.resource_type, list);
    }
    const nodeSections = [...byType.entries()]
      .sort(([a], [b]) => (TYPE_ORDER[a] ?? 9) - (TYPE_ORDER[b] ?? 9))
      .map(([type, items]) => ({
        id: `type:${type}`,
        label: TYPE_LABELS[type] ?? type,
        resourceType: type,
        tree: buildNodeTree(items),
      }));
    const macroSection = macros.length > 0
      ? [{ id: 'type:macro', label: 'Macros', resourceType: 'macro', tree: buildMacroTopLevel(macros, projectName) }]
      : [];

    return {
      projectSections: [...nodeSections, ...macroSection],
      databaseTree: buildDatabaseTree(nodes),
      groupTree: buildGroupTree(nodes),
      nodeMap: nMap,
      macroMap: mMap,
    };
  }, [docsData, projectName]);

  // Auto-select the project overview on load
  useEffect(() => {
    if (docsData && !selectedUid) {
      setSearchParams({ node: '__project__' }, { replace: true });
    }
  }, [docsData, selectedUid, setSearchParams]);

  // When a node is selected (e.g. via ReferencedBy link), expand the tree to reveal it
  useEffect(() => {
    if (!selectedUid || selectedUid === '__project__' || !docsData) return;
    // Project tab: sections like "type:model/folder/..."
    for (const section of projectSections) {
      const paths = findPathToUid(section.tree, selectedUid, section.id);
      if (paths) {
        expandProjectMany(paths);
        break;
      }
    }
    // Database tab
    const dbPaths = findPathToUid(databaseTree, selectedUid, '');
    if (dbPaths) expandDatabaseMany(dbPaths.filter(Boolean));
    // Group tab
    const grpPaths = findPathToUid(groupTree, selectedUid, '');
    if (grpPaths) expandGroupMany(grpPaths.filter(Boolean));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUid, docsData]);

  // Clear filter when switching tabs
  useEffect(() => { setFilter(''); }, [docsTab]);

  const isProjectOverview = selectedUid === '__project__';
  const selectedNode = selectedUid && !isProjectOverview ? nodeMap.get(selectedUid) ?? null : null;
  const selectedMacro = selectedUid && !isProjectOverview ? macroMap.get(selectedUid) ?? null : null;
  const q = filter.toLowerCase().trim();

  const TABS: { id: DocsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'project',  label: 'Project',  icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: 'database', label: 'Database', icon: <Database className="w-3.5 h-3.5" /> },
    { id: 'group',    label: 'Group',    icon: <LayoutGrid className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Nav rail */}
      <div style={{ width: navWidth }} className="shrink-0 bg-surface-panel border-r border-gray-800 flex flex-col overflow-hidden relative">
        <ProjectNav projectId={id} current="docs" />
        <div onMouseDown={() => { navResizing.current = true; }} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-brand-500/40 transition-colors" />
      </div>

      {/* Folder tree panel */}
      <div style={{ width: listWidth }} className="shrink-0 bg-surface-app border-r border-gray-800 flex flex-col overflow-hidden relative">
        {/* Header */}
        <div className="px-3 py-2 border-b border-gray-800 shrink-0 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-gray-400 font-medium">
              <BookOpen className="w-3.5 h-3.5" /> Documentation
            </span>
            <button onClick={handleRefresh} disabled={generating} title="Regenerate docs" className="p-1 rounded text-gray-500 hover:text-gray-300 disabled:opacity-50 transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Project / Database / Group tabs */}
          <div className="flex items-center gap-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setDocsTab(t.id)}
                className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors flex-1 justify-center
                  ${docsTab === t.id
                    ? 'bg-brand-900/50 text-brand-300'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-surface-elevated/40'
                  }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-600 pointer-events-none" />
              <input type="search" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)}
                className="w-full bg-surface-elevated border border-gray-700 rounded pl-6 pr-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <button
              onClick={collapseAll}
              title="Collapse all folders"
              className="shrink-0 p-1 text-gray-600 hover:text-gray-300 transition-colors"
            >
              <ChevronsDownUp className="w-3.5 h-3.5" />
            </button>
          </div>
          {status?.generated_at && (
            <p className="text-[10px] text-gray-700 truncate">{new Date(status.generated_at).toLocaleString()}</p>
          )}
        </div>

        {/* Tree */}
        <div className="overflow-auto flex-1 py-1 select-none">
          {generating && !hasDoc && (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-600">
              <RefreshCw className="w-5 h-5 animate-spin text-brand-400" />
              <span className="text-xs">Generating…</span>
            </div>
          )}
          {!generating && !hasDoc && (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-600 px-4 text-center">
              <BookOpen className="w-6 h-6" />
              <p className="text-xs">No docs yet.</p>
              <button onClick={handleRefresh} className="px-3 py-1 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white transition-colors">Generate</button>
            </div>
          )}
          {!generating && hasDoc && docsLoading && (
            <div className="flex items-center justify-center h-16 text-xs text-gray-600">Loading…</div>
          )}
          {!generating && hasDoc && !docsLoading && (
            <>
              {docsTab === 'project' && (
                <ProjectRootTree
                  projectName={projectName}
                  sections={projectSections}
                  selectedUid={selectedUid}
                  onSelect={(uid) => setSearchParams({ node: uid }, { replace: true })}
                  filterQ={q}
                  expanded={projectExpanded}
                  onToggle={setProjectExpanded}
                />
              )}
              {docsTab === 'database' && (
                <FlatTree
                  tree={databaseTree}
                  selectedUid={selectedUid}
                  onSelect={(uid) => setSearchParams({ node: uid }, { replace: true })}
                  filterQ={q}
                  emptyLabel="No database objects found."
                  expanded={databaseExpanded}
                  onToggle={setDatabaseExpanded}
                />
              )}
              {docsTab === 'group' && (
                <FlatTree
                  tree={groupTree}
                  selectedUid={selectedUid}
                  onSelect={(uid) => setSearchParams({ node: uid }, { replace: true })}
                  filterQ={q}
                  emptyLabel="No grouped nodes found."
                  expanded={groupExpanded}
                  onToggle={setGroupExpanded}
                />
              )}
            </>
          )}
        </div>

        <div onMouseDown={() => { listResizing.current = true; }} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-brand-500/40 transition-colors" />
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-auto bg-surface-app">
        {isProjectOverview && (
          <ProjectOverview
            projectId={id}
            projectName={projectName}
            description={docsData?.project_description ?? ''}
          />
        )}
        {selectedNode && <NodeDetail node={selectedNode} allNodes={nodeMap} projectId={id} />}
        {selectedMacro && <MacroDetail macro={selectedMacro} />}
        {!isProjectOverview && !selectedNode && !selectedMacro && (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm select-none">
            Select a node to view documentation
          </div>
        )}
      </div>
    </div>
  );
}

// ---- ProjectRootTree (Project tab wrapper) ----

interface ProjectRootTreeProps {
  projectName: string;
  sections: { id: string; label: string; resourceType: string; tree: TreeDir }[];
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  filterQ: string;
  expanded: Set<string>;
  onToggle: (key: string, open: boolean) => void;
}

function ProjectRootTree({ projectName, sections, selectedUid, onSelect, filterQ, expanded, onToggle }: ProjectRootTreeProps) {
  const isFilterActive = filterQ.length > 0;
  // Default open if not explicitly collapsed
  const open = isFilterActive || !expanded.has('__root__:closed');

  const handleToggle = () => {
    // We track closed state specially so default is open
    if (open) {
      onToggle('__root__:closed', true);
    } else {
      onToggle('__root__:closed', false);
    }
  };

  const isSelected = selectedUid === '__project__';

  return (
    <div>
      {/* Project root row */}
      <div className="flex items-center">
        <button
          onClick={handleToggle}
          className="p-1 pl-2 text-gray-600 hover:text-gray-400 shrink-0"
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <button
          onClick={() => onSelect('__project__')}
          className={`flex-1 text-left py-1 pr-3 text-xs flex items-center gap-1.5 transition-colors
            ${isSelected
              ? 'text-brand-300'
              : 'text-gray-300 hover:text-gray-100'
            }`}
        >
          <Package className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-brand-400' : 'text-brand-500'}`} />
          <span className="font-semibold truncate">{projectName}</span>
          {isSelected && <ChevronRight className="w-3 h-3 ml-auto shrink-0 opacity-60" />}
        </button>
      </div>

      {/* Nested sections */}
      {open && (
        <div className="pl-3">
          {sections.map((section) => (
            <SectionTree
              key={section.id}
              sectionKey={section.id}
              label={section.label}
              resourceType={section.resourceType}
              tree={section.tree}
              selectedUid={selectedUid}
              onSelect={onSelect}
              filterQ={filterQ}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );

}

// ---- SectionTree (Project tab) ----

interface SectionTreeProps {
  sectionKey: string;
  label: string;
  resourceType: string;
  tree: TreeDir;
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  filterQ: string;
  expanded: Set<string>;
  onToggle: (key: string, open: boolean) => void;
}

function SectionTree({ sectionKey, label, resourceType, tree, selectedUid, onSelect, filterQ, expanded, onToggle }: SectionTreeProps) {
  const { matchingUids, expandedDirs } = useMemo(() => {
    if (!filterQ) return { matchingUids: null, expandedDirs: null };
    return {
      matchingUids: collectMatching(tree, filterQ),
      expandedDirs: expandedDirsForFilter(tree, filterQ),
    };
  }, [tree, filterQ]);

  const visibleCount = matchingUids?.size ?? null;
  if (matchingUids !== null && matchingUids.size === 0) return null;

  const totalCount = useMemo(() => {
    let n = 0;
    function walk(node: TreeNode) {
      if (node.kind === 'leaf') n++;
      else node.children.forEach(walk);
    }
    tree.children.forEach(walk);
    return n;
  }, [tree]);

  const isFilterActive = !!filterQ && matchingUids !== null && matchingUids.size > 0;
  const open = isFilterActive || expanded.has(sectionKey);

  return (
    <div className="mb-0.5">
      <button
        onClick={() => onToggle(sectionKey, !open)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-wider text-gray-500 font-semibold hover:text-gray-300 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <span className={`${resourceColor(resourceType)}`}>{resourceIcon(resourceType, 'w-3 h-3 shrink-0')}</span>
        <span className="text-gray-500">{label}</span>
        <span className="text-gray-700 font-normal normal-case ml-0.5">
          ({visibleCount !== null ? visibleCount : totalCount})
        </span>
      </button>

      {open && (
        <div>
          {tree.children.map((child) => (
            <TreeNodeRow
              key={child.kind === 'leaf' ? child.uid : child.name}
              node={child}
              depth={1}
              resourceType={resourceType}
              selectedUid={selectedUid}
              onSelect={onSelect}
              matchingUids={matchingUids}
              expandedDirs={expandedDirs}
              pathKey={sectionKey + '/' + (child.kind === 'dir' ? child.name : '')}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- FlatTree (Database / Group tabs) ----
// Renders a flat tree of dirs with no section header — the top-level dirs (database names / group names)
// are rendered directly as collapsible rows.

interface FlatTreeProps {
  tree: TreeDir;
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  filterQ: string;
  emptyLabel: string;
  expanded: Set<string>;
  onToggle: (key: string, open: boolean) => void;
}

function FlatTree({ tree, selectedUid, onSelect, filterQ, emptyLabel, expanded, onToggle }: FlatTreeProps) {
  const q = filterQ.toLowerCase().trim();
  const matchingUids = useMemo(() => q ? collectMatching(tree, q) : null, [tree, q]);
  const expandedDirs = useMemo(() => q ? expandedDirsForFilter(tree, q) : null, [tree, q]);

  const visible = matchingUids !== null
    ? tree.children.filter((child) => {
        const uids = matchingUids as Set<string>;
        const anyMatch = (n: TreeNode): boolean =>
          n.kind === 'leaf' ? uids.has(n.uid) : n.children.some(anyMatch);
        return anyMatch(child);
      })
    : tree.children;

  if (visible.length === 0) {
    return <p className="text-xs text-gray-600 italic px-3 py-4">{emptyLabel}</p>;
  }

  return (
    <div>
      {visible.map((child) => (
        <TreeNodeRow
          key={child.kind === 'leaf' ? child.uid : child.name}
          node={child}
          depth={1}
          resourceType={child.kind === 'leaf' ? child.resourceType : ''}
          selectedUid={selectedUid}
          onSelect={onSelect}
          matchingUids={matchingUids}
          expandedDirs={expandedDirs}
          pathKey={child.kind === 'dir' ? child.name : ''}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

// ---- TreeNodeRow ----

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  resourceType: string;
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  matchingUids: Set<string> | null;
  expandedDirs: Set<string> | null;
  pathKey: string;
  expanded: Set<string>;
  onToggle: (key: string, open: boolean) => void;
}

function TreeNodeRow({ node, depth, resourceType, selectedUid, onSelect, matchingUids, expandedDirs, pathKey, expanded, onToggle }: TreeNodeRowProps) {
  const isFilterActive = matchingUids !== null;
  const open = isFilterActive ? (expandedDirs?.has(pathKey) ?? false) : expanded.has(pathKey);

  const indent = depth * 12;

  if (node.kind === 'leaf') {
    if (matchingUids && !matchingUids.has(node.uid)) return null;
    const isSelected = node.uid === selectedUid;
    return (
      <button
        onClick={() => onSelect(node.uid)}
        style={{ paddingLeft: indent + 4 }}
        className={`w-full text-left py-1 pr-3 text-xs flex items-center gap-1.5 transition-colors group
          ${isSelected
            ? 'bg-brand-900/40 text-brand-300'
            : 'text-gray-400 hover:text-gray-200 hover:bg-surface-elevated/50'
          }`}
      >
        <span className={`shrink-0 ${isSelected ? 'text-brand-400' : resourceColor(node.resourceType)}`}>
          {resourceIcon(node.resourceType, 'w-3.5 h-3.5 shrink-0')}
        </span>
        <span className="truncate font-mono">{node.name}</span>
        {isSelected && <ChevronRight className="w-3 h-3 ml-auto shrink-0 opacity-60" />}
      </button>
    );
  }

  // Directory — hide if filter active and no matching children
  if (matchingUids !== null) {
    const uids = matchingUids;
    const hasMatch = (() => {
      function anyMatch(n: TreeNode): boolean {
        if (n.kind === 'leaf') return uids.has(n.uid);
        return n.children.some(anyMatch);
      }
      return node.children.some(anyMatch);
    })();
    if (!hasMatch) return null;
  }

  return (
    <div>
      <button
        onClick={() => !isFilterActive && onToggle(pathKey, !open)}
        style={{ paddingLeft: indent }}
        className="w-full text-left py-1 pr-3 text-xs flex items-center gap-1.5 text-gray-500 hover:text-gray-300 transition-colors"
      >
        <span className="shrink-0 text-gray-600">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        <span className="shrink-0 text-gray-600">
          {open ? <FolderOpen className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}
        </span>
        <span className="truncate">{node.name}</span>
      </button>
      {open && node.children.map((child) => (
        <TreeNodeRow
          key={child.kind === 'leaf' ? child.uid : child.name}
          node={child}
          depth={depth + 1}
          resourceType={child.kind === 'leaf' ? child.resourceType : resourceType}
          selectedUid={selectedUid}
          onSelect={onSelect}
          matchingUids={matchingUids}
          expandedDirs={expandedDirs}
          pathKey={pathKey + '/' + child.name}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

// ---- ProjectOverview ----

type ProjectTab = 'overview' | 'readme';

function ProjectOverview({ projectId, projectName, description }: {
  projectId: number;
  projectName: string;
  description: string;
}) {
  const [tab, setTab] = useState<ProjectTab>('overview');

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.projects.get(projectId),
  });

  const TABS: { id: ProjectTab; label: string }[] = [
    { id: 'overview', label: 'Project Overview' },
    { id: 'readme',   label: 'README' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 pt-6 pb-0 shrink-0">
        <div className="flex items-baseline gap-3 mb-4">
          <Package className="w-6 h-6 text-brand-400 shrink-0" />
          <h1 className="text-2xl font-semibold text-gray-100 font-mono">{projectName}</h1>
        </div>
        {/* Centered tabs */}
        <div className="flex justify-center border-b border-gray-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-6 py-2 text-sm font-medium transition-colors relative ${tab === t.id ? 'text-brand-300' : 'text-gray-500 hover:text-gray-300'}`}
            >
              {t.label}
              {tab === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-400 rounded-t" />}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === 'overview' && (
          <div className="px-8 py-6">
            {description ? (
              <div className="prose-readme">
                <ReactMarkdown>{description}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-gray-600 italic">No project overview available.</p>
            )}
          </div>
        )}
        {tab === 'readme' && (
          <div className="px-8 py-6">
            {project?.readme ? (
              <div className="prose-readme">
                <ReactMarkdown>{project.readme}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-gray-600 italic">No README found in this project.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- NodeDetail ----

type NodeTab = 'details' | 'description' | 'columns' | 'referenced_by' | 'code';

function NodeDetail({ node, allNodes, projectId }: { node: DocsNodeDto; allNodes: Map<string, DocsNodeDto>; projectId: number }) {
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<NodeTab>('details');
  const [codeView, setCodeView] = useState<'source' | 'compiled'>('source');
  const [copied, setCopied] = useState(false);
  const isTest = node.resource_type === 'test';

  useEffect(() => { setTab('details'); }, [node.unique_id]);

  const tabs: { id: NodeTab; label: string }[] = [
    { id: 'details', label: 'Details' },
    { id: 'description', label: 'Description' },
    ...(node.columns.length > 0 ? [{ id: 'columns' as NodeTab, label: 'Columns' }] : []),
    ...(node.child_models.length > 0 || node.child_tests.length > 0 ? [{ id: 'referenced_by' as NodeTab, label: 'Referenced By' }] : []),
    ...(!isTest && (node.raw_code || node.compiled_code) ? [{ id: 'code' as NodeTab, label: 'Code' }] : []),
  ];

  const handleCopy = () => {
    const code = codeView === 'compiled' ? node.compiled_code : node.raw_code;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-6 pb-0 shrink-0 flex items-start justify-between">
        <div>
          <div className="flex items-baseline gap-3 mb-1">
            <h1 className="text-2xl font-semibold text-gray-100 font-mono">{node.name}</h1>
            {node.catalog_type && <span className="text-sm text-gray-500">{node.catalog_type.toLowerCase()}</span>}
            {!node.catalog_type && node.materialized && <span className="text-sm text-gray-500">{node.materialized}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1 shrink-0">
          <button
            onClick={() => navigate(`/projects/${projectId}/files?model=${encodeURIComponent(node.unique_id)}`)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-gray-700 bg-surface-elevated hover:bg-gray-700 text-gray-300 transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Files
          </button>
          <button
            onClick={() => navigate(`/projects/${projectId}/models?model=${encodeURIComponent(node.unique_id)}`)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-gray-700 bg-surface-elevated hover:bg-gray-700 text-gray-300 transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" />
            DAG
          </button>
        </div>
      </div>
      <div className="px-8 shrink-0">
        <div className="flex items-center gap-0 mt-4 border-b border-gray-800">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors relative ${tab === t.id ? 'text-brand-300' : 'text-gray-500 hover:text-gray-300'}`}>
              {t.label}
              {tab === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-400 rounded-t" />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {tab === 'details' && (
          <div className="flex flex-col gap-6">
            <section>
              <h2 className="text-sm font-semibold text-gray-200 mb-3">Details</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-6 gap-y-3 text-xs">
                <MetaCell label="Tags" value={node.tags.length > 0 ? node.tags.join(', ') : 'untagged'} />
                {node.owner && <MetaCell label="Owner" value={node.owner} />}
                {node.catalog_type && <MetaCell label="Type" value={node.catalog_type} />}
                {node.package_name && <MetaCell label="Package" value={node.package_name} />}
                {node.language && <MetaCell label="Language" value={node.language} />}
                {node.relation_name && <MetaCell label="Relation" value={node.relation_name} />}
                {node.access && <MetaCell label="Access" value={node.access} />}
                {node.group && <MetaCell label="Group" value={node.group} />}
                {node.materialized && <MetaCell label="Materialized" value={node.materialized} />}
                <MetaCell label="Contract" value={node.contract ? 'Enforced' : 'Not Enforced'} />
              </div>
            </section>
            {node.description && (
              <section>
                <h2 className="text-sm font-semibold text-gray-200 mb-2">Description</h2>
                <p className="text-sm text-gray-300 leading-relaxed">{node.description}</p>
              </section>
            )}
            {node.columns.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-200 mb-3">Columns</h2>
                <ColumnsTable columns={node.columns} compact />
              </section>
            )}
            {(node.child_models.length > 0 || node.child_tests.length > 0) && (
              <section>
                <h2 className="text-sm font-semibold text-gray-200 mb-3">Referenced By</h2>
                <ReferencedBy childModels={node.child_models} childTests={node.child_tests} allNodes={allNodes} onSelect={(uid) => setSearchParams({ node: uid }, { replace: true })} />
              </section>
            )}
            {!isTest && (node.raw_code || node.compiled_code) && (
              <section>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-sm font-semibold text-gray-200">Code</h2>
                  <CodeViewToggle value={codeView} onChange={setCodeView} />
                  <CopyButton copied={copied} onCopy={handleCopy} />
                </div>
                <CodeBlock code={codeView === 'compiled' ? node.compiled_code : node.raw_code} placeholder={`No ${codeView} SQL available.`} />
              </section>
            )}
          </div>
        )}
        {tab === 'description' && (
          <div className="flex flex-col gap-4 max-w-2xl">
            <h2 className="text-sm font-semibold text-gray-200">Description</h2>
            {node.description
              ? <p className="text-sm text-gray-300 leading-relaxed">{node.description}</p>
              : <p className="text-sm text-gray-600 italic">No description provided.</p>}
            {node.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {node.tags.map((t) => <Tag key={t} label={`#${t}`} />)}
              </div>
            )}
          </div>
        )}
        {tab === 'columns' && (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-gray-200">Columns <span className="font-normal text-gray-600">({node.columns.length})</span></h2>
            <ColumnsTable columns={node.columns} />
          </div>
        )}
        {tab === 'referenced_by' && (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-gray-200">Referenced By</h2>
            <ReferencedBy childModels={node.child_models} childTests={node.child_tests} allNodes={allNodes} onSelect={(uid) => setSearchParams({ node: uid }, { replace: true })} />
          </div>
        )}
        {tab === 'code' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-gray-200">Code</h2>
              <CodeViewToggle value={codeView} onChange={setCodeView} />
              <CopyButton copied={copied} onCopy={handleCopy} />
            </div>
            <CodeBlock code={codeView === 'compiled' ? node.compiled_code : node.raw_code} placeholder={`No ${codeView} SQL available.`} />
          </div>
        )}
      </div>
    </div>
  );
}

function MacroDetail({ macro }: { macro: DocsMacroDto }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(macro.macro_sql).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-6 flex flex-col gap-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-gray-100 font-mono">{macro.name}</h1>
        <span className="text-sm text-gray-500">macro</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-6 gap-y-3 text-xs">
        {macro.package_name && <MetaCell label="Package" value={macro.package_name} />}
        {macro.path && <MetaCell label="Path" value={macro.path} />}
      </div>
      {macro.description
        ? <p className="text-sm text-gray-300 leading-relaxed">{macro.description}</p>
        : <p className="text-sm text-gray-600 italic">No description provided.</p>}
      {macro.arguments.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-200 mb-3">Arguments</h2>
          <div className="rounded-lg border border-gray-800 overflow-hidden">
            <table className="w-full text-xs text-gray-300 border-collapse">
              <thead>
                <tr className="bg-surface-elevated text-gray-500">
                  <th className="px-3 py-2 text-left font-medium border-b border-gray-800">Name</th>
                  <th className="px-3 py-2 text-left font-medium border-b border-gray-800">Type</th>
                  <th className="px-3 py-2 text-left font-medium border-b border-gray-800">Description</th>
                </tr>
              </thead>
              <tbody>
                {macro.arguments.map((arg, i) => (
                  <tr key={arg.name} className={`border-b border-gray-800/60 ${i % 2 === 0 ? '' : 'bg-surface-elevated/20'}`}>
                    <td className="px-3 py-2 font-mono text-brand-300">{arg.name}</td>
                    <td className="px-3 py-2 font-mono text-gray-500">{arg.type || '—'}</td>
                    <td className="px-3 py-2 text-gray-400">{arg.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {macro.macro_sql && (
        <section>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-sm font-semibold text-gray-200">Macro SQL</h2>
            <CopyButton copied={copied} onCopy={handleCopy} />
          </div>
          <CodeBlock code={macro.macro_sql} placeholder="No SQL." />
        </section>
      )}
    </div>
  );
}

// ---- shared sub-components ----

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">{label}</span>
      <span className="text-gray-300 text-xs font-mono break-all">{value}</span>
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-elevated text-gray-500 font-mono">{label}</span>;
}

function CodeBlock({ code, placeholder }: { code: string; placeholder: string }) {
  if (!code) return <p className="text-xs text-gray-600 italic">{placeholder}</p>;
  return (
    <pre className="bg-surface-elevated border border-gray-800 rounded-lg p-4 text-xs font-mono text-gray-300 overflow-auto max-h-[500px] leading-relaxed whitespace-pre">
      {code}
    </pre>
  );
}

function CodeViewToggle({ value, onChange }: { value: 'source' | 'compiled'; onChange: (v: 'source' | 'compiled') => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-surface-elevated rounded p-0.5">
      {(['source', 'compiled'] as const).map((v) => (
        <button key={v} onClick={() => onChange(v)}
          className={`px-2.5 py-0.5 text-xs rounded capitalize transition-colors ${value === v ? 'bg-brand-900/60 text-brand-300' : 'text-gray-500 hover:text-gray-300'}`}>
          {v}
        </button>
      ))}
    </div>
  );
}

function CopyButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <button onClick={onCopy} className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied!' : 'Copy to clipboard'}
    </button>
  );
}

function ColumnsTable({ columns, compact = false }: { columns: DocsNodeDto['columns']; compact?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-800 overflow-hidden">
      <table className="w-full text-xs text-gray-300 border-collapse">
        <thead>
          <tr className="bg-surface-elevated text-gray-500 text-[10px] uppercase tracking-wider">
            <th className="px-3 py-2 text-left font-medium border-b border-gray-800">Column</th>
            <th className="px-3 py-2 text-left font-medium border-b border-gray-800">Type</th>
            <th className="px-3 py-2 text-left font-medium border-b border-gray-800">Description</th>
            {!compact && <th className="px-3 py-2 text-left font-medium border-b border-gray-800">Constraints</th>}
            <th className="px-3 py-2 text-left font-medium border-b border-gray-800">Tests</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((col, i) => (
            <tr key={col.name} className={`border-b border-gray-800/50 ${i % 2 === 0 ? '' : 'bg-surface-elevated/20'}`}>
              <td className="px-3 py-2 font-mono text-brand-300 whitespace-nowrap">{col.name}</td>
              <td className="px-3 py-2 font-mono text-gray-500 whitespace-nowrap">{col.data_type || '—'}</td>
              <td className="px-3 py-2 text-gray-400">{col.description || <span className="text-gray-700 italic">—</span>}</td>
              {!compact && (
                <td className="px-3 py-2 text-gray-500">
                  {col.constraints.length > 0
                    ? col.constraints.map((c, j) => <span key={j} className="mr-1 font-mono text-[10px]">{String(c)}</span>)
                    : '—'}
                </td>
              )}
              <td className="px-3 py-2">
                {col.tests.length > 0
                  ? <div className="flex gap-1 flex-wrap">{col.tests.map((t) => <TestBadge key={t} name={t} />)}</div>
                  : <span className="text-gray-700">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TEST_ABBREV: Record<string, string> = {
  unique: 'U', not_null: 'N', accepted_values: 'A', relationships: 'R',
};

function TestBadge({ name }: { name: string }) {
  const abbrev = TEST_ABBREV[name] ?? name.slice(0, 2).toUpperCase();
  const colors: Record<string, string> = {
    unique: 'bg-blue-900/40 text-blue-300 border-blue-800',
    not_null: 'bg-orange-900/40 text-orange-300 border-orange-800',
    accepted_values: 'bg-green-900/40 text-green-300 border-green-800',
    relationships: 'bg-purple-900/40 text-purple-300 border-purple-800',
  };
  return (
    <span title={name} className={`text-[10px] font-mono px-1 py-0.5 rounded border ${colors[name] ?? 'bg-surface-elevated text-gray-400 border-gray-700'}`}>
      {abbrev}
    </span>
  );
}

function ReferencedBy({ childModels, childTests, allNodes, onSelect }: {
  childModels: string[];
  childTests: string[];
  allNodes: Map<string, DocsNodeDto>;
  onSelect: (uid: string) => void;
}) {
  const [tab, setTab] = useState<'models' | 'tests'>('models');
  return (
    <div>
      <div className="flex items-center gap-0 mb-3 border-b border-gray-800">
        {(['models', 'tests'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors relative ${tab === t ? 'text-brand-300' : 'text-gray-500 hover:text-gray-300'}`}>
            {t === 'models' ? 'Models' : 'Data Tests'}
            {tab === t && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-400 rounded-t" />}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        {tab === 'models' && (
          childModels.length === 0
            ? <p className="text-xs text-gray-600 italic">No models reference this node.</p>
            : childModels.map((uid) => {
                const n = allNodes.get(uid);
                return (
                  <button
                    key={uid}
                    onClick={() => onSelect(uid)}
                    className="text-left text-xs font-mono text-brand-400 hover:text-brand-300 hover:underline transition-colors"
                  >
                    {n?.name ?? uid.split('.').pop()}
                  </button>
                );
              })
        )}
        {tab === 'tests' && (
          childTests.length === 0
            ? <p className="text-xs text-gray-600 italic">No data tests for this node.</p>
            : childTests.map((uid) => {
                const n = allNodes.get(uid);
                return (
                  <button
                    key={uid}
                    onClick={() => onSelect(uid)}
                    className="text-left text-xs font-mono text-gray-400 hover:text-gray-200 hover:underline transition-colors"
                  >
                    {n?.name ?? uid.split('.').pop()}
                  </button>
                );
              })
        )}
      </div>
    </div>
  );
}
