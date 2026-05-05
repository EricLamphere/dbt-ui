import type { GraphDto, ModelNode } from '../../../lib/api';

export interface ColumnCoverage {
  count: number;
  testTypes: string[];
}

export type CoverageMap = ReadonlyMap<string, ReadonlyMap<string, ColumnCoverage>>;

export interface ModelCoverageStats {
  totalColumns: number;
  testedColumns: number;
  percent: number;
}

export interface NodeCoverageData {
  columnsMap: ReadonlyMap<string, ColumnCoverage>;
  stats: ModelCoverageStats;
}

export type CoverageBucket = 'untested' | 'low' | 'med' | 'high';

export const COVERAGE_CLASS: Record<CoverageBucket, { bg: string; text: string; dot: string }> = {
  untested: { bg: 'bg-zinc-800/60',    text: 'text-zinc-500',    dot: 'bg-zinc-600' },
  low:      { bg: 'bg-emerald-900/30', text: 'text-emerald-300', dot: 'bg-emerald-700' },
  med:      { bg: 'bg-emerald-800/40', text: 'text-emerald-200', dot: 'bg-emerald-500' },
  high:     { bg: 'bg-emerald-700/50', text: 'text-emerald-100', dot: 'bg-emerald-300' },
};

export function buildCoverageMap(graph: GraphDto): CoverageMap {
  const mutable = new Map<string, Map<string, { count: number; types: Set<string> }>>();

  for (const node of graph.nodes) {
    if (
      node.resource_type !== 'test' ||
      !node.attached_node ||
      !node.column_name
    ) continue;

    const modelUid = node.attached_node;
    const colName = node.column_name;
    const testType = node.test_metadata_name ?? node.name;

    if (!mutable.has(modelUid)) mutable.set(modelUid, new Map());
    const colMap = mutable.get(modelUid)!;

    if (!colMap.has(colName)) colMap.set(colName, { count: 0, types: new Set() });
    const entry = colMap.get(colName)!;
    entry.count += 1;
    entry.types.add(testType);
  }

  const result = new Map<string, ReadonlyMap<string, ColumnCoverage>>();
  for (const [modelUid, colMap] of mutable) {
    const frozen = new Map<string, ColumnCoverage>();
    for (const [colName, { count, types }] of colMap) {
      frozen.set(colName, { count, testTypes: [...types].sort() });
    }
    result.set(modelUid, frozen);
  }
  return result;
}

export function getModelCoverageStats(map: CoverageMap, model: ModelNode): ModelCoverageStats {
  const totalColumns = model.columns.length;
  if (totalColumns === 0) return { totalColumns: 0, testedColumns: 0, percent: 0 };

  const colMap = map.get(model.unique_id);
  const testedColumns = colMap ? model.columns.filter((c) => colMap.has(c.name)).length : 0;
  const percent = Math.round((testedColumns / totalColumns) * 100);
  return { totalColumns, testedColumns, percent };
}

export function bucketFor(count: number): CoverageBucket {
  if (count === 0) return 'untested';
  if (count === 1) return 'low';
  if (count === 2) return 'med';
  return 'high';
}

export function badgeClassesFor(
  percent: number,
  hasColumns: boolean,
): { bg: string; text: string; label: string } {
  if (!hasColumns) return { bg: 'bg-zinc-700/50', text: 'text-zinc-500', label: 'n/a' };
  if (percent === 0)   return { bg: 'bg-red-900/40',     text: 'text-red-400',     label: '0%' };
  if (percent < 67)    return { bg: 'bg-amber-900/40',   text: 'text-amber-300',   label: `${percent}%` };
  if (percent < 100)   return { bg: 'bg-emerald-900/40', text: 'text-emerald-300', label: `${percent}%` };
  return               { bg: 'bg-emerald-800/50',  text: 'text-emerald-200', label: '100%' };
}
