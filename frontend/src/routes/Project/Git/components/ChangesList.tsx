import type { GitFileChange } from '../../../../lib/api';

interface Props {
  changes: GitFileChange[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
  onDeleteNew: (paths: string[]) => void;
}

const STATUS_LABEL: Record<string, string> = {
  M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', U: 'U', '?': 'U', '.': '',
};

function statusColor(s: string): string {
  if (s === 'M') return 'text-yellow-400';
  if (s === 'A') return 'text-green-400';
  if (s === 'D') return 'text-red-400';
  if (s === 'R') return 'text-blue-400';
  if (s === 'U' || s === '?') return 'text-zinc-400';
  return 'text-zinc-500';
}

function FileRow({
  change,
  selected,
  onSelect,
  onStage,
  onUnstage,
  onDiscard,
  onDeleteNew,
}: {
  change: GitFileChange;
  selected: boolean;
  onSelect: () => void;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  onDeleteNew: () => void;
}) {
  const displayStatus = change.staged
    ? STATUS_LABEL[change.index_status] ?? change.index_status
    : change.is_untracked
    ? 'U'
    : STATUS_LABEL[change.worktree_status] ?? change.worktree_status;

  const colorClass = change.staged
    ? statusColor(change.index_status)
    : change.is_untracked
    ? 'text-zinc-400'
    : statusColor(change.worktree_status);

  const filename = change.path.split('/').pop() ?? change.path;
  const dir = change.path.includes('/') ? change.path.substring(0, change.path.lastIndexOf('/')) : '';

  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-2 px-3 py-1 cursor-pointer text-sm
        ${selected ? 'bg-brand-900/40' : 'hover:bg-surface-elevated'}`}
    >
      <span className={`w-4 text-xs font-bold shrink-0 ${colorClass}`}>{displayStatus}</span>
      <span className="flex-1 truncate min-w-0">
        <span className="text-gray-200">{filename}</span>
        {dir && <span className="text-zinc-500 ml-1 text-xs">{dir}</span>}
        {change.renamed_from && (
          <span className="text-zinc-500 ml-1 text-xs">← {change.renamed_from.split('/').pop()}</span>
        )}
      </span>
      <div className="hidden group-hover:flex items-center gap-1 shrink-0">
        {change.staged ? (
          <button
            onClick={(e) => { e.stopPropagation(); onUnstage(); }}
            title="Unstage"
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-600 text-zinc-300 hover:text-white text-xs"
          >
            −
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onStage(); }}
            title="Stage"
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-600 text-zinc-300 hover:text-white text-xs"
          >
            +
          </button>
        )}
        {!change.staged && !change.is_untracked && (
          <button
            onClick={(e) => { e.stopPropagation(); onDiscard(); }}
            title="Discard changes"
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-600 text-zinc-300 hover:text-white text-xs"
          >
            ↶
          </button>
        )}
        {change.is_untracked && (
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteNew(); }}
            title="Delete file"
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-600 text-zinc-300 hover:text-white text-xs"
          >
            ↶
          </button>
        )}
      </div>
    </div>
  );
}

function SectionHeader({
  label,
  count,
  onStageAll,
  onUnstageAll,
}: {
  label: string;
  count: number;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-zinc-500 select-none">
      <span className="flex-1">{label}</span>
      <span className="text-zinc-600">{count}</span>
      {onStageAll && (
        <button
          onClick={onStageAll}
          title="Stage all"
          className="hover:text-zinc-300 px-1"
        >
          +
        </button>
      )}
      {onUnstageAll && (
        <button
          onClick={onUnstageAll}
          title="Unstage all"
          className="hover:text-zinc-300 px-1"
        >
          −
        </button>
      )}
    </div>
  );
}

export function ChangesList({ changes, selectedPath, onSelect, onStage, onUnstage, onDiscard, onDeleteNew }: Props) {
  const staged = changes.filter((c) => c.staged);
  const unstaged = changes.filter((c) => !c.staged && !c.is_conflict);
  const conflicts = changes.filter((c) => c.is_conflict && !c.staged);

  if (changes.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-sm text-zinc-500">
        No changes
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {staged.length > 0 && (
        <>
          <SectionHeader
            label="Staged Changes"
            count={staged.length}
            onUnstageAll={() => onUnstage(staged.map((c) => c.path))}
          />
          {staged.map((c) => (
            <FileRow
              key={c.path}
              change={c}
              selected={selectedPath === c.path}
              onSelect={() => onSelect(c.path)}
              onStage={() => onStage([c.path])}
              onUnstage={() => onUnstage([c.path])}
              onDiscard={() => onDiscard([c.path])}
              onDeleteNew={() => onDeleteNew([c.path])}
            />
          ))}
        </>
      )}
      {conflicts.length > 0 && (
        <>
          <SectionHeader label="Merge Conflicts" count={conflicts.length} />
          {conflicts.map((c) => (
            <FileRow
              key={c.path}
              change={c}
              selected={selectedPath === c.path}
              onSelect={() => onSelect(c.path)}
              onStage={() => onStage([c.path])}
              onUnstage={() => onUnstage([c.path])}
              onDiscard={() => onDiscard([c.path])}
              onDeleteNew={() => onDeleteNew([c.path])}
            />
          ))}
        </>
      )}
      {unstaged.length > 0 && (
        <>
          <SectionHeader
            label="Changes"
            count={unstaged.length}
            onStageAll={() => onStage(unstaged.map((c) => c.path))}
          />
          {unstaged.map((c) => (
            <FileRow
              key={c.path}
              change={c}
              selected={selectedPath === c.path}
              onSelect={() => onSelect(c.path)}
              onStage={() => onStage([c.path])}
              onUnstage={() => onUnstage([c.path])}
              onDiscard={() => onDiscard([c.path])}
              onDeleteNew={() => onDeleteNew([c.path])}
            />
          ))}
        </>
      )}
    </div>
  );
}
