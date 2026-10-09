import { createContext, useContext, useEffect } from 'react';

const NO_IDS: readonly string[] = [];

/**
 * The node (model/test/seed/…) currently selected on whichever project page is
 * open, lifted into ProjectLayout so the bottom pane's Node DAG tab can follow
 * it. The value and the setter are separate contexts so pages that only
 * report their selection don't re-render when it changes.
 */
export const SelectedNodeContext = createContext<string | null>(null);
export const SetSelectedNodeContext = createContext<(uid: string | null) => void>(() => {});

export function useSelectedNodeId(): string | null {
  return useContext(SelectedNodeContext);
}

/** Publish this page's selected node; clears it again when the page unmounts. */
export function useReportSelectedNode(uid: string | null): void {
  const setSelected = useContext(SetSelectedNodeContext);
  useEffect(() => {
    setSelected(uid);
  }, [uid, setSelected]);
  useEffect(() => () => setSelected(null), [setSelected]);
}

/**
 * The full multi-selection (Cmd+click on the DAG), when more than one node is
 * selected — empty otherwise. Kept apart from the single selection above
 * because Node DAG follows one node while Impact can cover several.
 */
export const SelectedNodeIdsContext = createContext<readonly string[]>(NO_IDS);
export const SetSelectedNodeIdsContext = createContext<(uids: readonly string[]) => void>(() => {});

/** Publish this page's multi-selection; clears it again when the page unmounts. */
export function useReportSelectedNodes(uids: readonly string[]): void {
  const setSelected = useContext(SetSelectedNodeIdsContext);
  const key = uids.join('|');
  useEffect(() => {
    setSelected(key ? key.split('|') : NO_IDS);
  }, [key, setSelected]);
  useEffect(() => () => setSelected(NO_IDS), [setSelected]);
}
