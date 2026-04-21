import { useState } from 'react';
import { Play, Hammer, FlaskConical } from 'lucide-react';
import { api } from '../../../../lib/api';

type RunCommand = 'run' | 'build' | 'test';
type RunMode = 'only' | 'upstream' | 'downstream' | 'full';

interface RunPaneProps {
  projectId: number;
  modelName: string;
  modelUid: string;
}

const RUN_ACTIONS: { cmd: RunCommand; icon: React.ReactNode; label: string }[] = [
  { cmd: 'run',   icon: <Play className="w-4 h-4" />,         label: 'Run' },
  { cmd: 'build', icon: <Hammer className="w-4 h-4" />,       label: 'Build' },
  { cmd: 'test',  icon: <FlaskConical className="w-4 h-4" />, label: 'Test' },
];

const SCOPE_LABELS: Record<RunMode, string> = {
  only: 'Only', upstream: '+ Upstream', downstream: '+ Downstream', full: 'Full',
};

export function RunPane({ projectId, modelName }: RunPaneProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handle = async (cmd: RunCommand, mode: RunMode) => {
    const key = `${cmd}:${mode}`;
    setLoading(key);
    setLastResult(null);
    try {
      await (cmd === 'run'
        ? api.runs.run(projectId, modelName, mode)
        : cmd === 'build'
        ? api.runs.build(projectId, modelName, mode)
        : api.runs.test(projectId, modelName, mode));
      setLastResult(`${cmd} (${mode}) started`);
    } catch (e) {
      setLastResult(`Error: ${String(e)}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="p-4 flex flex-col gap-4 overflow-auto">
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Run actions for: <span className="text-gray-300 normal-case">{modelName}</span></div>

      {RUN_ACTIONS.map(({ cmd, icon, label }) => (
        <div key={cmd} className="flex flex-col gap-1">
          <div className="grid grid-cols-4 gap-1">
            {(['only', 'upstream', 'downstream', 'full'] as RunMode[]).map((mode) => {
              const key = `${cmd}:${mode}`;
              return (
                <button
                  key={mode}
                  title={`${label} ${SCOPE_LABELS[mode]}`}
                  onClick={() => handle(cmd, mode)}
                  disabled={loading !== null}
                  className={`flex items-center justify-center gap-1.5 py-2 px-1 text-xs rounded border transition-colors disabled:opacity-50
                    ${mode === 'only'
                      ? 'bg-surface-elevated border-gray-700 text-gray-200 hover:border-brand-600 hover:text-brand-300'
                      : 'bg-transparent border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300'
                    }`}
                >
                  {loading === key ? (
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                    </svg>
                  ) : (
                    <>
                      {mode === 'only' && icon}
                      <span className="truncate">{mode === 'only' ? label : SCOPE_LABELS[mode]}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {lastResult && (
        <p className={`text-xs mt-2 ${lastResult.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
          {lastResult}
        </p>
      )}
    </div>
  );
}
