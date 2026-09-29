import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api, type InitStepDto } from '../../lib/api';
import NavRail from './components/NavRail';
import { useProjectEvents } from '../../lib/sse';
import { FilePickerModal } from './components/FilePickerModal';
import { StatusLogPopover } from './components/StatusLogPopover';

// ---- types ----

type StepStatus = 'idle' | 'running' | 'success' | 'error';

// Stable reference for the "no data yet" default below — `data: steps = []`
// would otherwise allocate a brand-new empty array on every render where the
// query hasn't resolved, which fed a `useEffect(() => setLocalSteps(steps),
// [steps])` an ever-changing "new" array and caused a render loop (visible
// as React's "Maximum update depth exceeded" warning on this page).
const EMPTY_STEPS: InitStepDto[] = [];

interface StepRunState {
  status: StepStatus;
  log: string;
  finishedAt: string | null;
}

// ---- status icon ----

function StatusIcon({ status, log }: { status: StepStatus; log: string }) {
  if (status === 'idle') return null;

  const iconEl = (
    <>
      {status === 'running' && (
        <svg className="w-4 h-4 text-blue-400 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
        </svg>
      )}
      {status === 'success' && (
        <svg className="w-4 h-4 text-green-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
      {status === 'error' && (
        <svg className="w-4 h-4 text-red-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      )}
    </>
  );

  let panel: React.ReactNode | null = null;
  if (status === 'running') {
    panel = <p className="text-xs text-gray-300">Running…</p>;
  } else if (status === 'success') {
    panel = (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-green-400">Complete</p>
        {log && <pre className="text-[11px] font-mono text-gray-400 whitespace-pre-wrap leading-relaxed">{log}</pre>}
      </div>
    );
  } else if (status === 'error') {
    panel = (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-red-400">Failed</p>
        <pre className="text-[11px] font-mono text-gray-400 whitespace-pre-wrap leading-relaxed">
          {log || 'No output captured.'}
        </pre>
      </div>
    );
  }

  return <StatusLogPopover icon={iconEl} panel={panel} align="start" />;
}

// ---- main page ----

export default function InitScriptsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const qc = useQueryClient();

  // refetchOnMount: 'always' — navigating back to this page must never show a
  // cached last_init_status from before an init run that started while away.
  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.projects.get(id),
    refetchOnMount: 'always',
  });

  const { data: steps = EMPTY_STEPS, isLoading } = useQuery({
    queryKey: ['init-steps', id],
    queryFn: () => api.init.steps(id),
    refetchOnMount: 'always',
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['init-steps', id] });

  const [setupRunning, setSetupRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [stepStates, setStepStates] = useState<Record<string, StepRunState>>({});

  // Seed stepStates from persisted step status once steps first load, so status/logs
  // survive navigation and server restarts. SSE overwrites this live during a run.
  const seededStepStatesRef = useRef(false);
  useEffect(() => {
    if (seededStepStatesRef.current || steps.length === 0) return;
    seededStepStatesRef.current = true;
    const seeded: Record<string, StepRunState> = {};
    for (const s of steps) {
      if (s.last_status && s.last_status !== 'idle') {
        seeded[s.name] = {
          status: s.last_status as StepStatus,
          log: s.last_log,
          finishedAt: s.last_finished_at,
        };
      }
    }
    setStepStates(seeded);
  }, [steps]);

  const runSetupMutation = useMutation({
    mutationFn: () => api.init.open(id),
    onMutate: () => {
      setSetupRunning(true);
      // Clear previous run states
      setStepStates({});
    },
    onError: (err) => {
      setSetupRunning(false);
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('409')) {
        alert('Init pipeline is already running for this project.');
      } else {
        alert(message);
      }
    },
  });

  useProjectEvents(id, useCallback((event) => {
    if (event.type === 'init_pipeline_started') {
      setSetupRunning(true);
      // Only clear state for the steps actually in this run (a single-step
      // run publishes the same event with just that one step's name) — other
      // steps' persisted status must not be wiped.
      const runningSteps = (event.data as { steps?: string[] }).steps ?? [];
      setStepStates((prev) => {
        const next = { ...prev };
        for (const name of runningSteps) {
          delete next[name];
        }
        return next;
      });
    }
    if (event.type === 'init_step') {
      const { name, status, log = '', finishedAt = null } = event.data as {
        name: string;
        status: StepStatus;
        log?: string;
        finishedAt?: string | null;
        finished_at?: string | null;
      };
      const resolvedFinishedAt = finishedAt ?? (event.data as Record<string, string | null>).finished_at ?? null;
      setStepStates((prev) => ({
        ...prev,
        [name]: { status, log, finishedAt: resolvedFinishedAt },
      }));
    }
    if (event.type === 'init_pipeline_finished') {
      setSetupRunning(false);
      setLastRunAt(new Date().toISOString());
      qc.invalidateQueries({ queryKey: ['project', id] });
      qc.invalidateQueries({ queryKey: ['init-steps', id] });
    }
  }, [id, qc]));

  const reorderMutation = useMutation({
    mutationFn: (names: string[]) => api.init.reorder(id, names),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => {
      const bareName = name.replace(/^custom:\s*/, '');
      return api.init.deleteStep(id, bareName);
    },
    onSuccess: invalidate,
  });

  const capturedVarsMutation = useMutation({
    mutationFn: ({ name, vars }: { name: string; vars: string[] }) => {
      const bareName = name.replace(/^custom:\s*/, '');
      return api.init.setCapturedVars(id, bareName, vars);
    },
    onSuccess: invalidate,
  });

  const [newStepOpen, setNewStepOpen] = useState(false);
  const [editStep, setEditStep] = useState<InitStepDto | null>(null);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [addDropdownOpen, setAddDropdownOpen] = useState(false);
  const addBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addDropdownOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (addBtnRef.current && !addBtnRef.current.contains(e.target as Node)) {
        setAddDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [addDropdownOpen]);
  const [localSteps, setLocalSteps] = useState<InitStepDto[]>([]);
  // Pointer-based drag, not native HTML5 drag-and-drop: WKWebView (Tauri's
  // macOS webview) has a long-standing bug where dragover/drop don't
  // reliably fire for in-page reordering — dragstart fires, then the OS-level
  // drag session silently goes straight to dragend without ever crossing a
  // drop target. Chromium's implementation is more complete, so testing only
  // in a normal browser never surfaced this. Plain pointer events don't
  // involve the OS drag subsystem at all, so they work the same everywhere.
  const dragFromRef = useRef<number | null>(null);
  const dragStartIndexRef = useRef<number | null>(null);
  // Keyed by step name, not array index: the dragged tile's logical index
  // (dragFromRef) changes every time it crosses a sibling during the drag,
  // but it's still the SAME DOM node the whole time. Indexing this by
  // position (the array-index version this replaced) looked up whatever
  // tile now rendered at that position after a reorder — a different node —
  // so the "follow the cursor" transform silently applied to the wrong
  // (or no) element after the first swap.
  const tileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const draggedNameRef = useRef<string | null>(null);
  // Cursor Y and the dragged tile's own natural (untransformed) top edge,
  // both re-baselined every time the array reorders — see the
  // useLayoutEffect below. Each pointermove's transform is just "how far
  // has the cursor moved since the last time we re-baselined", so a swap
  // (which shifts the tile's natural flex position by about one tile
  // height) never stacks its own layout shift on top of the already-correct
  // cursor-tracking offset — the classic bug this replaced, where the tile
  // visibly jumped away from the cursor after each swap.
  const baselineClientYRef = useRef(0);
  const baselineTransformYRef = useRef(0);
  // Set right before a swap reorders localSteps, to whatever the dragged
  // tile's natural (untransformed) top edge was at that instant. The
  // useLayoutEffect below reads it back after React has reflowed the list
  // with the new order, to measure exactly how far the reflow itself moved
  // the tile, and folds that into baselineTransformYRef so the visible
  // (transformed) position never jumps.
  const preSwapNaturalTopRef = useRef<number | null>(null);
  // Genuinely discrete state — only changes on drag start/end — purely for
  // the isDragging visual (dimming the tile being dragged).
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // Ref mirror of localSteps so the pointerup handler below (captured once
  // per effect run, at drag start) always mutates with the latest reordered
  // list rather than a stale closure from when the drag began.
  const localStepsRef = useRef(localSteps);
  useEffect(() => {
    localStepsRef.current = localSteps;
  }, [localSteps]);

  useEffect(() => {
    setLocalSteps(steps);
  }, [steps]);

  // Runs synchronously right after React reflows the list with a new order
  // (before the browser paints), so it can measure exactly how far that
  // reflow moved the dragged tile's natural position and fold that shift
  // into the transform. Without this, the transform kept accumulating
  // relative to the tile's position at drag START, so every swap's own
  // ~one-tile-height layout shift stacked on top of the (already correct)
  // cursor-tracking offset — visibly kicking the tile away from the cursor
  // with each crossing, worse the further it had already traveled.
  useLayoutEffect(() => {
    const draggedName = draggedNameRef.current;
    const preSwapTop = preSwapNaturalTopRef.current;
    if (draggedName === null || preSwapTop === null) return;
    const el = tileRefs.current.get(draggedName);
    if (!el) return;

    const prevTransform = el.style.transform;
    el.style.transform = '';
    const postSwapNaturalTop = el.getBoundingClientRect().top;
    el.style.transform = prevTransform;

    const reflowShift = postSwapNaturalTop - preSwapTop;
    baselineTransformYRef.current -= reflowShift;
    el.style.transform = `translateY(${baselineTransformYRef.current}px)`;

    preSwapNaturalTopRef.current = null;
  }, [localSteps]);

  // Global pointermove/pointerup while a drag is active — attached to
  // `document` (not the tile) so the drag keeps tracking even if the pointer
  // briefly leaves a tile's bounds between two adjacent tiles.
  useEffect(() => {
    if (dragIndex === null) return;

    const handlePointerMove = (e: PointerEvent) => {
      const from = dragFromRef.current;
      const draggedName = draggedNameRef.current;
      if (from === null || draggedName === null) return;

      // Move the dragged tile with the cursor. Written straight to the DOM
      // (not via setState) so this tracks every pointermove at full frame
      // rate — routing it through React state would mean a re-render per
      // pixel of movement. The transform is "the offset in effect at the
      // last baseline" plus "how far the cursor has moved since then" — NOT
      // raw distance from where the drag first started. When a swap below
      // reorders the array, the tile's own natural (untransformed) flex
      // position shifts by about one tile height on the next render; if the
      // transform kept accumulating from the original drag-start position,
      // that layout shift stacked on top of the cursor-tracking offset and
      // visibly kicked the tile away from the cursor with every swap.
      // Re-baselining on each swap (below) means this always measures
      // motion relative to the tile's current resting spot, so the two
      // effects never combine.
      const transformY = baselineTransformYRef.current + (e.clientY - baselineClientYRef.current);
      const draggedEl = tileRefs.current.get(draggedName);
      if (draggedEl) {
        draggedEl.style.transform = `translateY(${transformY}px)`;
      }

      // Hit-test against each OTHER tile's current bounding box rather than
      // the event target, since the pointer capture is on the handle, not
      // the tile the cursor is currently over.
      const names = localStepsRef.current.map((s) => s.name);
      for (let i = 0; i < names.length; i++) {
        if (i === from) continue;
        const el = tileRefs.current.get(names[i]);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          // The dragged tile's natural (untransformed) top edge right now,
          // derived from its current rendered position minus the transform
          // already applied to it — read BEFORE the reorder below changes
          // its natural position. The useLayoutEffect after this render
          // compares this to the tile's natural top once the swap has
          // settled, and folds the difference into the transform so the
          // rendered pixel position doesn't jump.
          if (draggedEl) {
            preSwapNaturalTopRef.current = draggedEl.getBoundingClientRect().top - transformY;
          }
          setLocalSteps((prev) => {
            const next = [...prev];
            const [moved] = next.splice(from, 1);
            next.splice(i, 0, moved);
            return next;
          });
          dragFromRef.current = i;
          setDragIndex(i);
          baselineTransformYRef.current = transformY;
          baselineClientYRef.current = e.clientY;
          break;
        }
      }
    };

    const handlePointerUp = () => {
      const moved = dragFromRef.current !== dragStartIndexRef.current;
      const draggedName = draggedNameRef.current;
      if (draggedName !== null) {
        const draggedEl = tileRefs.current.get(draggedName);
        if (draggedEl) draggedEl.style.transform = '';
      }
      dragFromRef.current = null;
      dragStartIndexRef.current = null;
      draggedNameRef.current = null;
      setDragIndex(null);
      if (moved) {
        reorderMutation.mutate(localStepsRef.current.map((s) => s.name));
      }
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragIndex, reorderMutation]);

  if (isLoading) {
    return (
      <PageShell id={id}>
        <p className="text-gray-500 text-sm p-6">Loading…</p>
      </PageShell>
    );
  }

  const handlePointerDown = (e: React.PointerEvent, idx: number, name: string) => {
    // Suppress the browser's default text-selection drag — without this,
    // moving the pointer across sibling tiles during a drag highlights their
    // text the same way a click-drag text selection would.
    e.preventDefault();
    dragFromRef.current = idx;
    dragStartIndexRef.current = idx;
    draggedNameRef.current = name;
    baselineClientYRef.current = e.clientY;
    baselineTransformYRef.current = 0;
    setDragIndex(idx);
  };

  const handleDelete = (step: InitStepDto) => {
    if (!confirm(`Delete script "${step.name.replace(/^custom:\s*/, '')}"? This cannot be undone.`)) return;
    deleteMutation.mutate(step.name);
  };

  // Persisted status (survives navigation + restarts); local SSE-driven state
  // during an active run takes priority once it fires.
  const displayRunning = setupRunning || project?.last_init_status === 'running';
  const effectiveLastRunAt = lastRunAt ?? project?.last_init_finished_at ?? null;
  const formattedLastRun = effectiveLastRunAt
    ? new Date(effectiveLastRunAt).toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null;

  return (
    <PageShell id={id}>
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-8">
        {/* Header with Run Setup button */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-gray-200">Initialization</h1>
            {formattedLastRun && (
              <p className="text-xs text-gray-600 mt-0.5">Last run: {formattedLastRun}</p>
            )}
          </div>
          <button
            onClick={() => runSetupMutation.mutate()}
            disabled={displayRunning || runSetupMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-medium transition-colors"
          >
            {displayRunning && (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
              </svg>
            )}
            {displayRunning ? 'Running…' : 'Run Setup'}
          </button>
        </div>

        {/* Setup steps section */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Setup steps
            </h2>
            <div ref={addBtnRef} className="relative">
              <button
                onClick={() => setAddDropdownOpen((v) => !v)}
                className="px-3 py-1 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors"
              >
                + Add script
              </button>
              {addDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 z-30 bg-surface-panel border border-gray-700 rounded shadow-lg min-w-[180px]">
                  <button
                    onClick={() => { setAddDropdownOpen(false); setNewStepOpen(true); }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-surface-elevated transition-colors"
                  >
                    Create new script
                  </button>
                  <button
                    onClick={() => { setAddDropdownOpen(false); setFilePickerOpen(true); }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-surface-elevated transition-colors"
                  >
                    Use existing script
                  </button>
                </div>
              )}
            </div>
          </div>

          {localSteps.length === 0 && (
            <p className="text-sm text-gray-600 py-4">No steps configured yet.</p>
          )}

          <div className={`flex flex-col gap-3 ${dragIndex !== null ? 'select-none' : ''}`}>
            {localSteps.map((step, idx) => (
              <StepTile
                key={step.name}
                step={step}
                projectId={id}
                runState={stepStates[step.name] ?? null}
                onToggle={(enabled) =>
                  api.init.toggleStep(id, step.name, enabled).then(invalidate)
                }
                onRunStep={() => api.init.runStep(id, step.name)}
                onEdit={!step.is_base ? () => setEditStep(step) : undefined}
                onDelete={!step.is_base ? () => handleDelete(step) : undefined}
                onCapturedVarsChange={(vars) => capturedVarsMutation.mutate({ name: step.name, vars })}
                tileRef={(el) => {
                  if (el) tileRefs.current.set(step.name, el);
                  else tileRefs.current.delete(step.name);
                }}
                onHandlePointerDown={(e) => handlePointerDown(e, idx, step.name)}
                isDragging={dragIndex === idx}
              />
            ))}
          </div>
        </div>
      </div>

      {newStepOpen && (
        <ScriptEditorModal
          projectId={id}
          initScriptPath={project?.init_script_path ?? 'init'}
          onClose={() => { setNewStepOpen(false); invalidate(); }}
        />
      )}

      {editStep && (
        <ScriptEditorModal
          projectId={id}
          initScriptPath={project?.init_script_path ?? 'init'}
          existing={editStep}
          onClose={() => { setEditStep(null); invalidate(); }}
        />
      )}

      {filePickerOpen && (
        <FilePickerModal
          projectPath={project?.path ?? '/'}
          onClose={() => setFilePickerOpen(false)}
          onSelect={async (path) => {
            try {
              await api.init.linkStep(id, path);
              setFilePickerOpen(false);
              invalidate();
            } catch (e) {
              alert(String(e));
            }
          }}
        />
      )}
    </PageShell>
  );
}

// ---- layout wrapper ----

function PageShell({ id, children }: { id: number; children: React.ReactNode }) {
  return (
    <div className="flex h-full overflow-hidden">
      <NavRail projectId={id} current="init" />
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}

// ---- step tile ----

const BASE_STEP_PREVIEWS: Record<string, string> = {
  'pip install':       '# Install Python requirements\n# Reads global + project requirements.txt',
  'dbt deps':          '# Install dbt package dependencies\n# Runs: dbt deps',
  'dbt docs generate': '# Generate dbt docs and catalog\n# Runs: dbt compile --write-catalog (or dbt docs generate)',
  'dbt compile':       '# Compile dbt models and populate compiled_code\n# Runs: dbt compile',
};

interface StepTileProps {
  step: InitStepDto;
  projectId: number;
  runState: StepRunState | null;
  onToggle: (enabled: boolean) => void;
  onRunStep: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCapturedVarsChange: (vars: string[]) => void;
  tileRef: (el: HTMLDivElement | null) => void;
  onHandlePointerDown: (e: React.PointerEvent) => void;
  isDragging: boolean;
}

function StepTile({ step, projectId, runState, onToggle, onRunStep, onEdit, onDelete, onCapturedVarsChange, tileRef, onHandlePointerDown, isDragging }: StepTileProps) {
  const displayName = step.name.replace(/^(base|custom):\s*/, '');
  const prefix = step.is_base ? 'base' : 'custom';
  const status: StepStatus = runState?.status ?? 'idle';
  const [preview, setPreview] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [newVar, setNewVar] = useState('');
  const [varInputOpen, setVarInputOpen] = useState(false);
  const varInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (varInputOpen) varInputRef.current?.focus();
  }, [varInputOpen]);

  const handleAddVar = useCallback(() => {
    const trimmed = newVar.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!trimmed || step.captured_vars.includes(trimmed)) { setNewVar(''); setVarInputOpen(false); return; }
    onCapturedVarsChange([...step.captured_vars, trimmed]);
    setNewVar('');
    setVarInputOpen(false);
  }, [newVar, step.captured_vars, onCapturedVarsChange]);

  const handleRemoveVar = useCallback((v: string) => {
    onCapturedVarsChange(step.captured_vars.filter((x) => x !== v));
  }, [step.captured_vars, onCapturedVarsChange]);

  useEffect(() => {
    if (step.is_base) {
      setPreview(BASE_STEP_PREVIEWS[displayName] ?? null);
    } else {
      api.init.getScriptContent(projectId, displayName)
        .then((content) => {
          const lines = content.split('\n').slice(0, 4).join('\n');
          setPreview(lines || null);
        })
        .catch(() => setPreview(null));
    }
  }, [step.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRun = async () => {
    setRunning(true);
    try {
      await onRunStep();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(message.startsWith('409') ? 'Init pipeline is already running for this project.' : message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      ref={tileRef}
      className={`rounded-xl border px-4 py-3 flex flex-col gap-2
        ${isDragging
          // The dragged tile's transform is written directly to the DOM on
          // every pointermove (see the effect above) so it tracks the
          // cursor at full frame rate — a CSS transition on transform here
          // would fight that, easing toward each new position instead of
          // following it 1:1. Other (non-dragged) tiles keep transition-all
          // so their reflow when the array reorders reads as a smooth
          // "make room" shift instead of an instant snap.
          ? 'opacity-90 shadow-2xl scale-[1.02] z-10 relative'
          : 'transition-all'}
        ${step.enabled
          ? 'bg-surface-panel border-gray-800'
          : 'bg-surface-panel/50 border-gray-800/50 opacity-60'}`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2.5">
        <span
          onPointerDown={onHandlePointerDown}
          className="text-gray-700 hover:text-gray-500 cursor-grab active:cursor-grabbing shrink-0 select-none text-sm leading-none touch-none"
        >
          ⠿
        </span>

        {/* Enable toggle */}
        <button
          onClick={() => onToggle(!step.enabled)}
          title={step.enabled ? 'Disable' : 'Enable'}
          className={`w-8 h-4 rounded-full transition-colors shrink-0 flex items-center px-0.5
            ${step.enabled ? 'bg-brand-600 justify-end' : 'bg-gray-700 justify-start'}`}
        >
          <span className="w-3 h-3 rounded-full bg-white shadow" />
        </button>

        {/* Name */}
        <div className="flex-1 min-w-0">
          <span className="text-[10px] text-gray-600 font-mono mr-1.5">{prefix}:</span>
          <span className="text-sm font-medium text-gray-200">{displayName}</span>
        </div>

        {/* Run this step */}
        <button
          onClick={handleRun}
          disabled={running || status === 'running'}
          title="Run this step"
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface-elevated hover:bg-brand-900/40 text-gray-400 hover:text-brand-300 disabled:opacity-40 transition-colors shrink-0"
        >
          {(running || status === 'running') ? (
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
            </svg>
          ) : (
            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
          )}
          Run
        </button>

        <StatusIcon status={status} log={runState?.log ?? ''} />
      </div>

      {/* Code preview */}
      {preview && (
        <pre className="text-[11px] text-gray-500 font-mono bg-surface-elevated/60 rounded px-3 py-2 overflow-hidden leading-relaxed max-h-[4.5rem] select-none whitespace-pre-wrap break-all">
          {preview}
        </pre>
      )}

      {/* Captured variables (custom steps only) */}
      {!step.is_base && (
        <div className="flex flex-col gap-1.5 pt-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-gray-600 font-medium uppercase tracking-wider shrink-0">Captured vars</span>
            {step.captured_vars.map((v) => (
              <span
                key={v}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-elevated border border-gray-700 text-[11px] font-mono text-gray-300"
              >
                {v}
                <button
                  onClick={() => handleRemoveVar(v)}
                  className="text-gray-600 hover:text-red-400 transition-colors leading-none"
                  title="Remove"
                >
                  ×
                </button>
              </span>
            ))}
            {varInputOpen ? (
              <input
                ref={varInputRef}
                value={newVar}
                onChange={(e) => setNewVar(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddVar(); } if (e.key === 'Escape') { setVarInputOpen(false); setNewVar(''); } }}
                onBlur={handleAddVar}
                placeholder="VAR_NAME"
                className="w-28 px-1.5 py-0.5 rounded bg-surface-elevated border border-brand-600 text-[11px] font-mono text-gray-200 placeholder-gray-600 focus:outline-none"
              />
            ) : (
              <button
                onClick={() => setVarInputOpen(true)}
                className="text-[10px] text-gray-600 hover:text-brand-400 transition-colors"
                title="Add a variable to capture"
              >
                + add
              </button>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {(onEdit || onDelete) && (
        <div className="flex gap-3 pt-0.5">
          {onEdit && (
            <button onClick={onEdit} className="text-xs text-gray-500 hover:text-brand-400 transition-colors">
              Edit
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} className="text-xs text-gray-500 hover:text-red-400 transition-colors">
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- script editor modal ----

interface ScriptEditorProps {
  projectId: number;
  initScriptPath: string;
  existing?: InitStepDto;
  onClose: () => void;
}

function ScriptEditorModal({ projectId, initScriptPath, existing, onClose }: ScriptEditorProps) {
  const isEdit = !!existing;
  const bareExistingName = existing?.name.replace(/^custom:\s*/, '') ?? '';

  const [name, setName] = useState(bareExistingName);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingContent, setLoadingContent] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit || !bareExistingName) return;
    setLoadingContent(true);
    api.init.getScriptContent(projectId, bareExistingName)
      .then((text) => { setContent(text); })
      .catch(() => { setContent(''); })
      .finally(() => setLoadingContent(false));
  }, [isEdit, projectId, bareExistingName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required.'); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      setError('Name may only contain letters, digits, underscores, and hyphens.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nameChanged = isEdit && trimmed !== bareExistingName;
      if (isEdit && !nameChanged) {
        // Save content back to wherever the script actually lives (handles linked scripts)
        await api.init.putScriptContent(projectId, trimmed, content);
      } else if (isEdit && nameChanged) {
        await api.init.createStep(projectId, trimmed, content);
        await api.init.deleteStep(projectId, bareExistingName);
      } else {
        await api.init.createStep(projectId, trimmed, content);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="flex flex-col bg-surface-panel border border-gray-700 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold text-gray-100">
            {isEdit ? `Edit: ${bareExistingName}` : 'New custom script'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5 overflow-auto">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-gray-400 font-medium">Script name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="setup_env"
              autoFocus={!isEdit}
              className="bg-surface-elevated border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className="text-[11px] text-gray-600">
              {isEdit && existing?.script_path
                ? <>Saved to <code className="font-mono text-gray-500">{existing.script_path}</code></>
                : <>Saved as <code className="font-mono text-gray-500">{initScriptPath}/{name || 'script_name'}.sh</code></>
              }
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-gray-400 font-medium">Shell script</label>
            {loadingContent ? (
              <div className="h-48 bg-surface-elevated rounded flex items-center justify-center text-gray-600 text-sm">
                Loading…
              </div>
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={'#!/usr/bin/env bash\nset -e\n\n# your setup here'}
                rows={12}
                autoFocus={isEdit}
                className="bg-surface-elevated border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 font-mono focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
              />
            )}
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs rounded bg-surface-elevated hover:bg-gray-700 text-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || loadingContent}
              className="px-4 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving…' : isEdit ? 'Save changes' : 'Create script'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
