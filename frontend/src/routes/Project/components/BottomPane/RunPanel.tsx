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

import { useProjectEvents } from '../../../../lib/sse';
import { api, type GraphDto } from '../../../../lib/api';
import ModelNodeComponent from '../ModelNode';
import { computeLayout } from '../../lib/layout';

interface ProjectRunButtonsProps {
  projectId: number;
  disabled: boolean;
}

function ProjectRunButtons({ projectId, disabled }: ProjectRunButtonsProps) {
  const run = useCallback((cmd: 'run' | 'build' | 'test') => {
    const fn = api.runs[cmd];
    fn(projectId, '', 'only').catch(() => {});
  }, [projectId]);

  const btn = (label: string, cmd: 'run' | 'build' | 'test', color: string) => (
    <button
      key={cmd}
      onClick={() => run(cmd)}
      disabled={disabled}
      className={`px-3 py-1 rounded text-xs font-semibold tracking-wide border transition-colors
        disabled:opacity-40 disabled:cursor-not-allowed
        ${color}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-600 mr-1">Full project:</span>
      {btn('Run', 'run', 'border-brand-600 text-brand-400 hover:bg-brand-900/40')}
      {btn('Build', 'build', 'border-purple-600 text-purple-400 hover:bg-purple-900/40')}
      {btn('Test', 'test', 'border-yellow-600 text-yellow-400 hover:bg-yellow-900/40')}
    </div>
  );
}

type NodeStatus = 'pending' | 'running' | 'success' | 'error' | 'warn' | 'idle';

interface RunInfo {
  command: string;
  select: string | null;
  startedAt: string;
}

interface RunPanelProps {
  projectId: number;
  graph: GraphDto | null;
  onRunStart: () => void;
}

const nodeTypes = { model: ModelNodeComponent };

// Strip ANSI escape codes that dbt sometimes emits
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

// Extract the last dot-separated segment (the bare model name)
function lastName(dotted: string): string {
  const parts = dotted.split('.');
  return parts[parts.length - 1];
}

// dbt log lines look like:
//   "1 of 3 START sql table model my_project.my_model ........ [RUN]"
//   "1 of 3 OK created sql table model my_project.my_model ... [SUCCESS 0.4s]"
//   "1 of 3 ERROR creating sql table model my_project.my_model [ERROR in 0.1s]"
//   "1 of 2 START test not_null_my_model_id .......... [RUN]"
//   "1 of 2 PASS not_null_my_model_id ................ [PASS in 0.1s]"
//   "1 of 2 FAIL 1 not_null_my_model_id .............. [FAIL 1]"
// The model name after "model " may be "project.name" OR "project.schema.name" — we always want the last segment.

function parseStartLine(raw: string): { name: string; type: 'model' | 'test' } | null {
  const line = stripAnsi(raw).trim();
  // Model name is dotted (e.g. "main.my_model" or "proj.schema.my_model") — capture all non-space chars, take last segment
  const modelMatch = line.match(/\d+ of \d+ START .+ model (\S+)/);
  if (modelMatch) return { name: lastName(modelMatch[1]), type: 'model' };
  const testMatch = line.match(/\d+ of \d+ START test (\S+)/);
  if (testMatch) return { name: lastName(testMatch[1]), type: 'test' };
  return null;
}

function parseResultLine(raw: string): { name: string; status: NodeStatus } | null {
  const line = stripAnsi(raw).trim();
  // OK/ERROR/WARN for models
  const modelMatch = line.match(/\d+ of \d+ (OK|ERROR|WARN) .+ model (\S+)/);
  if (modelMatch) {
    const kw = modelMatch[1];
    const status: NodeStatus = kw === 'ERROR' ? 'error' : kw === 'WARN' ? 'warn' : 'success';
    return { name: lastName(modelMatch[2]), status };
  }
  // PASS/FAIL for tests — name follows keyword (and optional count for FAIL)
  const testPassMatch = line.match(/\d+ of \d+ PASS \d* *(\S+)/);
  if (testPassMatch) return { name: lastName(testPassMatch[1]), status: 'success' };
  const testFailMatch = line.match(/\d+ of \d+ FAIL \d+ +(\S+)/);
  if (testFailMatch) return { name: lastName(testFailMatch[1]), status: 'error' };
  return null;
}

function applyStatuses(graph: GraphDto, statuses: Record<string, NodeStatus>): GraphDto {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      statuses[n.unique_id] ? { ...n, status: statuses[n.unique_id] } : n,
    ),
  };
}

// Build a subgraph containing only the nodes that actually executed.
function buildDisplayGraph(graph: GraphDto, runNodeIds: Set<string>): GraphDto {
  if (runNodeIds.size === 0) return { nodes: [], edges: [] };

  return {
    nodes: graph.nodes.filter((n) => runNodeIds.has(n.unique_id)),
    edges: graph.edges.filter((e) => runNodeIds.has(e.source) && runNodeIds.has(e.target)),
  };
}

function RunPanelInner({ projectId, graph, onRunStart }: RunPanelProps) {
  const [runInfo, setRunInfo] = useState<RunInfo | null>(null);
  const [running, setRunning] = useState(false);
  const [runNodeIds, setRunNodeIds] = useState<Set<string>>(new Set());
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, NodeStatus>>({});
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Always-current graph ref so event handlers don't need graph in their dep array
  const graphRef = useRef<GraphDto | null>(graph);
  useEffect(() => { graphRef.current = graph; }, [graph]);
  // name → unique_id map, rebuilt at run_started from current graph
  const nameToUidRef = useRef<Map<string, string>>(new Map());
  // true after run_started, cleared when first START log line is processed
  const newRunPendingRef = useRef(false);

  const startTimer = useCallback(() => {
    setElapsedSec(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => () => stopTimer(), [stopTimer]);

  useProjectEvents(projectId, useCallback((event) => {
    if (event.type === 'run_started') {
      const d = event.data as { command: string; select: string | null; started_at: string };
      // Rebuild name→uid lookup from the current graph
      nameToUidRef.current = new Map(
        graphRef.current?.nodes.map((n) => [n.name, n.unique_id]) ?? []
      );
      // Mark that a new run is starting — don't wipe the DAG yet.
      // It will be cleared when the first model's START line arrives.
      newRunPendingRef.current = true;
      setRunInfo({ command: d.command, select: d.select, startedAt: d.started_at });
      setRunning(true);
      startTimer();
      onRunStart();
    }

    if (event.type === 'run_log') {
      const line = (event.data as { line: string }).line;

      // Lazily build name map if graph loaded after run_started
      if (nameToUidRef.current.size === 0 && graphRef.current) {
        nameToUidRef.current = new Map(
          graphRef.current.nodes.map((n) => [n.name, n.unique_id])
        );
      }

      const start = parseStartLine(line);
      if (start) {
        const uid = nameToUidRef.current.get(start.name);
        if (uid) {
          if (newRunPendingRef.current) {
            // First model of the new run — clear previous DAG now
            newRunPendingRef.current = false;
            setRunNodeIds(new Set([uid]));
            setNodeStatuses({ [uid]: 'running' });
          } else {
            setRunNodeIds((prev) => new Set([...prev, uid]));
            setNodeStatuses((prev) => ({ ...prev, [uid]: 'running' }));
          }
        }
        return;
      }

      const result = parseResultLine(line);
      if (result) {
        const uid = nameToUidRef.current.get(result.name);
        if (uid) {
          setNodeStatuses((prev) => ({ ...prev, [uid]: result.status }));
        }
      }
    }

    if (event.type === 'run_finished') {
      setRunning(false);
      stopTimer();
      // Confirm final statuses from the backend-persisted results
      api.models.graph(projectId).then((updated) => {
        setNodeStatuses((prev) => {
          const next = { ...prev };
          updated.nodes.forEach((n) => {
            if (next[n.unique_id] !== undefined) {
              next[n.unique_id] = n.status as NodeStatus;
            }
          });
          return next;
        });
      }).catch(() => {});
    }
  }, [projectId, startTimer, stopTimer, onRunStart]));

  const miniGraph = useMemo(() => {
    if (!graph || runNodeIds.size === 0) return null;
    const patched = applyStatuses(graph, nodeStatuses);
    return buildDisplayGraph(patched, runNodeIds);
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

  const elapsed = `${Math.floor(elapsedSec / 60).toString().padStart(2, '0')}:${(elapsedSec % 60).toString().padStart(2, '0')}`;
  const commandColor =
    runInfo?.command === 'run'   ? 'text-brand-400' :
    runInfo?.command === 'build' ? 'text-purple-400' :
    'text-yellow-400';

  if (!runInfo) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 select-none">
        <span className="text-xs text-gray-600">No run yet — run the full project or trigger a model run from the DAG.</span>
        <ProjectRunButtons projectId={projectId} disabled={running} />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Run header */}
      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-gray-800 shrink-0 select-none">
        <span className={`text-xs font-semibold uppercase tracking-wide ${commandColor}`}>
          {runInfo.command}
        </span>
        {runInfo.select && (
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
        <div className="ml-auto">
          <ProjectRunButtons projectId={projectId} disabled={running} />
        </div>
      </div>

      {/* Execution DAG */}
      <div className="overflow-hidden relative flex-1">
        {running && runNodeIds.size === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-600">
            Waiting for models to start…
          </div>
        )}
        {!running && runNodeIds.size === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-600">
            No models executed.
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
    </div>
  );
}

export function RunPanel(props: RunPanelProps) {
  return (
    <ReactFlowProvider>
      <RunPanelInner {...props} />
    </ReactFlowProvider>
  );
}
