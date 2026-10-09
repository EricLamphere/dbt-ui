import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Hammer, ListTree, Loader2 } from 'lucide-react';
import { api } from '../../../../lib/api';
import { buildImpactSelector, computeImpact, formatImpactCounts, IMPACT_FLAGS } from '../../lib/impact';
import { changeErrorMessage, seedIdsFrom } from '../../lib/impactChanges';
import { useImpactChanges } from '../../lib/useImpactChanges';
import { openBottomTab } from '../../lib/bottomPaneEvents';
import { FlagBadge, useBuildImpacted } from '../../components/impact/impactUi';
import { PaneSectionHeader, usePersistedOpen } from './PaneSection';

const OPEN_KEY = 'dbt-ui:git-impact-open';

/** Collapsible "Impact" section: what the uncommitted changes affect downstream. */
export function ImpactSection({ projectId }: { projectId: number }) {
  const [open, toggle] = usePersistedOpen(OPEN_KEY, true);
  const { data: changes, isLoading, error: changesError } = useImpactChanges(projectId, 'working', null);
  const { data: graph } = useQuery({
    queryKey: ['graph', projectId],
    queryFn: () => api.models.graph(projectId),
  });
  const { build, building, error: buildError } = useBuildImpacted(projectId);

  const impact = useMemo(() => {
    const seeds = seedIdsFrom(changes);
    return graph && seeds.length > 0 ? computeImpact(graph, seeds) : null;
  }, [graph, changes]);

  const seedNodes = impact?.seeds.map((n) => n.node) ?? [];
  const selector = buildImpactSelector(seedNodes);

  return (
    <div className="shrink-0 flex flex-col">
      <PaneSectionHeader title="Impact" open={open} onToggle={toggle} count={seedNodes.length} />
      {open && (
        <div className="flex flex-col gap-2 px-3 pt-1 pb-3 max-h-64 overflow-y-auto">
          {isLoading && <p className="text-xs text-zinc-500">Checking changes…</p>}
          {changesError && <p className="text-xs text-red-400">{changeErrorMessage(changesError)}</p>}
          {changes && <ImpactSummaryText impactCount={seedNodes.length} impact={impact} />}
          {changes && changes.project_wide.length > 0 && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{changes.project_wide.map((f) => f.path).join(', ')} changed: may affect every node</span>
            </p>
          )}
          {impact && <ImpactFlags impact={impact} />}
          {impact && (
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => openBottomTab('impact', { impactMode: 'working' })}
                className="flex items-center justify-center gap-1.5 py-1 text-xs rounded border border-zinc-700 text-zinc-300 transition-colors hover:border-brand-600 hover:text-brand-300"
              >
                <ListTree size={12} />
                Details
              </button>
              <button
                onClick={() => build(seedNodes)}
                disabled={building || !selector}
                title={selector ? `dbt build --select ${selector}` : 'Only exposures changed; nothing to build'}
                className="flex items-center justify-center gap-1.5 py-1 text-xs rounded border border-zinc-700 text-zinc-300 transition-colors hover:border-brand-600 hover:text-brand-300 disabled:opacity-40"
              >
                {building ? <Loader2 size={12} className="animate-spin" /> : <Hammer size={12} />}
                Build impacted
              </button>
            </div>
          )}
          {buildError && <p className="text-[11px] text-red-400">{buildError}</p>}
        </div>
      )}
    </div>
  );
}

function ImpactSummaryText({ impactCount, impact }: { impactCount: number; impact: ReturnType<typeof computeImpact> | null }) {
  if (!impact) return <p className="text-xs text-zinc-500">Your changes don't touch any dbt nodes.</p>;
  return (
    <p className="text-xs text-zinc-300 leading-relaxed">
      {impactCount} changed node{impactCount === 1 ? '' : 's'}
      {impact.summary.downstreamCount > 0
        ? <> affect <span className="text-zinc-100">{formatImpactCounts(impact.summary)}</span></>
        : ', nothing downstream'}
    </p>
  );
}

function ImpactFlags({ impact }: { impact: ReturnType<typeof computeImpact> }) {
  const flags = IMPACT_FLAGS.filter((f) => impact.summary.flagCounts[f] > 0);
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => <FlagBadge key={f} flag={f} count={impact.summary.flagCounts[f]} />)}
    </div>
  );
}
