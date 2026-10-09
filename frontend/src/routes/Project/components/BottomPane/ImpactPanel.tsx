import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Hammer, Loader2 } from 'lucide-react';
import type { GraphDto } from '../../../../lib/api';
import { buildImpactSelector, computeImpact, formatImpactCounts, IMPACT_FLAGS } from '../../lib/impact';
import { buildCoverageMap } from '../../lib/testCoverage';
import { useOpenInFiles } from '../../lib/openInFiles';
import { FlagBadge, useBuildImpacted } from '../impact/impactUi';
import { ImpactTable } from './ImpactTable';

interface ImpactPanelProps {
  projectId: number;
  graph: GraphDto | null;
  selectedNodeId: string | null;
  /** The DAG multi-selection; when set it takes precedence over selectedNodeId. */
  selectedNodeIds: readonly string[];
}

const COPIED_RESET_MS = 1500;

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false));
  };
  return [copied, copy];
}

function EmptyState({ message }: { message: string }) {
  return <div className="flex-1 flex items-center justify-center text-xs text-gray-600 select-none">{message}</div>;
}

export function ImpactPanel({ projectId, graph, selectedNodeId, selectedNodeIds }: ImpactPanelProps) {
  const { handleClick: openInFilesClick } = useOpenInFiles(projectId);
  const { build, building, error } = useBuildImpacted(projectId);
  const [copied, copy] = useCopied();

  const seedIds = useMemo(
    () => (selectedNodeIds.length > 0 ? selectedNodeIds : selectedNodeId ? [selectedNodeId] : []),
    [selectedNodeIds, selectedNodeId],
  );
  const impact = useMemo(
    () => (graph && seedIds.length > 0 ? computeImpact(graph, seedIds) : null),
    [graph, seedIds],
  );
  const coverage = useMemo(() => (graph ? buildCoverageMap(graph) : new Map()), [graph]);

  if (seedIds.length === 0) {
    return <EmptyState message="Select a node in the DAG or open a model file to see its downstream impact." />;
  }
  if (!graph) return <EmptyState message="Loading graph…" />;
  if (!impact || impact.seeds.length === 0) {
    return <EmptyState message="Impact analysis isn't available for tests." />;
  }

  const seedNodes = impact.seeds.map((n) => n.node);
  const selector = buildImpactSelector(seedNodes);
  const { summary } = impact;
  const flags = IMPACT_FLAGS.filter((f) => summary.flagCounts[f] > 0);
  const groups = [{ depth: 0, nodes: impact.seeds }, ...impact.levels];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-3 h-9 px-4 border-b border-gray-800 shrink-0 select-none">
        <span className="text-[11px] text-gray-500 shrink-0">Impact of</span>
        <code className="px-2 py-0.5 rounded bg-gray-800/80 text-xs text-gray-200 truncate max-w-[24rem]" title={selector}>
          {selector}
        </code>
        <span className="w-px h-4 bg-gray-800 shrink-0" />
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {summary.downstreamCount === 0 ? 'Nothing downstream' : formatImpactCounts(summary)}
        </span>
        {flags.length > 0 && (
          <span className="flex items-center gap-1 shrink-0">
            {flags.map((f) => <FlagBadge key={f} flag={f} count={summary.flagCounts[f]} />)}
          </span>
        )}
        {error && <span className="text-xs text-red-400 truncate">{error}</span>}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <button
            onClick={() => copy(selector)}
            title="Copy the --select value"
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy selector'}
          </button>
          <button
            onClick={() => build(seedNodes)}
            disabled={building}
            title={`dbt build --select ${selector}`}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-brand-800 bg-brand-900/40 text-brand-300 transition-colors hover:bg-brand-800/60 disabled:opacity-50"
          >
            {building ? <Loader2 size={12} className="animate-spin" /> : <Hammer size={12} />}
            Build impacted
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <ImpactTable groups={groups} coverage={coverage} onNodeClick={openInFilesClick} />
        {impact.levels.length === 0 && (
          <div className="px-4 py-3 text-xs text-gray-600">Nothing downstream: a change here only affects the selection and its tests.</div>
        )}
      </div>
    </div>
  );
}
