import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Play, Hammer, FlaskConical, X, BookOpen } from 'lucide-react';

import { api, type ModelNode, type GraphDto } from '../../lib/api';
import { useProjectEvents } from '../../lib/sse';
import ModelNodeComponent from './components/ModelNode';
import SqlEditorModal from './components/SqlEditorModal';
import NewModelModal from './components/NewModelModal';
import ProjectNav from './components/ProjectNav';
import { computeLayout } from './lib/layout';

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
  const qc = useQueryClient();

  const [filterText, setFilterText] = useState('');
  const [selectedModel, setSelectedModel] = useState<ModelNode | null>(null);
  const [sqlEditorUid, setSqlEditorUid] = useState<string | null>(null);
  const [newModelOpen, setNewModelOpen] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [failedTestUid, setFailedTestUid] = useState<string | null>(null);
  // Live run status overlay: model name → status, applied on top of cached graph data
  const [liveStatuses, setLiveStatuses] = useState<Record<string, LiveStatus>>({});

  // Resizable panels
  const [navWidth, setNavWidth] = useState(192);
  const [panelWidth, setPanelWidth] = useState(420);
  const navResizing = useRef(false);
  const panelResizing = useRef(false);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (navResizing.current) {
        setNavWidth((w) => Math.max(120, Math.min(320, w + e.movementX)));
      }
      if (panelResizing.current) {
        setPanelWidth((w) => Math.max(200, Math.min(600, w - e.movementX)));
      }
    };
    const onMouseUp = () => {
      navResizing.current = false;
      panelResizing.current = false;
    };
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
    if (!filterText.trim()) return liveGraph;
    const q = filterText.toLowerCase();
    const matchingIds = new Set(
      liveGraph.nodes
        .filter(
          (n) =>
            n.name.toLowerCase().includes(q) ||
            n.tags.some((t) => t.toLowerCase().includes(q)) ||
            n.resource_type.toLowerCase().includes(q),
        )
        .map((n) => n.unique_id),
    );
    return {
      nodes: liveGraph.nodes.filter((n) => matchingIds.has(n.unique_id)),
      edges: liveGraph.edges.filter(
        (e) => matchingIds.has(e.source) && matchingIds.has(e.target),
      ),
    };
  }, [graph, filterText, liveStatuses]);

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

  const handleRun = async (command: 'run' | 'build' | 'test', mode: string) => {
    if (!selectedModel) return;
    await (command === 'run'
      ? api.runs.run(id, selectedModel.name, mode)
      : command === 'build'
      ? api.runs.build(id, selectedModel.name, mode)
      : api.runs.test(id, selectedModel.name, mode));
  };

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
        <div className="flex items-center gap-3 px-4 py-2 bg-surface-panel border-b border-gray-800">
          <input
            type="search"
            placeholder="Filter by name, tag, type…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="flex-1 bg-surface-elevated border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <span className="text-xs text-gray-500">
            {filteredGraph?.nodes.length ?? 0} nodes
          </span>
          {compiling && (
            <span className="flex items-center gap-1.5 text-xs text-brand-400">
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
              Compiling…
            </span>
          )}
          <button
            onClick={handleRefreshDag}
            disabled={compiling}
            className="px-3 py-1.5 text-xs rounded bg-surface-elevated hover:bg-gray-700 text-gray-300 disabled:opacity-50 transition-colors shrink-0"
          >
            ↻ Refresh DAG
          </button>
          <button
            onClick={() => setNewModelOpen(true)}
            className="px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors shrink-0"
          >
            + New model
          </button>
        </div>

        {/* React Flow */}
        <div className="flex-1 overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
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

      {/* Selected model side panel */}
      {selectedModel && (
        <div style={{ width: panelWidth }} className="shrink-0 bg-surface-panel border-l border-gray-800 flex flex-col overflow-hidden relative">
          {/* Panel resize handle */}
          <div
            onMouseDown={() => { panelResizing.current = true; }}
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-brand-500/40 transition-colors"
          />
          <ModelSidePanel
            projectId={id}
            model={selectedModel}
            onClose={() => { setSelectedModel(null); setFailedTestUid(null); }}
            onNavigateToFiles={() => navigate(`/projects/${id}/files?model=${encodeURIComponent(selectedModel.unique_id)}`)}
            onViewDocs={() => navigate(`/projects/${id}/docs?node=${encodeURIComponent(selectedModel.unique_id)}`)}
            onRun={handleRun}
            onDelete={() => handleDeleteModel(selectedModel)}
            failedTestUid={failedTestUid}
          />
        </div>
      )}

      {/* SQL editor modal */}
      {sqlEditorUid && (
        <SqlEditorModal
          projectId={id}
          uniqueId={sqlEditorUid}
          onClose={() => setSqlEditorUid(null)}
        />
      )}

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

// ---- side panel ----

type RunCommand = 'run' | 'build' | 'test';
type RunMode = 'only' | 'upstream' | 'downstream' | 'full';

interface SidePanelProps {
  projectId: number;
  model: ModelNode;
  onClose: () => void;
  onNavigateToFiles: () => void;
  onViewDocs: () => void;
  onRun: (cmd: RunCommand, mode: RunMode) => Promise<void>;
  onDelete: () => void;
  failedTestUid: string | null;
}

const RUN_ACTIONS: { cmd: RunCommand; icon: React.ReactNode; label: string }[] = [
  { cmd: 'run',   icon: <Play className="w-4 h-4" />,         label: 'Run' },
  { cmd: 'build', icon: <Hammer className="w-4 h-4" />,       label: 'Build' },
  { cmd: 'test',  icon: <FlaskConical className="w-4 h-4" />, label: 'Test' },
];

const SCOPE_LABELS: Record<RunMode, string> = {
  only: 'Only', upstream: '+ Upstream', downstream: '+ Downstream', full: 'Full',
};

function ModelSidePanel({ projectId, model, onClose, onNavigateToFiles, onViewDocs, onRun, onDelete, failedTestUid }: SidePanelProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [showRows, setShowRows] = useState<{ columns: string[]; rows: unknown[][] } | null>(null);
  const [loadingShow, setLoadingShow] = useState(false);

  const handle = async (cmd: RunCommand, mode: RunMode) => {
    const key = `${cmd}:${mode}`;
    setLoading(key);
    try { await onRun(cmd, mode); } finally { setLoading(null); }
  };

  // Auto-fetch failing rows when a test_failed event fires for this test node
  useEffect(() => {
    if (model.resource_type !== 'test') return;
    if (failedTestUid !== model.unique_id) return;
    setLoadingShow(true);
    api.models.show(projectId, model.unique_id, 100)
      .then((r) => setShowRows(r))
      .catch(() => setShowRows(null))
      .finally(() => setLoadingShow(false));
  }, [failedTestUid, model.unique_id, model.resource_type, projectId]);

  const isTest = model.resource_type === 'test';

  return (
    <div className="flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-gray-100 truncate">{model.name}</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Chip label={model.resource_type} />
            {model.materialized && <Chip label={model.materialized} />}
            <StatusChip status={model.status} />
          </div>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 ml-2 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="overflow-auto flex-1 p-4 flex flex-col gap-5">
        {/* Docs card */}
        {(model.description || model.tags.length > 0) && (
          <div className="bg-surface-elevated/60 rounded-lg px-3 py-2.5 flex flex-col gap-1.5">
            {model.description && (
              <p className="text-sm text-gray-300 leading-relaxed">{model.description}</p>
            )}
            {model.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {model.tags.map((t) => <Chip key={t} label={`#${t}`} dim />)}
              </div>
            )}
          </div>
        )}

        {/* Status message */}
        {model.message && (
          <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded px-3 py-2">
            {model.message}
          </p>
        )}

        {/* Run controls — model */}
        {!isTest && (
          <div className="flex flex-col gap-2">
            {RUN_ACTIONS.map(({ cmd, icon, label }) => (
              <div key={cmd} className="flex flex-col gap-1">
                <div className="grid grid-cols-4 gap-1">
                  {(['only', 'upstream', 'downstream', 'full'] as RunMode[]).map((mode) => {
                    const key = `${cmd}:${mode}`;
                    return (
                      <button
                        key={mode}
                        title={`${label} ${SCOPE_LABELS[mode]}`}
                        onClick={() => handle(cmd, mode)}
                        disabled={loading !== null}
                        className={`flex items-center justify-center gap-1.5 py-2 px-1 text-xs rounded border transition-colors disabled:opacity-50
                          ${mode === 'only'
                            ? 'bg-surface-elevated border-gray-700 text-gray-200 hover:border-brand-600 hover:text-brand-300'
                            : 'bg-transparent border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300'
                          }`}
                      >
                        {loading === key ? (
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                          </svg>
                        ) : (
                          <>
                            {mode === 'only' && icon}
                            <span className="truncate">{mode === 'only' ? label : SCOPE_LABELS[mode]}</span>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Test node run button */}
        {isTest && (
          <button
            onClick={() => handle('test', 'only')}
            disabled={loading !== null}
            className="flex items-center justify-center gap-2 w-full py-2.5 text-sm rounded bg-surface-elevated border border-gray-700 hover:border-brand-600 hover:text-brand-300 text-gray-200 transition-colors disabled:opacity-50"
          >
            <FlaskConical className="w-4 h-4" />
            {loading ? 'Running…' : 'Run test'}
          </button>
        )}

        {/* Failing test rows */}
        {isTest && loadingShow && (
          <p className="text-xs text-gray-500">Loading failing rows…</p>
        )}
        {isTest && showRows && (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-red-400 font-medium">
              {showRows.rows.length} failing row{showRows.rows.length !== 1 ? 's' : ''}
            </p>
            <div className="overflow-auto max-h-48 rounded border border-gray-800">
              <table className="w-full text-[11px] text-gray-300 border-collapse">
                <thead>
                  <tr className="bg-surface-elevated">
                    {showRows.columns.map((c) => (
                      <th key={c} className="px-2 py-1 text-left text-gray-500 font-medium border-b border-gray-800 whitespace-nowrap">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {showRows.rows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-800/50 hover:bg-surface-elevated/40">
                      {(row as unknown[]).map((cell, j) => (
                        <td key={j} className="px-2 py-1 font-mono whitespace-nowrap">{String(cell ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-2 mt-auto">
          {model.original_file_path && (
            <button
              onClick={onNavigateToFiles}
              className="w-full py-2 text-sm rounded bg-brand-900/40 hover:bg-brand-800/60 text-brand-300 border border-brand-800 transition-colors"
            >
              Edit in Files
            </button>
          )}
          <button
            onClick={onViewDocs}
            className="flex items-center justify-center gap-2 w-full py-2 text-sm rounded bg-surface-elevated hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors"
          >
            <BookOpen className="w-4 h-4" />
            View docs
          </button>
          {model.resource_type === 'model' && model.original_file_path && (
            <button
              onClick={onDelete}
              className="w-full py-2 text-sm rounded border border-red-900/50 hover:bg-red-950/30 text-red-500 hover:text-red-400 transition-colors"
            >
              Delete model
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ label, dim = false }: { label: string; dim?: boolean }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${dim ? 'bg-surface-elevated text-gray-500' : 'bg-gray-700 text-gray-300'}`}>
      {label}
    </span>
  );
}

const STATUS_COLORS: Record<string, string> = {
  idle: 'text-gray-400',
  success: 'text-emerald-400',
  error: 'text-red-400',
  running: 'text-brand-400 animate-pulse',
  stale: 'text-amber-400',
  warn: 'text-yellow-400',
};

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`font-mono text-xs ${STATUS_COLORS[status] ?? 'text-gray-400'}`}>
      {status}
    </span>
  );
}
