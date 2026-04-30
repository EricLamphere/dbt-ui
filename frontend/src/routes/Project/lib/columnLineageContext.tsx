import { createContext, useContext } from 'react';

export interface ColumnLineageContextValue {
  // "uid::colname" keys for actively selected columns
  activeColumnSels: ReadonlySet<string>;
  // uid → set of related (lineage-connected but not selected) column names
  relatedColumnsMap: ReadonlyMap<string, ReadonlySet<string>>;
  onColumnClick: (nodeId: string, column: string, multi: boolean) => void;
  onToggleExpand: (nodeId: string) => void;
}

export const ColumnLineageContext = createContext<ColumnLineageContextValue>({
  activeColumnSels: new Set(),
  relatedColumnsMap: new Map(),
  onColumnClick: () => {},
  onToggleExpand: () => {},
});

export function useColumnLineage() {
  return useContext(ColumnLineageContext);
}
