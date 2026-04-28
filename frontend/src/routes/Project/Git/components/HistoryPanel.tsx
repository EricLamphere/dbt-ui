import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../lib/api';

interface Props {
  projectId: number;
  selectedPath: string | null;
}

export function HistoryPanel({ projectId, selectedPath }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['git', 'log', projectId, selectedPath ?? null],
    queryFn: () => api.git.log(projectId, selectedPath ?? undefined, 50),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-16 text-xs text-zinc-500">
        Loading history…
      </div>
    );
  }

  const entries = data?.entries ?? [];

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-16 text-xs text-zinc-500">
        No commits
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      {entries.map((entry) => (
        <div key={entry.hash} className="flex items-start gap-2 px-3 py-1.5 hover:bg-surface-elevated text-xs group">
          <span className="font-mono text-zinc-500 shrink-0 pt-px">{entry.short_hash}</span>
          <div className="flex-1 min-w-0">
            <p className="text-gray-300 truncate">{entry.message}</p>
            <p className="text-zinc-500">{entry.author} · {entry.date.split('T')[0]}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
