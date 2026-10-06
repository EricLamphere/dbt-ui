import type { Edge, GraphDto, ModelNode } from '../../../lib/api';
import { matchesDropdownFilters, type DropdownFilters } from './dagFilter';

/** A lineage edge; `bridged` means it skips over one or more filtered-out nodes. */
export interface LineageEdge extends Edge {
  bridged: boolean;
}

export interface NodeLineage {
  nodes: ModelNode[];
  edges: LineageEdge[];
}

export type NodeDagFilter = Pick<DropdownFilters, 'resourceTypes' | 'materializations' | 'statuses'>;

export function emptyNodeDagFilter(): NodeDagFilter {
  return { resourceTypes: new Set(), materializations: new Set(), statuses: new Set() };
}

/** Initial filter: everything except tests, which as leaf nodes would swamp the view. */
export function defaultNodeDagFilter(): NodeDagFilter {
  return {
    resourceTypes: new Set(['seed', 'source', 'model', 'exposure']),
    materializations: new Set(),
    statuses: new Set(),
  };
}

export function isNodeDagFilterActive(f: NodeDagFilter): boolean {
  return f.resourceTypes.size > 0 || f.materializations.size > 0 || f.statuses.size > 0;
}

export function serializeNodeDagFilter(f: NodeDagFilter): string {
  return JSON.stringify({
    resourceTypes: [...f.resourceTypes],
    materializations: [...f.materializations],
    statuses: [...f.statuses],
  });
}

export function deserializeNodeDagFilter(raw: string | null): NodeDagFilter {
  if (!raw) return defaultNodeDagFilter();
  try {
    const obj = JSON.parse(raw);
    return {
      resourceTypes: new Set(obj.resourceTypes ?? []),
      materializations: new Set(obj.materializations ?? []),
      statuses: new Set(obj.statuses ?? []),
    };
  } catch {
    return defaultNodeDagFilter();
  }
}

function walk(seed: string, adjacency: Map<string, string[]>): Set<string> {
  const visited = new Set<string>([seed]);
  const queue = [seed];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

function downstreamMap(edges: Edge[]): Map<string, string[]> {
  const downstream = new Map<string, string[]>();
  for (const { source, target } of edges) {
    downstream.set(source, [...(downstream.get(source) ?? []), target]);
  }
  return downstream;
}

function upstreamMap(edges: Edge[]): Map<string, string[]> {
  const upstream = new Map<string, string[]>();
  for (const { source, target } of edges) {
    upstream.set(target, [...(upstream.get(target) ?? []), source]);
  }
  return upstream;
}

/**
 * The full `+uid+` subgraph: the node plus all of its transitive ancestors and
 * descendants (tests included — see filterNodeLineage). Returns null if uid
 * isn't in the graph.
 */
export function buildNodeLineageGraph(graph: GraphDto, uid: string): GraphDto | null {
  if (!graph.nodes.some((n) => n.unique_id === uid)) return null;

  const lineage = new Set([
    ...walk(uid, upstreamMap(graph.edges)),
    ...walk(uid, downstreamMap(graph.edges)),
  ]);

  return {
    nodes: graph.nodes.filter((n) => lineage.has(n.unique_id)),
    edges: graph.edges.filter((e) => lineage.has(e.source) && lineage.has(e.target)),
  };
}

function isVisible(node: ModelNode, selectedUid: string, filter: NodeDagFilter): boolean {
  if (node.unique_id === selectedUid) return true;
  return matchesDropdownFilters(node, filter);
}

/**
 * Edges between visible nodes. Where hidden nodes sit between two visible
 * ones, a `bridged` edge connects them directly so the lineage stays connected.
 */
function bridgeEdges(edges: Edge[], visible: Set<string>): LineageEdge[] {
  const downstream = downstreamMap(edges);
  const result = new Map<string, LineageEdge>();

  for (const source of visible) {
    const seen = new Set<string>();
    const queue = (downstream.get(source) ?? []).map((id) => ({ id, direct: true }));
    while (queue.length > 0) {
      const { id, direct } = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (visible.has(id)) {
        const key = `${source}→${id}`;
        if (direct || !result.has(key)) result.set(key, { source, target: id, bridged: !direct });
        continue;
      }
      for (const next of downstream.get(id) ?? []) queue.push({ id: next, direct: false });
    }
  }
  return [...result.values()];
}

/** Apply the Node DAG's dropdown filters; the selected node is always kept. */
export function filterNodeLineage(lineage: GraphDto, selectedUid: string, filter: NodeDagFilter): NodeLineage {
  const nodes = lineage.nodes.filter((n) => isVisible(n, selectedUid, filter));
  const visible = new Set(nodes.map((n) => n.unique_id));
  return { nodes, edges: bridgeEdges(lineage.edges, visible) };
}
