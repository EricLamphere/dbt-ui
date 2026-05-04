import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type DebugCheck } from '../../../lib/api';
import { useProjectEvents } from '../../../lib/sse';

interface HealthCheckPanelProps {
  projectId: number;
}

function CheckIcon({ status }: { status: DebugCheck['status'] }) {
  if (status === 'ok') {
    return (
      <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
      </svg>
    );
  }
  if (status === 'fail') {
    return (
      <svg className="w-3.5 h-3.5 text-red-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
      </svg>
    );
  }
  if (status === 'warn') {
    return (
      <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
    );
  }
  return (
    <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
    </svg>
  );
}

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
  return `${hrs}h ago`;
}

export default function HealthCheckPanel({ projectId }: HealthCheckPanelProps) {
  const qc = useQueryClient();
  const [liveLog, setLiveLog] = useState<string[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const { data: lastResult, isLoading: lastLoading } = useQuery({
    queryKey: ['health-check-last', projectId],
    queryFn: () => api.projects.debugLast(projectId),
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: () => api.projects.debug(projectId),
    onMutate: () => {
      setLiveLog([]);
      setShowRaw(false);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['health-check-last', projectId] });
    },
  });

  const isRunning = mutation.isPending;

  useProjectEvents(projectId, useCallback((event) => {
    if (event.type === 'run_log' && isRunning) {
      const data = event.data as { line?: string };
      if (data.line !== undefined) {
        setLiveLog((prev) => [...prev, data.line!]);
      }
    }
    if (event.type === 'health_check_finished') {
      qc.invalidateQueries({ queryKey: ['health-check-last', projectId] });
    }
  }, [projectId, qc, isRunning]));

  useEffect(() => {
    if (isRunning && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [liveLog, isRunning]);

  const result = mutation.isSuccess ? mutation.data : lastResult;
  const hasResult = result != null;

  return (
    <div className="bg-surface-panel border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-semibold text-gray-100">Health Check</span>
          {!isRunning && hasResult && (
            <span className={`text-xs ${result.overall_ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {result.overall_ok ? 'All checks passed' : 'Check failed'} · {relativeTime(result.finished_at)}
            </span>
          )}
          {!isRunning && !hasResult && !lastLoading && (
            <span className="text-xs text-gray-600">Not run yet</span>
          )}
          {isRunning && (
            <span className="text-xs text-brand-400 flex items-center gap-1.5">
              <Spinner />
              Running dbt debug…
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

      {/* Live log while running */}
      {isRunning && liveLog.length > 0 && (
        <div className="px-4 py-3 max-h-48 overflow-auto bg-black/30">
          <pre className="text-[10px] font-mono text-gray-400 whitespace-pre-wrap leading-relaxed">
            {liveLog.join('\n')}
          </pre>
          <div ref={logEndRef} />
        </div>
      )}

      {/* Results */}
      {!isRunning && hasResult && (
        <div className="px-5 py-4 flex flex-col gap-2">
          {/* Version info */}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-gray-500 pb-1">
            {result.dbt_version && (
              <span>dbt <span className="text-gray-300 font-mono">{result.dbt_version}</span></span>
            )}
            {result.adapter_name && (
              <span>adapter <span className="text-gray-300 font-mono">{result.adapter_name}{result.adapter_version ? ` ${result.adapter_version}` : ''}</span></span>
            )}
            {result.python_version && (
              <span>python <span className="text-gray-300 font-mono">{result.python_version}</span></span>
            )}
            {result.target_name && (
              <span>target <span className="text-gray-300 font-mono">{result.target_name}</span></span>
            )}
          </div>

          {/* Check list */}
          {result.checks.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {result.checks.map((check, i) => (
                <div key={`${check.key}-${i}`} className="flex items-start gap-2">
                  <CheckIcon status={check.status} />
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs text-gray-300">{check.label}</span>
                    {check.detail && (
                      <span className="text-[10px] text-gray-600 break-all leading-relaxed">{check.detail}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-600">No structured checks found in output.</p>
          )}

          {/* Show details toggle */}
          {result.raw_log && (
            <div className="pt-1">
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors flex items-center gap-1"
              >
                <svg className={`w-2.5 h-2.5 transition-transform ${showRaw ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                {showRaw ? 'Hide' : 'Show'} raw output
              </button>
              {showRaw && (
                <pre className="mt-2 text-[10px] font-mono text-gray-500 bg-black/20 rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap leading-relaxed">
                  {result.raw_log}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
