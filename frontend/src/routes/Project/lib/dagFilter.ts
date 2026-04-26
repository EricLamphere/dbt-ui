import type { ModelNode, Edge, GraphDto } from '../../../lib/api';

export interface FilterState {
  selector: string;
  resourceTypes: Set<string>;
  materializations: Set<string>;
  tags: Set<string>;
  statuses: Set<string>;
}

export function emptyFilter(): FilterState {
  return {
    selector: '',
    resourceTypes: new Set(),
    materializations: new Set(),
    tags: new Set(),
    statuses: new Set(),
  };
}

export function defaultFilter(): FilterState {
  return {
    selector: '',
    resourceTypes: new Set(['model']),
    materializations: new Set(),
    tags: new Set(),
    statuses: new Set(),
  };
}

export function isFilterActive(f: FilterState): boolean {
  return (
    f.selector.trim() !== '' ||
    f.resourceTypes.size > 0 ||
    f.materializations.size > 0 ||
    f.tags.size > 0 ||
    f.statuses.size > 0
  );
}


export function serializeFilter(f: FilterState): string {
  return JSON.stringify({
    selector: f.selector,
    resourceTypes: [...f.resourceTypes],
    materializations: [...f.materializations],
    tags: [...f.tags],
    statuses: [...f.statuses],
  });
}

export function deserializeFilter(raw: string): FilterState {
  try {
    const obj = JSON.parse(raw);
    return {
      selector: obj.selector ?? '',
      resourceTypes: new Set(obj.resourceTypes ?? []),
      materializations: new Set(obj.materializations ?? []),
      tags: new Set(obj.tags ?? []),
      statuses: new Set(obj.statuses ?? []),
    };
  } catch {
    return defaultFilter();
  }
}

export interface AvailableFilters {
  resourceTypes: string[];
  materializations: string[];
  tags: string[];
  statuses: string[];
}

export function getAvailableFilters(graph: GraphDto): AvailableFilters {
  const resourceTypes = new Set<string>();
  const materializations = new Set<string>();
  const tags = new Set<string>();
  const statuses = new Set<string>();

  for (const node of graph.nodes) {
    resourceTypes.add(node.resource_type);
    if (node.materialized) materializations.add(node.materialized);
    for (const tag of node.tags) tags.add(tag);
    if (node.status && node.status !== 'idle') statuses.add(node.status);
  }

  return {
    resourceTypes: [...resourceTypes].sort(),
    materializations: [...materializations].sort(),
    tags: [...tags].sort(),
    statuses: [...statuses].sort(),
  };
}

function buildAdjacency(edges: Edge[]): {
  bySource: Map<string, Set<string>>;
  byTarget: Map<string, Set<string>>;
} {
  const bySource = new Map<string, Set<string>>();
  const byTarget = new Map<string, Set<string>>();
  for (const { source, target } of edges) {
    if (!bySource.has(source)) bySource.set(source, new Set());
    bySource.get(source)!.add(target);
    if (!byTarget.has(target)) byTarget.set(target, new Set());
    byTarget.get(target)!.add(source);
  }
  return { bySource, byTarget };
}

function bfsExpand(
  seeds: Set<string>,
  allIds: Set<string>,
  adjacency: Map<string, Set<string>>,
): Set<string> {
  const visited = new Set<string>(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (allIds.has(neighbor) && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited;
}

interface ParsedToken {
  upstream: boolean;
  downstream: boolean;
  kind: 'tag' | 'source' | 'resource_type' | 'name';
  value: string;
}

function parseToken(raw: string): ParsedToken {
  let s = raw;
  const upstream = s.startsWith('+');
  if (upstream) s = s.slice(1);
  const downstream = s.endsWith('+');
  if (downstream) s = s.slice(0, -1);

  if (s.startsWith('tag:')) {
    return { upstream, downstream, kind: 'tag', value: s.slice(4).toLowerCase() };
  }
  if (s.startsWith('source:')) {
    return { upstream, downstream, kind: 'source', value: s.slice(7).toLowerCase() };
  }
  if (s.startsWith('resource_type:')) {
    return { upstream, downstream, kind: 'resource_type', value: s.slice(14).toLowerCase() };
  }

  // Bare type shorthand: model, seed, snapshot, test, source, analysis
  const bareTypes = new Set(['model', 'seed', 'snapshot', 'test', 'source', 'analysis']);
  if (bareTypes.has(s.toLowerCase())) {
    return { upstream, downstream, kind: 'resource_type', value: s.toLowerCase() };
  }

  return { upstream, downstream, kind: 'name', value: s.toLowerCase() };
}

function seedsForToken(token: ParsedToken, nodes: ModelNode[]): Set<string> {
  const seeds = new Set<string>();
  for (const node of nodes) {
    let match = false;
    if (token.kind === 'tag') {
      match = node.tags.some((t) => t.toLowerCase().includes(token.value));
    } else if (token.kind === 'source') {
      match = node.resource_type === 'source' && node.name.toLowerCase().includes(token.value);
    } else if (token.kind === 'resource_type') {
      match = node.resource_type.toLowerCase() === token.value;
    } else {
      match = node.name.toLowerCase().includes(token.value);
    }
    if (match) seeds.add(node.unique_id);
  }
  return seeds;
}

export function applyFilter(graph: GraphDto, filter: FilterState): GraphDto {
  if (!isFilterActive(filter)) return graph;

  const allIds = new Set(graph.nodes.map((n) => n.unique_id));
  const { bySource, byTarget } = buildAdjacency(graph.edges);

  // Step 1: apply selector text → candidate set
  let candidates: Set<string>;

  const selectorText = filter.selector.trim();
  if (selectorText) {
    candidates = new Set<string>();
    for (const rawToken of selectorText.split(/\s+/)) {
      if (!rawToken) continue;
      const token = parseToken(rawToken);
      const seeds = seedsForToken(token, graph.nodes);

      let expanded = seeds;
      if (token.upstream) {
        expanded = new Set([...expanded, ...bfsExpand(seeds, allIds, byTarget)]);
      }
      if (token.downstream) {
        expanded = new Set([...expanded, ...bfsExpand(seeds, allIds, bySource)]);
      }
      for (const id of expanded) candidates.add(id);
    }
  } else {
    candidates = new Set(allIds);
  }

  // Step 2: apply dropdown filters (AND between categories, OR within each)
  const nodeMap = new Map(graph.nodes.map((n) => [n.unique_id, n]));

  const filtered = new Set<string>();
  for (const id of candidates) {
    const node = nodeMap.get(id);
    if (!node) continue;

    if (filter.resourceTypes.size > 0 && !filter.resourceTypes.has(node.resource_type)) continue;
    if (filter.materializations.size > 0 && (!node.materialized || !filter.materializations.has(node.materialized))) continue;
    if (filter.tags.size > 0 && !node.tags.some((t) => filter.tags.has(t))) continue;
    if (filter.statuses.size > 0 && !filter.statuses.has(node.status)) continue;

    filtered.add(id);
  }

  return {
    nodes: graph.nodes.filter((n) => filtered.has(n.unique_id)),
    edges: graph.edges.filter((e) => filtered.has(e.source) && filtered.has(e.target)),
  };
}
