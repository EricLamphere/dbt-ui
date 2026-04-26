import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ModelNode } from '../../../lib/api';

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
  data: { model: ModelNode };
}

export default memo(function ModelNodeComponent({ data, selected }: Props) {
  const { model } = data;
  const ring = STATUS_RING[model.status] ?? STATUS_RING.idle;
  const dot = STATUS_DOT[model.status] ?? STATUS_DOT.idle;
  const icon = TYPE_ICON[model.resource_type] ?? '▣';

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ background: 'rgb(var(--brand-500))', border: 'none' }} />
      <div
        className={`
          w-[200px] h-[72px] bg-surface-panel rounded-lg ring-1 px-3 py-2 flex flex-col justify-between
          cursor-pointer select-none transition-all duration-150
          ${ring}
          ${selected ? 'ring-2 brightness-110' : 'hover:brightness-105'}
        `}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-400 text-xs">{icon}</span>
          <span className="text-[10px] text-gray-500 font-mono truncate flex-1">{model.resource_type}</span>
          <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        </div>
        <div className="font-medium text-xs text-gray-100 truncate" title={model.name}>
          {model.name}
        </div>
        {model.materialized && (
          <div className="text-[9px] text-gray-600 font-mono truncate">{model.materialized}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: 'rgb(var(--brand-500))', border: 'none' }} />
    </>
  );
});
