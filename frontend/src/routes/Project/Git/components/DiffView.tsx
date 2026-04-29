import { DiffEditor } from '@monaco-editor/react';
import { useTheme } from '../../../../lib/useTheme';
import type { GitFileChange } from '../../../../lib/api';

interface Props {
  original: string;
  modified: string;
  path: string;
  change: GitFileChange | null;
  loading: boolean;
  onOpenInFiles?: (path: string) => void;
}

function languageFor(path: string): string {
  if (path.endsWith('.sql')) return 'sql';
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml';
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.sh')) return 'shell';
  return 'plaintext';
}

export function DiffView({ original, modified, path, change, loading, onOpenInFiles }: Props) {
  const theme = useTheme();
  const monacoTheme = theme === 'light' ? 'vs-light' : 'vs-dark';

  if (!change) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-500">
        Select a file to view its diff
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-500">
        Loading diff…
      </div>
    );
  }

  const isNewFile = change.is_untracked || change.index_status === 'A';

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 bg-surface-panel shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-zinc-400 truncate">{path}</span>
          {isNewFile && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/50 text-emerald-400 font-medium uppercase tracking-wide">
              new file
            </span>
          )}
        </div>
        {onOpenInFiles && (
          <button
            onClick={() => onOpenInFiles(path)}
            className="ml-3 shrink-0 px-2.5 py-1 text-xs rounded bg-brand-900/40 hover:bg-brand-800/60 text-brand-300 border border-brand-800 transition-colors"
          >
            Open in Files
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        <DiffEditor
          original={original}
          modified={modified}
          language={languageFor(path)}
          theme={monacoTheme}
          options={{
            readOnly: true,
            renderSideBySide: true,
            fontSize: 13,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            automaticLayout: true,
            renderLineHighlight: 'all',
            smoothScrolling: true,
            padding: { top: 12 },
            diffWordWrap: 'off',
          }}
        />
      </div>
    </div>
  );
}
