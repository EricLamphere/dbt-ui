import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { useProjectEvents } from '../../../../lib/sse';

interface LogPanelProps {
  projectId: number;
  logType: 'project' | 'api';
}

// Events that trigger a full re-fetch (run ended, pipeline done, etc.)
const PROJECT_REFETCH_EVENTS = new Set([
  'run_finished',
  'init_pipeline_finished',
  'compile_finished',
  'docs_generated',
]);

const API_REFETCH_EVENTS = new Set([
  'run_started',
  'run_finished',
  'init_pipeline_started',
  'init_pipeline_finished',
  'compile_started',
  'compile_finished',
  'docs_generating',
  'docs_generated',
]);

export function LogPanel({ projectId, logType }: LogPanelProps) {
  const qc = useQueryClient();
  const queryKey = ['logs', logType, projectId];
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  // Extra lines accumulated in real time from SSE (flushed on refetch)
  const [liveLines, setLiveLines] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      logType === 'project'
        ? api.logs.projectLogs(projectId)
        : api.logs.apiLogs(projectId),
    refetchInterval: false,
    staleTime: 0,
  });

  // Clear live lines whenever a fresh fetch completes (they'll be in `data` now)
  useEffect(() => {
    if (data) setLiveLines([]);
  }, [data]);

  const persistedLines = data?.lines ?? [];
  // Dedupe: only show live lines that aren't already in the fetched set
  // Simple approach: just append — the refetch clears liveLines anyway
  const lines = [...persistedLines, ...liveLines];

  const refetchEvents = logType === 'project' ? PROJECT_REFETCH_EVENTS : API_REFETCH_EVENTS;

  useProjectEvents(projectId, useCallback((event) => {
    // Real-time: append run_log lines immediately to project log view
    if (logType === 'project' && event.type === 'run_log') {
      const line = (event.data as { line: string }).line;
      setLiveLines((prev) => [...prev, line]);
      return;
    }

    // Also append init step output in real time
    if (logType === 'project' && event.type === 'init_step') {
      const d = event.data as { name: string; status: string; log?: string };
      if (d.log) {
        const newLines = d.log.split('\n').filter(Boolean);
        setLiveLines((prev) => [...prev, ...newLines]);
      }
      return;
    }

    // On completion events, do a full refetch to get the authoritative log
    if (refetchEvents.has(event.type)) {
      setTimeout(() => {
        qc.invalidateQueries({ queryKey });
      }, 300);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logType, projectId, qc]));

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [lines.length, autoScroll]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-gray-800 shrink-0">
        <span className="text-[10px] text-gray-600 font-mono">
          {logType === 'project'
            ? 'logs/dbt-ui/project_logs.log'
            : '{data_dir}/logs/dbt-ui/api_logs.log'}
        </span>
        <div className="flex items-center gap-2">
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-[10px] text-brand-400 hover:text-brand-300 transition-colors"
            >
              ↓ Scroll to bottom
            </button>
          )}
          <button
            onClick={() => qc.invalidateQueries({ queryKey })}
            className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors"
            title="Refresh"
          >
            ↺ Refresh
          </button>
        </div>
      </div>

      {/* Log content */}
      <div
        className="flex-1 overflow-auto font-mono text-xs p-3 bg-surface-app text-gray-400 leading-relaxed"
        onScroll={handleScroll}
      >
        {isLoading && <span className="text-gray-600">Loading…</span>}
        {!isLoading && lines.length === 0 && (
          <span className="text-gray-600">No log entries yet.</span>
        )}
        {lines.map((line, i) => (
          <LogLine key={i} line={line} />
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}

function LogLine({ line }: { line: string }) {
  const colorClass =
    line.includes('ERROR') || line.includes('FAILED') || line.includes('error')
      ? 'text-red-400'
      : line.includes('SUCCESS') || line.includes('OK') || line.includes('success')
      ? 'text-green-400'
      : line.includes('>>>') || line.includes('===') || line.includes('---')
      ? 'text-brand-300'
      : line.includes('WARN') || line.includes('warn')
      ? 'text-amber-400'
      : '';

  return <div className={colorClass || undefined}>{line}</div>;
}
