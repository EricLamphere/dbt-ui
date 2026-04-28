import { useEffect, useRef } from 'react';

export type SseHandler = (event: { type: string; data: unknown }) => void;

/**
 * useProjectEvents — subscribe to a project's SSE stream.
 * Reconnects automatically on disconnect. Cleans up on unmount.
 */
export function useProjectEvents(projectId: number | null, onEvent: SseHandler) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (projectId === null) return;
    const url = `/api/projects/${projectId}/events`;
    let es: EventSource;
    let dead = false;

    function connect() {
      if (dead) return;
      es = new EventSource(url);

      const types = [
        'run_started', 'run_log', 'run_finished', 'run_error',
        'statuses_changed', 'graph_changed', 'files_changed',
        'init_pipeline_started', 'init_step', 'init_pipeline_finished',
        'compile_started', 'compile_finished',
        'docs_generating', 'docs_generated',
        'test_failed',
        'git_status_changed', 'git_started', 'git_log', 'git_finished', 'git_error',
      ];
      types.forEach((type) => {
        es.addEventListener(type, (e: MessageEvent) => {
          try {
            handlerRef.current({ type, data: JSON.parse(e.data) });
          } catch {
            handlerRef.current({ type, data: e.data });
          }
        });
      });

      es.onerror = () => {
        es.close();
        if (!dead) setTimeout(connect, 3000);
      };
    }

    connect();
    return () => {
      dead = true;
      es?.close();
    };
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
