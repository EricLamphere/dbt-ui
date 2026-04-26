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

const ADAPTER_PACKAGES: Record<string, string> = {
  postgres: 'dbt-postgres',
  duckdb: 'dbt-duckdb',
  bigquery: 'dbt-bigquery',
  snowflake: 'dbt-snowflake',
  redshift: 'dbt-redshift',
  databricks: 'dbt-databricks',
  spark: 'dbt-spark',
  trino: 'dbt-trino',
  athena: 'dbt-athena-community',
  clickhouse: 'dbt-clickhouse',
};

type Step = 'pick-platform' | 'check-adapter' | 'terminal';

type AdapterCheckState =
  | { status: 'loading' }
  | { status: 'installed'; version: string }
  | { status: 'not-installed'; requirementLine: string };

export default function NewProjectModal({ onClose }: Props) {
  const [step, setStep] = useState<Step>('pick-platform');
  const [platform, setPlatform] = useState('');
  const [adapterCheck, setAdapterCheck] = useState<AdapterCheckState>({ status: 'loading' });
  const [skipInstall, setSkipInstall] = useState(false);

  const termRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [returnCode, setReturnCode] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  // Check adapter when entering check-adapter step
  useEffect(() => {
    if (step !== 'check-adapter' || !platform) return;
    const pkg = ADAPTER_PACKAGES[platform] ?? `dbt-${platform}`;
    setAdapterCheck({ status: 'loading' });
    api.init.checkPackage(pkg).then((info) => {
      if (info.installed_version) {
        setAdapterCheck({ status: 'installed', version: info.installed_version });
      } else {
        setAdapterCheck({ status: 'not-installed', requirementLine: pkg });
      }
    }).catch(() => {
      setAdapterCheck({ status: 'not-installed', requirementLine: ADAPTER_PACKAGES[platform] ?? `dbt-${platform}` });
    });
  }, [step, platform]);

  // Mount terminal only once we're in the terminal step
  useEffect(() => {
    if (step !== 'terminal') return;
    let cancelled = false;

    const isDark = document.documentElement.dataset.theme !== 'light';
    const term = new Terminal({
      theme: isDark ? {
        background: '#030712',
        foreground: '#e5e7eb',
        cursor: '#a78bfa',
        selectionBackground: '#374151',
      } : {
        background: '#ffffff',
        foreground: '#1e293b',
        cursor: '#0f766e',
        selectionBackground: '#cbd5e1aa',
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

    api.init.startSession(platform, undefined, skipInstall)
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
  }, [step, platform, skipInstall]);

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
    const projects = await api.projects.rescan().catch(() => []);
    await Promise.all(projects.map((p) => api.projects.ensureProfilesYml(p.id).catch(() => {})));
    onClose();
  };

  const handlePlatformSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!platform) return;
    setStep('check-adapter');
  };

  const handleProceedInstallLatest = () => {
    setSkipInstall(false);
    setStep('terminal');
  };

  const handleProceedSkipInstall = () => {
    setSkipInstall(true);
    setStep('terminal');
  };

  const pkg = platform ? (ADAPTER_PACKAGES[platform] ?? `dbt-${platform}`) : '';

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
              {step === 'pick-platform' && 'Choose your data platform'}
              {step === 'check-adapter' && `Checking for ${pkg}`}
              {step === 'terminal' && <>Installing adapter &amp; running <code className="font-mono">dbt init</code></>}
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
                      ? 'border-brand-500 bg-brand-950/60 text-white'
                      : 'border-gray-700 bg-gray-800 hover:border-gray-600 text-gray-300'}`}
                >
                  <span className="text-base">{p.icon}</span>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>

            {platform && (
              <p className="text-xs text-gray-500">
                Will check for <code className="font-mono text-gray-400">{pkg}</code> then run <code className="font-mono text-gray-400">dbt init</code>
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!platform}
                className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors disabled:opacity-40"
              >
                Continue →
              </button>
            </div>
          </form>
        )}

        {/* Step 2 — adapter check */}
        {step === 'check-adapter' && (
          <div className="p-6 flex flex-col gap-5">
            {adapterCheck.status === 'loading' && (
              <p className="text-sm text-gray-400">Checking for <code className="font-mono">{pkg}</code>…</p>
            )}

            {adapterCheck.status === 'installed' && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 px-4 py-3 bg-emerald-950/40 border border-emerald-800/60 rounded-lg">
                  <span className="text-emerald-400 text-sm">✓</span>
                  <p className="text-sm text-emerald-300">
                    Using installed <code className="font-mono">{pkg}</code> {adapterCheck.version}
                  </p>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={handleProceedSkipInstall}
                    className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors"
                  >
                    Continue →
                  </button>
                </div>
              </div>
            )}

            {adapterCheck.status === 'not-installed' && (
              <AdapterNotInstalled
                pkg={pkg}
                requirementLine={adapterCheck.requirementLine}
                onInstallLatest={handleProceedInstallLatest}
                onAddToRequirements={async (line) => {
                  try {
                    await api.init.appendRequirement(line);
                  } catch {
                    // proceed anyway — user can fix requirements file manually
                  }
                  setSkipInstall(false);
                  setStep('terminal');
                }}
              />
            )}
          </div>
        )}

        {/* Step 3 — terminal */}
        {step === 'terminal' && (
          <>
            <div className="flex-1 min-h-0 bg-surface-panel p-1">
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
                  className="px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white transition-colors"
                >
                  Continue →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface AdapterNotInstalledProps {
  pkg: string;
  requirementLine: string;
  onInstallLatest: () => void;
  onAddToRequirements: (line: string) => Promise<void>;
}

function AdapterNotInstalled({ pkg, requirementLine, onInstallLatest, onAddToRequirements }: AdapterNotInstalledProps) {
  const [editedLine, setEditedLine] = useState(requirementLine);
  const [addMode, setAddMode] = useState(false);
  const [adding, setAdding] = useState(false);

  if (addMode) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-300">
          Add <code className="font-mono">{pkg}</code> to your requirements file. Edit the version pin if needed:
        </p>
        <input
          type="text"
          value={editedLine}
          onChange={(e) => setEditedLine(e.target.value)}
          className="bg-surface-elevated border border-gray-700 rounded px-3 py-2 text-sm font-mono text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
          placeholder="e.g. dbt-athena-community==1.9.4"
        />
        <div className="flex items-center justify-between">
          <button
            onClick={() => setAddMode(false)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            ← Back
          </button>
          <button
            disabled={!editedLine.trim() || adding}
            onClick={async () => {
              setAdding(true);
              await onAddToRequirements(editedLine.trim());
            }}
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors disabled:opacity-40"
          >
            {adding ? 'Adding…' : 'Add & install →'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-300">
        <code className="font-mono">{pkg}</code> is not installed. How would you like to proceed?
      </p>
      <div className="flex flex-col gap-2">
        <button
          onClick={() => setAddMode(true)}
          className="flex flex-col gap-0.5 px-4 py-3 rounded-lg border border-gray-700 bg-gray-800 hover:border-brand-600 hover:bg-brand-950/30 text-left transition-colors"
        >
          <span className="text-sm font-medium text-gray-100">Add to requirements file</span>
          <span className="text-xs text-gray-500">Appends a line to your global requirements.txt, then installs</span>
        </button>
        <button
          onClick={onInstallLatest}
          className="flex flex-col gap-0.5 px-4 py-3 rounded-lg border border-gray-700 bg-gray-800 hover:border-brand-600 hover:bg-brand-950/30 text-left transition-colors"
        >
          <span className="text-sm font-medium text-gray-100">Install latest version</span>
          <span className="text-xs text-gray-500">Installs the latest <code className="font-mono">{pkg}</code> without version pinning</span>
        </button>
      </div>
    </div>
  );
}
