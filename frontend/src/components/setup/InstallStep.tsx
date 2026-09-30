import { GlobalSetupOutput } from '../globalSetup/GlobalSetupOutput';
import { useGlobalSetupRun } from '../globalSetup/useGlobalSetupRun';
import { StepHeading } from './fields';

interface Props {
  installing: string;
  onRetry: () => void;
  onFinish: () => void;
}

/** Final wizard step: runs global setup and streams pip's output. Remount via `key` to retry. */
export function InstallStep({ installing, onRetry, onFinish }: Props) {
  const run = useGlobalSetupRun();
  const { state, returnCode } = run;
  const running = state === 'starting' || state === 'running';

  const skip = async () => {
    await run.cancel();
    onFinish();
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <StepHeading title={running ? 'Installing dbt…' : state === 'done' ? "You're all set" : 'Install failed'}>
        {running && <>Installing {installing} into dbt-ui's environment.</>}
        {state === 'done' && <>dbt is installed. Your settings are saved and can be changed any time in Global Settings.</>}
        {state === 'error' && (
          <>
            pip exited with code {returnCode ?? 1}. Check the output below, fix the requirements if needed, and retry, or
            continue and run global setup later from the home page.
          </>
        )}
      </StepHeading>

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden rounded border border-gray-800">
        <GlobalSetupOutput run={run} />
      </div>

      <div className="flex items-center justify-end gap-2 pt-4">
        {running && (
          <button onClick={skip} className="px-3 py-1.5 text-xs rounded text-gray-400 hover:text-gray-200 transition-colors">
            Skip — install later
          </button>
        )}
        {state === 'error' && (
          <>
            <button onClick={onFinish} className="px-3 py-1.5 text-xs rounded text-gray-400 hover:text-gray-200 transition-colors">
              Continue anyway
            </button>
            <button
              onClick={onRetry}
              className="px-4 py-2 text-sm rounded bg-surface-elevated hover:bg-gray-700 text-gray-200 transition-colors"
            >
              Retry
            </button>
          </>
        )}
        {state === 'done' && (
          <button
            onClick={onFinish}
            className="px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors"
          >
            Open dbt-ui
          </button>
        )}
      </div>
    </div>
  );
}
