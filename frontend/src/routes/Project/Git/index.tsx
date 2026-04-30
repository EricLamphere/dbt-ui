import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api, type GitFileChange } from '../../../lib/api';
import { useProjectEvents } from '../../../lib/sse';
import NavRail from '../components/NavRail';
import { ChangesList } from './components/ChangesList';
import { CommitBox } from './components/CommitBox';
import { DiffView } from './components/DiffView';
import { BranchPicker } from './components/BranchPicker';
import { HistoryPanel } from './components/HistoryPanel';

export default function GitPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const SESSION_KEY = `git-selected-path-${id}`;

  // Panel sizing
  const [changesWidth, setChangesWidth] = useState(() => {
    try { const v = parseInt(localStorage.getItem('dbt-ui:git-changes-width') ?? '', 10); return !isNaN(v) && v >= 180 && v <= 600 ? v : 280; } catch { return 280; }
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const changesResizing = useRef(false);
  const changesWidthRef = useRef(changesWidth);

  // UI state — restore selected path from sessionStorage
  const [selectedPath, setSelectedPath] = useState<string | null>(
    () => sessionStorage.getItem(SESSION_KEY)
  );
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState<string[] | null>(null);
  const [deleteNewConfirm, setDeleteNewConfirm] = useState<string[] | null>(null);
  const [syncOutput, setSyncOutput] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);

  // Persist selected path across navigations
  useEffect(() => {
    if (selectedPath) sessionStorage.setItem(SESSION_KEY, selectedPath);
    else sessionStorage.removeItem(SESSION_KEY);
  }, [selectedPath, SESSION_KEY]);

  const handleOpenInFiles = useCallback((filePath: string) => {
    sessionStorage.setItem(`file-explorer-open-${id}`, filePath);
    navigate(`/projects/${id}/files`);
  }, [id, navigate]);

  // ---- queries ----
  const { data: status, isLoading } = useQuery({
    queryKey: ['git', 'status', id],
    queryFn: () => api.git.status(id),
    retry: false,
  });

  const selectedChange: GitFileChange | null =
    status?.changes.find((c) => c.path === selectedPath) ?? null;

  const { data: headData, isLoading: headLoading } = useQuery({
    queryKey: ['git', 'fileAtHead', id, selectedPath],
    queryFn: () => api.git.fileAtHead(id, selectedPath!),
    enabled: selectedPath !== null,
  });

  const { data: workingData, isLoading: workingLoading } = useQuery({
    queryKey: ['files', 'content', id, selectedPath],
    queryFn: () => api.files.getContent(id, selectedPath!),
    enabled: selectedPath !== null && selectedChange !== null,
  });

  // ---- SSE ----
  useProjectEvents(id, useCallback((event) => {
    if (event.type === 'git_status_changed') {
      qc.invalidateQueries({ queryKey: ['git', 'status', id] });
      qc.invalidateQueries({ queryKey: ['git', 'branches', id] });
    }
    if (event.type === 'git_log') {
      const data = event.data as { line?: string };
      if (data?.line) setSyncOutput((prev) => [...prev, data.line!]);
    }
    if (event.type === 'git_started') {
      setSyncing(true);
      setSyncOutput([]);
    }
    if (event.type === 'git_finished') {
      setSyncing(false);
      qc.invalidateQueries({ queryKey: ['git', 'status', id] });
      qc.invalidateQueries({ queryKey: ['git', 'branches', id] });
    }
  }, [id, qc]));

  // ---- mutations ----
  const stageMutation = useMutation({
    mutationFn: (paths: string[]) => api.git.stage(id, paths),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['git', 'status', id] }),
  });

  const unstageMutation = useMutation({
    mutationFn: (paths: string[]) => api.git.unstage(id, paths),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['git', 'status', id] }),
  });

  const discardMutation = useMutation({
    mutationFn: (paths: string[]) => api.git.discard(id, paths),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['git', 'status', id] });
      setDiscardConfirm(null);
    },
  });

  const deleteNewMutation = useMutation({
    mutationFn: (paths: string[]) => api.git.deleteNew(id, paths),
    onSuccess: (_, paths) => {
      qc.invalidateQueries({ queryKey: ['git', 'status', id] });
      setDeleteNewConfirm(null);
      if (paths.includes(selectedPath ?? '')) setSelectedPath(null);
    },
  });

  // ---- resize handlers ----
  const onMouseMove = useCallback((e: MouseEvent) => {
    if (changesResizing.current) setChangesWidth((w) => {
      const next = Math.max(180, Math.min(600, w + e.movementX));
      changesWidthRef.current = next;
      return next;
    });
  }, []);
  const onMouseUp = useCallback(() => {
    if (!changesResizing.current) return;
    changesResizing.current = false;
    try { localStorage.setItem('dbt-ui:git-changes-width', String(changesWidthRef.current)); } catch {}
  }, []);

  const registerListeners = useCallback(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // Register on mount
  const cleanupRef = useRef<(() => void) | null>(null);
  if (!cleanupRef.current) {
    cleanupRef.current = registerListeners();
  }

  const branch = status?.branch;
  const changes = status?.changes ?? [];
  const stagedCount = changes.filter((c) => c.staged).length;

  // ---- diff content ----
  const originalContent = headData?.content ?? '';
  const modifiedContent = workingData?.content ?? '';
  const diffLoading = headLoading || workingLoading;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Nav */}
      <NavRail projectId={id} current="git" />

      {/* Changes panel */}
      <div
        style={{ width: changesWidth }}
        className="shrink-0 flex flex-col bg-surface-panel border-r border-zinc-800 overflow-hidden"
      >
        <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Source Control
          </h2>
        </div>

        {/* Not a git repo */}
        {!isLoading && !status && (
          <div className="flex flex-col items-center justify-center flex-1 gap-2 px-4 text-center">
            <p className="text-sm text-zinc-500">Not a git repository</p>
            <p className="text-xs text-zinc-600">This project is not inside a git repo.</p>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center flex-1 text-sm text-zinc-500">
            Loading…
          </div>
        )}

        {status && (
          <>
            <div className="flex-1 overflow-y-auto">
              <ChangesList
                changes={changes}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                onStage={(paths) => stageMutation.mutate(paths)}
                onUnstage={(paths) => unstageMutation.mutate(paths)}
                onDiscard={(paths) => setDiscardConfirm(paths)}
                onDeleteNew={(paths) => setDeleteNewConfirm(paths)}
              />
            </div>

            {/* History toggle */}
            <div className="shrink-0 border-t border-zinc-800">
              <button
                onClick={() => setHistoryOpen((o) => !o)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-500 hover:text-gray-300 hover:bg-surface-elevated"
              >
                <svg className={`w-3 h-3 transition-transform ${historyOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                History
              </button>
              {historyOpen && (
                <div className="border-t border-zinc-800 max-h-48 overflow-y-auto">
                  <HistoryPanel projectId={id} selectedPath={selectedPath} />
                </div>
              )}
            </div>

            <CommitBox
              projectId={id}
              stagedCount={stagedCount}
              currentBranch={branch?.name ?? null}
              ahead={branch?.ahead ?? 0}
              behind={branch?.behind ?? 0}
              onBranchClick={() => setBranchPickerOpen((o) => !o)}
              syncOutput={syncOutput}
              syncing={syncing}
            />
          </>
        )}
      </div>

      <div
        className="w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-brand-500 transition-colors"
        onMouseDown={() => { changesResizing.current = true; }}
      />

      {/* Diff view */}
      <div className="flex-1 overflow-hidden relative">
        {selectedPath && selectedChange ? (
          <DiffView
            original={originalContent}
            modified={modifiedContent}
            path={selectedPath}
            change={selectedChange}
            loading={diffLoading}
            onOpenInFiles={handleOpenInFiles}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-zinc-500">
            Select a file to view its diff
          </div>
        )}
      </div>

      {/* Branch picker popover */}
      {branchPickerOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setBranchPickerOpen(false)}
          />
          <div
            className="fixed z-50 bottom-32 left-64 w-72 bg-surface-panel border border-zinc-700 rounded-lg shadow-xl overflow-hidden"
            style={{ left: changesWidth + 192 - 20 }}
          >
            <BranchPicker
              projectId={id}
              currentBranch={branch?.name ?? null}
              ahead={branch?.ahead ?? 0}
              behind={branch?.behind ?? 0}
              onClose={() => setBranchPickerOpen(false)}
            />
          </div>
        </>
      )}

      {/* Discard confirmation dialog */}
      {discardConfirm && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" />
          <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 bg-surface-panel border border-zinc-700 rounded-lg shadow-xl p-4">
            <h3 className="text-sm font-medium text-gray-200 mb-2">Discard changes?</h3>
            <p className="text-xs text-zinc-400 mb-4">
              This will permanently discard all changes to{' '}
              <span className="text-gray-300">{discardConfirm.join(', ')}</span>. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDiscardConfirm(null)}
                className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => discardMutation.mutate(discardConfirm)}
                disabled={discardMutation.isPending}
                className="px-3 py-1.5 text-sm bg-red-700 hover:bg-red-600 text-white rounded disabled:opacity-50"
              >
                Discard
              </button>
            </div>
          </div>
        </>
      )}

      {/* Delete new file confirmation dialog */}
      {deleteNewConfirm && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" />
          <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 bg-surface-panel border border-zinc-700 rounded-lg shadow-xl p-4">
            <h3 className="text-sm font-medium text-gray-200 mb-2">Delete new file?</h3>
            <p className="text-xs text-zinc-400 mb-4">
              <span className="text-gray-300">{deleteNewConfirm.join(', ')}</span> is a new untracked file.
              Deleting it will permanently remove it from disk. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteNewConfirm(null)}
                className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteNewMutation.mutate(deleteNewConfirm)}
                disabled={deleteNewMutation.isPending}
                className="px-3 py-1.5 text-sm bg-red-700 hover:bg-red-600 text-white rounded disabled:opacity-50"
              >
                Delete file
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
