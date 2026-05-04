import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api, type DriftSnapshot, type ModelDriftResult, type ColumnDrift } from '../../../lib/api';
import { useProjectEvents } from '../../../lib/sse';

interface DriftPanelProps {
  projectId: number;
}

type FilterKey = 'all' | 'manifest_only' | 'warehouse_only' | 'type_mismatch' | 'errors';

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
    </svg>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function columnDriftLabel(col: ColumnDrift): string {
  if (col.type_mismatch) return 'type mismatch';
  if (col.in_manifest && !col.in_warehouse) return 'manifest only';
  if (!col.in_manifest && col.in_warehouse) return 'warehouse only';
  return 'in sync';
}

function columnDriftColor(col: ColumnDrift): string {
  if (col.type_mismatch) return 'text-amber-400';
  if (col.in_manifest && !col.in_warehouse) return 'text-red-400';
  if (!col.in_manifest && col.in_warehouse) return 'text-blue-400';
  return 'text-emerald-400';
}

function matchesFilter(result: ModelDriftResult, filter: FilterKey): boolean {
  if (filter === 'errors') return result.error != null;
  if (filter === 'all') return result.has_drift || result.error != null;
  if (filter === 'manifest_only') return result.columns.some((c) => c.in_manifest && !c.in_warehouse);
  if (filter === 'warehouse_only') return result.columns.some((c) => !c.in_manifest && c.in_warehouse);
  if (filter === 'type_mismatch') return result.columns.some((c) => c.type_mismatch);
  return false;
}

function ModelDriftRow({ result }: { result: ModelDriftResult }) {
  const [open, setOpen] = useState(true);

  const driftCols = result.columns.filter(
    (c) => !c.in_manifest || !c.in_warehouse || c.type_mismatch
  );

  const summary = result.error
    ? 'error'
    : `${driftCols.length} column${driftCols.length !== 1 ? 's' : ''} drifted`;

  return (
    <div className="border border-gray-800/60 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-surface-elevated/30 hover:bg-surface-elevated/60 transition-colors text-left"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-gray-600 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
        )}
        <span className="text-xs font-mono text-gray-300 flex-1 truncate">{result.name}</span>
        <span className={`text-[10px] shrink-0 ${result.error ? 'text-red-400' : 'text-amber-400'}`}>
          {summary}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-2 pt-1 flex flex-col gap-0.5">
          {result.error ? (
            <p className="text-[10px] text-red-400 font-mono break-all">{result.error}</p>
          ) : (
            driftCols.map((col) => (
              <div key={col.name} className="flex items-center gap-2 py-0.5">
                <span className="text-[10px] font-mono text-gray-400 flex-1 truncate">{col.name}</span>
                <span className={`text-[10px] shrink-0 ${columnDriftColor(col)}`}>
                  {columnDriftLabel(col)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const FILTER_LABELS: Record<FilterKey, string> = {
  all: 'All drift',
  manifest_only: 'Manifest only',
  warehouse_only: 'Warehouse only',
  type_mismatch: 'Type mismatch',
  errors: 'Errors',
};

export default function DriftPanel({ projectId }: DriftPanelProps) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [optimisticProgress, setOptimisticProgress] = useState<{ checked: number; total: number; current: string } | null>(null);

  const { data: snapshot, isLoading } = useQuery({
    queryKey: ['drift-latest', projectId],
    queryFn: () => api.drift.latest(projectId),
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: () => api.drift.start(projectId),
    onSuccess: () => {
      setOptimisticProgress(null);
      qc.invalidateQueries({ queryKey: ['drift-latest', projectId] });
    },
  });

  const isRunning = mutation.isPending || snapshot?.status === 'running';

  useProjectEvents(projectId, useCallback((event) => {
    if (event.type === 'drift_progress') {
      const d = event.data as { checked: number; total: number; current: string };
      setOptimisticProgress(d);
      qc.setQueryData<DriftSnapshot | null>(['drift-latest', projectId], (old) => {
        if (!old) return old;
        return { ...old, checked_models: d.checked, total_models: d.total };
      });
    }
    if (event.type === 'drift_finished') {
      setOptimisticProgress(null);
      qc.invalidateQueries({ queryKey: ['drift-latest', projectId] });
    }
  }, [projectId, qc]));

  const display = snapshot;
  const progress = optimisticProgress ?? (display ? { checked: display.checked_models, total: display.total_models, current: '' } : null);

  const driftedResults = display?.results.filter((r) => r.has_drift || r.error != null) ?? [];
  const syncedCount = (display?.results.length ?? 0) - driftedResults.length;
  const filteredResults = driftedResults.filter((r) => matchesFilter(r, filter));

  return (
    <div className="p-6 pb-12 max-w-[62rem] mx-auto w-full">
      <div className="bg-surface-panel border border-gray-800 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm font-semibold text-gray-100">Schema Drift</span>
            {!isRunning && display && (
              <span className={`text-xs ${driftedResults.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {driftedResults.length > 0
                  ? `${driftedResults.length} of ${display.total_models} with drift`
                  : `All ${display.total_models} models in sync`}
                {' · '}{relativeTime(display.started_at)}
              </span>
            )}
            {!isRunning && !display && !isLoading && (
              <span className="text-xs text-gray-600">Not run yet</span>
            )}
            {isRunning && (
              <span className="text-xs text-brand-400 flex items-center gap-1.5">
                <Spinner />
                {progress
                  ? `Checking ${progress.checked} / ${progress.total}${progress.current ? ` — ${progress.current}` : ''}…`
                  : 'Starting…'}
              </span>
            )}
          </div>
          <button
            onClick={() => mutation.mutate()}
            disabled={isRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-gray-700 bg-surface-elevated text-gray-300 hover:border-brand-600 hover:text-brand-300 transition-colors disabled:opacity-40"
          >
            {isRunning ? <Spinner /> : null}
            {isRunning ? 'Running…' : 'Run'}
          </button>
        </div>

        {/* Progress bar */}
        {isRunning && progress && progress.total > 0 && (
          <div className="px-5 py-2 border-b border-gray-800">
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-600 transition-all duration-300"
                style={{ width: `${Math.round((progress.checked / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Results */}
        {!isRunning && display && display.status !== 'running' && (
          <div className="px-5 py-4 flex flex-col gap-4">
            {driftedResults.length > 0 && (
              <>
                {/* Filter pills */}
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => {
                    const count = key === 'all'
                      ? driftedResults.length
                      : driftedResults.filter((r) => matchesFilter(r, key)).length;
                    if (key !== 'all' && count === 0) return null;
                    return (
                      <button
                        key={key}
                        onClick={() => setFilter(key)}
                        className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                          filter === key
                            ? 'bg-brand-900/60 border-brand-700 text-brand-300'
                            : 'bg-surface-elevated border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-300'
                        }`}
                      >
                        {FILTER_LABELS[key]} ({count})
                      </button>
                    );
                  })}
                </div>

                {/* Drifted model list */}
                <div className="flex flex-col gap-2">
                  {filteredResults.length === 0 ? (
                    <p className="text-xs text-gray-600">No models match this filter.</p>
                  ) : (
                    filteredResults.map((r) => <ModelDriftRow key={r.unique_id} result={r} />)
                  )}
                </div>
              </>
            )}

            {/* Sync summary */}
            {syncedCount > 0 && (
              <p className="text-xs text-emerald-400/70 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {syncedCount} model{syncedCount !== 1 ? 's' : ''} in sync
              </p>
            )}

            {driftedResults.length === 0 && syncedCount === 0 && (
              <p className="text-xs text-gray-600">No eligible models found (only table/incremental/seed/snapshot models are checked).</p>
            )}
          </div>
        )}

        {/* Error state */}
        {!isRunning && display?.status === 'error' && (
          <div className="px-5 py-4">
            <p className="text-xs text-red-400">Drift check failed: {display.error_message}</p>
          </div>
        )}

        {isLoading && (
          <div className="px-5 py-4">
            <p className="text-xs text-gray-600">Loading…</p>
          </div>
        )}
      </div>
    </div>
  );
}
