import { useCallback, useRef, useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import { useProjectEvents } from '../../../lib/sse';
import { loadCommandHistory, runCustomCommand } from '../lib/customCommand';

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
    </svg>
  );
}

/** Free-form `dbt <command>` input for the project homepage's Quick Run card. */
export function DbtCommandRow({ projectId }: { projectId: number }) {
  const [command, setCommand] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // -1 = editing a fresh command; otherwise an index into the recalled history.
  const historyIndex = useRef(-1);

  useProjectEvents(projectId, useCallback((event) => {
    if (event.type === 'run_finished' || event.type === 'run_error') setRunning(false);
  }, []));

  const submit = async () => {
    if (running) return;
    setError(null);
    setRunning(true);
    const err = await runCustomCommand(projectId, command);
    historyIndex.current = -1;
    if (err) {
      setError(err);
      setRunning(false);
    }
  };

  const recall = (direction: 1 | -1) => {
    const history = loadCommandHistory(projectId);
    const next = Math.max(-1, Math.min(historyIndex.current + direction, history.length - 1));
    historyIndex.current = next;
    setCommand(next === -1 ? '' : history[next]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      recall(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      recall(-1);
    }
  };

  return (
    <div className="border-t border-gray-800 px-5 py-4">
      <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-3">dbt Command</div>
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-surface-elevated border border-gray-700 rounded focus-within:border-gray-500 transition-colors">
          <span className="text-xs text-brand-400 font-mono shrink-0">dbt</span>
          <input
            type="text"
            value={command}
            onChange={(e) => {
              setCommand(e.target.value);
              setError(null);
              historyIndex.current = -1;
            }}
            onKeyDown={handleKeyDown}
            placeholder="ls --select my_model+   (↑ for recent)"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent text-xs text-gray-200 font-mono placeholder-gray-600 focus:outline-none"
          />
        </div>
        <button
          onClick={submit}
          disabled={running || !command.trim()}
          className="flex items-center gap-1.5 px-3 py-2 rounded text-xs font-medium border border-brand-700 text-brand-400 hover:bg-brand-900/30 hover:border-brand-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? <Spinner /> : <SquareTerminal className="w-3.5 h-3.5" />}
          Run
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
