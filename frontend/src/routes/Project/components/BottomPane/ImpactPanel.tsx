import { useMemo } from 'react';
import type { GraphDto } from '../../../../lib/api';
import { buildExactSelector, buildImpactSelector, computeImpact } from '../../lib/impact';
import { changeErrorMessage, reasonsByNode, seedIdsFrom, type ImpactMode } from '../../lib/impactChanges';
import { picksFromColumnKeys } from '../../lib/columnImpact';
import { useImpactChanges } from '../../lib/useImpactChanges';
import { buildCoverageMap } from '../../lib/testCoverage';
import { useOpenInFiles } from '../../lib/openInFiles';
import { useBuildImpacted } from '../impact/impactUi';
import { ImpactColumnBar } from './ImpactColumnBar';
import { ImpactNotices } from './ImpactNotices';
import { ImpactTable } from './ImpactTable';
import { ImpactToolbar } from './ImpactToolbar';
import { useColumnLevelImpact } from './useColumnLevelImpact';

interface ImpactPanelProps {
  projectId: number;
  graph: GraphDto | null;
  selectedNodeId: string | null;
  /** The DAG multi-selection; when set it takes precedence over selectedNodeId. */
  selectedNodeIds: readonly string[];
  /** DAG column selection (`<uid>::<column>`); in Selection mode it starts column-level impact. */
  selectedColumns: readonly string[];
  mode: ImpactMode;
  onModeChange: (mode: ImpactMode) => void;
  /** Branch mode base ref; null = server default (origin/HEAD, main, master). */
  base: string | null;
  onBaseChange: (base: string | null) => void;
  /** Column-level impact (Pro) in Selection mode. */
  columnLevel: boolean;
  onColumnLevelChange: (on: boolean) => void;
}

function EmptyState({ message, tone = 'muted' }: { message: string; tone?: 'muted' | 'error' }) {
  return (
    <div className={`flex-1 flex items-center justify-center px-4 text-xs text-center select-none ${tone === 'error' ? 'text-red-400' : 'text-gray-600'}`}>
      {message}
    </div>
  );
}

function selectionSeedIds(selectedNodeIds: readonly string[], selectedNodeId: string | null): readonly string[] {
  if (selectedNodeIds.length > 0) return selectedNodeIds;
  return selectedNodeId ? [selectedNodeId] : [];
}

export function ImpactPanel(props: ImpactPanelProps) {
  const { projectId, graph, selectedNodeId, selectedNodeIds, selectedColumns, mode, base } = props;
  const dagPicks = useMemo(
    () => (mode === 'selection' ? picksFromColumnKeys(selectedColumns) : new Map<string, string[]>()),
    [mode, selectedColumns],
  );
  const { handleClick: openInFilesClick } = useOpenInFiles(projectId);
  const { buildSelector, building, error: buildError } = useBuildImpacted(projectId);

  const isChangeMode = mode !== 'selection';
  const changes = useImpactChanges(projectId, mode === 'branch' ? 'branch' : 'working', mode === 'branch' ? base : null, isChangeMode);

  const seedIds = useMemo(
    () => {
      if (isChangeMode) return seedIdsFrom(changes.data);
      // Columns selected on the DAG take precedence: their nodes are the starting points.
      if (dagPicks.size > 0) return [...dagPicks.keys()];
      return selectionSeedIds(selectedNodeIds, selectedNodeId);
    },
    [isChangeMode, changes.data, dagPicks, selectedNodeIds, selectedNodeId],
  );
  const nodeImpact = useMemo(
    () => (graph && seedIds.length > 0 ? computeImpact(graph, seedIds) : null),
    [graph, seedIds],
  );
  const seedNodes = useMemo(() => nodeImpact?.seeds.map((n) => n.node) ?? [], [nodeImpact]);

  const columnLevelForced = dagPicks.size > 0;
  const columnLevel = mode === 'selection' && (props.columnLevel || columnLevelForced);
  const columns = useColumnLevelImpact(projectId, graph, seedNodes, columnLevel, dagPicks);
  const columnResult = columnLevel ? columns.result : null;

  const impact = useMemo(() => {
    if (!graph || !columnResult) return nodeImpact;
    const reach = new Map([...columnResult.nodes].map(([uid, info]) => [uid, info.depth]));
    return computeImpact(graph, seedIds, { reach, affectedTests: columnResult.tests });
  }, [graph, seedIds, nodeImpact, columnResult]);
  const prunedCount = columnResult && nodeImpact && impact
    ? nodeImpact.summary.downstreamCount - impact.summary.downstreamCount
    : null;
  const coverage = useMemo(() => (graph ? buildCoverageMap(graph) : new Map()), [graph]);
  const reasons = useMemo(() => (isChangeMode ? reasonsByNode(changes.data) : undefined), [isChangeMode, changes.data]);

  // Column-level builds exactly the affected nodes; node-level builds everything downstream.
  const selector = columnResult && impact
    ? buildExactSelector([...impact.seeds, ...impact.levels.flatMap((l) => l.nodes)].map((n) => n.node))
    : buildImpactSelector(seedNodes);

  const body = (() => {
    if (!graph) return <EmptyState message="Loading graph…" />;
    if (isChangeMode && changes.isLoading) return <EmptyState message="Checking for changes…" />;
    if (isChangeMode && changes.error) return <EmptyState message={changeErrorMessage(changes.error)} tone="error" />;
    if (!isChangeMode && seedIds.length === 0) {
      return <EmptyState message="Select a node in the DAG or open a model file to see its downstream impact." />;
    }
    if (isChangeMode && changes.data?.changed_files === 0) {
      return <EmptyState message={mode === 'branch' ? 'No changes to dbt files on this branch compared to the base.' : 'No uncommitted changes to dbt files in this project.'} />;
    }
    if (columnLevel && seedNodes.length > 0 && !columnResult) {
      const message = columns.lineage.locked
        ? 'Column-level impact is a dbt-ui Pro feature. Turn off Columns for node-level impact.'
        : columns.lineage.ready
          ? 'Pick one or more columns above to see which downstream columns they reach.'
          : 'Column-level impact needs column lineage. Load it above.';
      return <EmptyState message={message} />;
    }
    if (!impact || impact.seeds.length === 0) {
      return (
        <EmptyState message={isChangeMode ? 'None of the changed files map to models, seeds, snapshots, sources or exposures.' : "Impact analysis isn't available for tests."} />
      );
    }
    return (
      <div className="flex-1 overflow-auto">
        <ImpactTable
          groups={[{ depth: 0, nodes: impact.seeds }, ...impact.levels]}
          coverage={coverage}
          onNodeClick={openInFilesClick}
          seedLabel={isChangeMode ? 'Changed' : 'Selected'}
          reasons={reasons}
          affectedColumns={columnResult ? columns.labels : undefined}
        />
        {impact.levels.length === 0 && (
          <div className="px-4 py-3 text-xs text-gray-600">Nothing downstream: only these nodes and their tests are affected.</div>
        )}
      </div>
    );
  })();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <ImpactToolbar
        projectId={projectId}
        mode={mode}
        onModeChange={props.onModeChange}
        base={base}
        resolvedBase={changes.data?.base ?? null}
        onBaseChange={props.onBaseChange}
        impact={columnLevel && !columnResult ? null : impact}
        prunedCount={prunedCount}
        columnLevel={columnLevel}
        onColumnLevelChange={props.onColumnLevelChange}
        columnLevelForced={columnLevelForced}
        selector={selector}
        building={building}
        buildError={buildError}
        onBuild={() => buildSelector(selector)}
      />
      {columnLevel && seedNodes.length > 0 && (
        <ImpactColumnBar
          lineage={columns.lineage}
          seeds={seedNodes}
          columnsFor={columns.columnsFor}
          picked={columns.picked}
          onPick={columns.pick}
          fromDag={columns.fromDag}
        />
      )}
      {isChangeMode && changes.data && changes.data.changed_files > 0 && <ImpactNotices data={changes.data} />}
      {body}
    </div>
  );
}
