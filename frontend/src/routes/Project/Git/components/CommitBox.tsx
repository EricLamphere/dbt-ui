import { useRef, useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../../../../lib/api';

interface Props {
  projectId: number;
  stagedCount: number;
  currentBranch: string | null;
  ahead: number;
  behind: number;
  onBranchClick: () => void;
  syncOutput: string[];
  syncing: boolean;
}

export function CommitBox({
  projectId,
  stagedCount,
  currentBranch,
  ahead,
  behind,
  onBranchClick,
  syncOutput,
  syncing,
}: Props) {
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const [commitError, setCommitError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const commitMutation = useMutation({
    mutationFn: () => api.git.commit(projectId, message.trim()),
    onSuccess: () => {
      setMessage('');
      setCommitError('');
      qc.invalidateQueries({ queryKey: ['git', 'status', projectId] });
    },
    onError: (err: Error) => {
      setCommitError(err.message);
    },
  });

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (message.trim() && stagedCount > 0) commitMutation.mutate();
    }
  }

  const canCommit = message.trim().length > 0 && stagedCount > 0 && !commitMutation.isPending;

  return (
    <div className="flex flex-col gap-2 p-3 border-t border-zinc-800">
      {/* Branch chip + sync */}
      <div className="flex items-center gap-2">
        <button
          onClick={onBranchClick}
          className="flex items-center gap-1.5 px-2 py-1 bg-surface-elevated rounded text-xs text-gray-300 hover:bg-zinc-700 border border-zinc-700"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 5v7m0 0l-3-3m3 3l3-3M6 19a2 2 0 100-4 2 2 0 000 4zm12 0a2 2 0 100-4 2 2 0 000 4zM6 7a2 2 0 100-4 2 2 0 000 4z" />
          </svg>
          <span className="max-w-[140px] truncate">{currentBranch ?? 'detached HEAD'}</span>
          {(ahead > 0 || behind > 0) && (
            <span className="text-zinc-400">
              {ahead > 0 && `↑${ahead}`}{behind > 0 && `↓${behind}`}
            </span>
          )}
        </button>

        <div className="flex-1" />

        <button
          onClick={() => {
            // push/pull handled at parent via SSE — just trigger
            if (behind > 0) {
              fetch(`/api/projects/${projectId}/git/pull`, { method: 'POST' });
            } else {
              fetch(`/api/projects/${projectId}/git/push`, { method: 'POST' });
            }
          }}
          disabled={syncing}
          title={behind > 0 ? 'Pull' : 'Push'}
          className="p-1 rounded hover:bg-surface-elevated text-zinc-400 hover:text-gray-200 disabled:opacity-40"
        >
          {behind > 0 ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          )}
        </button>
      </div>

      {/* SSE sync output */}
      {syncOutput.length > 0 && (
        <div className="bg-surface-panel rounded p-2 text-xs font-mono text-gray-300 max-h-24 overflow-y-auto">
          {syncOutput.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {/* Commit message */}
      <textarea
        ref={textareaRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={stagedCount > 0 ? 'Message (⌘↵ to commit)' : 'Stage changes to commit'}
        rows={3}
        className="w-full bg-surface-elevated border border-zinc-700 rounded px-2 py-1.5 text-sm text-gray-200
          placeholder-zinc-600 focus:outline-none focus:border-brand-500 resize-none"
      />

      {commitError && (
        <p className="text-xs text-red-400 truncate" title={commitError}>
          {commitError}
        </p>
      )}

      <button
        onClick={() => commitMutation.mutate()}
        disabled={!canCommit}
        className="w-full py-1.5 rounded text-sm font-medium
          bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed
          text-white transition-colors"
      >
        {commitMutation.isPending
          ? 'Committing…'
          : stagedCount > 0
          ? `Commit ${stagedCount} file${stagedCount !== 1 ? 's' : ''}`
          : 'Commit'}
      </button>
    </div>
  );
}
