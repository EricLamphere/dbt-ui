import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, History, SquareTerminal } from 'lucide-react';
import { loadCommandHistory, normalizeCommand, runCustomCommand } from '../lib/customCommand';

interface CustomCommandModeProps {
  projectId: number;
  initialCommand: string;
  /** Submit `initialCommand` immediately on mount (used when typed as "dbt …" in search). */
  autoSubmit: boolean;
  onBack: () => void;
  onDone: () => void;
}

/** Command palette mode: free-form `dbt <command>` input with recent-command recall. */
export function CustomCommandMode({ projectId, initialCommand, autoSubmit, onBack, onDone }: CustomCommandModeProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [command, setCommand] = useState(initialCommand);
  // What the user typed; arrow-key recall changes `command` but not the filter.
  const [filterText, setFilterText] = useState(initialCommand);
  const autoSubmitted = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const history = useMemo(() => loadCommandHistory(projectId), [projectId]);

  const suggestions = useMemo(() => {
    const q = normalizeCommand(filterText).toLowerCase();
    return q ? history.filter((c) => c.toLowerCase().includes(q)) : history;
  }, [history, filterText]);

  const submit = async (value: string) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const err = await runCustomCommand(projectId, value);
    setSubmitting(false);
    if (err) {
      setError(err);
      inputRef.current?.focus();
    } else {
      onDone();
    }
  };

  useEffect(() => {
    inputRef.current?.focus();
    if (autoSubmit && !autoSubmitted.current) {
      autoSubmitted.current = true;
      submit(initialCommand);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (index: number) => {
    setSelectedIndex(index);
    if (index >= 0) setCommand(suggestions[index]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit(command);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      select(Math.min(selectedIndex + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      select(Math.max(selectedIndex - 1, -1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onBack();
    } else if (e.key === 'Backspace' && command === '') {
      e.preventDefault();
      onBack();
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 shrink-0">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-300 shrink-0" title="Back to commands">
          <ArrowLeft size={14} />
        </button>
        <span className="text-sm text-brand-400 font-mono shrink-0">dbt</span>
        <input
          ref={inputRef}
          value={command}
          onChange={(e) => {
            setCommand(e.target.value);
            setFilterText(e.target.value);
            setSelectedIndex(-1);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          disabled={submitting}
          placeholder="run --select my_model+ --full-refresh"
          spellCheck={false}
          className="flex-1 bg-transparent text-sm text-gray-100 font-mono placeholder-gray-600 focus:outline-none disabled:opacity-60"
        />
        <kbd className="text-[10px] text-gray-600 border border-gray-700 rounded px-1.5 py-0.5 shrink-0">↵ run</kbd>
      </div>

      {error && (
        <div className="px-4 py-2 border-b border-gray-800 bg-red-950/30 text-xs text-red-400 shrink-0">{error}</div>
      )}

      <div className="overflow-y-auto flex-1">
        {suggestions.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-4 text-xs text-gray-600">
            <SquareTerminal size={14} className="shrink-0" />
            Runs in the project directory with the active profile and target. Output streams to the Run panel.
          </div>
        ) : (
          <>
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-gray-600 font-semibold border-b border-gray-800/50">
              Recent
            </div>
            {suggestions.map((cmd, i) => (
              <button
                key={cmd}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => submit(cmd)}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                  i === selectedIndex ? 'bg-brand-900/40 text-brand-300' : 'text-gray-300 hover:bg-surface-elevated'
                }`}
              >
                <History size={14} className="shrink-0 text-gray-500" />
                <span className="text-sm font-mono truncate">dbt {cmd}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </>
  );
}
