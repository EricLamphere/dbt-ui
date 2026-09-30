import { Loader2 } from 'lucide-react';
import { InlineCode } from './fields';

interface Props {
  /** Seconds spent waiting for the backend so far. */
  waitedSecs: number;
}

const SLOW_AFTER_SECS = 8;
const STUCK_AFTER_SECS = 45;

/** Full-app screen shown until the local backend answers its first request. */
export function LoadingScreen({ waitedSecs }: Props) {
  const slow = waitedSecs >= SLOW_AFTER_SECS;
  const stuck = waitedSecs >= STUCK_AFTER_SECS;

  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 p-6 bg-surface-app text-center">
      <span className="text-lg font-semibold text-brand-400">dbt-ui</span>
      <Loader2 className="w-6 h-6 text-brand-400 animate-spin" aria-hidden />
      <p className="text-sm text-gray-300" role="status">
        {stuck ? 'Still waiting for the dbt-ui server…' : 'Getting things ready…'}
      </p>
      {slow && !stuck && (
        <p className="max-w-sm text-xs text-gray-500">
          Starting the local server. This can take a little longer the first time.
        </p>
      )}
      {stuck && (
        <p className="max-w-sm text-xs text-gray-500">
          The server hasn't responded yet. If this doesn't clear up, check that the backend is running
          (<InlineCode>task start</InlineCode>), or quit and reopen dbt-ui.
        </p>
      )}
    </div>
  );
}
