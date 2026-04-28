import { DiffEditor } from '@monaco-editor/react';
import { useTheme } from '../../../../lib/useTheme';
import type { GitFileChange } from '../../../../lib/api';

interface Props {
  original: string;
  modified: string;
  path: string;
  change: GitFileChange | null;
  loading: boolean;
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

export function DiffView({ original, modified, path, change, loading }: Props) {
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

  return (
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
  );
}
