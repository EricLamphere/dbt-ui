import { describe, expect, it } from 'vitest';
import type { Edge, GraphDto, ModelNode } from '../../../lib/api';
import { buildImpactSelector, computeImpact, formatImpactCounts, selectorFor } from './impact';

function node(uid: string, overrides: Partial<ModelNode> = {}): ModelNode {
  const [resource_type, , name] = uid.split('.');
  return {
    unique_id: uid,
    name: name ?? uid,
    resource_type: resource_type ?? 'model',
    schema_: null,
    database: null,
    materialized: resource_type === 'model' ? 'view' : null,
    tags: [],
    description: '',
    original_file_path: null,
    source_name: null,
    status: 'success',
    message: null,
    columns: [],
    test_metadata_name: null,
    column_name: null,
    attached_node: null,
    patch_path: null,
    ...overrides,
  };
}

const e = (source: string, target: string): Edge => ({ source, target });

/**
 *   src ─► stg ─► int ─► fct ─► exp
 *           │             ▲
 *           └─────────────┘   (stg is also a direct parent of fct)
 *   tests: stg (1), fct (2, one relationship to int), unit test on int
 */
function sampleGraph(): GraphDto {
  return {
    nodes: [
      node('source.p.raw_orders', { source_name: 'shop', materialized: null }),
      node('model.p.stg'),
      node('model.p.int', { materialized: 'incremental' }),
      node('model.p.fct', { materialized: 'table', status: 'error' }),
      node('exposure.p.dash', { materialized: null }),
      node('model.p.lonely', { status: 'stale' }),
      node('test.p.not_null_stg'),
      node('test.p.unique_fct'),
      node('test.p.rel_fct_int'),
    ],
    edges: [
      e('source.p.raw_orders', 'model.p.stg'),
      e('model.p.stg', 'model.p.int'),
      e('model.p.stg', 'model.p.fct'),
      e('model.p.int', 'model.p.fct'),
      e('model.p.fct', 'exposure.p.dash'),
      e('model.p.stg', 'test.p.not_null_stg'),
      e('model.p.fct', 'test.p.unique_fct'),
      e('model.p.fct', 'test.p.rel_fct_int'),
      e('model.p.int', 'test.p.rel_fct_int'),
    ],
    unit_tests: [{ unique_id: 'unit_test.p.int.ut', name: 'ut', model: 'int', original_file_path: null }],
  };
}

const ids = (nodes: { node: ModelNode }[]) => nodes.map((n) => n.node.unique_id);

describe('computeImpact', () => {
  it('groups downstream nodes by shortest depth, excluding tests', () => {
    const impact = computeImpact(sampleGraph(), ['model.p.stg']);
    expect(ids(impact.seeds)).toEqual(['model.p.stg']);
    expect(impact.levels.map((l) => [l.depth, ids(l.nodes)])).toEqual([
      [1, ['model.p.fct', 'model.p.int']],
      [2, ['exposure.p.dash']],
    ]);
  });

  it('counts data and unit tests per node', () => {
    const impact = computeImpact(sampleGraph(), ['model.p.stg']);
    const byId = new Map([...impact.seeds, ...impact.levels.flatMap((l) => l.nodes)].map((n) => [n.node.unique_id, n]));
    expect(byId.get('model.p.stg')).toMatchObject({ dataTests: 1, unitTests: 0 });
    expect(byId.get('model.p.int')).toMatchObject({ dataTests: 1, unitTests: 1 });
    expect(byId.get('model.p.fct')).toMatchObject({ dataTests: 2, unitTests: 0 });
  });

  it('flags risks on each node', () => {
    const graph = sampleGraph();
    graph.nodes.push(node('model.p.bare'));
    graph.edges.push(e('model.p.fct', 'model.p.bare'));
    const impact = computeImpact(graph, ['model.p.stg']);
    const flags = Object.fromEntries(impact.levels.flatMap((l) => l.nodes).map((n) => [n.node.name, n.flags]));
    expect(flags.int).toEqual(['incremental']);
    expect(flags.fct).toEqual(['failing']);
    expect(flags.dash).toEqual(['exposure']);
    expect(flags.bare).toEqual(['untested']);
  });

  it('flags stale nodes and failing warn status', () => {
    const graph = sampleGraph();
    graph.nodes = graph.nodes.map((n) => (n.unique_id === 'model.p.int' ? { ...n, status: 'stale' as const } : n));
    graph.nodes = graph.nodes.map((n) => (n.unique_id === 'model.p.fct' ? { ...n, status: 'warn' as const } : n));
    const impact = computeImpact(graph, ['model.p.stg']);
    const flags = Object.fromEntries(impact.levels.flatMap((l) => l.nodes).map((n) => [n.node.name, n.flags]));
    expect(flags.int).toEqual(['incremental', 'stale']);
    expect(flags.fct).toEqual(['failing']);
  });

  it('summarizes downstream counts, tests and flags', () => {
    const { summary } = computeImpact(sampleGraph(), ['model.p.stg']);
    expect(summary.downstreamCount).toBe(3);
    expect(summary.byType).toEqual({ model: 2, exposure: 1 });
    expect(summary.testsOnSeeds).toBe(1);
    expect(summary.testsDownstream).toBe(2);
    expect(summary.unitTests).toBe(1);
    expect(summary.flagCounts).toEqual({ untested: 0, exposure: 1, incremental: 1, failing: 1, stale: 0 });
  });

  it('merges several seeds, keeping seeds out of the downstream levels', () => {
    const impact = computeImpact(sampleGraph(), ['model.p.int', 'model.p.stg']);
    expect(ids(impact.seeds)).toEqual(['model.p.int', 'model.p.stg']);
    expect(impact.levels.map((l) => ids(l.nodes))).toEqual([['model.p.fct'], ['exposure.p.dash']]);
    expect(impact.summary.testsOnSeeds).toBe(2);
    expect(impact.summary.testsDownstream).toBe(1);
  });

  it('returns an empty impact for leaf nodes', () => {
    const impact = computeImpact(sampleGraph(), ['model.p.lonely']);
    expect(impact.levels).toEqual([]);
    expect(impact.summary.downstreamCount).toBe(0);
    expect(impact.seeds[0].flags).toEqual(['untested', 'stale']);
  });

  it('ignores unknown ids and test nodes as seeds', () => {
    const impact = computeImpact(sampleGraph(), ['model.p.nope', 'test.p.unique_fct']);
    expect(impact.seeds).toEqual([]);
    expect(impact.levels).toEqual([]);
  });
});

describe('selectorFor', () => {
  it('uses the node name for models, seeds and snapshots', () => {
    expect(selectorFor(node('model.p.stg'))).toBe('stg');
    expect(selectorFor(node('seed.p.countries'))).toBe('countries');
  });

  it('qualifies sources and exposures', () => {
    expect(selectorFor(node('source.p.raw_orders', { source_name: 'shop' }))).toBe('source:shop.raw_orders');
    expect(selectorFor(node('exposure.p.dash'))).toBe('exposure:dash');
  });
});

describe('buildImpactSelector', () => {
  it('adds a downstream + to each seed, deduplicated', () => {
    const g = sampleGraph();
    const seeds = g.nodes.filter((n) => ['model.p.stg', 'source.p.raw_orders'].includes(n.unique_id));
    expect(buildImpactSelector([...seeds, seeds[0]])).toBe('source:shop.raw_orders+ stg+');
  });

  it('leaves out exposures, which dbt build has nothing to build for', () => {
    const g = sampleGraph();
    const seeds = g.nodes.filter((n) => ['model.p.int', 'exposure.p.dash'].includes(n.unique_id));
    expect(buildImpactSelector(seeds)).toBe('int+');
    expect(buildImpactSelector(seeds.filter((n) => n.resource_type === 'exposure'))).toBe('');
  });
});

describe('formatImpactCounts', () => {
  it('lists node types in display order, then tests', () => {
    const { summary } = computeImpact(sampleGraph(), ['model.p.stg']);
    expect(formatImpactCounts(summary)).toBe('2 models · 1 exposure · 4 tests');
  });

  it('still reports tests when nothing is downstream', () => {
    const { summary } = computeImpact(sampleGraph(), ['model.p.lonely']);
    expect(formatImpactCounts(summary)).toBe('0 tests');
  });
});
