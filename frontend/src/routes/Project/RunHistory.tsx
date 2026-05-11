import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import NavRail from './components/NavRail';
import { api, ModelTimingDto, NodeTrendPoint, RunInvocationDetailDto, RunInvocationDto } from '../../lib/api';
import { useProjectEvents } from '../../lib/sse';

// ── helpers ─────────────────────────────────────────────────────────────────

function statusCls(status: string) {
  if (status === 'success') return 'status-badge-success';
  if (status === 'error') return 'status-badge-error';
  if (status === 'running') return 'status-badge-running';
  if (status === 'cancelled') return 'bg-amber-900/40 text-amber-400';
  return 'bg-surface-elevated text-gray-400';
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusCls(status)}`}>
      {status}
    </span>
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(0).padStart(2, '0');
  return `${m}m ${s}s`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const CMD_COLORS: Record<string, string> = {
  run:   'cmd-badge-run',
  build: 'cmd-badge-build',
  test:  'cmd-badge-test',
  seed:  'cmd-badge-seed',
};

function CommandBadge({ command }: { command: string }) {
  const cls = CMD_COLORS[command] ?? 'text-gray-300 bg-surface-elevated';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium ${cls}`}>
      {command}
    </span>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ points }: { points: NodeTrendPoint[] }) {
  if (points.length < 2) {
    return <span className="text-gray-500 text-xs">not enough data</span>;
  }
  const times = points.map((p) => p.execution_time ?? 0);
  const max = Math.max(...times, 0.001);
  const W = 120, H = 32, PAD = 2;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const pts = points.map((p, i) => {
    const x = PAD + (i / (points.length - 1)) * innerW;
    const y = PAD + (1 - (p.execution_time ?? 0) / max) * innerH;
    return { x, y, status: p.status };
  });
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline
        points={polyline}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-brand-400"
      />
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={2.5}
          className={p.status === 'error' ? 'fill-red-400' : 'fill-brand-400'}
        />
      ))}
    </svg>
  );
}

// ── TrendRow (single node trend, loaded on demand) ───────────────────────────

function TrendRow({ projectId, node }: { projectId: number; node: ModelTimingDto }) {
  const [open, setOpen] = useState(false);
  const { data: trend } = useQuery<NodeTrendPoint[]>({
    queryKey: ['node-trend', projectId, node.unique_id],
    queryFn: () => api.runHistory.nodeTrend(projectId, node.unique_id),
    enabled: open,
    staleTime: 30_000,
  });

  const timeDisplay = node.execution_time === null
    ? '—'
    : node.execution_time >= 10
      ? `⚠ ${node.execution_time.toFixed(2)}`
      : node.execution_time.toFixed(2);

  const kindBadge = node.kind === 'test'
    ? <span className="text-[10px] px-1 py-0.5 rounded cmd-badge-test font-mono">test</span>
    : null;

  return (
    <>
      <tr
        className="border-b border-gray-800/60 hover:bg-surface-elevated cursor-pointer transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <td className="px-4 py-2 font-mono text-gray-300 flex items-center gap-1.5">
          <svg
            className={`w-3 h-3 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          {node.name}
          {kindBadge && <span className="ml-1">{kindBadge}</span>}
        </td>
        <td className={`px-4 py-2 text-right tabular-nums font-mono ${node.execution_time !== null && node.execution_time >= 10 ? 'text-amber-500' : 'text-gray-300'}`}>
          {timeDisplay}
        </td>
        <td className="px-4 py-2"><StatusBadge status={node.status} /></td>
        <td className="px-4 py-2 text-gray-500 max-w-[220px] truncate">{node.message ?? ''}</td>
      </tr>
      {open && (
        <tr className="border-b border-gray-800/40 bg-surface-app/50">
          <td colSpan={4} className="px-6 py-3">
            <div className="flex items-center gap-4">
              <span className="text-xs text-gray-500 shrink-0">Last {trend?.length ?? 0} runs:</span>
              {trend && trend.length > 0 ? (
                <>
                  <Sparkline points={trend} />
                  <div className="flex flex-col text-[10px] text-gray-500 gap-0.5">
                    <span>max: <span className="text-gray-300">{Math.max(...trend.map(p => p.execution_time ?? 0)).toFixed(2)}s</span></span>
                    <span>avg: <span className="text-gray-300">{(trend.reduce((s, p) => s + (p.execution_time ?? 0), 0) / trend.length).toFixed(2)}s</span></span>
                    <span>min: <span className="text-gray-300">{Math.min(...trend.filter(p => p.execution_time !== null).map(p => p.execution_time!)).toFixed(2)}s</span></span>
                  </div>
                </>
              ) : (
                <span className="text-xs text-gray-600">Loading…</span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── DetailPanel ──────────────────────────────────────────────────────────────

type DetailTab = 'nodes' | 'log';

interface DetailPanelProps {
  projectId: number;
  invocation: RunInvocationDto;
}

function DetailPanel({ projectId, invocation }: DetailPanelProps) {
  const [tab, setTab] = useState<DetailTab>('nodes');
  const [nodeFilter, setNodeFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'model' | 'test'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data, isLoading } = useQuery<RunInvocationDetailDto>({
    queryKey: ['run-invocation', projectId, invocation.id],
    queryFn: () => api.runHistory.detail(projectId, invocation.id),
  });

  const { data: logData, isLoading: logLoading } = useQuery<{ lines: string[] }>({
    queryKey: ['run-invocation-log', projectId, invocation.id],
    queryFn: () => api.runHistory.log(projectId, invocation.id),
    enabled: tab === 'log',
  });

  const filteredNodes = useMemo(() => {
    const nodes = data?.nodes ?? [];
    return nodes.filter((n) => {
      if (kindFilter !== 'all' && n.kind !== kindFilter) return false;
      if (statusFilter !== 'all' && n.status !== statusFilter) return false;
      if (nodeFilter && !n.name.toLowerCase().includes(nodeFilter.toLowerCase())) return false;
      return true;
    });
  }, [data?.nodes, kindFilter, statusFilter, nodeFilter]);

  const allStatuses = useMemo(() => {
    const s = new Set((data?.nodes ?? []).map((n) => n.status));
    return Array.from(s).sort();
  }, [data?.nodes]);

  const modelCount = data?.nodes.filter((n) => n.kind === 'model').length ?? 0;
  const testCount = data?.nodes.filter((n) => n.kind === 'test').length ?? 0;

  return (
    <div className="flex flex-col h-full border-l border-gray-800 bg-surface-panel min-w-0">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2 min-w-0">
          <CommandBadge command={invocation.command} />
          <span className="text-xs text-gray-400 truncate">{invocation.selector ?? 'all models'}</span>
          <StatusBadge status={invocation.status} />
        </div>
      </div>

      {/* Meta row */}
      <div className="shrink-0 flex gap-5 px-4 py-2 border-b border-gray-800 text-xs text-gray-500">
        <span>Started: <span className="text-gray-300">{formatTime(invocation.started_at)}</span></span>
        <span>Duration: <span className="text-gray-300">{formatDuration(invocation.duration_seconds)}</span></span>
        <span>Models: <span className="text-gray-300">{modelCount}</span></span>
        {testCount > 0 && <span>Tests: <span className="text-gray-300">{testCount}</span></span>}
      </div>

      {/* Tab bar */}
      <div className="shrink-0 flex border-b border-gray-800">
        {(['nodes', 'log'] as DetailTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
              tab === t
                ? 'border-brand-500 text-brand-300'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {t === 'nodes' ? 'Nodes' : 'Log'}
          </button>
        ))}
      </div>

      {/* Nodes tab */}
      {tab === 'nodes' && (
        <>
          {/* Filter bar */}
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-surface-app">
            <input
              type="text"
              placeholder="Search nodes…"
              value={nodeFilter}
              onChange={(e) => setNodeFilter(e.target.value)}
              className="flex-1 min-w-0 form-input border rounded px-2.5 py-1 text-xs"
            />
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as 'all' | 'model' | 'test')}
              className="form-select border rounded px-2 py-1 text-xs"
            >
              <option value="all">All kinds</option>
              <option value="model">Models</option>
              <option value="test">Tests</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="form-select border rounded px-2 py-1 text-xs"
            >
              <option value="all">All statuses</option>
              {allStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32 text-gray-500 text-sm">Loading…</div>
            ) : filteredNodes.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-gray-500 text-sm">No nodes match filters.</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
                    <th className="px-4 py-2 font-medium">Node</th>
                    <th className="px-4 py-2 font-medium text-right">Time (s)</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNodes.map((n) => (
                    <TrendRow key={n.unique_id} projectId={projectId} node={n} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {!isLoading && filteredNodes.length > 0 && (
            <p className="shrink-0 px-4 py-1.5 text-[10px] text-gray-500 border-t border-gray-800">
              Click a row to view the trend for that node across its last {20} runs. ⚠ = slower than 10s.
            </p>
          )}
        </>
      )}

      {/* Log tab */}
      {tab === 'log' && (
        <div className="flex-1 overflow-auto bg-surface-app font-mono text-xs text-gray-300 p-4">
          {logLoading ? (
            <span className="text-gray-500">Loading…</span>
          ) : !logData || logData.lines.length === 0 ? (
            <span className="text-gray-500">No log captured for this invocation.</span>
          ) : (
            logData.lines.map((line, i) => (
              <div key={i} className={`whitespace-pre leading-5 ${line.includes('ERROR') || line.includes('FAILED') ? 'text-red-400' : line.includes('OK') || line.includes('PASS') ? 'text-emerald-400' : line.includes('WARN') ? 'text-amber-400' : ''}`}>
                {line}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Filter bar (list-level) ───────────────────────────────────────────────────

interface ListFilters {
  q: string;
  command: string;
  status: string;
}

// ── Pane geometry ─────────────────────────────────────────────────────────────

const PANE_MIN = 280;
const PANE_DEFAULT = 520;
const PANE_MAX = 1200;
const PANE_COLLAPSE_THRESHOLD = 80;
const PANE_STORAGE_KEY = 'dbt-ui:run-history-pane-width';

function readPaneWidth(): number {
  try {
    const v = localStorage.getItem(PANE_STORAGE_KEY);
    if (v) {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n >= PANE_MIN && n <= PANE_MAX) return n;
    }
  } catch {}
  return PANE_DEFAULT;
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

function StopButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title="Stop run"
      className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
    >
      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
        <rect x="4" y="4" width="16" height="16" rx="2" />
      </svg>
    </button>
  );
}

export default function RunHistoryPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const qc = useQueryClient();

  const sessionKey = `run-history:${id}`;

  const cancelMutation = useMutation({
    mutationFn: () => api.runHistory.cancel(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['run-history', id], exact: false });
    },
  });

  const [selectedId, setSelectedId] = useState<number | null>(() => {
    try { const v = sessionStorage.getItem(`${sessionKey}:selected`); return v ? Number(v) : null; } catch { return null; }
  });
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<ListFilters>({ q: '', command: '', status: '' });
  const [draftQ, setDraftQ] = useState('');

  const [paneOpen, setPaneOpen] = useState(() => {
    try { return sessionStorage.getItem(`${sessionKey}:pane-open`) === 'true'; } catch { return false; }
  });
  const [paneWidth, setPaneWidth] = useState(readPaneWidth);
  const lastPaneWidth = useRef(readPaneWidth());
  const resizing = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  function persistSelected(invId: number | null) {
    try {
      if (invId === null) sessionStorage.removeItem(`${sessionKey}:selected`);
      else sessionStorage.setItem(`${sessionKey}:selected`, String(invId));
    } catch {}
  }

  function persistPaneOpen(open: boolean) {
    try { sessionStorage.setItem(`${sessionKey}:pane-open`, String(open)); } catch {}
  }

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const delta = startX.current - e.clientX;
      setPaneWidth(Math.max(0, Math.min(PANE_MAX, startW.current + delta)));
    };
    const onMouseUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      setPaneWidth((w) => {
        if (w < PANE_COLLAPSE_THRESHOLD) {
          setPaneOpen(false);
          persistPaneOpen(false);
          return lastPaneWidth.current;
        }
        const clamped = Math.max(PANE_MIN, w);
        lastPaneWidth.current = clamped;
        try { localStorage.setItem(PANE_STORAGE_KEY, String(clamped)); } catch {}
        return clamped;
      });
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePane() {
    setPaneOpen((v) => {
      const next = !v;
      if (next) setPaneWidth(lastPaneWidth.current);
      persistPaneOpen(next);
      return next;
    });
  }

  function selectInvocation(inv: RunInvocationDto) {
    setSelectedId(inv.id);
    persistSelected(inv.id);
    if (!paneOpen) {
      setPaneWidth(lastPaneWidth.current);
      setPaneOpen(true);
      persistPaneOpen(true);
    }
  }

  function clearSelected() {
    clearSelected();
    persistSelected(null);
  }

  const queryParams = {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    command: filters.command || undefined,
    status: filters.status || undefined,
    q: filters.q || undefined,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['run-history', id, queryParams],
    queryFn: () => api.runHistory.list(id, queryParams),
  });

  useProjectEvents(id, useCallback((event) => {
    if (event.type === 'run_started') {
      qc.invalidateQueries({ queryKey: ['run-history', id], exact: false });
    }
    if (event.type === 'run_history_changed') {
      qc.invalidateQueries({ queryKey: ['run-history', id], exact: false });
      // also invalidate the detail if it's open
      qc.invalidateQueries({ queryKey: ['run-invocation', id], exact: false });
    }
  }, [id, qc]));

  const invocations = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const selected = invocations.find((inv) => inv.id === selectedId) ?? null;

  function applySearch() {
    setFilters((f) => ({ ...f, q: draftQ }));
    setPage(0);
    clearSelected();
  }

  function setFilter(key: keyof ListFilters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
    clearSelected();
  }

  return (
    <div className="flex h-full overflow-hidden">
      <NavRail projectId={id} current="runs" />

      <div className="flex-1 flex min-w-0 overflow-hidden">
        {/* Left: list */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Header */}
          <div className="shrink-0 border-b border-gray-800 px-6 pt-5 pb-3 bg-surface-app">
            <div className="flex items-center gap-2.5 mb-1">
              <svg className="w-5 h-5 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h1 className="text-base font-semibold text-gray-100">Run History</h1>
              {total > 0 && <span className="text-xs text-gray-500">{total} total</span>}
            </div>

            {/* Filter bar */}
            <div className="flex items-center gap-2 mt-3">
              <form
                className="flex-1 flex gap-1.5"
                onSubmit={(e) => { e.preventDefault(); applySearch(); }}
              >
                <input
                  type="text"
                  placeholder="Search by selector…"
                  value={draftQ}
                  onChange={(e) => setDraftQ(e.target.value)}
                  className="flex-1 min-w-0 form-input border rounded px-2.5 py-1 text-xs"
                />
                <button type="submit" className="px-2.5 py-1 form-btn border rounded text-xs transition-colors">
                  Search
                </button>
              </form>
              <select
                value={filters.command}
                onChange={(e) => setFilter('command', e.target.value)}
                className="form-select border rounded px-2 py-1 text-xs"
              >
                <option value="">All commands</option>
                <option value="run">run</option>
                <option value="build">build</option>
                <option value="test">test</option>
                <option value="seed">seed</option>
              </select>
              <select
                value={filters.status}
                onChange={(e) => setFilter('status', e.target.value)}
                className="form-select border rounded px-2 py-1 text-xs"
              >
                <option value="">All statuses</option>
                <option value="success">success</option>
                <option value="error">error</option>
                <option value="running">running</option>
              </select>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32 text-gray-500 text-sm">Loading…</div>
            ) : invocations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-500">
                <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm">{total === 0 ? 'No runs recorded yet.' : 'No runs match filters.'}</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-panel z-10">
                  <tr className="border-b border-gray-800 text-left text-[10px] uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-2 font-medium">Started</th>
                    <th className="px-4 py-2 font-medium">Cmd</th>
                    <th className="px-4 py-2 font-medium">Selector</th>
                    <th className="px-4 py-2 font-medium text-right">Duration</th>
                    <th className="px-4 py-2 font-medium text-right">Results</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium w-8" />
                  </tr>
                </thead>
                <tbody>
                  {invocations.map((inv) => {
                    const isActive = inv.id === selectedId;
                    return (
                      <tr
                        key={inv.id}
                        onClick={() => { if (isActive) clearSelected(); else selectInvocation(inv); }}
                        className={`border-b border-gray-800/60 cursor-pointer transition-colors ${isActive ? 'bg-brand-900/20' : 'hover:bg-surface-elevated'}`}
                      >
                        <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap font-mono">{formatTime(inv.started_at)}</td>
                        <td className="px-4 py-2.5"><CommandBadge command={inv.command} /></td>
                        <td className="px-4 py-2.5 text-gray-400 max-w-[140px] truncate font-mono">
                          {inv.selector ?? <span className="text-gray-600 italic">all</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums">{formatDuration(inv.duration_seconds)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                          {inv.status === 'running' ? (
                            <span className="text-gray-500">—</span>
                          ) : inv.model_count === 0 ? (
                            <span className="text-gray-500">—</span>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              <span className="result-ok">{inv.success_count} ok</span>
                              {inv.error_count > 0 && <span className="result-err">{inv.error_count} err</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5"><StatusBadge status={inv.status} /></td>
                        <td className="px-2 py-2">
                          {inv.status === 'running' && (
                            <StopButton onClick={() => cancelMutation.mutate()} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="shrink-0 flex items-center justify-between px-4 py-2 border-t border-gray-800 text-xs text-gray-500">
              <span>Page {page + 1} of {totalPages}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setPage((p) => Math.max(0, p - 1)); clearSelected(); }}
                  disabled={page === 0}
                  className="px-2.5 py-1 form-btn disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => { setPage((p) => Math.min(totalPages - 1, p + 1)); clearSelected(); }}
                  disabled={page >= totalPages - 1}
                  className="px-2.5 py-1 form-btn disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: draggable detail pane */}
        <div className="shrink-0 bg-surface-panel border-l border-gray-700 flex flex-row">
          {/* Drag handle + toggle strip */}
          <div
            className="flex flex-col items-center justify-between py-2 border-r border-gray-800 select-none cursor-col-resize bg-surface-panel"
            style={{ width: 20 }}
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              resizing.current = true;
              startX.current = e.clientX;
              if (paneOpen) {
                startW.current = paneWidth;
              } else {
                startW.current = 0;
                setPaneOpen(true);
                setPaneWidth(0);
              }
              e.preventDefault();
            }}
          >
            <div className="flex flex-col gap-0.5 items-center opacity-40 mt-2">
              <div className="w-px h-4 bg-gray-500" />
              <div className="w-px h-4 bg-gray-500" />
              <div className="w-px h-4 bg-gray-500" />
            </div>
            <button
              onClick={togglePane}
              className="p-0.5 rounded text-gray-500 hover:text-gray-300 transition-colors mb-2"
              title={paneOpen ? 'Collapse panel' : 'Expand panel'}
            >
              {paneOpen
                ? <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              }
            </button>
          </div>

          {/* Panel content */}
          <div
            style={{ width: paneOpen ? paneWidth : 0 }}
            className="overflow-hidden flex flex-col transition-none"
          >
            <div style={{ width: paneWidth }} className="flex flex-col h-full">
              {selected
                ? <DetailPanel projectId={id} invocation={selected} />
                : (
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm px-6 text-center">
                    Select a run to see node timings and logs.
                  </div>
                )
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
