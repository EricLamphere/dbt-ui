import { useEffect, useRef } from 'react';

export type SseHandler = (event: { type: string; data: unknown }) => void;

const PROJECT_EVENT_TYPES = [
  'run_started', 'run_log', 'run_finished', 'run_error', 'run_history_changed',
  'statuses_changed', 'graph_changed', 'files_changed',
  'init_pipeline_started', 'init_step', 'init_pipeline_finished',
  'compile_started', 'compile_finished',
  'docs_generating', 'docs_generated',
  'test_failed',
  'git_status_changed', 'git_started', 'git_log', 'git_finished', 'git_error',
  'project_log', 'api_log',
  'health_check_started', 'health_check_finished',
  'drift_started', 'drift_progress', 'drift_finished',
  'freshness_started', 'freshness_finished',
  'column_lineage_compiling', 'column_lineage_started', 'column_lineage_progress', 'column_lineage_finished',
];

const RECONNECT_DELAY_MS = 3000;

/**
 * One EventSource per project, shared by every useProjectEvents() subscriber.
 *
 * Browsers cap HTTP/1.1 at 6 open connections per host. With one EventSource
 * per hook, a page with 6+ subscribers (homepage, bottom pane, panels…) uses
 * every slot, and all later fetches queue forever — the app hangs until reload.
 */
interface SharedProjectStream {
  listeners: Set<SseHandler>;
  es: EventSource | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

const projectStreams = new Map<number, SharedProjectStream>();

function dispatch(stream: SharedProjectStream, type: string, raw: string) {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  stream.listeners.forEach((listener) => {
    try {
      listener({ type, data });
    } catch (err) {
      // One broken handler must not starve the other subscribers.
      console.error(`SSE handler failed for ${type}`, err);
    }
  });
}

function openProjectStream(projectId: number, stream: SharedProjectStream) {
  const es = new EventSource(`/api/projects/${projectId}/events`);
  stream.es = es;
  PROJECT_EVENT_TYPES.forEach((type) => {
    es.addEventListener(type, (e: MessageEvent) => dispatch(stream, type, e.data));
  });
  es.onerror = () => {
    es.close();
    stream.es = null;
    if (stream.listeners.size === 0) return;
    stream.retryTimer = setTimeout(() => {
      stream.retryTimer = null;
      if (projectStreams.get(projectId) === stream) openProjectStream(projectId, stream);
    }, RECONNECT_DELAY_MS);
  };
}

function subscribeToProject(projectId: number, listener: SseHandler): () => void {
  let stream = projectStreams.get(projectId);
  if (!stream) {
    stream = { listeners: new Set(), es: null, retryTimer: null };
    projectStreams.set(projectId, stream);
    openProjectStream(projectId, stream);
  }
  const active = stream;
  active.listeners.add(listener);
  return () => {
    active.listeners.delete(listener);
    if (active.listeners.size > 0) return;
    active.es?.close();
    if (active.retryTimer) clearTimeout(active.retryTimer);
    projectStreams.delete(projectId);
  };
}

/**
 * useProjectEvents — subscribe to a project's SSE stream.
 * All subscribers for a project share one connection, which reconnects
 * automatically and closes when the last subscriber unmounts.
 */
export function useProjectEvents(projectId: number | null, onEvent: SseHandler) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (projectId === null) return;
    return subscribeToProject(projectId, (event) => handlerRef.current(event));
  }, [projectId]);
}

/**
 * useTerminalEvents — subscribe to a terminal session's SSE stream.
 * Same wire format as init sessions (init_output / init_finished).
 */
export function useTerminalEvents(
  sessionId: string | null,
  onEvent: SseHandler,
) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!sessionId) return;
    const url = `/api/terminal/${sessionId}/events`;
    let es: EventSource;
    let dead = false;
    let finished = false;

    function connect() {
      if (dead) return;
      es = new EventSource(url);

      es.addEventListener('init_output', (e: MessageEvent) => {
        try { handlerRef.current({ type: 'init_output', data: JSON.parse(e.data) }); }
        catch { handlerRef.current({ type: 'init_output', data: e.data }); }
      });

      es.addEventListener('init_finished', (e: MessageEvent) => {
        finished = true;
        es.close();
        try { handlerRef.current({ type: 'init_finished', data: JSON.parse(e.data) }); }
        catch { handlerRef.current({ type: 'init_finished', data: e.data }); }
      });

      es.onerror = () => {
        es.close();
        if (!dead && !finished) setTimeout(connect, 2000);
      };
    }

    connect();
    return () => {
      dead = true;
      es?.close();
    };
  }, [sessionId]);
}

/**
 * useInitSessionEvents — subscribe to a PTY init session's SSE stream.
 * Does NOT reconnect after init_finished — the session is done.
 */
export function useInitSessionEvents(
  sessionId: string | null,
  onEvent: SseHandler,
) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!sessionId) return;
    const url = `/api/projects/init-session/${sessionId}/events`;
    let es: EventSource;
    let dead = false;
    let finished = false;

    function connect() {
      if (dead) return;
      es = new EventSource(url);

      es.addEventListener('init_output', (e: MessageEvent) => {
        try { handlerRef.current({ type: 'init_output', data: JSON.parse(e.data) }); }
        catch { handlerRef.current({ type: 'init_output', data: e.data }); }
      });

      es.addEventListener('init_finished', (e: MessageEvent) => {
        finished = true;
        es.close();
        try { handlerRef.current({ type: 'init_finished', data: JSON.parse(e.data) }); }
        catch { handlerRef.current({ type: 'init_finished', data: e.data }); }
      });

      es.onerror = () => {
        es.close();
        // Only reconnect on unexpected errors, not after a clean finish.
        if (!dead && !finished) setTimeout(connect, 2000);
      };
    }

    connect();
    return () => {
      dead = true;
      es?.close();
    };
  }, [sessionId]);
}
