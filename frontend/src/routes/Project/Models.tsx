import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type OnSelectionChangeParams,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { api, type ModelNode, type GraphDto } from '../../lib/api';
import { useProjectEvents } from '../../lib/sse';
import ModelNodeComponent from './components/ModelNode';
import NewModelModal from './components/NewModelModal';
import NavRail from './components/NavRail';
import { SidePane } from './components/SidePane';
import { type ShowRows } from './components/SidePane/PropertiesTab';
import DagFilterBar from './components/DagFilterBar';
import { computeLayout, NODE_HEIGHT } from './lib/layout';
import { type FilterState, defaultFilter, applyFilter, serializeFilter, deserializeFilter } from './lib/dagFilter';
import { ColumnLineageContext, type ColumnLineageContextValue } from './lib/columnLineageContext';

type LiveStatus = 'running' | 'success' | 'error' | 'warn';

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function lastName(dotted: string): string {
  const parts = dotted.split('.');
  return parts[parts.length - 1];
}

function parseStartName(raw: string): string | null {
  const line = stripAnsi(raw).trim();
  const modelMatch = line.match(/\d+ of \d+ START .+ model (\S+)/);
  if (modelMatch) return lastName(modelMatch[1]);
  const testMatch = line.match(/\d+ of \d+ START test (\S+)/);
  if (testMatch) return lastName(testMatch[1]);
  return null;
}

function parseResultEntry(raw: string): { name: string; status: LiveStatus } | null {
  const line = stripAnsi(raw).trim();
  const modelMatch = line.match(/\d+ of \d+ (OK|ERROR|WARN) .+ model (\S+)/);
  if (modelMatch) {
    const kw = modelMatch[1];
    const status: LiveStatus = kw === 'ERROR' ? 'error' : kw === 'WARN' ? 'warn' : 'success';
    return { name: lastName(modelMatch[2]), status };
  }
  const testPassMatch = line.match(/\d+ of \d+ PASS \d* *(\S+)/);
  if (testPassMatch) return { name: lastName(testPassMatch[1]), status: 'success' };
  const testFailMatch = line.match(/\d+ of \d+ FAIL \d+ +(\S+)/);
  if (testFailMatch) return { name: lastName(testFailMatch[1]), status: 'error' };
  return null;
}

function applyLiveStatuses(graph: GraphDto, liveStatuses: Record<string, LiveStatus>): GraphDto {
  if (Object.keys(liveStatuses).length === 0) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      liveStatuses[n.name] ? { ...n, status: liveStatuses[n.name] } : n,
    ),
  };
}

function FitViewOnFirstLoad({ trigger }: { trigger: unknown }) {
  const { fitView } = useReactFlow();
  const hasFit = useRef(false);
  useEffect(() => {
    if (hasFit.current || !trigger) return;
    hasFit.current = true;
    fitView({ padding: 0.2, duration: 200 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return null;
}

const nodeTypes = { model: ModelNodeComponent };

export default function ModelsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();

  const filterKey = `dag-filter-${id}`;
  const selectedModelKey = `dag-selected-model-${id}`;
  const expandedNodesKey = `dag-expanded-nodes-${id}`;
  const columnSelsKey = `dag-column-sels-${id}`;

  const [filter, setFilter] = useState<FilterState>(() => {
    const saved = sessionStorage.getItem(filterKey);
    return saved ? deserializeFilter(saved) : defaultFilter();
  });

  const handleFilterChange = useCallback((f: FilterState) => {
    setFilter(f);
    sessionStorage.setItem(filterKey, serializeFilter(f));
  }, [filterKey]);
  const [selectedModels, setSelectedModels] = useState<ModelNode[]>([]);
  const [newModelOpen, setNewModelOpen] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [closeDropdownsSignal, setCloseDropdownsSignal] = useState(0);
  const [failedTestUid, setFailedTestUid] = useState<string | null>(null);
  const SHOW_ROWS_KEY = `dag-show-rows-${id}`;
  const [testShowRows, setTestShowRows] = useState<Record<string, ShowRows>>(() => {
    try {
      const saved = sessionStorage.getItem(`dag-show-rows-${id}`);
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  // Live run status overlay: model name → status, applied on top of cached graph data
  const [liveStatuses, setLiveStatuses] = useState<Record<string, LiveStatus>>({});

  // Column lineage state
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem(expandedNodesKey);
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch { return new Set(); }
  });
  // Active column selections: Set of "uid::colname" keys. Supports multi-select via cmd/ctrl+click.
  const [activeColumnSels, setActiveColumnSels] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem(columnSelsKey);
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch { return new Set(); }
  });
  // Lineage trace mode: 'direct' shows only immediate upstream/downstream of the clicked column;
  // 'full' follows the complete transitive closure.
  const [lineageMode, setLineageMode] = useState<'direct' | 'full'>('direct');

  const { data: graph } = useQuery({
    queryKey: ['models', id],
    queryFn: () => api.models.graph(id),
    refetchInterval: false,
    staleTime: 0,
  });

  const { data: columnLineage, isLoading: columnLineageLoading } = useQuery({
    queryKey: ['column-lineage', id],
    queryFn: () => api.models.columnLineage(id),
    refetchInterval: false,
  });

  // Pre-select model from ?model=<unique_id> query param (takes priority),
  // or from sessionStorage. Initialise directly from cache so the selection is
  // available on the first render even when the cached graph object reference
  // hasn't changed.
  const modelParam = searchParams.get('model');
  const [selectedModel, setSelectedModel] = useState<ModelNode | null>(() => {
    const cachedGraph = qc.getQueryData<GraphDto>(['models', id]);
    if (!cachedGraph) return null;
    if (modelParam) return cachedGraph.nodes.find((n) => n.unique_id === modelParam) ?? null;
    try {
      const uid = sessionStorage.getItem(selectedModelKey);
      if (uid) return cachedGraph.nodes.find((n) => n.unique_id === uid) ?? null;
    } catch {}
    return null;
  });

  useEffect(() => {
    if (!graph) return;
    if (modelParam) {
      const node = graph.nodes.find((n) => n.unique_id === modelParam);
      if (node) setSelectedModel(node);
      return;
    }
    setSelectedModel((current) => {
      if (current) return current;
      try {
        const uid = sessionStorage.getItem(selectedModelKey);
        if (uid) return graph.nodes.find((n) => n.unique_id === uid) ?? null;
      } catch {}
      return null;
    });
  }, [graph, modelParam]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!graph || !selectedModel) return;
    const refreshed = graph.nodes.find((n) => n.unique_id === selectedModel.unique_id);
    if (refreshed) setSelectedModel(refreshed);
    else {
      setSelectedModel(null);
      try { sessionStorage.removeItem(selectedModelKey); } catch {}
    }
  }, [graph]); // eslint-disable-line react-hooks/exhaustive-deps

  // SSE — react to server events
  useProjectEvents(id, useCallback((event) => {
    if (event.type === 'statuses_changed' || event.type === 'graph_changed') {
      setLiveStatuses({});
      setTestShowRows({});
      try { sessionStorage.removeItem(`dag-show-rows-${id}`); } catch {}
      if (event.type === 'graph_changed') {
        setActiveColumnSels(new Set());
        setExpandedNodes(new Set());
        try {
          sessionStorage.setItem(columnSelsKey, '[]');
          sessionStorage.setItem(expandedNodesKey, '[]');
        } catch {}
      }
      qc.invalidateQueries({ queryKey: ['models', id] });
      qc.invalidateQueries({ queryKey: ['column-lineage', id] });
    }
    if (event.type === 'compile_started') setCompiling(true);
    if (event.type === 'compile_finished') {
      setCompiling(false);
      qc.invalidateQueries({ queryKey: ['column-lineage', id] });
    }
    if (event.type === 'test_failed') {
      const d = event.data as { test_uid: string; model_uid: string | null };
      setFailedTestUid(d.test_uid);
    }
    if (event.type === 'run_log') {
      const line = (event.data as { line: string }).line;
      const startName = parseStartName(line);
      if (startName) {
        setLiveStatuses((prev) => ({ ...prev, [startName]: 'running' }));
        return;
      }
      const result = parseResultEntry(line);
      if (result) {
        setLiveStatuses((prev) => ({ ...prev, [result.name]: result.status }));
      }
    }
  }, [id, qc, selectedModelKey, columnSelsKey, expandedNodesKey]));

  const filteredGraph = useMemo(() => {
    if (!graph) return null;
    const liveGraph = applyLiveStatuses(graph, liveStatuses);
    return applyFilter(liveGraph, filter);
  }, [graph, filter, liveStatuses]);

  // Per-node heights for expanded nodes (used by dagre layout)
  const nodeHeights = useMemo(() => {
    if (!graph) return new Map<string, number>();
    const heights = new Map<string, number>();
    for (const node of graph.nodes) {
      if (expandedNodes.has(node.unique_id) && node.columns.length > 0) {
        const colHeight = Math.min(node.columns.length * 22, 150);
        heights.set(node.unique_id, NODE_HEIGHT + 20 + colHeight);
      }
    }
    return heights;
  }, [graph, expandedNodes]);

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () =>
      filteredGraph
        ? computeLayout(filteredGraph.nodes, filteredGraph.edges, nodeHeights)
        : { nodes: [], edges: [] },
    [filteredGraph, nodeHeights],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Model-level connection set for dimming (based on selected model, ignoring column state)
  const connectedUids = useMemo(() => {
    const seeds = selectedModels.length > 0
      ? selectedModels.map((m) => m.unique_id)
      : selectedModel ? [selectedModel.unique_id] : [];
    if (seeds.length === 0) return null;

    const fwd = new Map<string, string[]>();
    const bwd = new Map<string, string[]>();
    for (const e of layoutEdges) {
      if (!fwd.has(e.source)) fwd.set(e.source, []);
      fwd.get(e.source)!.push(e.target);
      if (!bwd.has(e.target)) bwd.set(e.target, []);
      bwd.get(e.target)!.push(e.source);
    }

    const connected = new Set<string>(seeds);
    const downQueue = [...seeds];
    while (downQueue.length > 0) {
      const uid = downQueue.shift()!;
      for (const next of fwd.get(uid) ?? []) {
        if (!connected.has(next)) { connected.add(next); downQueue.push(next); }
      }
    }
    const upQueue = [...seeds];
    while (upQueue.length > 0) {
      const uid = upQueue.shift()!;
      for (const next of bwd.get(uid) ?? []) {
        if (!connected.has(next)) { connected.add(next); upQueue.push(next); }
      }
    }
    return connected;
  }, [selectedModel, selectedModels, layoutEdges]);

  // Precompute reverse lineage index once per lineage fetch:
  // upstream_uid::col → [{downNode, downCol}]
  const reverseLineageIndex = useMemo(() => {
    const idx = new Map<string, Array<{ n: string; c: string }>>();
    if (!columnLineage) return idx;
    for (const [downNode, colMap] of Object.entries(columnLineage.lineage)) {
      for (const [downCol, refs] of Object.entries(colMap)) {
        for (const ref of refs) {
          const key = `${ref.node}::${ref.column}`;
          if (!idx.has(key)) idx.set(key, []);
          idx.get(key)!.push({ n: downNode, c: downCol });
        }
      }
    }
    return idx;
  }, [columnLineage]);

  const traceColumn = useCallback((nodeId: string, column: string): Array<{ n: string; c: string }> => {
    if (!columnLineage) return [{ n: nodeId, c: column }];
    const lineage = columnLineage.lineage;
    const seedKey = `${nodeId}::${column}`;

    if (lineageMode === 'direct') {
      const seen = new Set<string>([seedKey]);
      const result: Array<{ n: string; c: string }> = [{ n: nodeId, c: column }];

      const walkUp = (n: string, c: string) => {
        for (const ref of lineage[n]?.[c] ?? []) {
          const k = `${ref.node}::${ref.column}`;
          if (!seen.has(k)) { seen.add(k); result.push({ n: ref.node, c: ref.column }); walkUp(ref.node, ref.column); }
        }
      };
      const walkDown = (n: string, c: string) => {
        const k = `${n}::${c}`;
        for (const entry of reverseLineageIndex.get(k) ?? []) {
          const ek = `${entry.n}::${entry.c}`;
          if (!seen.has(ek)) { seen.add(ek); result.push({ n: entry.n, c: entry.c }); walkDown(entry.n, entry.c); }
        }
      };

      walkUp(nodeId, column);
      walkDown(nodeId, column);
      return result;
    }

    const all: Array<{ n: string; c: string }> = [];
    const visited = new Set<string>();
    const enqueue = (n: string, c: string) => {
      const key = `${n}::${c}`;
      if (visited.has(key)) return;
      visited.add(key);
      all.push({ n, c });
      for (const ref of lineage[n]?.[c] ?? []) enqueue(ref.node, ref.column);
      for (const entry of reverseLineageIndex.get(key) ?? []) enqueue(entry.n, entry.c);
    };
    enqueue(nodeId, column);
    return all;
  }, [columnLineage, reverseLineageIndex, lineageMode]);

  // Compute column-level connected UIDs and related columns for the context value.
  // This does NOT touch React Flow node state — it feeds context only.
  const { columnConnectedUids, relatedColumnsMap } = useMemo(() => {
    if (activeColumnSels.size === 0 || !columnLineage) {
      return { columnConnectedUids: null, relatedColumnsMap: new Map<string, Set<string>>() };
    }
    const connectedUidSet = new Set<string>();
    const related = new Map<string, Set<string>>();
    for (const key of activeColumnSels) {
      const sep = key.indexOf('::');
      const nodeId = key.slice(0, sep);
      const col = key.slice(sep + 2);
      for (const { n, c } of traceColumn(nodeId, col)) {
        connectedUidSet.add(n);
        if (!activeColumnSels.has(`${n}::${c}`)) {
          if (!related.has(n)) related.set(n, new Set());
          related.get(n)!.add(c);
        }
      }
    }
    return { columnConnectedUids: connectedUidSet, relatedColumnsMap: related };
  }, [activeColumnSels, columnLineage, traceColumn]);

  const handleColumnClick = useCallback((nodeId: string, column: string, multi: boolean) => {
    const key = `${nodeId}::${column}`;
    setActiveColumnSels((prev) => {
      let next: Set<string>;
      if (multi) {
        next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
      } else {
        next = prev.size === 1 && prev.has(key) ? new Set() : new Set([key]);
      }
      try { sessionStorage.setItem(columnSelsKey, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [columnSelsKey]);

  const handleToggleExpand = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      try { sessionStorage.setItem(expandedNodesKey, JSON.stringify([...next])); } catch {}
      return next;
    });
    setActiveColumnSels((prev) => {
      const next = new Set(prev);
      for (const key of prev) {
        if (key.startsWith(`${nodeId}::`)) next.delete(key);
      }
      if (next.size !== prev.size) {
        try { sessionStorage.setItem(columnSelsKey, JSON.stringify([...next])); } catch {}
        return next;
      }
      return prev;
    });
  }, [expandedNodesKey, columnSelsKey]);

  // Sync layout + node-level dimming/expand into React Flow state.
  // Column highlight state is NOT stored in nodes — it lives in context so only
  // nodes that actually need it re-render when selections change.
  useEffect(() => {
    const effectiveConnected = columnConnectedUids ?? connectedUids;
    setNodes((prev) => {
      const prevSelected = new Map(prev.map((n) => [n.id, n.selected ?? false]));
      return layoutNodes.map((n) => {
        const uid = (n.data?.model as ModelNode | undefined)?.unique_id ?? '';
        return {
          ...n,
          selected: prevSelected.get(n.id) ?? false,
          data: {
            ...n.data,
            dimmed: effectiveConnected !== null && !effectiveConnected.has(uid),
            expanded: expandedNodes.has(uid),
          },
        };
      });
    });
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, connectedUids, columnConnectedUids, expandedNodes, setNodes, setEdges]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedModel) return;
    setNodes((prev) => prev.map((n) => ({
      ...n,
      selected: n.id === selectedModel.unique_id ? true : n.selected,
    })));
  }, [selectedModel?.unique_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleShowRows = useCallback((uid: string, rows: ShowRows | null) => {
    setTestShowRows((prev) => {
      const next = rows ? { ...prev, [uid]: rows } : prev;
      try { sessionStorage.setItem(SHOW_ROWS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [SHOW_ROWS_KEY]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const model = node.data?.model as ModelNode | undefined;
      if (model) {
        setSelectedModel(model);
        try { sessionStorage.setItem(selectedModelKey, model.unique_id); } catch {}
        setActiveColumnSels(new Set());
        try { sessionStorage.setItem(columnSelsKey, '[]'); } catch {}
      }
    },
    [selectedModelKey, columnSelsKey],
  );

  // onSelectionChange: only handles non-empty selections (multi-select, single-select).
  // Deselection (0 nodes) is handled by onPaneClick to avoid spurious clears from
  // programmatic setNodes calls that React Flow fires selection events for.
  const onSelectionChange = useCallback(({ nodes }: OnSelectionChangeParams) => {
    if (nodes.length === 0) return;
    const models = nodes
      .map((n) => n.data?.model as ModelNode | undefined)
      .filter((m): m is ModelNode => m !== undefined);
    setSelectedModels(models);
    if (models.length === 1) {
      setSelectedModel(models[0]);
      try { sessionStorage.setItem(selectedModelKey, models[0].unique_id); } catch {}
    }
  }, [selectedModelKey]);

  const onPaneClick = useCallback(() => {
    setSelectedModel(null);
    setSelectedModels([]);
    try { sessionStorage.removeItem(selectedModelKey); } catch {}
    setActiveColumnSels(new Set());
    try { sessionStorage.setItem(columnSelsKey, '[]'); } catch {}
    setCloseDropdownsSignal((n) => n + 1);
  }, [selectedModelKey, columnSelsKey]);

  const handleRefreshDag = async () => {
    await api.models.compile(id);
  };

  const handleDeleteModel = async (model: ModelNode) => {
    if (!confirm(`Delete model '${model.name}'? This removes the file from disk.`)) return;
    await api.models.delete(id, model.unique_id);
    setSelectedModel(null);
  };

  const columnLineageCtx = useMemo<ColumnLineageContextValue>(() => ({
    activeColumnSels,
    relatedColumnsMap,
    onColumnClick: handleColumnClick,
    onToggleExpand: handleToggleExpand,
  }), [activeColumnSels, relatedColumnsMap, handleColumnClick, handleToggleExpand]);

  return (
    <ColumnLineageContext.Provider value={columnLineageCtx}>
      <div className="flex h-full overflow-hidden">
        {/* Side rail */}
        <NavRail projectId={id} current="dag" />

        {/* Main DAG area */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Filter bar */}
          <DagFilterBar
            graph={graph ?? null}
            filter={filter}
            onChange={handleFilterChange}
            nodeCount={filteredGraph?.nodes.length ?? 0}
            compiling={compiling}
            onRefresh={handleRefreshDag}
            onNewModel={() => setNewModelOpen(true)}
            closeDropdownsSignal={closeDropdownsSignal}
          />

          {/* React Flow */}
          <div className="flex-1 overflow-hidden">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              onSelectionChange={onSelectionChange}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.1}
            >
              <FitViewOnFirstLoad trigger={layoutNodes} />
              <Panel position="top-center">
                <div className="flex items-center gap-2">
                  {columnLineageLoading && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800/90 border border-zinc-700 text-xs text-zinc-400 shadow-lg">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                      Column lineage loading…
                    </div>
                  )}
                  {activeColumnSels.size > 0 && (
                    <button
                      onClick={() => setLineageMode((m) => m === 'direct' ? 'full' : 'direct')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800/90 border border-zinc-700 text-xs shadow-lg transition-colors hover:bg-zinc-700/90"
                      title={lineageMode === 'direct' ? 'Switch to full transitive closure' : 'Switch to direct lineage only'}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${lineageMode === 'direct' ? 'bg-brand-400' : 'bg-amber-400'}`} />
                      <span className={lineageMode === 'direct' ? 'text-zinc-300' : 'text-amber-300'}>
                        {lineageMode === 'direct' ? 'Direct lineage' : 'Full lineage'}
                      </span>
                    </button>
                  )}
                </div>
              </Panel>
              <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1f2937" />
              <Controls showInteractive={false} className="!bg-surface-panel !border-gray-800" />
              <MiniMap
                nodeColor={(n) => {
                  const status = (n.data?.model as ModelNode)?.status ?? 'idle';
                  if (status === 'success') return '#059669';
                  if (status === 'error') return '#dc2626';
                  if (status === 'running') return '#14b8a6';
                  if (status === 'stale') return '#d97706';
                  return '#374151';
                }}
                className="!bg-surface-panel !border-gray-800"
              />
            </ReactFlow>
          </div>

        </div>

        {/* Side panel */}
        <SidePane
          projectId={id}
          model={selectedModel}
          selectedModels={selectedModels}
          graph={graph ?? null}
          page="dag"
          onNavigateToFiles={() => selectedModel && navigate(`/projects/${id}/files?model=${encodeURIComponent(selectedModel.unique_id)}`)}
          onNavigateToFile={(path) => {
            const node = graph?.nodes.find((n) => n.original_file_path === path);
            if (node) navigate(`/projects/${id}/files?model=${encodeURIComponent(node.unique_id)}`);
          }}
          onViewDocs={() => selectedModel && navigate(`/projects/${id}/docs?node=${encodeURIComponent(selectedModel.unique_id)}`)}
          onDelete={() => selectedModel && handleDeleteModel(selectedModel)}
          failedTestUid={failedTestUid}
          onFailedTestConsumed={() => setFailedTestUid(null)}
          showRows={selectedModel ? (testShowRows[selectedModel.unique_id] ?? null) : null}
          onShowRows={handleShowRows}
        />

        {/* New model modal */}
        {newModelOpen && (
          <NewModelModal
            projectId={id}
            onClose={() => setNewModelOpen(false)}
            onCreated={() => {
              setNewModelOpen(false);
              qc.invalidateQueries({ queryKey: ['models', id] });
            }}
          />
        )}
      </div>
    </ColumnLineageContext.Provider>
  );
}
