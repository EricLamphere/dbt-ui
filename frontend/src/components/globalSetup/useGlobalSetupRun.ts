import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export type GlobalSetupState = 'starting' | 'running' | 'done' | 'error';

export interface GlobalSetupRun {
  state: GlobalSetupState;
  outputText: string;
  startError: string | null;
  returnCode: number | null;
  /** True after 15s without output while running (pip can go quiet writing large wheels). */
  showWaiting: boolean;
  cancel: () => Promise<void>;
}

/**
 * Starts global setup on mount and streams its output. Remount (e.g. via `key`) to retry.
 * SSE is the primary signal; the status endpoint is polled every 3s as a backstop for a
 * missed `global_setup_finished` event.
 */
export function useGlobalSetupRun(): GlobalSetupRun {
  const qc = useQueryClient();
  const [state, setState] = useState<GlobalSetupState>('starting');
  const [lines, setLines] = useState<string[]>([]);
  const [silentSecs, setSilentSecs] = useState(0);
  const [returnCode, setReturnCode] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const stateRef = useRef<GlobalSetupState>('starting');
  const startedRef = useRef(false);
  const lastOutputRef = useRef(Date.now());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const es = new EventSource('/api/init/global-setup/events');
    esRef.current = es;

    es.addEventListener('global_setup_started', () => {
      setState('running');
    });

    es.addEventListener('global_setup_output', (e) => {
      const data = JSON.parse(e.data) as { data: string };
      // Heartbeat dots from the backend — don't add to log, just reset the timer
      if (data.data === '.') {
        lastOutputRef.current = Date.now();
        return;
      }
      lastOutputRef.current = Date.now();
      setSilentSecs(0);
      setLines((prev) => [...prev, data.data]);
    });

    es.addEventListener('global_setup_finished', (e) => {
      const data = JSON.parse(e.data) as { return_code: number };
      setReturnCode(data.return_code);
      setSilentSecs(0);
      setState(data.return_code === 0 ? 'done' : 'error');
      if (data.return_code === 0) {
        qc.invalidateQueries({ queryKey: ['dbt-core-status'] });
      }
      es.close();
    });

    es.onerror = () => {
      // Only surface the error if we haven't received any events yet.
      // Mid-run disconnects are normal — the browser will auto-reconnect.
      if (stateRef.current === 'starting') {
        setState('error');
        es.close();
      }
    };

    if (!startedRef.current) {
      startedRef.current = true;
      api.init.runGlobalSetup().catch((e) => {
        setStartError(String(e));
        setState('error');
        es.close();
      });
    }

    return () => {
      es.close();
    };
  }, []);

  useEffect(() => {
    if (state !== 'running') return;
    const id = setInterval(async () => {
      setSilentSecs(Math.round((Date.now() - lastOutputRef.current) / 1000));
      try {
        const status = await api.init.globalSetupStatus();
        if (!status.running && status.return_code !== null && stateRef.current === 'running') {
          setReturnCode(status.return_code);
          setSilentSecs(0);
          setState(status.return_code === 0 ? 'done' : 'error');
          if (status.return_code === 0) {
            qc.invalidateQueries({ queryKey: ['dbt-core-status'] });
          }
        }
      } catch {
        // best-effort — SSE is the primary signal
      }
    }, 3000);
    return () => clearInterval(id);
  }, [state]);

  const cancel = async () => {
    esRef.current?.close();
    try {
      await api.init.cancelGlobalSetup();
    } catch {
      // best-effort
    }
  };

  return {
    state,
    outputText: lines.join(''),
    startError,
    returnCode,
    showWaiting: state === 'running' && silentSecs >= 15,
    cancel,
  };
}
