import { useMemo } from 'react';
import { Hammer, ListTree, Loader2 } from 'lucide-react';
import type { GraphDto, ModelNode } from '../../../../lib/api';
import { IMPACT_FLAGS, buildImpactSelector, computeImpact, formatImpactCounts } from '../../lib/impact';
import { openBottomTab } from '../../lib/bottomPaneEvents';
import { FlagBadge, useBuildImpacted } from '../impact/impactUi';

interface ImpactSummaryProps {
  projectId: number;
  /** The selected node(s); tests and exposures are ignored. */
  nodes: readonly ModelNode[];
  graph: GraphDto;
}

const NO_IMPACT_TYPES = new Set(['test', 'exposure']);

/** Compact "what does changing this affect" card for the Properties tab. */
export function ImpactSummary({ projectId, nodes, graph }: ImpactSummaryProps) {
  const seedKey = nodes.filter((n) => !NO_IMPACT_TYPES.has(n.resource_type)).map((n) => n.unique_id).join('|');
  const impact = useMemo(() => computeImpact(graph, seedKey ? seedKey.split('|') : []), [graph, seedKey]);
  const { build, building, error } = useBuildImpacted(projectId);
  const { summary } = impact;
  const flags = IMPACT_FLAGS.filter((f) => summary.flagCounts[f] > 0);
  const nothingDownstream = summary.downstreamCount === 0;
  if (impact.seeds.length === 0) return null;
  const seedNodes = impact.seeds.map((n) => n.node);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Downstream impact</span>
      <div className="flex flex-col gap-2 bg-surface-elevated/40 rounded-lg p-3">
        <span className="text-xs text-gray-300">
          {nothingDownstream ? 'Nothing downstream' : formatImpactCounts(summary)}
        </span>
        {flags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {flags.map((f) => <FlagBadge key={f} flag={f} count={summary.flagCounts[f]} />)}
          </div>
        )}
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <button
            onClick={() => openBottomTab('impact', { impactMode: 'selection' })}
            className="flex items-center justify-center gap-1.5 py-1.5 text-xs rounded border bg-surface-elevated border-gray-700 text-gray-200 hover:border-brand-600 hover:text-brand-300 transition-colors"
          >
            <ListTree className="w-3.5 h-3.5" />
            Show impact
          </button>
          <button
            onClick={() => build(seedNodes)}
            disabled={building}
            title={`dbt build --select ${buildImpactSelector(seedNodes)}`}
            className="flex items-center justify-center gap-1.5 py-1.5 text-xs rounded border bg-surface-elevated border-gray-700 text-gray-200 hover:border-brand-600 hover:text-brand-300 transition-colors disabled:opacity-50"
          >
            {building ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Hammer className="w-3.5 h-3.5" />}
            Build impacted
          </button>
        </div>
        {error && <p className="text-[10px] text-red-400">{error}</p>}
      </div>
    </div>
  );
}
