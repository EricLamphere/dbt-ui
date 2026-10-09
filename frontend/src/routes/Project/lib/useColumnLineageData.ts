import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, isProFeatureRequiredError } from '../../../lib/api';
import { useProjectEvents } from '../../../lib/sse';

/** Snapshots older than this lack row dependencies, which column-level impact needs. */
export const IMPACT_LINEAGE_VERSION = 2;

function startErrorMessage(err: unknown): string | null {
  if (err instanceof ApiError && err.status === 409) return null; // already running; its events update the query
  if (err instanceof ApiError && err.status === 503) return 'Column lineage is unavailable in this build (the dbt-ui Pro package is not installed).';
  if (err instanceof ApiError && err.status === 422) return 'Column lineage needs a compiled project. Use Refresh DAG first.';
  if (err instanceof ApiError && typeof err.body === 'string') return err.body;
  return err instanceof Error ? err.message : 'Failed to start column lineage';
}

/**
 * The project's latest column lineage snapshot (Pro) for impact analysis,
 * plus a `start()` to compute it. Shares the ['column-lineage', id] query
 * with the DAG page; progress arrives over SSE.
 */
export function useColumnLineageData(projectId: number, enabled: boolean) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<{ checked: number; total: number } | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useProjectEvents(projectId, useCallback((event) => {
    if (event.type === 'column_lineage_compiling') setCompiling(true);
    if (event.type === 'column_lineage_progress') {
      const d = event.data as { checked: number; total: number };
      setCompiling(false);
      setProgress({ checked: d.checked, total: d.total });
    }
    if (event.type === 'column_lineage_finished') {
      setCompiling(false);
      setProgress(null);
      qc.invalidateQueries({ queryKey: ['column-lineage', projectId] });
    }
  }, [projectId, qc]));

  const query = useQuery({
    queryKey: ['column-lineage', projectId],
    queryFn: () => api.models.columnLineage(projectId),
    enabled: enabled && !!projectId,
    staleTime: Infinity,
    retry: (failureCount, err) => !isProFeatureRequiredError(err) && failureCount < 3,
  });

  const start = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      await api.models.startColumnLineage(projectId);
      qc.invalidateQueries({ queryKey: ['column-lineage', projectId] });
    } catch (err) {
      if (isProFeatureRequiredError(err)) setLocked(true);
      else setStartError(startErrorMessage(err));
    } finally {
      setStarting(false);
    }
  }, [projectId, qc]);

  const snapshot = query.data ?? null;
  return {
    snapshot,
    /** Finished and new enough to include row dependencies. */
    ready: snapshot?.status === 'done' && snapshot.lineage_version >= IMPACT_LINEAGE_VERSION,
    running: compiling || starting || snapshot?.status === 'running',
    compiling,
    progress,
    locked: locked || isProFeatureRequiredError(query.error),
    error: startError ?? (snapshot?.status === 'error' ? snapshot.error_message : null),
    start,
  };
}
