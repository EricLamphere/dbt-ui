import { useMemo } from 'react';
import type { GraphDto } from '../../../../lib/api';
import { buildImpactSelector, computeImpact } from '../../lib/impact';
import { changeErrorMessage, reasonsByNode, seedIdsFrom, type ImpactMode } from '../../lib/impactChanges';
import { useImpactChanges } from '../../lib/useImpactChanges';
import { buildCoverageMap } from '../../lib/testCoverage';
import { useOpenInFiles } from '../../lib/openInFiles';
import { useBuildImpacted } from '../impact/impactUi';
import { ImpactNotices } from './ImpactNotices';
import { ImpactTable } from './ImpactTable';
import { ImpactToolbar } from './ImpactToolbar';

interface ImpactPanelProps {
  projectId: number;
  graph: GraphDto | null;
  selectedNodeId: string | null;
  /** The DAG multi-selection; when set it takes precedence over selectedNodeId. */
  selectedNodeIds: readonly string[];
  mode: ImpactMode;
  onModeChange: (mode: ImpactMode) => void;
  /** Branch mode base ref; null = server default (origin/HEAD, main, master). */
  base: string | null;
  onBaseChange: (base: string | null) => void;
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
  const { projectId, graph, selectedNodeId, selectedNodeIds, mode, base } = props;
  const { handleClick: openInFilesClick } = useOpenInFiles(projectId);
  const { build, building, error: buildError } = useBuildImpacted(projectId);

  const isChangeMode = mode !== 'selection';
  const changes = useImpactChanges(projectId, mode === 'branch' ? 'branch' : 'working', mode === 'branch' ? base : null, isChangeMode);

  const seedIds = useMemo(
    () => (isChangeMode ? seedIdsFrom(changes.data) : selectionSeedIds(selectedNodeIds, selectedNodeId)),
    [isChangeMode, changes.data, selectedNodeIds, selectedNodeId],
  );
  const impact = useMemo(
    () => (graph && seedIds.length > 0 ? computeImpact(graph, seedIds) : null),
    [graph, seedIds],
  );
  const coverage = useMemo(() => (graph ? buildCoverageMap(graph) : new Map()), [graph]);
  const reasons = useMemo(() => (isChangeMode ? reasonsByNode(changes.data) : undefined), [isChangeMode, changes.data]);

  const seedNodes = impact?.seeds.map((n) => n.node) ?? [];
  const selector = buildImpactSelector(seedNodes);

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
        impact={impact}
        selector={selector}
        building={building}
        buildError={buildError}
        onBuild={() => build(seedNodes)}
      />
      {isChangeMode && changes.data && changes.data.changed_files > 0 && <ImpactNotices data={changes.data} />}
      {body}
    </div>
  );
}
