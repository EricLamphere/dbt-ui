import { useCallback, useState } from 'react';
import { api, type ModelNode } from '../../../../lib/api';
import { buildImpactSelector, type ImpactFlag } from '../../lib/impact';

export const FLAG_META: Record<ImpactFlag, { label: string; title: string; cls: string }> = {
  untested: {
    label: 'untested',
    title: 'No data or unit tests — breakage here would go unnoticed',
    cls: 'bg-red-950/40 text-red-300 border-red-900/60',
  },
  exposure: {
    label: 'exposure',
    title: 'A dashboard, app or other consumer outside dbt',
    cls: 'bg-purple-950/40 text-purple-300 border-purple-900/60',
  },
  incremental: {
    label: 'incremental',
    title: 'Schema changes may need --full-refresh',
    cls: 'bg-amber-950/40 text-amber-300 border-amber-900/60',
  },
  failing: {
    label: 'failing',
    title: 'Last run errored or warned',
    cls: 'bg-red-950/40 text-red-400 border-red-900/60',
  },
  stale: {
    label: 'stale',
    title: 'Out of date since its last run',
    cls: 'bg-amber-950/30 text-amber-400 border-amber-900/50',
  },
};

export function FlagBadge({ flag, count }: { flag: ImpactFlag; count?: number }) {
  const meta = FLAG_META[flag];
  return (
    <span title={meta.title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono ${meta.cls}`}>
      {count !== undefined && <span className="font-semibold">{count}</span>}
      {meta.label}
    </span>
  );
}

/** `dbt build --select <seed>+ …` for the given seeds, with loading/error state. */
export function useBuildImpacted(projectId: number) {
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const build = useCallback(async (seeds: readonly ModelNode[]) => {
    const selector = buildImpactSelector(seeds);
    if (!selector) return;
    setBuilding(true);
    setError(null);
    try {
      await api.runs.build(projectId, '', 'only', {}, selector);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start build');
    } finally {
      setBuilding(false);
    }
  }, [projectId]);

  return { build, building, error };
}
