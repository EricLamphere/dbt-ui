type Status = 'idle' | 'pending' | 'running' | 'success' | 'error' | 'stale' | 'warn';

const CLASSES: Record<Status, string> = {
  idle: 'bg-gray-700 text-gray-400',
  pending: 'bg-blue-900/60 text-blue-300',
  running: 'bg-blue-600 text-white animate-pulse',
  success: 'bg-emerald-900/60 text-emerald-400',
  error: 'bg-red-900/60 text-red-400',
  stale: 'bg-amber-900/60 text-amber-400',
  warn: 'bg-yellow-900/60 text-yellow-400',
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
