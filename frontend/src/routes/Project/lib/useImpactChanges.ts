import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ImpactChangeScope } from '../../../lib/api';
import { useProjectEvents } from '../../../lib/sse';

/** Events after which the change set (or its mapping to nodes) may differ. */
const STALE_EVENTS = new Set(['git_status_changed', 'files_changed', 'graph_changed']);

/**
 * Changed files → nodes for a project, refetched when git state, watched files
 * or the manifest change. Pass `enabled: false` while the data isn't shown.
 */
export function useImpactChanges(projectId: number, scope: ImpactChangeScope, base: string | null, enabled = true) {
  const qc = useQueryClient();
  useProjectEvents(projectId, useCallback((event) => {
    if (STALE_EVENTS.has(event.type)) qc.invalidateQueries({ queryKey: ['impact-changes', projectId] });
  }, [projectId, qc]));

  return useQuery({
    queryKey: ['impact-changes', projectId, scope, base],
    queryFn: () => api.impact.changes(projectId, scope, base ?? undefined),
    enabled: enabled && !!projectId,
    retry: false,
  });
}
