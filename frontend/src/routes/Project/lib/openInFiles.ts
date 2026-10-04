import { useCallback, useMemo } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';

export const OPEN_IN_FILES_TITLE = 'Cmd+click to open in Files';

/** Hover styling for a node name that can be Cmd+clicked into the Files page. */
export const OPEN_IN_FILES_HOVER_CLS = 'hover:text-brand-300 hover:underline underline-offset-2';

/**
 * Cursor for a Cmd+clickable element whose plain click does nothing: arrow
 * normally, pointer only while Cmd/Ctrl is held. Omit it when the element sits
 * inside a row/button that has its own click behavior, so it keeps the pointer.
 */
export const OPEN_IN_FILES_CURSOR_CLS = 'cursor-default mod:cursor-pointer';

export function isOpenInFilesClick(e: MouseEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

/**
 * Cmd+click navigation from any node reference (model/test/unit test/seed/source/snapshot)
 * to its file on the Files page — the same `?model=<unique_id>` deep link the
 * DAG SidePane uses. Nodes no longer in the manifest (e.g. from an old run)
 * report `canOpen === false` so callers can skip the affordance.
 */
export function useOpenInFiles(projectId: number) {
  const navigate = useNavigate();
  const { data: graph } = useQuery({
    queryKey: ['graph', projectId],
    queryFn: () => api.models.graph(projectId),
    enabled: !!projectId,
  });

  const openable = useMemo(
    () => new Set(
      [...(graph?.nodes ?? []), ...(graph?.unit_tests ?? [])]
        .filter((n) => n.original_file_path)
        .map((n) => n.unique_id),
    ),
    [graph],
  );

  const canOpen = useCallback((uniqueId: string) => openable.has(uniqueId), [openable]);

  const open = useCallback((uniqueId: string) => {
    navigate(`/projects/${projectId}/files?model=${encodeURIComponent(uniqueId)}`);
  }, [navigate, projectId]);

  /** Returns true (and navigates) if this click was a Cmd/Ctrl+click on an openable node. */
  const handleClick = useCallback((e: MouseEvent, uniqueId: string): boolean => {
    if (!isOpenInFilesClick(e) || !openable.has(uniqueId)) return false;
    e.preventDefault();
    e.stopPropagation();
    open(uniqueId);
    return true;
  }, [open, openable]);

  return { canOpen, open, handleClick };
}
