import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GraphDto } from '../../../lib/api';
import { useProjectEvents } from '../../../lib/sse';

export type LiveStatus = 'running' | 'success' | 'error' | 'warn';

/**
 * Minimum time a node shows as running. Fast adapters (e.g. duckdb) finish a
 * model in tens of ms, so without a floor the blue "running" state is never
 * visible and a re-run of an already-green model looks like nothing happened.
 */
const MIN_RUNNING_MS = 600;

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function lastName(dotted: string): string {
  const parts = dotted.split('.');
  return parts[parts.length - 1];
}

function parseStartName(raw: string): string | null {
  const line = stripAnsi(raw).trim();
  const modelMatch = line.match(/\d+ of \d+ START .+ model (\S+)/);
  if (modelMatch) return lastName(modelMatch[1]);
  const testMatch = line.match(/\d+ of \d+ START test (\S+)/);
  if (testMatch) return lastName(testMatch[1]);
  return null;
}

function parseResultEntry(raw: string): { name: string; status: LiveStatus } | null {
  const line = stripAnsi(raw).trim();
  const modelMatch = line.match(/\d+ of \d+ (OK|ERROR|WARN) .+ model (\S+)/);
  if (modelMatch) {
    const kw = modelMatch[1];
    const status: LiveStatus = kw === 'ERROR' ? 'error' : kw === 'WARN' ? 'warn' : 'success';
    return { name: lastName(modelMatch[2]), status };
  }
  const testPassMatch = line.match(/\d+ of \d+ PASS \d* *(\S+)/);
  if (testPassMatch) return { name: lastName(testPassMatch[1]), status: 'success' };
  const testFailMatch = line.match(/\d+ of \d+ FAIL \d+ +(\S+)/);
  if (testFailMatch) return { name: lastName(testFailMatch[1]), status: 'error' };
  return null;
}

/** Overlay live statuses (keyed by node name) on top of the persisted graph statuses. */
export function applyLiveStatuses(graph: GraphDto, liveStatuses: Record<string, LiveStatus>): GraphDto {
  if (Object.keys(liveStatuses).length === 0) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      liveStatuses[n.name] ? { ...n, status: liveStatuses[n.name] } : n,
    ),
  };
}

/**
 * Live per-node run status parsed from `run_log` lines, for the main DAG.
 *
 * Owns the graph refetch on `statuses_changed` and drops the overlay only once
 * that refetch has landed *and* every held "running" state has played out, so
 * nodes never flash back to their pre-run color.
 */
export function useLiveRunStatuses(projectId: number): Record<string, LiveStatus> {
  const qc = useQueryClient();
  const [liveStatuses, setLiveStatuses] = useState<Record<string, LiveStatus>>({});
  const startedAt = useRef(new Map<string, number>());
  const heldResults = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const clearWhenIdle = useRef(false);

  const reset = useCallback(() => {
    heldResults.current.forEach(clearTimeout);
    heldResults.current.clear();
    startedAt.current.clear();
    clearWhenIdle.current = false;
    setLiveStatuses({});
  }, []);

  const clearIfIdle = useCallback(() => {
    if (heldResults.current.size > 0) {
      clearWhenIdle.current = true;
      return;
    }
    reset();
  }, [reset]);

  useEffect(() => () => heldResults.current.forEach(clearTimeout), []);

  const setStatus = useCallback((name: string, status: LiveStatus) => {
    setLiveStatuses((prev) => ({ ...prev, [name]: status }));
  }, []);

  const applyResult = useCallback((name: string, status: LiveStatus) => {
    const started = startedAt.current.get(name);
    const wait = started === undefined ? 0 : started + MIN_RUNNING_MS - Date.now();
    if (wait <= 0) {
      setStatus(name, status);
      return;
    }
    const timer = setTimeout(() => {
      heldResults.current.delete(name);
      setStatus(name, status);
      if (clearWhenIdle.current) clearIfIdle();
    }, wait);
    heldResults.current.set(name, timer);
  }, [setStatus, clearIfIdle]);

  useProjectEvents(projectId, useCallback((event) => {
    if (event.type === 'run_started') {
      reset(); // a new run supersedes any overlay left from the previous one
      return;
    }
    if (event.type === 'run_log') {
      const line = (event.data as { line: string }).line;
      const startName = parseStartName(line);
      if (startName) {
        startedAt.current.set(startName, Date.now());
        setStatus(startName, 'running');
        return;
      }
      const result = parseResultEntry(line);
      if (result) applyResult(result.name, result.status);
      return;
    }
    if (event.type === 'run_finished') {
      // Nodes that started but never reported (cancelled/killed run) fall back
      // to their persisted status rather than staying blue forever.
      setLiveStatuses((prev) => Object.fromEntries(
        Object.entries(prev).filter(([name, status]) => status !== 'running' || heldResults.current.has(name)),
      ));
      return;
    }
    if (event.type === 'statuses_changed') {
      qc.invalidateQueries({ queryKey: ['models', projectId] })
        .catch((err) => console.error('failed to refresh DAG statuses', err))
        .finally(clearIfIdle);
    }
  }, [projectId, qc, reset, setStatus, applyResult, clearIfIdle]));

  return liveStatuses;
}
