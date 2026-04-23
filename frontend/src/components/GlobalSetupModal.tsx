import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface Props {
  onClose: () => void;
}

type SetupState = 'starting' | 'running' | 'done' | 'error';

export function GlobalSetupModal({ onClose }: Props) {
  const [state, setState] = useState<SetupState>('starting');
  const [lines, setLines] = useState<string[]>([]);
  const [silentSecs, setSilentSecs] = useState(0);
  const [returnCode, setReturnCode] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const stateRef = useRef<SetupState>('starting');
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

  // Tick silent-seconds counter while running so user sees "still working"
  useEffect(() => {
    if (state !== 'running') return;
    const id = setInterval(() => {
      setSilentSecs(Math.round((Date.now() - lastOutputRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [state]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // Only show the "still working" banner after 8s of silence so it doesn't flash on fast installs
  const showWaiting = state === 'running' && silentSecs >= 8;

  const handleCancel = async () => {
    esRef.current?.close();
    try {
      await api.init.cancelGlobalSetup();
    } catch {
      // best-effort
    }
    onClose();
  };

  const outputText = lines.join('');
  const isFinished = state === 'done' || state === 'error';
  const isRunning = state === 'running' || state === 'starting';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="flex flex-col w-[90vw] max-w-2xl bg-gray-900 rounded-xl shadow-2xl border border-gray-700 overflow-hidden" style={{ maxHeight: '70vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">Run global setup</h2>
            <p className="text-[10px] text-gray-500">
              {state === 'starting' && 'Starting…'}
              {state === 'running' && 'Installing requirements…'}
              {state === 'done' && 'Done'}
              {state === 'error' && 'Failed'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {state === 'done' && <span className="text-xs text-emerald-400">Done ✓</span>}
            {state === 'error' && <span className="text-xs text-red-400">Failed</span>}
            {isRunning && (
              <button
                onClick={handleCancel}
                className="px-2 py-1.5 text-xs rounded bg-gray-800 hover:bg-red-900 text-gray-400 hover:text-red-300 transition-colors"
              >
                Cancel
              </button>
            )}
            {isFinished && (
              <button
                onClick={onClose}
                className="px-2 py-1.5 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
              >
                ✕ Close
              </button>
            )}
          </div>
        </div>

        {/* Output */}
        <pre
          ref={outputRef}
          className="flex-1 min-h-0 overflow-auto p-4 text-xs font-mono text-gray-300 bg-gray-950 whitespace-pre-wrap"
        >
          {startError
            ? <span className="text-red-400">Error: {startError}</span>
            : outputText || <span className="text-gray-600">Waiting for output…</span>
          }
        </pre>
        {showWaiting && (
          <div className="px-4 py-2 bg-gray-900 border-t border-gray-800 shrink-0 flex items-center gap-2">
            <span className="text-yellow-500 animate-pulse text-xs">●</span>
            <span className="text-xs text-gray-400">
              Still installing… ({silentSecs}s without output — pip is writing files to disk)
            </span>
          </div>
        )}

        {/* Footer */}
        {isFinished && (
          <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between shrink-0">
            <span className={`text-xs ${state === 'done' ? 'text-emerald-400' : 'text-red-400'}`}>
              {state === 'done'
                ? '✓ Requirements installed successfully.'
                : `Failed (exit code ${returnCode ?? 1}). Check output above.`}
            </span>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
