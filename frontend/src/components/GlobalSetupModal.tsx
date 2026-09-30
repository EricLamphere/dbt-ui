import { GlobalSetupOutput } from './globalSetup/GlobalSetupOutput';
import { useGlobalSetupRun } from './globalSetup/useGlobalSetupRun';

interface Props {
  onClose: () => void;
}

export function GlobalSetupModal({ onClose }: Props) {
  const run = useGlobalSetupRun();
  const { state, returnCode } = run;

  const handleCancel = async () => {
    await run.cancel();
    onClose();
  };

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

        <GlobalSetupOutput run={run} />

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
              className="px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
