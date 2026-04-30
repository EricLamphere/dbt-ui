import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api, type InitStepDto } from '../../lib/api';
import NavRail from './components/NavRail';
import { useProjectEvents } from '../../lib/sse';
import { FilePickerModal } from './components/FilePickerModal';

// ---- types ----

type StepStatus = 'idle' | 'running' | 'success' | 'error';

interface StepRunState {
  status: StepStatus;
  log: string;
  finishedAt: string | null;
}

// ---- status icon ----

function StatusIcon({ status, log }: { status: StepStatus; log: string }) {
  const [hovered, setHovered] = useState(false);

  const tooltip =
    status === 'success' ? 'Complete' :
    status === 'running' ? 'Running' :
    status === 'error'   ? `Failed\n${log}` :
    null;

  if (status === 'idle') return null;

  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
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
      {hovered && tooltip && (
        <div className="absolute left-6 top-1/2 -translate-y-1/2 z-50 min-w-max max-w-xs bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 shadow-xl pointer-events-none">
          <pre className="text-xs text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">{tooltip}</pre>
        </div>
      )}
    </div>
  );
}

// ---- main page ----

export default function InitScriptsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const qc = useQueryClient();

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.projects.get(id),
  });

  const { data: steps = [], isLoading } = useQuery({
    queryKey: ['init-steps', id],
    queryFn: () => api.init.steps(id),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['init-steps', id] });

  const [setupRunning, setSetupRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [stepStates, setStepStates] = useState<Record<string, StepRunState>>({});

  const runSetupMutation = useMutation({
    mutationFn: () => api.init.open(id),
    onMutate: () => {
      setSetupRunning(true);
      // Clear previous run states
      setStepStates({});
    },
  });

  useProjectEvents(id, (event) => {
    if (event.type === 'init_pipeline_started') {
      setSetupRunning(true);
      setStepStates({});
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
    }
  });

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
  const dragIndexRef = useRef<number | null>(null);

  useEffect(() => {
    setLocalSteps(steps);
  }, [steps]);

  if (isLoading) {
    return (
      <PageShell id={id}>
        <p className="text-gray-500 text-sm p-6">Loading…</p>
      </PageShell>
    );
  }

  const handleDragStart = (idx: number) => {
    dragIndexRef.current = idx;
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from === null || from === idx) return;
    setLocalSteps((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(idx, 0, moved);
      dragIndexRef.current = idx;
      return next;
    });
  };

  const handleDrop = () => {
    dragIndexRef.current = null;
    reorderMutation.mutate(localSteps.map((s) => s.name));
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
  };

  const handleDelete = (step: InitStepDto) => {
    if (!confirm(`Delete script "${step.name.replace(/^custom:\s*/, '')}"? This cannot be undone.`)) return;
    deleteMutation.mutate(step.name);
  };

  const formattedLastRun = lastRunAt
    ? new Date(lastRunAt).toLocaleString(undefined, {
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
            disabled={setupRunning || runSetupMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-medium transition-colors"
          >
            {setupRunning && (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
              </svg>
            )}
            {setupRunning ? 'Running…' : 'Run Setup'}
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

          <div className="flex flex-col gap-3">
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
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                isDragging={dragIndexRef.current === idx}
              />
            ))}
          </div>
        </div>
      </div>

      {newStepOpen && (
        <ScriptEditorModal
          projectId={id}
          onClose={() => { setNewStepOpen(false); invalidate(); }}
        />
      )}

      {editStep && (
        <ScriptEditorModal
          projectId={id}
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
};

interface StepTileProps {
  step: InitStepDto;
  projectId: number;
  runState: StepRunState | null;
  onToggle: (enabled: boolean) => void;
  onRunStep: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  isDragging: boolean;
}

function StepTile({ step, projectId, runState, onToggle, onRunStep, onEdit, onDelete, onDragStart, onDragOver, onDrop, onDragEnd, isDragging }: StepTileProps) {
  const displayName = step.name.replace(/^(base|custom):\s*/, '');
  const prefix = step.is_base ? 'base' : 'custom';
  const status: StepStatus = runState?.status ?? 'idle';
  const [preview, setPreview] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

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
    try { await onRunStep(); } finally { setRunning(false); }
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`rounded-xl border px-4 py-3 flex flex-col gap-2 transition-all
        ${isDragging ? 'opacity-40 scale-[0.99]' : ''}
        ${step.enabled
          ? 'bg-surface-panel border-gray-800'
          : 'bg-surface-panel/50 border-gray-800/50 opacity-60'}`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2.5">
        <span className="text-gray-700 hover:text-gray-500 cursor-grab active:cursor-grabbing shrink-0 select-none text-sm leading-none">⠿</span>

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
  existing?: InitStepDto;
  onClose: () => void;
}

function ScriptEditorModal({ projectId, existing, onClose }: ScriptEditorProps) {
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
                : <>Saved as <code className="font-mono text-gray-500">init/{name || 'script_name'}.sh</code></>
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
