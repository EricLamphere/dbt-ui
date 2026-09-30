import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, RefreshCw } from 'lucide-react';
import { api, type PythonInterpreterDto, type SettingsDto } from '../lib/api';
import { GlobalSetupModal } from './GlobalSetupModal';

const LABEL = 'DBT_UI_PYTHON_PATH';

function optionLabel(p: PythonInterpreterDto): string {
  return `Python ${p.version} — ${p.path}`;
}

/** DBT_UI_PYTHON_PATH row: pick which installed Python the dbt venv is built from. */
export function PythonInterpreterRow({ appSettings }: { appSettings: SettingsDto }) {
  const qc = useQueryClient();
  const editable = appSettings.python_path_editable;
  const current = appSettings.python_path;

  const { data: interpreters, isFetching, error } = useQuery({
    queryKey: ['python-interpreters'],
    queryFn: () => api.settings.pythonInterpreters(),
    enabled: editable,
  });

  const [switching, setSwitching] = useState(false);
  const [rebuiltWith, setRebuiltWith] = useState<PythonInterpreterDto | null>(null);
  const [globalSetupOpen, setGlobalSetupOpen] = useState(false);

  const handleSelect = async (path: string) => {
    const choice = interpreters?.find((p) => p.path === path);
    if (!choice || path === current) return;
    const ok = confirm(
      `Switch dbt to Python ${choice.version}?\n\n` +
        "This rebuilds dbt's environment from scratch — dbt-core and your adapters " +
        'will need to be reinstalled with Run global setup.',
    );
    if (!ok) return;
    setSwitching(true);
    try {
      await api.settings.update({ python_path: path });
      qc.invalidateQueries({ queryKey: ['app-settings'] });
      qc.invalidateQueries({ queryKey: ['python-interpreters'] });
      qc.invalidateQueries({ queryKey: ['dbt-core-status'] });
      setRebuiltWith(choice);
    } catch (e) {
      alert(String(e));
    } finally {
      setSwitching(false);
    }
  };

  const currentListed = !current || interpreters?.some((p) => p.path === current);

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-elevated rounded border border-gray-800 text-xs">
        <div className="w-60 shrink-0">
          <span className="block font-mono text-brand-300 truncate">{LABEL}</span>
          <span className="text-gray-600 italic">
            {editable
              ? 'Python that dbt runs on; switching rebuilds the dbt environment'
              : "dbt shares dbt-ui's own venv (DBT_UI_DBT_VENV_DIR) — can't switch"}
          </span>
        </div>
        <span className="text-gray-600">=</span>
        {!editable ? (
          <span className="flex flex-1 items-center gap-1.5 font-mono text-gray-300 opacity-60 truncate">
            <Lock className="w-3 h-3 shrink-0" />
            {current ?? <span className="text-gray-600 italic">e.g. /opt/homebrew/bin/python3.12</span>}
          </span>
        ) : (
          <>
            <select
              value={current ?? ''}
              disabled={switching || !interpreters}
              onChange={(e) => handleSelect(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1 bg-surface-panel border border-gray-700 rounded font-mono text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
            >
              {!interpreters && <option value={current ?? ''}>{current ?? 'Scanning for Python installs…'}</option>}
              {interpreters && !current && <option value="" disabled>Select a Python interpreter…</option>}
              {interpreters && !currentListed && current && (
                <option value={current} disabled>{`${current} (not found)`}</option>
              )}
              {interpreters?.map((p) => (
                <option key={p.path} value={p.path}>{optionLabel(p)}</option>
              ))}
            </select>
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ['python-interpreters'] })}
              disabled={isFetching || switching}
              title="Rescan for Python installs"
              className="p-1 text-gray-500 hover:text-gray-300 disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            </button>
          </>
        )}
      </div>

      {switching && <p className="px-3 text-xs text-gray-500 italic">Rebuilding dbt's environment…</p>}
      {error && <p className="px-3 text-xs text-red-400">Couldn't scan for Python installs: {String(error)}</p>}
      {interpreters && interpreters.length === 0 && (
        <p className="px-3 text-xs text-amber-300">
          No Python 3.11+ found. Install one (e.g. from python.org or Homebrew), then click rescan.
        </p>
      )}
      {rebuiltWith && (
        <div className="flex items-center gap-3 px-3 py-2 rounded border border-amber-700/50 bg-amber-900/20 text-xs text-amber-200">
          <span className="flex-1">
            dbt's environment was rebuilt with Python {rebuiltWith.version}. Run global setup to reinstall dbt and its
            adapters, then re-open any project that uses its own REQUIREMENTS_PATH.
          </span>
          <button
            onClick={() => setGlobalSetupOpen(true)}
            className="px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-500 text-white font-medium shrink-0 transition-colors"
          >
            Run global setup
          </button>
        </div>
      )}
      {globalSetupOpen && (
        <GlobalSetupModal onClose={() => { setGlobalSetupOpen(false); setRebuiltWith(null); }} />
      )}
    </>
  );
}
