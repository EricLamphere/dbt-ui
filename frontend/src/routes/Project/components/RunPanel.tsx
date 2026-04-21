import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { X, ChevronDown, ChevronUp } from 'lucide-react';

import { useProjectEvents } from '../../../lib/sse';
import { api, type GraphDto } from '../../../lib/api';
import ModelNodeComponent from './ModelNode';
import { computeLayout } from '../lib/layout';

type NodeStatus = 'pending' | 'running' | 'success' | 'error' | 'warn' | 'idle';

interface RunInfo {
  command: string;
  select: string | null;
  startedAt: string;
}

interface RunPanelProps {
  projectId: number;
  graph: GraphDto | null;
}

const nodeTypes = { model: ModelNodeComponent };

// Overlay status onto graph nodes and return a patched GraphDto
function applyStatuses(
  graph: GraphDto,
  statuses: Record<string, NodeStatus>,
): GraphDto {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      statuses[n.unique_id]
        ? { ...n, status: statuses[n.unique_id] }
        : n,
    ),
  };
}

// Extract the subgraph containing only the given node IDs + edges between them
function subgraph(graph: GraphDto, ids: Set<string>): GraphDto {
  return {
    nodes: graph.nodes.filter((n) => ids.has(n.unique_id)),
    edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
}

// ---- Inner component — needs ReactFlow context ----
function RunPanelInner({ projectId, graph }: RunPanelProps) {
  const [open, setOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [runInfo, setRunInfo] = useState<RunInfo | null>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [runNodeIds, setRunNodeIds] = useState<Set<string>>(new Set());
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, NodeStatus>>({});
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const prevStatusesRef = useRef<Record<string, NodeStatus>>({});

  // Keep a snapshot of statuses before the run so we can diff on statuses_changed
  const snapshotRef = useRef<Record<string, string>>({});

  // Capture snapshot from graph before run
  const captureSnapshot = useCallback(() => {
    if (!graph) return;
    const snap: Record<string, string> = {};
    graph.nodes.forEach((n) => { snap[n.unique_id] = n.status; });
    snapshotRef.current = snap;
  }, [graph]);

  // Start elapsed timer
  const startTimer = useCallback(() => {
    setElapsedSec(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => () => stopTimer(), [stopTimer]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useProjectEvents(projectId, useCallback((event) => {
    if (event.type === 'run_started') {
      const d = event.data as { command: string; select: string | null; started_at: string };
      captureSnapshot();
      setRunInfo({ command: d.command, select: d.select, startedAt: d.started_at });
      setRunning(true);
      setLogs([]);
      setRunNodeIds(new Set());
      setNodeStatuses({});
      prevStatusesRef.current = {};
      setOpen(true);
      startTimer();
    }
    if (event.type === 'run_log') {
      const d = event.data as { line: string };
      setLogs((prev) => [...prev.slice(-500), d.line]);
    }
    if (event.type === 'run_finished') {
      setRunning(false);
      stopTimer();
      // Fetch updated graph to diff statuses
      api.models.graph(projectId).then((updated) => {
        const snapshot = snapshotRef.current;
        const changed = new Set<string>();
        updated.nodes.forEach((n) => {
          if (snapshot[n.unique_id] !== n.status) changed.add(n.unique_id);
        });
        if (changed.size === 0) {
          // No changes detected — show all non-idle nodes as a fallback
          updated.nodes.forEach((n) => {
            if (n.status !== 'idle') changed.add(n.unique_id);
          });
        }
        setRunNodeIds(changed);
        const statuses: Record<string, NodeStatus> = {};
        updated.nodes.forEach((n) => {
          if (changed.has(n.unique_id)) statuses[n.unique_id] = n.status as NodeStatus;
        });
        setNodeStatuses(statuses);
        prevStatusesRef.current = statuses;
      }).catch(() => {});
    }
  }, [projectId, captureSnapshot, startTimer, stopTimer]));

  // Build the mini-DAG subgraph
  const miniGraph = useMemo(() => {
    if (!graph || runNodeIds.size === 0) return null;
    const patched = applyStatuses(graph, nodeStatuses);
    return subgraph(patched, runNodeIds);
  }, [graph, runNodeIds, nodeStatuses]);

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => miniGraph ? computeLayout(miniGraph.nodes, miniGraph.edges) : { nodes: [], edges: [] },
    [miniGraph],
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(layoutNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(layoutEdges);
  const { fitView } = useReactFlow();

  useEffect(() => {
    setRfNodes(layoutNodes);
    setRfEdges(layoutEdges);
    if (layoutNodes.length > 0) {
      setTimeout(() => fitView({ padding: 0.3, duration: 200 }), 50);
    }
  }, [layoutNodes, layoutEdges, setRfNodes, setRfEdges, fitView]);

  if (!open) return null;

  const elapsed = `${Math.floor(elapsedSec / 60).toString().padStart(2, '0')}:${(elapsedSec % 60).toString().padStart(2, '0')}`;
  const commandColor =
    runInfo?.command === 'run' ? 'text-brand-400' :
    runInfo?.command === 'build' ? 'text-amber-400' :
    'text-emerald-400';

  return (
    <div className="shrink-0 bg-surface-panel border-t border-gray-700 flex flex-col" style={{ height: logsOpen ? 420 : 260 }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 shrink-0 select-none">
        <span className={`text-xs font-semibold uppercase tracking-wide ${commandColor}`}>
          {runInfo?.command ?? 'run'}
        </span>
        {runInfo?.select && (
          <span className="text-xs font-mono text-gray-400 truncate max-w-xs">{runInfo.select}</span>
        )}
        {running ? (
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            <svg className="w-3 h-3 animate-spin text-brand-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
            </svg>
            {elapsed}
          </span>
        ) : (
          <span className="text-xs text-gray-600">{elapsed}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setLogsOpen((v) => !v)}
            title={logsOpen ? 'Hide logs' : 'Show logs'}
            className="p-1 rounded text-gray-500 hover:text-gray-300 transition-colors"
          >
            {logsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setOpen(false)}
            title="Close"
            className="p-1 rounded text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mini-DAG */}
      <div className="flex-1 overflow-hidden relative">
        {running && runNodeIds.size === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-600">
            Running…
          </div>
        )}
        {!running && runNodeIds.size === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-600">
            No model status changes detected.
          </div>
        )}
        {runNodeIds.size > 0 && (
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag
            zoomOnScroll={false}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            minZoom={0.3}
            maxZoom={1.5}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1f2937" />
          </ReactFlow>
        )}
      </div>

      {/* Log output (collapsible) */}
      {logsOpen && (
        <div className="h-36 border-t border-gray-800 overflow-auto font-mono text-xs p-3 text-gray-400 shrink-0 bg-surface-app">
          {logs.length === 0 && <span className="text-gray-600">Waiting for output…</span>}
          {logs.map((line, i) => <div key={i}>{line}</div>)}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  );
}

// Wrap with ReactFlowProvider so useReactFlow() works inside
export function RunPanel(props: RunPanelProps) {
  return (
    <ReactFlowProvider>
      <RunPanelInner {...props} />
    </ReactFlowProvider>
  );
}
