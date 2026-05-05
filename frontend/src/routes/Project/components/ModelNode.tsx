import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ModelNode } from '../../../lib/api';
import { useColumnLineage } from '../lib/columnLineageContext';
import { bucketFor, badgeClassesFor, COVERAGE_CLASS, type NodeCoverageData } from '../lib/testCoverage';

const STATUS_RING: Record<string, string> = {
  idle: 'ring-gray-700',
  pending: 'ring-blue-600',
  running: 'ring-blue-500 shadow-blue-500/30 shadow-lg',
  success: 'ring-emerald-600',
  error: 'ring-red-600',
  stale: 'ring-amber-500',
  warn: 'ring-yellow-500',
};

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-gray-600',
  pending: 'bg-blue-400 animate-pulse',
  running: 'bg-blue-400 animate-pulse',
  success: 'bg-emerald-400',
  error: 'bg-red-500',
  stale: 'bg-amber-400',
  warn: 'bg-yellow-400',
};

const TYPE_ICON: Record<string, string> = {
  model: '▣',
  source: '⬡',
  seed: '⊡',
  snapshot: '◈',
  test: '⬤',
};

interface Props extends NodeProps {
  data: {
    model: ModelNode;
    dimmed?: boolean;
    expanded?: boolean;
    coverage?: NodeCoverageData;
  };
}

function ModelNodeComponent({ data, selected }: Props) {
  const { model, dimmed, expanded, coverage } = data;
  const { activeColumnSels, relatedColumnsMap, onColumnClick, onToggleExpand } = useColumnLineage();

  const ring = STATUS_RING[model.status] ?? STATUS_RING.idle;
  const dot = STATUS_DOT[model.status] ?? STATUS_DOT.idle;
  const icon = TYPE_ICON[model.resource_type] ?? '▣';
  const hasColumns = model.columns.length > 0;

  const uid = model.unique_id;
  const relatedColumns = relatedColumnsMap.get(uid);

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ background: 'rgb(var(--brand-500))', border: 'none' }} />
      <div
        style={{ opacity: dimmed ? 0.2 : 1 }}
        className={`
          w-[200px] rounded-lg ring-2 px-3 py-2 flex flex-col
          cursor-pointer select-none transition-all duration-150
          ${selected
            ? 'node-selected ring-2 shadow-lg'
            : `bg-surface-panel ${ring} ring-1 hover:brightness-105`}
        `}
      >
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-400 text-xs">{icon}</span>
          <span className="text-[10px] text-gray-500 font-mono truncate flex-1">{model.resource_type}</span>
          {coverage && model.resource_type === 'model' && hasColumns && (() => {
            const badge = badgeClassesFor(coverage.stats.percent, hasColumns);
            return (
              <span
                className={`text-[9px] px-1 rounded font-mono shrink-0 ${badge.bg} ${badge.text}`}
                title={`${coverage.stats.testedColumns}/${coverage.stats.totalColumns} columns tested`}
              >
                {badge.label}
              </span>
            );
          })()}
          <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        </div>

        {/* Model name */}
        <div
          className={`node-name font-medium text-xs truncate mt-1 ${selected ? 'text-white' : 'text-gray-100'}`}
          title={model.name}
        >
          {model.name}
        </div>

        {/* Materialization */}
        {model.materialized && (
          <div className="text-[9px] text-gray-600 font-mono truncate mt-0.5">{model.materialized}</div>
        )}

        {/* Expand/collapse toggle */}
        {hasColumns && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(uid);
            }}
            className="w-full text-center text-[9px] text-gray-600 hover:text-gray-400 py-0.5 border-t border-zinc-700 mt-1.5 leading-none"
          >
            {expanded ? `▲ hide` : `▼ ${model.columns.length} columns`}
          </button>
        )}

        {/* Column list */}
        {expanded && hasColumns && (
          <div
            className="border-t border-zinc-700 mt-1 pt-1 max-h-[150px] overflow-y-auto"
            onWheelCapture={(e) => e.stopPropagation()}
          >
            {model.columns.map((col) => {
              const isActive = activeColumnSels.has(`${uid}::${col.name}`);
              const isRelated = !isActive && (relatedColumns?.has(col.name) ?? false);
              const cvg = coverage?.columnsMap.get(col.name);
              const bucket = coverage && !isActive && !isRelated ? bucketFor(cvg?.count ?? 0) : null;
              const cc = bucket ? COVERAGE_CLASS[bucket] : null;
              const rowTitle = coverage
                ? cvg
                  ? `${cvg.count} test${cvg.count !== 1 ? 's' : ''}${cvg.testTypes.length ? ': ' + cvg.testTypes.join(', ') : ''}`
                  : 'untested'
                : undefined;
              return (
                <div
                  key={col.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    onColumnClick(uid, col.name, e.metaKey || e.ctrlKey);
                  }}
                  title={rowTitle}
                  className={`
                    px-1 py-0.5 cursor-pointer rounded text-[10px] font-mono
                    flex justify-between items-center gap-1
                    ${isActive
                      ? 'bg-brand-500/20 text-white ring-1 ring-brand-500/40'
                      : isRelated
                        ? 'text-gray-100 font-semibold bg-zinc-700/50 hover:bg-zinc-700'
                        : cc
                          ? `${cc.bg} ${cc.text} hover:brightness-110`
                          : 'text-gray-400 hover:bg-zinc-700 hover:text-gray-300'}
                  `}
                >
                  <span className="truncate flex items-center gap-1">
                    {isRelated && (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-400/70 shrink-0" />
                    )}
                    {!isRelated && cc && (
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${cc.dot} shrink-0`} />
                    )}
                    {col.name}
                  </span>
                  {col.data_type && (
                    <span className="text-[8px] text-gray-600 shrink-0 font-sans">{col.data_type}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: 'rgb(var(--brand-500))', border: 'none' }} />
    </>
  );
}

export default memo(ModelNodeComponent, (prev, next) => {
  return (
    prev.selected === next.selected &&
    prev.data.dimmed === next.data.dimmed &&
    prev.data.expanded === next.data.expanded &&
    prev.data.model === next.data.model &&
    prev.data.coverage === next.data.coverage
  );
});
