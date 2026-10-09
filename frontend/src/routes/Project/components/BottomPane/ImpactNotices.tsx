import { AlertTriangle, FileQuestion, GitBranch } from 'lucide-react';
import type { ImpactChangedFileDto, ImpactChangesDto } from '../../../../lib/api';

const MAX_LISTED_FILES = 4;

function fileList(files: readonly ImpactChangedFileDto[]): string {
  const shown = files.slice(0, MAX_LISTED_FILES).map((f) => (f.change === 'modified' ? f.path : `${f.path} (${f.change})`));
  const more = files.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

function isOnBase({ branch, base }: ImpactChangesDto): boolean {
  return !!branch && !!base && (base === branch || base.endsWith(`/${branch}`));
}

function describeComparison(data: ImpactChangesDto): string {
  const files = `${data.changed_files} changed file${data.changed_files === 1 ? '' : 's'} in this project`;
  if (data.scope !== 'branch' || !data.base) return `${files} (uncommitted${data.branch ? ` on ${data.branch}` : ''})`;
  if (isOnBase(data)) return `${files}. You're on ${data.base} itself, so only uncommitted changes are included`;
  const since = data.merge_base ? ` (${data.merge_base})` : '';
  return `${files} on ${data.branch ?? 'HEAD'} since it branched from ${data.base}${since}, plus uncommitted changes`;
}

function Notice({ tone, icon, children }: { tone: 'warn' | 'info'; icon: React.ReactNode; children: React.ReactNode }) {
  const cls = tone === 'warn'
    ? 'bg-amber-950/30 border-amber-900/50 text-amber-200'
    : 'bg-gray-800/40 border-gray-800 text-gray-400';
  return (
    <div className={`flex items-start gap-2 px-3 py-1.5 rounded border text-xs ${cls}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** Context for a change set: what was compared, and changes the node mapping can't account for. */
export function ImpactNotices({ data }: { data: ImpactChangesDto }) {
  const { project_wide: projectWide, unmapped } = data;
  return (
    <div className="flex flex-col gap-1.5 px-4 py-2 border-b border-gray-800 shrink-0">
      <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
        <GitBranch size={12} />
        {describeComparison(data)}
      </span>
      {projectWide.length > 0 && (
        <Notice tone="warn" icon={<AlertTriangle size={12} />}>
          <span className="font-mono">{fileList(projectWide)}</span> changed, which can affect every node.
          Consider a full <code className="font-mono">dbt build</code>.
        </Notice>
      )}
      {!data.manifest_available && (
        <Notice tone="info" icon={<FileQuestion size={12} />}>
          No <code className="font-mono">target/manifest.json</code> yet, so changes can't be mapped to nodes.
          Use Refresh DAG on the DAG page to parse the project.
        </Notice>
      )}
      {data.manifest_available && unmapped.length > 0 && (
        <Notice tone="info" icon={<FileQuestion size={12} />}>
          Not in the manifest: <span className="font-mono">{fileList(unmapped)}</span>. New files show up after
          Refresh DAG; deleted ones no longer have downstream nodes to show.
        </Notice>
      )}
    </div>
  );
}
