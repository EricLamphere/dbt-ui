import { describe, expect, it } from 'vitest';
import type { ColumnLineageEntry, Edge, GraphDto, ModelNode } from '../../../lib/api';
import { computeColumnImpact, describeAffected, pickableColumns, picksFromColumnKeys, type ColumnLineageData } from './columnImpact';

function node(uid: string, overrides: Partial<ModelNode> = {}): ModelNode {
  const [resource_type, , name] = uid.split('.');
  return {
    unique_id: uid, name, resource_type, schema_: null, database: null, materialized: null, tags: [],
    description: '', original_file_path: null, source_name: null, status: 'success', message: null,
    columns: [], test_metadata_name: null, column_name: null, attached_node: null, patch_path: null,
    ...overrides,
  };
}

const e = (source: string, target: string): Edge => ({ source, target });
const ref = (uid: string, column: string): ColumnLineageEntry => ({ node: uid, column });

const STG = 'model.p.stg_orders';
const ENR = 'model.p.enriched';
const AGG = 'model.p.agg';
const DASH = 'exposure.p.dash';
const BLIND = 'model.p.blind'; // no lineage traced (e.g. unparseable SQL)
const T_EMAIL = 'test.p.not_null_enriched_email';
const T_AMOUNT = 'test.p.not_null_enriched_amount';

/**
 *   stg_orders(order_id, email, amount, status)
 *     → enriched(order_id ← order_id, email ← email, amount ← amount), filters on stg_orders.status
 *     → agg(total ← enriched.amount), groups by enriched.email
 *     → dash (exposure, on agg)
 *   stg_orders → blind (no lineage)
 */
function fixture(): { graph: GraphDto; lineage: ColumnLineageData } {
  const graph: GraphDto = {
    nodes: [
      node(STG), node(ENR), node(AGG), node(DASH), node(BLIND),
      node(T_EMAIL, { attached_node: ENR, column_name: 'email' }),
      node(T_AMOUNT, { attached_node: ENR, column_name: 'amount' }),
    ],
    edges: [e(STG, ENR), e(ENR, AGG), e(AGG, DASH), e(STG, BLIND), e(ENR, T_EMAIL), e(ENR, T_AMOUNT)],
  };
  const lineage: ColumnLineageData = {
    results: {
      [ENR]: { order_id: [ref(STG, 'order_id')], email: [ref(STG, 'email')], amount: [ref(STG, 'amount')] },
      [AGG]: { email: [ref(ENR, 'email')], total: [ref(ENR, 'amount')] },
    },
    row_dependencies: {
      [ENR]: [ref(STG, 'status')],
      [AGG]: [ref(ENR, 'email')],
      [T_EMAIL]: [ref(ENR, 'email')],
      [T_AMOUNT]: [ref(ENR, 'amount')],
    },
  };
  return { graph, lineage };
}

const run = (seeds: Record<string, string[] | 'all'>) => {
  const { graph, lineage } = fixture();
  return computeColumnImpact(graph, lineage, new Map(Object.entries(seeds)));
};

describe('computeColumnImpact', () => {
  it('follows a projected column and prunes nodes that never read it', () => {
    const result = run({ [STG]: ['order_id'] });
    expect([...result.nodes.keys()]).toEqual([ENR, BLIND]);
    expect(result.nodes.get(ENR)).toMatchObject({ columns: ['order_id'], via: 'columns', depth: 1 });
    // blind has no lineage, so it can't be narrowed — conservatively all columns
    expect(result.nodes.get(BLIND)).toMatchObject({ columns: 'all', via: 'untraced', depth: 1 });
    expect(result.tests).toEqual(new Set());
  });

  it('marks every column of a model that filters on an affected column', () => {
    const result = run({ [STG]: ['status'] });
    expect(result.nodes.get(ENR)).toMatchObject({ columns: 'all', via: 'rows', trigger: ref(STG, 'status') });
    // all of enriched's columns flow on: agg groups by email → all; dash sits on agg
    expect(result.nodes.get(AGG)).toMatchObject({ columns: 'all', via: 'rows', depth: 2 });
    expect(result.nodes.get(DASH)).toMatchObject({ via: 'exposure', depth: 3 });
    expect(result.tests).toEqual(new Set([T_EMAIL, T_AMOUNT]));
  });

  it('narrows columns through several hops and reaches exposures', () => {
    const result = run({ [STG]: ['amount'] });
    expect(result.nodes.get(ENR)).toMatchObject({ columns: ['amount'], via: 'columns' });
    expect(result.nodes.get(AGG)).toMatchObject({ columns: ['total'], via: 'columns', depth: 2 });
    expect(result.nodes.get(DASH)).toMatchObject({ via: 'exposure', depth: 3 });
    expect(result.tests).toEqual(new Set([T_AMOUNT]));
  });

  it('matches columns case-insensitively and keeps the downstream spelling', () => {
    const result = run({ [STG]: ['EMAIL'] });
    expect(result.nodes.get(ENR)).toMatchObject({ columns: ['email'] });
    expect(result.nodes.get(AGG)).toMatchObject({ columns: 'all', via: 'rows', trigger: ref(ENR, 'email') });
  });

  it('merges columns arriving from several seeds', () => {
    const result = run({ [STG]: ['order_id', 'email'] });
    expect(result.nodes.get(ENR)).toMatchObject({ columns: ['email', 'order_id'] });
  });

  it('treats a seed with every column picked like a row-level change', () => {
    const result = run({ [ENR]: 'all' });
    expect(result.nodes.get(AGG)).toMatchObject({ columns: 'all' });
    expect(result.tests).toEqual(new Set([T_EMAIL, T_AMOUNT]));
  });

  it('falls back to attached_node + column_name for tests without row dependencies', () => {
    const { graph, lineage } = fixture();
    const result = computeColumnImpact(graph, { ...lineage, row_dependencies: {} }, new Map([[STG, ['email']]]));
    expect(result.tests).toEqual(new Set([T_EMAIL]));
  });

  it('never lists tests as downstream nodes, even when lineage traced their SQL', () => {
    const { graph, lineage } = fixture();
    // dbt data tests compile to SQL, so the tracer reports lineage for them too
    const traced = { ...lineage, results: { ...lineage.results, [T_EMAIL]: { email: [ref(ENR, 'email')] } } };
    const result = computeColumnImpact(graph, traced, new Map([[STG, ['email']]]));
    expect([...result.nodes.keys()]).not.toContain(T_EMAIL);
    expect(result.tests).toEqual(new Set([T_EMAIL]));
  });

  it('returns nothing for seeds with no picked columns', () => {
    const result = run({ [STG]: [] });
    expect(result.nodes.size).toBe(0);
    expect(result.tests.size).toBe(0);
  });
});

describe('pickableColumns', () => {
  it('combines traced, documented and downstream-read columns', () => {
    const { graph, lineage } = fixture();
    const stg = { ...graph.nodes[0], columns: [{ name: 'Order_ID', description: '', data_type: '' }, { name: 'created_at', description: '', data_type: '' }] } as ModelNode;
    expect(pickableColumns(lineage, stg)).toEqual(['amount', 'created_at', 'email', 'Order_ID', 'status']);
    expect(pickableColumns(lineage, graph.nodes[1])).toEqual(['amount', 'email', 'order_id']);
  });
});

describe('describeAffected', () => {
  const nameOf = (uid: string) => uid.split('.').pop()!;

  it('lists up to three columns then a count', () => {
    expect(describeAffected({ columns: ['a', 'b'], via: 'columns' }, nameOf)).toMatchObject({ text: 'a, b', tone: 'columns' });
    expect(describeAffected({ columns: ['a', 'b', 'c', 'd', 'e'], via: 'columns' }, nameOf))
      .toMatchObject({ text: 'a, b, c +2', title: 'a, b, c, d, e' });
  });

  it('explains row-level, untraced and exposure cases', () => {
    expect(describeAffected({ columns: 'all', via: 'rows', trigger: ref(STG, 'status') }, nameOf))
      .toMatchObject({ text: 'all · rows via stg_orders.status', tone: 'rows' });
    expect(describeAffected({ columns: 'all', via: 'untraced' }, nameOf)).toMatchObject({ text: 'all · not traced', tone: 'muted' });
    expect(describeAffected({ columns: 'all', via: 'exposure' }, nameOf)).toMatchObject({ text: '—' });
    expect(describeAffected({ columns: 'all', via: 'columns' }, nameOf)).toMatchObject({ text: 'all columns' });
  });
});

describe('picksFromColumnKeys', () => {
  it('groups uid::column keys by node', () => {
    expect(picksFromColumnKeys([`${STG}::email`, `${ENR}::amount`, `${STG}::status`, `${STG}::email`])).toEqual(
      new Map([[STG, ['email', 'status']], [ENR, ['amount']]]),
    );
  });

  it('skips malformed keys', () => {
    expect(picksFromColumnKeys(['no-separator', '::col', `${STG}::`])).toEqual(new Map());
  });
});
