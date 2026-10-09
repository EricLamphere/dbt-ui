import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Crosshair } from 'lucide-react';

import type { GraphDto, ModelNode } from '../../../../lib/api';
import ModelNodeComponent from '../ModelNode';
import { computeLayout, NODE_HEIGHT, NODE_WIDTH } from '../../lib/layout';
import { getAvailableFilters } from '../../lib/dagFilter';
import {
  buildNodeLineageGraph,
  deserializeNodeDagFilter,
  defaultNodeDagFilter,
  filterNodeLineage,
  serializeNodeDagFilter,
  type NodeDagFilter,
} from '../../lib/nodeLineage';
import { OPEN_IN_FILES_TITLE, useOpenInFiles } from '../../lib/openInFiles';
import { FilterDropdown } from '../FilterDropdown';

interface NodeDagPanelProps {
  projectId: number;
  graph: GraphDto | null;
  selectedNodeId: string | null;
}

const nodeTypes = { model: ModelNodeComponent };

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1;
const VIEW_PADDING = 40;
const BRIDGED_EDGE_STYLE = { strokeDasharray: '5 4' };

const filterStorageKey = (projectId: number) => `node-dag-filter-${projectId}`;

function readStoredFilter(projectId: number): NodeDagFilter {
  try {
    return deserializeNodeDagFilter(sessionStorage.getItem(filterStorageKey(projectId)));
  } catch {
    return defaultNodeDagFilter();
  }
}

/** Type/Materialization/Status filters, persisted per project for the session. */
function useNodeDagFilter(projectId: number) {
  const [filter, setFilterState] = useState<NodeDagFilter>(() => readStoredFilter(projectId));
  const setFilter = useCallback((next: NodeDagFilter) => {
    setFilterState(next);
    try { sessionStorage.setItem(filterStorageKey(projectId), serializeNodeDagFilter(next)); } catch {}
  }, [projectId]);
  return [filter, setFilter] as const;
}

/**
 * Zoom level that keeps every node visible while the selected node sits dead
 * centre — i.e. fit the farthest node on each axis into half the viewport.
 */
function zoomToFitAround(nodes: Node[], cx: number, cy: number, width: number, height: number): number {
  let maxDx = NODE_WIDTH / 2;
  let maxDy = NODE_HEIGHT / 2;
  for (const n of nodes) {
    maxDx = Math.max(maxDx, Math.abs(n.position.x - cx), Math.abs(n.position.x + NODE_WIDTH - cx));
    maxDy = Math.max(maxDy, Math.abs(n.position.y - cy), Math.abs(n.position.y + NODE_HEIGHT - cy));
  }
  const zoom = Math.min((width / 2 - VIEW_PADDING) / maxDx, (height / 2 - VIEW_PADDING) / maxDy);
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-xs text-gray-600 select-none">
      {message}
    </div>
  );
}

function NodeDagPanelInner({ projectId, graph, selectedNodeId }: NodeDagPanelProps) {
  const { setCenter } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const { handleClick: openInFilesClick } = useOpenInFiles(projectId);

  const [filter, setFilter] = useNodeDagFilter(projectId);
  const [closeDropdownsSignal, setCloseDropdownsSignal] = useState(0);

  const fullLineage = useMemo(
    () => (graph && selectedNodeId ? buildNodeLineageGraph(graph, selectedNodeId) : null),
    [graph, selectedNodeId],
  );
  // Options come from the whole project graph (as on the main DAG), so every
  // type/materialization/status is always offered — even ones this lineage lacks.
  const available = useMemo(() => (graph ? getAvailableFilters(graph) : null), [graph]);
  const lineage = useMemo(
    () => (fullLineage && selectedNodeId ? filterNodeLineage(fullLineage, selectedNodeId, filter) : null),
    [fullLineage, selectedNodeId, filter],
  );

  const { nodes, edges } = useMemo(() => {
    if (!lineage) return { nodes: [], edges: [] };
    const layout = computeLayout(lineage.nodes, lineage.edges);
    const bridged = new Set(lineage.edges.filter((e) => e.bridged).map((e) => `${e.source}→${e.target}`));
    return {
      nodes: layout.nodes.map((n) => ({ ...n, selected: n.id === selectedNodeId })),
      edges: layout.edges.map((e) => (bridged.has(e.id) ? { ...e, style: BRIDGED_EDGE_STYLE } : e)),
    };
  }, [lineage, selectedNodeId]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedName = (selectedNode?.data.model as ModelNode | undefined)?.name ?? null;

  const recenter = useCallback((duration = 200) => {
    if (!selectedNode || width === 0 || height === 0) return;
    const cx = selectedNode.position.x + NODE_WIDTH / 2;
    const cy = selectedNode.position.y + NODE_HEIGHT / 2;
    setCenter(cx, cy, { zoom: zoomToFitAround(nodes, cx, cy, width, height), duration });
  }, [selectedNode, nodes, width, height, setCenter]);

  // Re-centre when the selection or the set of nodes in the lineage changes —
  // not on status-only graph refreshes, so a run doesn't yank the viewport.
  const nodeIdsKey = useMemo(() => nodes.map((n) => n.id).join('|'), [nodes]);
  const viewportReady = width > 0 && height > 0;
  useEffect(() => {
    if (viewportReady) recenter(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, nodeIdsKey, viewportReady]);

  const onNodeClick = useCallback((e: React.MouseEvent, node: Node) => {
    openInFilesClick(e, node.id);
  }, [openInFilesClick]);

  if (!selectedNodeId) {
    return <EmptyState message="Select a node in the DAG or open a model file to see its lineage." />;
  }
  if (!graph) return <EmptyState message="Loading graph…" />;
  if (!lineage || !available) return <EmptyState message="The selected node isn't in the project graph." />;

  const setCategory = (key: keyof NodeDagFilter) => (value: Set<string>) =>
    setFilter({ ...filter, [key]: value });
  // Also list selected values absent from the project (e.g. the default `exposure`
  // in a project without exposures), so the badge count matches visible boxes.
  const optionsFor = (present: string[], selected: ReadonlySet<string>) =>
    [...new Set([...present, ...selected])].sort();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-1 border-b border-gray-800 shrink-0 select-none">
        <span className="text-xs font-mono text-gray-300 truncate">+{selectedName}+</span>
        <span className="text-xs text-gray-600">
          {lineage.nodes.length} node{lineage.nodes.length === 1 ? '' : 's'}
        </span>
        <span className="text-xs text-gray-600 truncate">· {OPEN_IN_FILES_TITLE}</span>
        <div className="flex items-center gap-2 ml-auto">
          <FilterDropdown
            label="Type"
            options={optionsFor(available.resourceTypes, filter.resourceTypes)}
            selected={filter.resourceTypes}
            onChange={setCategory('resourceTypes')}
            closeSignal={closeDropdownsSignal}
          />
          <FilterDropdown
            label="Materialization"
            options={optionsFor(available.materializations, filter.materializations)}
            selected={filter.materializations}
            onChange={setCategory('materializations')}
            closeSignal={closeDropdownsSignal}
          />
          <FilterDropdown
            label="Status"
            options={optionsFor(available.statuses, filter.statuses)}
            selected={filter.statuses}
            onChange={setCategory('statuses')}
            closeSignal={closeDropdownsSignal}
          />
        </div>
        <button
          onClick={() => recenter()}
          className="p-1 rounded text-gray-500 transition-colors hover:text-gray-300"
          title="Re-center on selected node"
        >
          <Crosshair className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onPaneClick={() => setCloseDropdownsSignal((n) => n + 1)}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          minZoom={MIN_ZOOM}
          maxZoom={1.5}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1f2937" />
        </ReactFlow>
      </div>
    </div>
  );
}

export function NodeDagPanel(props: NodeDagPanelProps) {
  return (
    <ReactFlowProvider>
      <NodeDagPanelInner {...props} />
    </ReactFlowProvider>
  );
}
