import { createContext, useContext, useEffect } from 'react';

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
