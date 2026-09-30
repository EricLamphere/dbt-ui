import { useEffect, useRef } from 'react';
import type { GlobalSetupRun } from './useGlobalSetupRun';

/** Auto-scrolling pip output for a global setup run, plus the "still installing" notice. */
export function GlobalSetupOutput({ run, className = '' }: { run: GlobalSetupRun; className?: string }) {
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [run.outputText]);

  return (
    <>
      <pre
        ref={outputRef}
        className={`flex-1 min-h-0 overflow-auto p-4 text-xs font-mono text-gray-300 bg-gray-950 whitespace-pre-wrap ${className}`}
      >
        {run.startError
          ? <span className="text-red-400">Error: {run.startError}</span>
          : run.outputText || <span className="text-gray-600">Waiting for output…</span>
        }
      </pre>
      {run.showWaiting && (
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 border-t border-gray-800 shrink-0">
          <span className="text-xs text-yellow-500 animate-pulse">●</span>
          <span className="text-xs text-gray-400">
            Still installing… pip may be writing files to disk. This is normal for large requirement sets and can take several minutes.
          </span>
        </div>
      )}
    </>
  );
}
