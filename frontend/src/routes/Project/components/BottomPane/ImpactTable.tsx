import type { MouseEvent } from 'react';
import type { ImpactLevel, ImpactNode } from '../../lib/impact';
import { getModelCoverageStats, type CoverageMap } from '../../lib/testCoverage';
import { typeIconFor } from '../../lib/nodeTypeIcon';
import { OPEN_IN_FILES_HOVER_CLS, OPEN_IN_FILES_TITLE } from '../../lib/openInFiles';
import type { AffectedColumnsLabel } from '../../lib/columnImpact';
import { FlagBadge } from '../impact/impactUi';

interface ImpactTableProps {
  /** Depth 0 (the selected nodes) first, then each downstream depth. */
  groups: ImpactLevel[];
  coverage: CoverageMap;
  onNodeClick: (e: MouseEvent, uniqueId: string) => void;
  /** Title of the depth-0 group ("Selected" or "Changed"). */
  seedLabel: string;
  /** Why each depth-0 node counts as changed, shown after its name. */
  reasons?: ReadonlyMap<string, string>;
  /** Column-level mode: affected columns per node, shown in an extra column. */
  affectedColumns?: ReadonlyMap<string, AffectedColumnsLabel>;
}

const GRID_BASE = 'grid items-center gap-4 px-4';
const GRID_COLS = 'grid-cols-[minmax(14rem,2fr)_5.5rem_7.5rem_6rem_6.5rem_8.5rem_minmax(9rem,1.5fr)]';
const GRID_COLS_WITH_AFFECTED = 'grid-cols-[minmax(12rem,1.5fr)_minmax(11rem,1.5fr)_5.5rem_7.5rem_6rem_6.5rem_8.5rem_minmax(8rem,1fr)]';

const COLUMNS = ['Node', 'Type', 'Materialization', 'Status', 'Tests', 'Column coverage', 'Flags'];
const COLUMNS_WITH_AFFECTED = ['Node', 'Affected columns', ...COLUMNS.slice(1)];

const AFFECTED_TONE: Record<AffectedColumnsLabel['tone'], string> = {
  columns: 'font-mono text-brand-300',
  rows: 'text-amber-300',
  muted: 'text-gray-500',
};

const STATUS_STYLE: Record<string, { dot: string; text: string }> = {
  success: { dot: 'bg-emerald-400', text: 'text-emerald-400' },
  error: { dot: 'bg-red-400', text: 'text-red-400' },
  warn: { dot: 'bg-yellow-400', text: 'text-yellow-400' },
  running: { dot: 'bg-brand-400 animate-pulse', text: 'text-brand-400' },
  stale: { dot: 'bg-amber-400', text: 'text-amber-400' },
};
const IDLE_STATUS = { dot: 'bg-gray-600', text: 'text-gray-500' };

const COVERAGE_TYPES = new Set(['model', 'snapshot']);
/** Exposures aren't run, so their status is meaningless; their type already says "exposure". */
const isExposure = (item: ImpactNode) => item.node.resource_type === 'exposure';

function groupTitle(depth: number, seedLabel: string): { label: string; hint: string } {
  if (depth === 0) return { label: seedLabel, hint: '' };
  if (depth === 1) return { label: 'Depth 1', hint: 'direct children' };
  return { label: `Depth ${depth}`, hint: `${depth} hops downstream` };
}

function coverageColor(percent: number): { bar: string; text: string } {
  if (percent === 0) return { bar: 'bg-red-500', text: 'text-red-400' };
  if (percent < 67) return { bar: 'bg-amber-400', text: 'text-amber-300' };
  return { bar: 'bg-emerald-400', text: 'text-emerald-300' };
}

const Muted = ({ children = '—' }: { children?: string }) => <span className="text-gray-700">{children}</span>;

function StatusCell({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? IDLE_STATUS;
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
      <span className={style.text}>{status}</span>
    </span>
  );
}

function TestsCell({ item }: { item: ImpactNode }) {
  if (!COVERAGE_TYPES.has(item.node.resource_type) && item.dataTests === 0) return <Muted />;
  if (item.dataTests === 0 && item.unitTests === 0) return <span className="text-red-400/80">none</span>;
  return (
    <span className="tabular-nums text-gray-300" title={item.affectedTests !== undefined ? `${item.affectedTests} of ${item.dataTests} data tests check an affected column` : undefined}>
      {item.affectedTests !== undefined && <span className={item.affectedTests > 0 ? 'text-brand-300' : 'text-gray-500'}>{item.affectedTests} of </span>}
      {item.dataTests}
      {item.unitTests > 0 && <span className="text-gray-500"> + {item.unitTests} unit</span>}
    </span>
  );
}

function CoverageCell({ item, coverage }: { item: ImpactNode; coverage: CoverageMap }) {
  if (!COVERAGE_TYPES.has(item.node.resource_type)) return <Muted />;
  const stats = getModelCoverageStats(coverage, item.node);
  if (stats.totalColumns === 0) return <Muted>no columns</Muted>;
  const color = coverageColor(stats.percent);
  return (
    <span className="flex items-center gap-2" title={`${stats.testedColumns} of ${stats.totalColumns} documented columns have a test`}>
      <span className="w-12 h-1 rounded-full bg-gray-800 overflow-hidden">
        <span className={`block h-full ${color.bar}`} style={{ width: `${stats.percent}%` }} />
      </span>
      <span className={`tabular-nums ${color.text}`}>{stats.percent}%</span>
    </span>
  );
}

function ImpactRow({ item, coverage, onNodeClick, reason, grid, affected }: {
  item: ImpactNode;
  coverage: CoverageMap;
  onNodeClick: ImpactTableProps['onNodeClick'];
  reason?: string;
  grid: string;
  /** Present in column-level mode (undefined label = not computed for this row). */
  affected?: AffectedColumnsLabel | null;
}) {
  const { node } = item;
  const rowFlags = item.flags.filter((f) => f !== 'exposure');
  return (
    <div className={`${grid} h-8 text-xs border-b border-gray-800/40 transition-colors hover:bg-gray-800/40`}>
      <span className="flex items-center gap-2 min-w-0">
        <span className="w-3 text-center text-gray-600 shrink-0">{typeIconFor(node.resource_type)}</span>
        <button
          onClick={(e) => onNodeClick(e, node.unique_id)}
          title={OPEN_IN_FILES_TITLE}
          className={`font-mono text-gray-200 truncate text-left cursor-default mod:cursor-pointer ${OPEN_IN_FILES_HOVER_CLS}`}
        >
          {node.source_name ? `${node.source_name}.${node.name}` : node.name}
        </button>
        {reason && <span className="text-[11px] text-amber-300/70 truncate shrink-[2]" title={reason}>{reason}</span>}
      </span>
      {affected !== undefined && (
        affected
          ? <span className={`truncate ${AFFECTED_TONE[affected.tone]}`} title={affected.title}>{affected.text}</span>
          : <Muted />
      )}
      <span className={`truncate ${isExposure(item) ? 'text-purple-300' : 'text-gray-400'}`}>{node.resource_type}</span>
      <span className="text-gray-400 truncate">{node.materialized ?? <Muted />}</span>
      {isExposure(item) ? <Muted /> : <StatusCell status={node.status} />}
      <TestsCell item={item} />
      <CoverageCell item={item} coverage={coverage} />
      <span className="flex items-center gap-1 overflow-hidden">
        {rowFlags.length > 0 ? rowFlags.map((f) => <FlagBadge key={f} flag={f} />) : <Muted />}
      </span>
    </div>
  );
}

function GroupHeader({ depth, count, seedLabel }: { depth: number; count: number; seedLabel: string }) {
  const { label, hint } = groupTitle(depth, seedLabel);
  return (
    <div className="sticky top-7 z-[5] flex items-center gap-2 h-7 px-4 bg-surface-panel border-b border-gray-800 select-none">
      <span className={`w-0.5 h-3 rounded-full ${depth === 0 ? 'bg-brand-400' : 'bg-gray-600'}`} />
      <span className="text-[11px] font-medium text-gray-300">{label}</span>
      {hint && <span className="text-[11px] text-gray-600">{hint}</span>}
      <span className="px-1.5 rounded-full bg-gray-800 text-[10px] tabular-nums text-gray-400">{count}</span>
    </div>
  );
}

export function ImpactTable({ groups, coverage, onNodeClick, seedLabel, reasons, affectedColumns }: ImpactTableProps) {
  const grid = `${GRID_BASE} ${affectedColumns ? GRID_COLS_WITH_AFFECTED : GRID_COLS}`;
  const columns = affectedColumns ? COLUMNS_WITH_AFFECTED : COLUMNS;
  return (
    <div className={affectedColumns ? 'min-w-[72rem]' : 'min-w-[60rem]'}>
      <div className={`${grid} sticky top-0 z-10 h-7 bg-surface-panel border-b border-gray-800 text-[10px] uppercase tracking-wider font-medium text-gray-500 select-none`}>
        {columns.map((c) => <span key={c} className="truncate">{c}</span>)}
      </div>
      {groups.map(({ depth, nodes }) => (
        <div key={depth}>
          <GroupHeader depth={depth} count={nodes.length} seedLabel={seedLabel} />
          {nodes.map((item) => (
            <ImpactRow
              key={item.node.unique_id}
              item={item}
              coverage={coverage}
              onNodeClick={onNodeClick}
              reason={depth === 0 ? reasons?.get(item.node.unique_id) : undefined}
              grid={grid}
              affected={affectedColumns ? affectedColumns.get(item.node.unique_id) ?? null : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
