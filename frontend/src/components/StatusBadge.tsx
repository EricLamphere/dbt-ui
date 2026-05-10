type Status = 'idle' | 'pending' | 'running' | 'success' | 'error' | 'stale' | 'warn';

const CLASSES: Record<Status, string> = {
  idle: 'bg-gray-700 text-gray-400',
  pending: 'status-badge-pending',
  running: 'bg-blue-600 text-white animate-pulse',
  success: 'status-badge-success',
  error: 'status-badge-error',
  stale: 'status-badge-stale',
  warn: 'status-badge-warn',
};

const ICONS: Record<Status, string> = {
  idle: '○',
  pending: '⋯',
  running: '↻',
  success: '✓',
  error: '✕',
  stale: '~',
  warn: '⚠',
};

interface Props {
  status: Status;
  label?: boolean;
  size?: 'xs' | 'sm';
}

export default function StatusBadge({ status, label = false, size = 'xs' }: Props) {
  const cls = CLASSES[status] ?? CLASSES.idle;
  const icon = ICONS[status] ?? '○';
  const textSize = size === 'sm' ? 'text-xs' : 'text-[10px]';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono ${textSize} ${cls}`}>
      <span>{icon}</span>
      {label && <span className="capitalize">{status}</span>}
    </span>
  );
}
