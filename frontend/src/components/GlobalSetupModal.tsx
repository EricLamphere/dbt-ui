import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface Props {
  onClose: () => void;
}

type SetupState = 'starting' | 'running' | 'done' | 'error';

export function GlobalSetupModal({ onClose }: Props) {
  const [state, setState] = useState<SetupState>('starting');
  const [lines, setLines] = useState<string[]>([]);
  const [returnCode, setReturnCode] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Open SSE connection first, then trigger the setup
    const es = new EventSource('/api/init/global-setup/events');
    esRef.current = es;

    es.addEventListener('global_setup_started', () => {
      setState('running');
    });

    es.addEventListener('global_setup_output', (e) => {
      const data = JSON.parse(e.data) as { data: string };
      setLines((prev) => [...prev, data.data]);
    });

    es.addEventListener('global_setup_finished', (e) => {
      const data = JSON.parse(e.data) as { return_code: number };
      setReturnCode(data.return_code);
      setState(data.return_code === 0 ? 'done' : 'error');
      es.close();
    });

    es.onerror = () => {
      // SSE connection error — if still starting, show error
      setState((prev) => (prev === 'starting' ? 'error' : prev));
    };

    api.init.runGlobalSetup().catch((e) => {
      setStartError(String(e));
      setState('error');
      es.close();
    });

    return () => {
      es.close();
    };
  }, []);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  const outputText = lines.join('');

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
            <button
              onClick={onClose}
              disabled={state === 'running' || state === 'starting'}
              className="px-2 py-1.5 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {state === 'done' || state === 'error' ? '✕ Close' : 'Running…'}
            </button>
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

        {/* Footer */}
        {(state === 'done' || state === 'error') && (
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
