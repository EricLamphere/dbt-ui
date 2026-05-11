import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api, type SourceFreshnessResult } from '../../../lib/api';
import { useProjectEvents } from '../../../lib/sse';

interface FreshnessPanelProps {
  projectId: number;
}

interface ColWidths {
  table: number;
  age: number;
  warnAfter: number;
  errorAfter: number;
}

const DEFAULT_COL_WIDTHS: ColWidths = { table: 320, age: 160, warnAfter: 160, errorAfter: 160 };
const MIN_COL_WIDTH = 48;

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
    </svg>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatAge(seconds: number | null): string {
  if (seconds === null) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatThreshold(count: number | null, period: string | null): string {
  if (count === null || !period) return '—';
  return `${count} ${period}${count !== 1 ? 's' : ''}`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'pass': return 'status-text-pass';
    case 'warn': return 'status-text-warn';
    case 'error':
    case 'runtime error': return 'status-text-error';
    default: return 'text-gray-500';
  }
}

function statusBadge(status: string): string {
  switch (status) {
    case 'pass': return 'status-badge-success border';
    case 'warn': return 'status-badge-warn border';
    case 'error':
    case 'runtime error': return 'status-badge-error border';
    default: return 'bg-surface-elevated border border-gray-700 text-gray-500';
  }
}

type FilterKey = 'all' | 'pass' | 'warn' | 'error';

const FILTER_LABELS: Record<FilterKey, string> = {
  all: 'All',
  pass: 'Pass',
  warn: 'Warn',
  error: 'Error',
};

function matchesFilter(result: SourceFreshnessResult, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'error') return result.status === 'error' || result.status === 'runtime error';
  return result.status === filter;
}

// Drag handle rendered at the right edge of a header cell
function ResizeHandle({ onDrag }: { onDrag: (dx: number) => void }) {
  const startX = useRef<number | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    startX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (startX.current === null) return;
    const dx = e.clientX - startX.current;
    startX.current = e.clientX;
    onDrag(dx);
  }

  function onPointerUp() {
    startX.current = null;
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none flex items-center justify-center group"
    >
      <div className="w-px h-3 bg-gray-700 group-hover:bg-gray-500 transition-colors" />
    </div>
  );
}

interface TableHeaderProps {
  widths: ColWidths;
  onResize: (col: keyof ColWidths, dx: number) => void;
}

function TableHeader({ widths, onResize }: TableHeaderProps) {
  return (
    <div className="flex items-center border-b border-gray-800/40 bg-surface-elevated/20 text-[10px] text-gray-400 font-semibold select-none">
      <div className="relative shrink-0 px-4 py-1.5" style={{ width: widths.table }}>
        Table
        <ResizeHandle onDrag={(dx) => onResize('table', dx)} />
      </div>
      <div className="relative shrink-0 px-2 py-1.5" style={{ width: widths.age }}>
        Age
        <ResizeHandle onDrag={(dx) => onResize('age', dx)} />
      </div>
      <div className="relative shrink-0 px-2 py-1.5" style={{ width: widths.warnAfter }}>
        Warn after
        <ResizeHandle onDrag={(dx) => onResize('warnAfter', dx)} />
      </div>
      <div className="relative shrink-0 px-2 py-1.5" style={{ width: widths.errorAfter }}>
        Error after
        <ResizeHandle onDrag={(dx) => onResize('errorAfter', dx)} />
      </div>
      <div className="flex-1" />
      <div className="shrink-0 px-4 py-1.5">Status</div>
    </div>
  );
}

interface SourceTableRowProps {
  result: SourceFreshnessResult;
  widths: ColWidths;
}

function SourceTableRow({ result, widths }: SourceTableRowProps) {
  return (
    <div className="flex items-center border-b border-gray-800/40 last:border-0">
      <span
        className="shrink-0 px-4 py-2.5 text-xs font-mono text-gray-300 truncate"
        style={{ width: widths.table }}
        title={result.table_name}
      >
        {result.table_name}
      </span>
      <span
        className={`shrink-0 px-2 py-2.5 text-xs tabular-nums ${result.age_seconds !== null && result.age_seconds > 0 ? 'text-gray-300' : 'text-gray-600'}`}
        style={{ width: widths.age }}
      >
        {formatAge(result.age_seconds)}
      </span>
      <span className="shrink-0 px-2 py-2.5 text-[10px] truncate" style={{ width: widths.warnAfter }}>
        <span className="text-gray-500">warn </span>
        <span className="text-gray-400">{formatThreshold(result.warn_after_count, result.warn_after_period)}</span>
      </span>
      <span className="shrink-0 px-2 py-2.5 text-[10px] truncate" style={{ width: widths.errorAfter }}>
        <span className="text-gray-500">error </span>
        <span className="text-gray-400">{formatThreshold(result.error_after_count, result.error_after_period)}</span>
      </span>
      <div className="flex-1" />
      {result.error ? (
        <span className="text-[10px] status-text-error truncate max-w-48 px-2" title={result.error}>
          {result.error}
        </span>
      ) : null}
      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 mr-4 ${statusBadge(result.status)}`}>
        {result.status}
      </span>
    </div>
  );
}

interface SourceGroupProps {
  sourceName: string;
  results: SourceFreshnessResult[];
  widths: ColWidths;
  onResize: (col: keyof ColWidths, dx: number) => void;
}

function SourceGroup({ sourceName, results, widths, onResize }: SourceGroupProps) {
  const [open, setOpen] = useState(true);

  const worstStatus = results.reduce<string>((worst, r) => {
    const order = ['pass', 'warn', 'error', 'runtime error'];
    return order.indexOf(r.status) > order.indexOf(worst) ? r.status : worst;
  }, 'pass');

  return (
    <div className="border border-gray-800/60 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-surface-elevated/30 hover:bg-surface-elevated/60 transition-colors text-left"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-gray-600 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
        )}
        <span className="text-xs font-semibold text-gray-200 flex-1 truncate">{sourceName}</span>
        <span className={`text-[10px] shrink-0 ${statusColor(worstStatus)}`}>
          {results.length} table{results.length !== 1 ? 's' : ''}
        </span>
      </button>

      {open && (
        <>
          <TableHeader widths={widths} onResize={onResize} />
          <div>
            {results.map((r) => (
              <SourceTableRow key={r.unique_id} result={r} widths={widths} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function FreshnessPanel({ projectId }: FreshnessPanelProps) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [colWidths, setColWidths] = useState<ColWidths>(DEFAULT_COL_WIDTHS);

  function handleResize(col: keyof ColWidths, dx: number) {
    setColWidths((prev) => ({
      ...prev,
      [col]: Math.max(MIN_COL_WIDTH, prev[col] + dx),
    }));
  }

  const { data: snapshot, isLoading } = useQuery({
    queryKey: ['freshness-latest', projectId],
    queryFn: () => api.freshness.latest(projectId),
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: () => api.freshness.start(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['freshness-latest', projectId] });
    },
  });

  const isRunning = mutation.isPending || snapshot?.status === 'running';

  useProjectEvents(projectId, useCallback((event) => {
    if (event.type === 'freshness_finished') {
      qc.invalidateQueries({ queryKey: ['freshness-latest', projectId] });
    }
  }, [projectId, qc]));

  const results = snapshot?.results ?? [];
  const filtered = results.filter((r) => matchesFilter(r, filter));

  const grouped = filtered.reduce<Record<string, SourceFreshnessResult[]>>((acc, r) => {
    const key = r.source_name || '(unknown)';
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});
  const sourceNames = Object.keys(grouped).sort();

  const passCount = results.filter((r) => r.status === 'pass').length;
  const warnCount = results.filter((r) => r.status === 'warn').length;
  const errorCount = results.filter((r) => r.status === 'error' || r.status === 'runtime error').length;

  return (
    <div className="p-6 pb-12 max-w-[62rem] mx-auto w-full">
      <div className="bg-surface-panel border border-gray-800 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm font-semibold text-gray-100">Source Freshness</span>
            {!isRunning && snapshot && snapshot.status !== 'running' && (
              <span className="text-xs text-gray-400 flex items-center gap-2">
                {errorCount > 0 && (
                  <span className="status-text-error">{errorCount} error{errorCount !== 1 ? 's' : ''}</span>
                )}
                {warnCount > 0 && (
                  <span className="status-text-warn">{warnCount} warn{warnCount !== 1 ? 's' : ''}</span>
                )}
                {passCount > 0 && (
                  <span className="status-text-pass">{passCount} pass</span>
                )}
                {results.length === 0 && (
                  <span className="text-gray-600">No sources found</span>
                )}
                <span className="text-gray-600">·</span>
                <span className="text-gray-600">{relativeTime(snapshot.started_at)}</span>
              </span>
            )}
            {!isRunning && !snapshot && !isLoading && (
              <span className="text-xs text-gray-600">Not run yet</span>
            )}
            {isRunning && (
              <span className="text-xs text-brand-400 flex items-center gap-1.5">
                <Spinner />
                Running dbt source freshness…
              </span>
            )}
          </div>
          <button
            onClick={() => mutation.mutate()}
            disabled={isRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-gray-700 bg-surface-elevated text-gray-300 hover:border-brand-600 hover:text-brand-300 transition-colors disabled:opacity-40"
          >
            {isRunning ? <Spinner /> : null}
            {isRunning ? 'Running…' : 'Run'}
          </button>
        </div>

        {/* Results */}
        {!isRunning && snapshot && snapshot.status !== 'running' && results.length > 0 && (
          <div className="px-5 py-4 flex flex-col gap-4">
            {/* Filter pills */}
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => {
                const count = key === 'all'
                  ? results.length
                  : results.filter((r) => matchesFilter(r, key)).length;
                if (key !== 'all' && count === 0) return null;
                return (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                      filter === key
                        ? 'bg-brand-900/60 border-brand-700 text-brand-300'
                        : 'bg-surface-elevated border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-300'
                    }`}
                  >
                    {FILTER_LABELS[key]} ({count})
                  </button>
                );
              })}
            </div>

            {/* Source groups */}
            {sourceNames.length === 0 ? (
              <p className="text-xs text-gray-600">No sources match this filter.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sourceNames.map((sourceName) => (
                  <SourceGroup
                    key={sourceName}
                    sourceName={sourceName}
                    results={grouped[sourceName]}
                    widths={colWidths}
                    onResize={handleResize}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* No sources state */}
        {!isRunning && snapshot && snapshot.status === 'done' && results.length === 0 && (
          <div className="px-5 py-4">
            <p className="text-xs text-gray-600">
              No sources with freshness configuration found. Add{' '}
              <code className="text-gray-400">freshness:</code> blocks to your{' '}
              <code className="text-gray-400">sources.yml</code>.
            </p>
          </div>
        )}

        {/* Error state */}
        {!isRunning && snapshot?.status === 'error' && (
          <div className="px-5 py-4">
            <p className="text-xs status-text-error">Freshness check failed: {snapshot.error_message}</p>
          </div>
        )}

        {isLoading && (
          <div className="px-5 py-4">
            <p className="text-xs text-gray-600">Loading…</p>
          </div>
        )}
      </div>
    </div>
  );
}
