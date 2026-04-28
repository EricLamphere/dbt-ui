import { useEffect, useRef, useState } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { api, type GitBranchDto } from '../../../../lib/api';

interface Props {
  projectId: number;
  currentBranch?: string | null;
  ahead: number;
  behind: number;
  onClose: () => void;
}

export function BranchPicker({ projectId, ahead, behind, onClose }: Props) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery({
    queryKey: ['git', 'branches', projectId],
    queryFn: () => api.git.branches(projectId),
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const checkoutMutation = useMutation({
    mutationFn: (name: string) => api.git.checkout(projectId, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['git', 'status', projectId] });
      qc.invalidateQueries({ queryKey: ['git', 'branches', projectId] });
      onClose();
    },
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => api.git.createBranch(projectId, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['git', 'branches', projectId] });
      setCreating(false);
      setNewName('');
    },
  });

  const branches = data?.branches ?? [];
  const filtered = branches.filter((b) =>
    !filter || b.name.toLowerCase().includes(filter.toLowerCase())
  );
  const locals = filtered.filter((b) => !b.remote);
  const remotes = filtered.filter((b) => b.remote);

  function BranchRow({ branch }: { branch: GitBranchDto }) {
    return (
      <button
        onClick={() => {
          if (!branch.current) checkoutMutation.mutate(branch.name);
          else onClose();
        }}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left rounded
          ${branch.current
            ? 'bg-brand-900/40 text-brand-300'
            : 'hover:bg-surface-elevated text-gray-300'}`}
      >
        {branch.current && (
          <span className="text-brand-400 text-xs">✓</span>
        )}
        <span className={`truncate ${branch.current ? '' : 'pl-4'}`}>{branch.name}</span>
        {branch.remote && (
          <span className="ml-auto text-xs text-zinc-500 shrink-0">remote</span>
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1 py-1">
      <div className="px-2">
        <input
          ref={inputRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter branches…"
          className="w-full bg-surface-elevated border border-zinc-700 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
        />
      </div>

      {ahead > 0 || behind > 0 ? (
        <div className="px-3 py-1 text-xs text-zinc-500">
          {ahead > 0 && <span className="mr-2">↑{ahead}</span>}
          {behind > 0 && <span>↓{behind}</span>}
        </div>
      ) : null}

      <div className="max-h-64 overflow-y-auto px-1">
        {locals.length > 0 && (
          <>
            <p className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              Local
            </p>
            {locals.map((b) => <BranchRow key={b.name} branch={b} />)}
          </>
        )}
        {remotes.length > 0 && (
          <>
            <p className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mt-1">
              Remote
            </p>
            {remotes.map((b) => <BranchRow key={b.name} branch={b} />)}
          </>
        )}
        {filtered.length === 0 && (
          <p className="px-3 py-2 text-sm text-zinc-500">No branches found</p>
        )}
      </div>

      <div className="border-t border-zinc-700 mt-1 pt-1 px-2">
        {creating ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) createMutation.mutate(newName.trim());
            }}
            className="flex gap-1"
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New branch name…"
              className="flex-1 bg-surface-elevated border border-zinc-700 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={!newName.trim() || createMutation.isPending}
              className="px-2 py-1 text-xs bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="px-2 py-1 text-xs text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full text-left px-2 py-1 text-sm text-zinc-400 hover:text-gray-200"
          >
            + Create new branch
          </button>
        )}
      </div>
    </div>
  );
}
