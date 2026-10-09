import type { ColumnLineageEntry, GraphDto, ModelNode } from '../../../lib/api';

/**
 * Column-level downstream impact (dbt-ui Pro). Starting from picked columns
 * of the seed nodes, follows projection lineage column by column, and treats
 * a model as changed in EVERY column when it filters / joins / groups on an
 * affected column (row dependencies), since that changes which rows it has.
 *
 * Errs towards over-reporting: a downstream model with no traced lineage at
 * all (unparseable SQL, untraced `select *`) is assumed to change entirely.
 */

/** The parts of a column lineage snapshot this needs. */
export interface ColumnLineageData {
  /** downstream uid → output column → upstream columns it's computed from */
  results: Record<string, Record<string, ColumnLineageEntry[]>>;
  /** uid → upstream columns it filters / joins / groups on */
  row_dependencies: Record<string, ColumnLineageEntry[]>;
}

/** Why a node is affected: specific columns, rows (filter/join/group), no lineage to narrow with, or an exposure. */
export type ColumnImpactVia = 'columns' | 'rows' | 'untraced' | 'exposure';

export interface ColumnImpactNode {
  /** Affected output columns (sorted), or 'all'. */
  columns: string[] | 'all';
  via: ColumnImpactVia;
  /** For via 'rows': the affected upstream column that triggered it. */
  trigger?: ColumnLineageEntry;
  depth: number;
}

export interface ColumnImpactResult {
  /** Downstream non-test nodes reached (seeds excluded), in discovery order. */
  nodes: Map<string, ColumnImpactNode>;
  /** Test uids that check an affected column (seeds' tests included). */
  tests: Set<string>;
}

interface Target { uid: string; column: string }

interface Index {
  byId: Map<string, ModelNode>;
  /** parent uid → lowercased parent column → downstream (uid, column) */
  projection: Map<string, Map<string, Target[]>>;
  /** parent uid → lowercased parent column → downstream non-test uids whose rows depend on it */
  rows: Map<string, Map<string, { uid: string; trigger: ColumnLineageEntry }[]>>;
  /** parent uid → non-test children (graph edges) */
  children: Map<string, string[]>;
  /** test uid → parent uids */
  testParents: Map<string, string[]>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  map.set(key, [...(map.get(key) ?? []), value]);
}

function nested<V>(map: Map<string, Map<string, V[]>>, outer: string, inner: string, value: V) {
  if (!map.has(outer)) map.set(outer, new Map());
  push(map.get(outer)!, inner, value);
}

function buildIndex(graph: GraphDto, lineage: ColumnLineageData): Index {
  const byId = new Map(graph.nodes.map((n) => [n.unique_id, n]));
  const isTest = (uid: string) => byId.get(uid)?.resource_type === 'test';
  const projection: Index['projection'] = new Map();
  for (const [uid, columns] of Object.entries(lineage.results)) {
    // Tests are traced too (they compile to SQL) but are counted separately, not listed as nodes.
    if (isTest(uid)) continue;
    for (const [column, refs] of Object.entries(columns)) {
      for (const r of refs) nested(projection, r.node, r.column.toLowerCase(), { uid, column });
    }
  }
  const rows: Index['rows'] = new Map();
  for (const [uid, refs] of Object.entries(lineage.row_dependencies)) {
    if (isTest(uid)) continue;
    for (const r of refs) nested(rows, r.node, r.column.toLowerCase(), { uid, trigger: r });
  }
  const children = new Map<string, string[]>();
  const testParents = new Map<string, string[]>();
  for (const { source, target } of graph.edges) {
    if (isTest(target)) push(testParents, target, source);
    else push(children, source, target);
  }
  return { byId, projection, rows, children, testParents };
}

/** Lowercased name → spelling, for a node's known columns. */
type ColumnSet = Map<string, string> | 'all';

function hasLineage(lineage: ColumnLineageData, uid: string): boolean {
  return uid in lineage.results || uid in lineage.row_dependencies;
}

/** Every column of `uid` that something downstream reads (what 'all' expands to when propagating). */
function knownColumns(index: Index, uid: string): string[] {
  return [...new Set([...(index.projection.get(uid)?.keys() ?? []), ...(index.rows.get(uid)?.keys() ?? [])])];
}

class Propagation {
  readonly affected = new Map<string, ColumnSet>();
  readonly info = new Map<string, Omit<ColumnImpactNode, 'columns'>>();
  private readonly queue: string[] = [];

  constructor(private readonly index: Index, private readonly lineage: ColumnLineageData) {}

  seed(uid: string, columns: string[] | 'all') {
    this.affected.set(uid, columns === 'all' ? 'all' : new Map(columns.map((c) => [c.toLowerCase(), c])));
    this.info.set(uid, { via: 'columns', depth: 0 });
    this.queue.push(uid);
  }

  run() {
    while (this.queue.length > 0) this.propagateFrom(this.queue.shift()!);
  }

  private reach(uid: string, columns: ColumnSet, via: ColumnImpactVia, depth: number, trigger?: ColumnLineageEntry) {
    const current = this.affected.get(uid);
    if (current === 'all') return;
    if (!this.info.has(uid)) this.info.set(uid, { via, depth, trigger });
    else if (columns === 'all') this.info.set(uid, { ...this.info.get(uid)!, via, trigger });

    if (columns === 'all') {
      this.affected.set(uid, 'all');
    } else {
      const merged = new Map(current ?? []);
      const before = merged.size;
      columns.forEach((spelling, lower) => merged.set(lower, spelling));
      if (current && merged.size === before) return;
      this.affected.set(uid, merged);
    }
    this.queue.push(uid);
  }

  private propagateFrom(uid: string) {
    const set = this.affected.get(uid)!;
    const depth = this.info.get(uid)!.depth + 1;
    const columns = set === 'all' ? knownColumns(this.index, uid) : [...set.keys()];

    for (const column of columns) {
      for (const t of this.index.projection.get(uid)?.get(column) ?? []) {
        this.reach(t.uid, new Map([[t.column.toLowerCase(), t.column]]), 'columns', depth);
      }
      for (const r of this.index.rows.get(uid)?.get(column) ?? []) {
        this.reach(r.uid, 'all', 'rows', depth, r.trigger);
      }
    }
    // Exposures and models without lineage can't be narrowed: any affected column reaches them.
    for (const child of this.index.children.get(uid) ?? []) {
      const type = this.index.byId.get(child)?.resource_type;
      if (type === 'exposure') this.reach(child, 'all', 'exposure', depth);
      else if (!hasLineage(this.lineage, child)) this.reach(child, 'all', 'untraced', depth);
    }
  }
}

function isTestAffected(index: Index, lineage: ColumnLineageData, affected: Map<string, ColumnSet>, test: ModelNode): boolean {
  const covers = (uid: string, column: string) => {
    const set = affected.get(uid);
    return set === 'all' || (!!set && set.has(column.toLowerCase()));
  };
  const deps = lineage.row_dependencies[test.unique_id];
  if (deps?.length) return deps.some((d) => covers(d.node, d.column));
  if (test.attached_node && test.column_name) return covers(test.attached_node, test.column_name);
  return (index.testParents.get(test.unique_id) ?? []).some((p) => affected.has(p));
}

export function computeColumnImpact(
  graph: GraphDto,
  lineage: ColumnLineageData,
  seeds: ReadonlyMap<string, string[] | 'all'>,
): ColumnImpactResult {
  const index = buildIndex(graph, lineage);
  const propagation = new Propagation(index, lineage);
  seeds.forEach((columns, uid) => {
    if (columns === 'all' || columns.length > 0) propagation.seed(uid, columns);
  });
  propagation.run();

  const nodes = new Map<string, ColumnImpactNode>();
  propagation.affected.forEach((set, uid) => {
    if (seeds.has(uid)) return;
    const columns = set === 'all' ? 'all' : [...set.values()].sort();
    nodes.set(uid, { columns, ...propagation.info.get(uid)! });
  });

  const tests = new Set(
    graph.nodes
      .filter((n) => n.resource_type === 'test' && isTestAffected(index, lineage, propagation.affected, n))
      .map((n) => n.unique_id),
  );
  return { nodes, tests };
}

/**
 * Columns of `node` to offer in the picker: its traced output columns, its
 * documented columns, and any column of it that something downstream reads
 * (covers seeds and sources, which have no traced output). Sorted, deduped
 * case-insensitively, keeping the first spelling seen.
 */
export function pickableColumns(lineage: ColumnLineageData, node: ModelNode): string[] {
  const read = Object.values(lineage.results).flatMap((cols) =>
    Object.values(cols).flatMap((refs) => refs.filter((r) => r.node === node.unique_id).map((r) => r.column)),
  );
  const rowRead = Object.values(lineage.row_dependencies).flatMap((refs) =>
    refs.filter((r) => r.node === node.unique_id).map((r) => r.column),
  );
  const all = [...Object.keys(lineage.results[node.unique_id] ?? {}), ...node.columns.map((c) => c.name), ...read, ...rowRead];
  const byLower = new Map<string, string>();
  for (const c of all) if (!byLower.has(c.toLowerCase())) byLower.set(c.toLowerCase(), c);
  return [...byLower.values()].sort((a, b) => a.localeCompare(b));
}

export interface AffectedColumnsLabel {
  text: string;
  /** Full detail for a tooltip. */
  title: string;
  tone: 'columns' | 'rows' | 'muted';
}

const SHOWN_COLUMNS = 3;

/** Display text for one node's affected columns. `nameOf` maps a uid to a short node name. */
export function describeAffected(
  info: Pick<ColumnImpactNode, 'columns' | 'via' | 'trigger'>,
  nameOf: (uid: string) => string,
): AffectedColumnsLabel {
  if (info.via === 'exposure') return { text: '—', title: 'Exposures have no columns; reached through an affected parent', tone: 'muted' };
  if (info.via === 'untraced') {
    return { text: 'all · not traced', title: "No column lineage for this model (e.g. SQL that couldn't be parsed), so it's assumed fully affected", tone: 'muted' };
  }
  if (info.via === 'rows' && info.trigger) {
    const via = `${nameOf(info.trigger.node)}.${info.trigger.column}`;
    return { text: `all · rows via ${via}`, title: `Filters, joins or groups on ${via}, so every row and column can change`, tone: 'rows' };
  }
  if (info.columns === 'all') return { text: 'all columns', title: 'Every column is affected', tone: 'rows' };
  const shown = info.columns.slice(0, SHOWN_COLUMNS).join(', ');
  const more = info.columns.length - SHOWN_COLUMNS;
  return { text: more > 0 ? `${shown} +${more}` : shown, title: info.columns.join(', '), tone: 'columns' };
}

/** The DAG's column selection keys (`<uid>::<column>`) → picked columns per node, in first-seen order. */
export function picksFromColumnKeys(keys: readonly string[]): Map<string, string[]> {
  const picks = new Map<string, string[]>();
  for (const key of keys) {
    const sep = key.indexOf('::');
    if (sep <= 0 || sep + 2 >= key.length) continue;
    const uid = key.slice(0, sep);
    const column = key.slice(sep + 2);
    const cols = picks.get(uid) ?? [];
    if (!cols.includes(column)) picks.set(uid, [...cols, column]);
  }
  return picks;
}
