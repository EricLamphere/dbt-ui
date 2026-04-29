import dagre from 'dagre';
import type { Node, Edge as RFEdge } from '@xyflow/react';
import type { ModelNode, Edge } from '../../../lib/api';

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 72;

export function computeLayout(
  models: ModelNode[],
  edges: Edge[],
  nodeHeights?: Map<string, number>,
): { nodes: Node[]; edges: RFEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 40 });

  models.forEach((m) => {
    const height = nodeHeights?.get(m.unique_id) ?? NODE_HEIGHT;
    g.setNode(m.unique_id, { width: NODE_WIDTH, height });
  });
  edges.forEach((e) => {
    g.setEdge(e.source, e.target);
  });
  dagre.layout(g);

  const rfNodes: Node[] = models.map((m) => {
    const pos = g.node(m.unique_id);
    const height = nodeHeights?.get(m.unique_id) ?? NODE_HEIGHT;
    return {
      id: m.unique_id,
      type: 'model',
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - height / 2 },
      data: { model: m },
    };
  });

  const rfEdges: RFEdge[] = edges.map((e) => ({
    id: `${e.source}→${e.target}`,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
  }));

  return { nodes: rfNodes, edges: rfEdges };
}
