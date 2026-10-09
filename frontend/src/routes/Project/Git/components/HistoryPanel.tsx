import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../lib/api';

interface Props {
  projectId: number;
  selectedPath: string | null;
}

type Scope = 'all' | 'file';

const LOG_LIMIT = 200;

function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

export function HistoryPanel({ projectId, selectedPath }: Props) {
  const [scope, setScope] = useState<Scope>('all');
  const path = scope === 'file' ? selectedPath : null;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['git', 'log', projectId, path],
    queryFn: () => api.git.log(projectId, path ?? undefined, LOG_LIMIT),
    retry: false,
  });

  const entries = data?.entries ?? [];

  return (
    <div className="flex flex-col h-full min-h-0">
      {selectedPath && (
        <div className="flex items-center gap-1 px-3 py-1 shrink-0 border-b border-zinc-800">
          {(['all', 'file'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              title={s === 'file' ? selectedPath : undefined}
              className={`max-w-[60%] truncate px-2 py-0.5 rounded text-[10px] transition-colors ${
                scope === s ? 'bg-brand-900/60 text-brand-300' : 'text-zinc-500 hover:text-gray-300'
              }`}
            >
              {s === 'all' ? 'All' : fileName(selectedPath)}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <p className="flex items-center justify-center h-16 text-xs text-zinc-500">Loading history…</p>
        ) : isError ? (
          <p className="px-3 py-3 text-xs text-red-400 break-all">
            {error instanceof Error ? error.message : 'Failed to load history'}
          </p>
        ) : entries.length === 0 ? (
          <p className="flex items-center justify-center h-16 text-xs text-zinc-500 px-3 text-center">
            {path ? `No commits touching ${fileName(path)}` : 'No commits'}
          </p>
        ) : (
          entries.map((entry) => (
            <div key={entry.hash} className="flex items-start gap-2 px-3 py-1.5 hover:bg-surface-elevated text-xs group">
              <span className="font-mono text-zinc-500 shrink-0 pt-px">{entry.short_hash}</span>
              <div className="flex-1 min-w-0">
                <p className="text-gray-300 truncate" title={entry.message}>{entry.message}</p>
                <p className="text-zinc-500">{entry.author} · {entry.date.split(' ')[0].split('T')[0]}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
