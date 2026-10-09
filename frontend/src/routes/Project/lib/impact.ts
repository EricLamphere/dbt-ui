import type { GraphDto, ModelNode } from '../../../lib/api';

/**
 * Downstream impact analysis: given the nodes being changed ("seeds"), what
 * sits downstream of them, how well is it tested, and what is risky to break.
 * Tests are not listed as impacted nodes; they're counted per node instead.
 */

export const IMPACT_FLAGS = ['untested', 'exposure', 'incremental', 'failing', 'stale'] as const;
export type ImpactFlag = (typeof IMPACT_FLAGS)[number];

export interface ImpactNode {
  node: ModelNode;
  /** 0 for seeds, otherwise the shortest number of hops from any seed. */
  depth: number;
  dataTests: number;
  unitTests: number;
  flags: ImpactFlag[];
}

export interface ImpactLevel {
  depth: number;
  nodes: ImpactNode[];
}

export interface ImpactSummary {
  downstreamCount: number;
  byType: Record<string, number>;
  /** Data tests attached to a seed — they check the change itself. */
  testsOnSeeds: number;
  /** Data tests attached only to downstream nodes. */
  testsDownstream: number;
  /** Unit tests on seeds and downstream models. */
  unitTests: number;
  /** Flags across downstream nodes only. */
  flagCounts: Record<ImpactFlag, number>;
}

export interface Impact {
  seeds: ImpactNode[];
  levels: ImpactLevel[];
  summary: ImpactSummary;
}

const TESTABLE_TYPES = new Set(['model', 'snapshot']);
const FAILING_STATUSES = new Set(['error', 'warn']);
const TYPE_ORDER = ['model', 'snapshot', 'seed', 'source', 'exposure'];

function typeRank(type: string): number {
  const i = TYPE_ORDER.indexOf(type);
  return i === -1 ? TYPE_ORDER.length : i;
}

function compareNodes(a: ImpactNode, b: ImpactNode): number {
  return typeRank(a.node.resource_type) - typeRank(b.node.resource_type) || a.node.name.localeCompare(b.node.name);
}

function flagsFor(node: ModelNode, totalTests: number): ImpactFlag[] {
  const has: Record<ImpactFlag, boolean> = {
    untested: TESTABLE_TYPES.has(node.resource_type) && totalTests === 0,
    exposure: node.resource_type === 'exposure',
    incremental: node.materialized === 'incremental',
    failing: FAILING_STATUSES.has(node.status),
    stale: node.status === 'stale',
  };
  return IMPACT_FLAGS.filter((f) => has[f]);
}

interface GraphIndex {
  byId: Map<string, ModelNode>;
  children: Map<string, string[]>;
  /** test uid → the non-test nodes it depends on */
  testParents: Map<string, string[]>;
  unitTestsByModelName: Map<string, number>;
}

function indexGraph(graph: GraphDto): GraphIndex {
  const byId = new Map(graph.nodes.map((n) => [n.unique_id, n]));
  const children = new Map<string, string[]>();
  const testParents = new Map<string, string[]>();
  for (const { source, target } of graph.edges) {
    if (byId.get(target)?.resource_type === 'test') {
      testParents.set(target, [...(testParents.get(target) ?? []), source]);
    } else {
      children.set(source, [...(children.get(source) ?? []), target]);
    }
  }
  const unitTestsByModelName = new Map<string, number>();
  for (const ut of graph.unit_tests ?? []) {
    if (ut.model) unitTestsByModelName.set(ut.model, (unitTestsByModelName.get(ut.model) ?? 0) + 1);
  }
  return { byId, children, testParents, unitTestsByModelName };
}

/** Shortest-depth BFS from all seeds at once; seeds themselves get depth 0. */
function downstreamDepths(seedIds: string[], children: Map<string, string[]>): Map<string, number> {
  const depths = new Map(seedIds.map((id) => [id, 0]));
  const queue = [...seedIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of children.get(current) ?? []) {
      if (depths.has(next)) continue;
      depths.set(next, depths.get(current)! + 1);
      queue.push(next);
    }
  }
  return depths;
}

function countDataTests(testParents: Map<string, string[]>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const parents of testParents.values()) {
    for (const p of new Set(parents)) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return counts;
}

function groupByDepth(nodes: ImpactNode[]): ImpactLevel[] {
  const levels = new Map<number, ImpactNode[]>();
  for (const n of nodes) levels.set(n.depth, [...(levels.get(n.depth) ?? []), n]);
  return [...levels.entries()]
    .sort(([a], [b]) => a - b)
    .map(([depth, items]) => ({ depth, nodes: [...items].sort(compareNodes) }));
}

function summarize(seeds: ImpactNode[], downstream: ImpactNode[], index: GraphIndex): ImpactSummary {
  const seedIds = new Set(seeds.map((n) => n.node.unique_id));
  const downstreamIds = new Set(downstream.map((n) => n.node.unique_id));
  let testsOnSeeds = 0;
  let testsDownstream = 0;
  for (const parents of index.testParents.values()) {
    if (parents.some((p) => seedIds.has(p))) testsOnSeeds += 1;
    else if (parents.some((p) => downstreamIds.has(p))) testsDownstream += 1;
  }

  const byType: Record<string, number> = {};
  const flagCounts = Object.fromEntries(IMPACT_FLAGS.map((f) => [f, 0])) as Record<ImpactFlag, number>;
  for (const { node, flags } of downstream) {
    byType[node.resource_type] = (byType[node.resource_type] ?? 0) + 1;
    for (const f of flags) flagCounts[f] += 1;
  }

  return {
    downstreamCount: downstream.length,
    byType,
    testsOnSeeds,
    testsDownstream,
    unitTests: [...seeds, ...downstream].reduce((sum, n) => sum + n.unitTests, 0),
    flagCounts,
  };
}

export function computeImpact(graph: GraphDto, seedIds: readonly string[]): Impact {
  const index = indexGraph(graph);
  const validSeeds = [...new Set(seedIds)].filter((id) => {
    const n = index.byId.get(id);
    return n != null && n.resource_type !== 'test';
  });
  const dataTests = countDataTests(index.testParents);

  const impactNodes = [...downstreamDepths(validSeeds, index.children)].flatMap(([id, depth]) => {
    const node = index.byId.get(id);
    if (!node) return [];
    const data = dataTests.get(id) ?? 0;
    const unit = node.resource_type === 'model' ? index.unitTestsByModelName.get(node.name) ?? 0 : 0;
    return [{ node, depth, dataTests: data, unitTests: unit, flags: flagsFor(node, data + unit) }];
  });

  const seeds = impactNodes.filter((n) => n.depth === 0).sort(compareNodes);
  const downstream = impactNodes.filter((n) => n.depth > 0);
  return { seeds, levels: groupByDepth(downstream), summary: summarize(seeds, downstream, index) };
}

/** The dbt `--select` term for a single node. */
export function selectorFor(node: ModelNode): string {
  if (node.resource_type === 'source' && node.source_name) return `source:${node.source_name}.${node.name}`;
  if (node.resource_type === 'exposure') return `exposure:${node.name}`;
  return node.name;
}

/** `dbt build --select` value covering the seeds and everything downstream. */
export function buildImpactSelector(seeds: readonly ModelNode[]): string {
  return [...new Set(seeds.map((n) => `${selectorFor(n)}+`))].sort().join(' ');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Total tests a `dbt build` of the impact would run (data + unit). */
export function totalImpactTests(summary: ImpactSummary): number {
  return summary.testsOnSeeds + summary.testsDownstream + summary.unitTests;
}

/** e.g. "12 models · 2 exposures · 38 tests" — node types in display order. */
export function formatImpactCounts(summary: ImpactSummary): string {
  const types = Object.keys(summary.byType).sort((a, b) => typeRank(a) - typeRank(b) || a.localeCompare(b));
  const parts = types.map((t) => plural(summary.byType[t], t));
  return [...parts, plural(totalImpactTests(summary), 'test')].join(' · ');
}
