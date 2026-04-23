import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type OnSelectionChangeParams,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { api, type ModelNode, type GraphDto } from '../../lib/api';
import { useProjectEvents } from '../../lib/sse';
import ModelNodeComponent from './components/ModelNode';
import NewModelModal from './components/NewModelModal';
import ProjectNav from './components/ProjectNav';
import { SidePane } from './components/SidePane';
import DagFilterBar from './components/DagFilterBar';
import { computeLayout } from './lib/layout';
import { type FilterState, emptyFilter, applyFilter } from './lib/dagFilter';

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

const nodeTypes = { model: ModelNodeComponent };

export default function ModelsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();

  const [filter, setFilter] = useState<FilterState>(emptyFilter());
  const [selectedModel, setSelectedModel] = useState<ModelNode | null>(null);
  const [selectedModels, setSelectedModels] = useState<ModelNode[]>([]);
  const [newModelOpen, setNewModelOpen] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [failedTestUid, setFailedTestUid] = useState<string | null>(null);
  // Live run status overlay: model name → status, applied on top of cached graph data
  const [liveStatuses, setLiveStatuses] = useState<Record<string, LiveStatus>>({});

  // Resizable nav rail
  const [navWidth, setNavWidth] = useState(192);
  const navResizing = useRef(false);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (navResizing.current) {
        setNavWidth((w) => Math.max(120, Math.min(320, w + e.movementX)));
      }
    };
    const onMouseUp = () => { navResizing.current = false; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const { data: graph } = useQuery({
    queryKey: ['models', id],
    queryFn: () => api.models.graph(id),
    refetchInterval: false,
  });

  // Deep-link: ?model=<unique_id> — pre-select model in SidePane on load
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || !graph) return;
    const modelParam = searchParams.get('model');
    if (!modelParam) return;
    deepLinkHandled.current = true;
    const node = graph.nodes.find((n) => n.unique_id === modelParam);
    if (node) setSelectedModel(node);
  }, [graph, searchParams]);

  // SSE — react to server events
  useProjectEvents(id, useCallback((event) => {
    if (event.type === 'statuses_changed' || event.type === 'graph_changed') {
      setLiveStatuses({});
      qc.invalidateQueries({ queryKey: ['models', id] });
    }
    if (event.type === 'compile_started') setCompiling(true);
    if (event.type === 'compile_finished') setCompiling(false);
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
  }, [id, qc]));

  const filteredGraph = useMemo(() => {
    if (!graph) return null;
    const liveGraph = applyLiveStatuses(graph, liveStatuses);
    return applyFilter(liveGraph, filter);
  }, [graph, filter, liveStatuses]);

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () =>
      filteredGraph
        ? computeLayout(filteredGraph.nodes, filteredGraph.edges)
        : { nodes: [], edges: [] },
    [filteredGraph],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  useEffect(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const model = node.data?.model as ModelNode | undefined;
      if (model) setSelectedModel(model);
    },
    [],
  );

  const onSelectionChange = useCallback(({ nodes }: OnSelectionChangeParams) => {
    const models = nodes
      .map((n) => n.data?.model as ModelNode | undefined)
      .filter((m): m is ModelNode => m !== undefined);
    setSelectedModels(models);
    if (models.length === 1) setSelectedModel(models[0]);
    if (models.length === 0) setSelectedModel(null);
  }, []);

  const handleRefreshDag = async () => {
    await api.models.compile(id);
  };

  const handleDeleteModel = async (model: ModelNode) => {
    if (!confirm(`Delete model '${model.name}'? This removes the file from disk.`)) return;
    await api.models.delete(id, model.unique_id);
    setSelectedModel(null);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Side rail */}
      <div style={{ width: navWidth }} className="shrink-0 bg-surface-panel border-r border-gray-800 flex flex-col overflow-hidden relative">
        <ProjectNav projectId={id} current="dag" />
        <div
          onMouseDown={() => { navResizing.current = true; }}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-brand-500/40 transition-colors"
        />
      </div>

      {/* Main DAG area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Filter bar */}
        <DagFilterBar
          graph={graph ?? null}
          filter={filter}
          onChange={setFilter}
          nodeCount={filteredGraph?.nodes.length ?? 0}
          compiling={compiling}
          onRefresh={handleRefreshDag}
          onNewModel={() => setNewModelOpen(true)}
        />

        {/* React Flow */}
        <div className="flex-1 overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onSelectionChange={onSelectionChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.1}
          >
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
        onViewDocs={() => selectedModel && navigate(`/projects/${id}/docs?node=${encodeURIComponent(selectedModel.unique_id)}`)}
        onDelete={() => selectedModel && handleDeleteModel(selectedModel)}
        failedTestUid={failedTestUid}
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
  );
}
