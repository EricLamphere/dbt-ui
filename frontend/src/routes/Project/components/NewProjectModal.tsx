import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { api } from '../../../lib/api';
import { useInitSessionEvents } from '../../../lib/sse';

interface Props {
  onClose: (newProjectId?: number) => void;
}

const PLATFORMS = [
  { value: 'postgres',    label: 'PostgreSQL',  icon: '🐘' },
  { value: 'duckdb',      label: 'DuckDB',       icon: '🦆' },
  { value: 'bigquery',    label: 'BigQuery',     icon: '☁️' },
  { value: 'snowflake',   label: 'Snowflake',    icon: '❄️' },
  { value: 'redshift',    label: 'Redshift',     icon: '⬡' },
  { value: 'databricks',  label: 'Databricks',   icon: '🧱' },
  { value: 'spark',       label: 'Spark',        icon: '⚡' },
  { value: 'trino',       label: 'Trino',        icon: '🔷' },
  { value: 'athena',      label: 'Athena',       icon: '🏺' },
  { value: 'clickhouse',  label: 'ClickHouse',   icon: '🔴' },
];

type Step = 'pick-platform' | 'terminal';

export default function NewProjectModal({ onClose }: Props) {
  const [step, setStep] = useState<Step>('pick-platform');
  const [platform, setPlatform] = useState('');

  const termRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [returnCode, setReturnCode] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  // Mount terminal only once we're in the terminal step
  useEffect(() => {
    if (step !== 'terminal') return;
    let cancelled = false;

    const term = new Terminal({
      theme: {
        background: '#030712',
        foreground: '#e5e7eb',
        cursor: '#6366f1',
        selectionBackground: '#374151',
      },
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      convertEol: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);

    if (termRef.current) {
      term.open(termRef.current);
      requestAnimationFrame(() => {
        fit.fit();
        term.focus();
      });
    }

    termInstance.current = term;

    const ro = new ResizeObserver(() => fit.fit());
    if (termRef.current) ro.observe(termRef.current);

    term.writeln('\x1b[2mStarting…\x1b[0m');

    api.init.startSession(platform)
      .then(({ session_id }) => {
        if (cancelled) {
          api.init.stopSession(session_id).catch(() => {});
          return;
        }
        sessionIdRef.current = session_id;
        setSessionId(session_id);
      })
      .catch((e) => {
        if (!cancelled) {
          term.writeln(`\x1b[31mFailed to start session: ${e}\x1b[0m`);
          setStartError(String(e));
        }
      });

    return () => {
      cancelled = true;
      ro.disconnect();
      term.dispose();
    };
  }, [step, platform]);

  useEffect(() => {
    const term = termInstance.current;
    if (!term || !sessionId) return;
    const dispose = term.onData((data) => {
      api.init.sendInput(sessionId, data).catch(() => {});
    });
    return () => dispose.dispose();
  }, [sessionId]);

  useInitSessionEvents(sessionId, (event) => {
    if (event.type === 'init_output') {
      const d = event.data as { data: string };
      termInstance.current?.write(d.data);
    }
    if (event.type === 'init_finished') {
      const d = event.data as { return_code: number };
      setFinished(true);
      setReturnCode(d.return_code);
    }
  });

  const handleClose = () => {
    const sid = sessionIdRef.current;
    if (sid) api.init.stopSession(sid).catch(() => {});
    onClose();
  };

  const handleDone = async () => {
    const sid = sessionIdRef.current;
    if (sid) api.init.stopSession(sid).catch(() => {});
    await api.projects.rescan().catch(() => {});
    onClose();
  };

  const handlePlatformSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!platform) return;
    setStep('terminal');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="flex flex-col w-[90vw] max-w-3xl bg-gray-900 rounded-xl shadow-2xl border border-gray-700 overflow-hidden"
        style={{ height: step === 'terminal' ? '70vh' : 'auto' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">New dbt project</h2>
            <p className="text-[10px] text-gray-500">
              {step === 'pick-platform'
                ? 'Choose your data platform'
                : <>Installing adapter &amp; running <code className="font-mono">dbt init</code></>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {finished && returnCode === 0 && (
              <span className="text-xs text-emerald-400">Done ✓</span>
            )}
            {startError && <span className="text-xs text-red-400">Error — see terminal</span>}
            <button
              onClick={handleClose}
              className="px-2 py-1.5 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* Step 1 — platform picker */}
        {step === 'pick-platform' && (
          <form onSubmit={handlePlatformSubmit} className="p-6 flex flex-col gap-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPlatform(p.value)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-colors text-left
                    ${platform === p.value
                      ? 'border-indigo-500 bg-indigo-950/60 text-white'
                      : 'border-gray-700 bg-gray-800 hover:border-gray-600 text-gray-300'}`}
                >
                  <span className="text-base">{p.icon}</span>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>

            {platform && (
              <p className="text-xs text-gray-500">
                Will install <code className="font-mono text-gray-400">dbt-{platform === 'athena' ? 'athena-community' : platform}</code> then run <code className="font-mono text-gray-400">dbt init</code>
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!platform}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors disabled:opacity-40"
              >
                Continue →
              </button>
            </div>
          </form>
        )}

        {/* Step 2 — terminal */}
        {step === 'terminal' && (
          <>
            <div className="flex-1 min-h-0 bg-[#030712] p-1">
              <div ref={termRef} className="w-full h-full" />
            </div>

            {finished && (
              <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between bg-gray-900 shrink-0">
                <span className={`text-xs ${returnCode === 0 ? 'text-emerald-400' : 'text-gray-400'}`}>
                  {returnCode === 0
                    ? '✓ Project created.'
                    : 'Process exited. Close to rescan if the project was created.'}
                </span>
                <button
                  onClick={returnCode === 0 ? handleDone : handleClose}
                  className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                >
                  Done
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
