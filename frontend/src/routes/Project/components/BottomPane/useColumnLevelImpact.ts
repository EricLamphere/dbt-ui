import { useCallback, useMemo, useState } from 'react';
import type { GraphDto, ModelNode } from '../../../../lib/api';
import { computeColumnImpact, describeAffected, pickableColumns, type AffectedColumnsLabel, type ColumnImpactResult } from '../../lib/columnImpact';
import { useColumnLineageData } from '../../lib/useColumnLineageData';
import type { PickedColumns } from './ImpactColumnBar';

export interface ColumnLevelImpact {
  lineage: ReturnType<typeof useColumnLineageData>;
  picked: PickedColumns;
  pick: (uid: string, next: readonly string[] | 'all') => void;
  columnsFor: (seed: ModelNode) => readonly string[];
  /** Null until lineage is ready and at least one column is picked. */
  result: ColumnImpactResult | null;
  /** Affected-columns labels for seeds and reached nodes. */
  labels: Map<string, AffectedColumnsLabel>;
  /** True when the picks come from the DAG's column selection rather than the picker. */
  fromDag: boolean;
}

/** Column-level impact (Pro) for the Impact tab's Selection mode. */
export function useColumnLevelImpact(
  projectId: number,
  graph: GraphDto | null,
  seeds: readonly ModelNode[],
  enabled: boolean,
  /** The DAG's column selection; when non-empty it replaces the picker. */
  dagPicks: ReadonlyMap<string, readonly string[]>,
): ColumnLevelImpact {
  const lineage = useColumnLineageData(projectId, enabled);
  const [pickerPicks, setPicked] = useState<Map<string, readonly string[] | 'all'>>(new Map());
  const fromDag = dagPicks.size > 0;
  const picked: PickedColumns = fromDag ? dagPicks : pickerPicks;
  const pick = useCallback((uid: string, next: readonly string[] | 'all') => {
    setPicked((prev) => new Map(prev).set(uid, next));
  }, []);

  const data = lineage.ready ? lineage.snapshot : null;
  const columnsFor = useCallback((seed: ModelNode) => (data ? pickableColumns(data, seed) : []), [data]);

  const result = useMemo(() => {
    if (!enabled || !graph || !data) return null;
    const seedPicks = new Map(
      seeds.map((s) => {
        const p = picked.get(s.unique_id) ?? [];
        return [s.unique_id, p === 'all' ? 'all' as const : [...p]];
      }),
    );
    const anyPicked = [...seedPicks.values()].some((p) => p === 'all' || p.length > 0);
    return anyPicked ? computeColumnImpact(graph, data, seedPicks) : null;
  }, [enabled, graph, data, seeds, picked]);

  const labels = useMemo(() => {
    const out = new Map<string, AffectedColumnsLabel>();
    if (!result || !graph) return out;
    const names = new Map(graph.nodes.map((n) => [n.unique_id, n.name]));
    const nameOf = (uid: string) => names.get(uid) ?? uid;
    for (const s of seeds) {
      const p = picked.get(s.unique_id) ?? [];
      out.set(s.unique_id, describeAffected({ columns: p === 'all' ? 'all' : [...p].sort(), via: 'columns' }, nameOf));
    }
    result.nodes.forEach((info, uid) => out.set(uid, describeAffected(info, nameOf)));
    return out;
  }, [result, graph, seeds, picked]);

  return { lineage, picked, pick, columnsFor, result, labels, fromDag };
}
