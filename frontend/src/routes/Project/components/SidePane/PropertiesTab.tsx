import { useEffect, useReducer, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Play, Hammer, FlaskConical, Layers, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, type ModelNode, type GraphDto, type RunOpts } from '../../../../lib/api';

type RunCommand = 'run' | 'build' | 'test';

interface PropertiesTabProps {
  projectId: number;
  model: ModelNode | null;
  selectedModels?: ModelNode[];
  graph: GraphDto | null;
  page: 'files' | 'dag';
  onNavigateToFiles?: () => void;
  onNavigateToDag?: () => void;
  onViewDocs?: () => void;
  onDelete?: () => void;
  onNavigateToFile?: (path: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  idle: 'text-gray-400',
  success: 'text-emerald-400',
  error: 'text-red-400',
  running: 'text-brand-400 animate-pulse',
  stale: 'text-amber-400',
  warn: 'text-yellow-400',
  pending: 'text-gray-400',
};

const ERROR_STATUSES = new Set(['error', 'warn', 'stale']);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">{label}</span>
      <div className="text-xs text-gray-300 break-all">{children}</div>
    </div>
  );
}

function Chip({ label, dim = false }: { label: string; dim?: boolean }) {
  return (
    <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-mono mr-1 mb-1 ${dim ? 'bg-surface-elevated text-gray-500' : 'bg-gray-700 text-gray-300'}`}>
      {label}
    </span>
  );
}

// Shared run options component — scope toggles, full refresh, threads
interface VarEntry { key: string; value: string }

export interface RunOptionsState {
  upstream: boolean;
  downstream: boolean;
  fullRefresh: boolean;
  debug: boolean;
  empty: boolean;
  threads: string;
  vars: VarEntry[];
}

export type RunOptionsAction =
  | { type: 'toggle'; field: 'upstream' | 'downstream' | 'fullRefresh' | 'debug' | 'empty' }
  | { type: 'setUpstream'; value: boolean }
  | { type: 'setDownstream'; value: boolean }
  | { type: 'setThreads'; value: string }
  | { type: 'addVar' }
  | { type: 'setVarKey'; index: number; value: string }
  | { type: 'setVarValue'; index: number; value: string }
  | { type: 'removeVar'; index: number };

export function runOptionsInitial(): RunOptionsState {
  return { upstream: false, downstream: false, fullRefresh: false, debug: false, empty: false, threads: '', vars: [] };
}

export function runOptionsReducer(state: RunOptionsState, action: RunOptionsAction): RunOptionsState {
  switch (action.type) {
    case 'toggle': return { ...state, [action.field]: !state[action.field] };
    case 'setUpstream': return { ...state, upstream: action.value };
    case 'setDownstream': return { ...state, downstream: action.value };
    case 'setThreads': return { ...state, threads: action.value };
    case 'addVar': return { ...state, vars: [...state.vars, { key: '', value: '' }] };
    case 'setVarKey': return { ...state, vars: state.vars.map((v, i) => i === action.index ? { ...v, key: action.value } : v) };
    case 'setVarValue': return { ...state, vars: state.vars.map((v, i) => i === action.index ? { ...v, value: action.value } : v) };
    case 'removeVar': return { ...state, vars: state.vars.filter((_, i) => i !== action.index) };
    default: return state;
  }
}

export function runOptsFromState(state: RunOptionsState): RunOpts {
  const mode = state.upstream && state.downstream ? 'full' : state.upstream ? 'upstream' : state.downstream ? 'downstream' : 'only';
  const validVars = state.vars.filter((v) => v.key.trim());
  return {
    full_refresh: state.fullRefresh || undefined,
    threads: state.threads ? parseInt(state.threads, 10) : undefined,
    debug: state.debug || undefined,
    empty: state.empty || undefined,
    vars: validVars.length ? Object.fromEntries(validVars.map((v) => [v.key.trim(), v.value])) : undefined,
    _mode: mode,
  } as RunOpts & { _mode: string };
}

function Pill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded border font-mono transition-colors select-none ${
        active
          ? 'bg-brand-900/70 border-brand-600 text-brand-200'
          : 'bg-surface-elevated border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-300'
      }`}
    >
      {label}
    </button>
  );
}

export function RunOptions({ state, dispatch }: { state: RunOptionsState; dispatch: (a: RunOptionsAction) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {/* Row 1: scope pills */}
      <div className="flex gap-1.5 flex-wrap">
        <Pill
          active={state.upstream && !state.downstream}
          label="+Upstream"
          onClick={() => {
            const wasOnly = state.upstream && !state.downstream;
            dispatch({ type: 'setUpstream', value: !wasOnly });
            if (!wasOnly) dispatch({ type: 'setDownstream', value: false });
          }}
        />
        <Pill
          active={!state.upstream && state.downstream}
          label="Downstream+"
          onClick={() => {
            const wasOnly = !state.upstream && state.downstream;
            dispatch({ type: 'setDownstream', value: !wasOnly });
            if (!wasOnly) dispatch({ type: 'setUpstream', value: false });
          }}
        />
        <Pill
          active={state.upstream && state.downstream}
          label="+Full Lineage+"
          onClick={() => {
            const both = state.upstream && state.downstream;
            dispatch({ type: 'setUpstream', value: !both });
            dispatch({ type: 'setDownstream', value: !both });
          }}
        />
      </div>
      {/* Row 2: flags */}
      <div className="flex gap-1.5 flex-wrap">
        <Pill active={state.fullRefresh} label="Full Refresh" onClick={() => dispatch({ type: 'toggle', field: 'fullRefresh' })} />
        <Pill active={state.debug} label="Debug" onClick={() => dispatch({ type: 'toggle', field: 'debug' })} />
        <Pill active={state.empty} label="Empty" onClick={() => dispatch({ type: 'toggle', field: 'empty' })} />
      </div>
      {/* Row 3: threads */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 whitespace-nowrap">Threads</label>
        <input
          type="number"
          min={1}
          max={64}
          placeholder="default"
          value={state.threads}
          onChange={(e) => dispatch({ type: 'setThreads', value: e.target.value })}
          className="w-20 px-2 py-1.5 text-xs bg-surface-elevated border border-gray-700 rounded text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600"
        />
      </div>
      {/* Vars section */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Vars</span>
          <button
            type="button"
            onClick={() => dispatch({ type: 'addVar' })}
            className="flex items-center justify-center w-4 h-4 rounded bg-surface-elevated border border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300 transition-colors"
          >
            <Plus className="w-2.5 h-2.5" />
          </button>
        </div>
        {state.vars.map((v, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              placeholder="key"
              value={v.key}
              onChange={(e) => dispatch({ type: 'setVarKey', index: i, value: e.target.value })}
              className="w-24 px-2 py-1 text-xs bg-surface-elevated border border-gray-700 rounded text-gray-300 font-mono placeholder-gray-600 focus:outline-none focus:border-gray-600"
            />
            <span className="text-gray-600 text-xs shrink-0">=</span>
            <input
              placeholder="value"
              value={v.value}
              onChange={(e) => dispatch({ type: 'setVarValue', index: i, value: e.target.value })}
              className="flex-1 min-w-0 px-2 py-1 text-xs bg-surface-elevated border border-gray-700 rounded text-gray-300 font-mono placeholder-gray-600 focus:outline-none focus:border-gray-600"
            />
            <button
              type="button"
              onClick={() => dispatch({ type: 'removeVar', index: i })}
              className="text-gray-600 hover:text-red-400 transition-colors shrink-0"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Spinner SVG
function Spinner() {
  return (
    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
    </svg>
  );
}

export function PropertiesTab({
  projectId, model, selectedModels = [], graph, page,
  onNavigateToFiles, onNavigateToDag, onViewDocs, onDelete, onNavigateToFile,
}: PropertiesTabProps) {
  const [loading, setLoading] = useState<RunCommand | null>(null);
  const [opts, dispatchOpts] = useReducer(runOptionsReducer, undefined, runOptionsInitial);

  const qc = useQueryClient();
  const [descEditing, setDescEditing] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [descSaving, setDescSaving] = useState(false);
  const [descError, setDescError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startEditDesc = () => {
    setDescDraft(model?.description ?? '');
    setDescError(null);
    setDescEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const cancelEditDesc = () => {
    setDescEditing(false);
    setDescError(null);
  };

  // Reset edit state when the selected model changes
  useEffect(() => {
    setDescEditing(false);
    setDescError(null);
  }, [model?.unique_id]);

  const saveDesc = async () => {
    if (!model) return;
    setDescSaving(true);
    setDescError(null);
    try {
      await api.models.patchDescription(projectId, model.unique_id, descDraft.trim());
      setDescEditing(false);
      qc.invalidateQueries({ queryKey: ['graph', projectId] });
    } catch (err) {
      setDescError(err instanceof Error ? err.message : 'Failed to save description');
    } finally {
      setDescSaving(false);
    }
  };

  const handleRun = async (cmd: RunCommand) => {
    if (!model) return;
    setLoading(cmd);
    try {
      const { _mode, ...runOpts } = runOptsFromState(opts) as RunOpts & { _mode: string };
      if (cmd === 'run') await api.runs.run(projectId, model.name, _mode, runOpts);
      else if (cmd === 'build') await api.runs.build(projectId, model.name, _mode, runOpts);
      else await api.runs.test(projectId, model.name, _mode, runOpts);
    } finally {
      setLoading(null);
    }
  };

  if (selectedModels.length > 1) {
    return <MultiSelectionTab projectId={projectId} selectedModels={selectedModels} />;
  }

  if (!model) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm select-none px-4 text-center">
        Select a model to view its properties
      </div>
    );
  }

  const isTest = model.resource_type === 'test';

  return (
    <div className="flex-1 p-4 flex flex-col gap-4">
      {/* Name + type header */}
      <div className="flex flex-col gap-1">
        <span className="font-semibold text-gray-100 text-sm break-all">{model.name}</span>
        <div className="flex flex-wrap items-center gap-1">
          <Chip label={model.resource_type} />
          {model.materialized && <Chip label={model.materialized} />}
          <span className={`font-mono text-xs ${STATUS_COLORS[model.status] ?? 'text-gray-400'}`}>
            {model.status}
          </span>
        </div>
      </div>

      {/* Error/warn message */}
      {model.message && ERROR_STATUSES.has(model.status) && (
        <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded px-3 py-2">
          {model.message}
        </p>
      )}

      {/* Description — click-to-edit for models */}
      {(model.description || model.resource_type === 'model') && (
        <Row label="Description">
          {model.resource_type === 'model' ? (
            descEditing ? (
              <div className="flex flex-col gap-1.5">
                <textarea
                  ref={textareaRef}
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') cancelEditDesc();
                  }}
                  disabled={descSaving}
                  rows={4}
                  className="w-full bg-surface-elevated border border-zinc-700 rounded px-2 py-1.5 text-xs text-gray-200 resize-y focus:outline-none focus:border-brand-500 disabled:opacity-50"
                  placeholder="Describe this model…"
                />
                {descError && (
                  <p className="text-[10px] text-red-400">{descError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={saveDesc}
                    disabled={descSaving}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
                  >
                    {descSaving && <Loader2 size={10} className="animate-spin" />}
                    Save
                  </button>
                  <button
                    onClick={cancelEditDesc}
                    disabled={descSaving}
                    className="px-2 py-0.5 rounded text-[10px] text-gray-400 hover:text-gray-200 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={startEditDesc}
                className="group text-left w-full flex items-start gap-1.5 hover:text-gray-100"
              >
                {model.description ? (
                  <span className="text-gray-300 leading-relaxed">{model.description}</span>
                ) : (
                  <span className="text-gray-600 italic">Add description…</span>
                )}
                <Pencil size={10} className="mt-0.5 shrink-0 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )
          ) : (
            <span className="text-gray-300 leading-relaxed">{model.description}</span>
          )}
        </Row>
      )}

      <div className="flex flex-col gap-3 bg-surface-elevated/40 rounded-lg p-3">
        {model.original_file_path && (
          <Row label="Path">
            <span className="font-mono text-gray-400">{model.original_file_path}</span>
          </Row>
        )}
        {model.schema_ && (
          <Row label="Schema">
            <span className="font-mono">{model.schema_}</span>
          </Row>
        )}
        {model.database && (
          <Row label="Database">
            <span className="font-mono">{model.database}</span>
          </Row>
        )}
        {model.materialized && (
          <Row label="Materialization">
            <span className="font-mono">{model.materialized}</span>
          </Row>
        )}
        {(() => {
          if (!graph) return null;
          const upstreamNodes = graph.edges
            .filter((e) => e.target === model.unique_id)
            .map((e) => graph.nodes.find((n) => n.unique_id === e.source))
            .filter((n): n is ModelNode => n != null);
          const downstreamNodes = graph.edges
            .filter((e) => e.source === model.unique_id)
            .map((e) => graph.nodes.find((n) => n.unique_id === e.target))
            .filter((n): n is ModelNode => n != null);
          if (upstreamNodes.length === 0 && downstreamNodes.length === 0) return null;
          return (
            <>
              {upstreamNodes.length > 0 && (
                <Row label="Refs / Sources">
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {upstreamNodes.map((n) => (
                      <button
                        key={n.unique_id}
                        title={n.original_file_path ? 'Cmd+click to open in Files' : n.name}
                        onClick={(e) => {
                          if ((e.metaKey || e.ctrlKey) && n.original_file_path && onNavigateToFile) {
                            onNavigateToFile(n.original_file_path);
                          }
                        }}
                        className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-mono border transition-colors ${
                          n.original_file_path && onNavigateToFile
                            ? 'bg-gray-700 text-gray-300 border-gray-600 hover:border-brand-500 hover:text-brand-300 cursor-default'
                            : 'bg-surface-elevated text-gray-500 border-transparent cursor-default'
                        }`}
                      >
                        {n.source_name ? `${n.source_name}.${n.name}` : n.name}
                      </button>
                    ))}
                  </div>
                </Row>
              )}
              {downstreamNodes.length > 0 && (
                <Row label="Referenced By">
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {downstreamNodes.map((n) => (
                      <button
                        key={n.unique_id}
                        title={n.original_file_path ? 'Cmd+click to open in Files' : n.name}
                        onClick={(e) => {
                          if ((e.metaKey || e.ctrlKey) && n.original_file_path && onNavigateToFile) {
                            onNavigateToFile(n.original_file_path);
                          }
                        }}
                        className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-mono border transition-colors ${
                          n.original_file_path && onNavigateToFile
                            ? 'bg-gray-700 text-gray-300 border-gray-600 hover:border-brand-500 hover:text-brand-300 cursor-default'
                            : 'bg-surface-elevated text-gray-500 border-transparent cursor-default'
                        }`}
                      >
                        {n.name}
                      </button>
                    ))}
                  </div>
                </Row>
              )}
            </>
          );
        })()}
      </div>

      {/* Tags */}
      {model.tags.length > 0 && (
        <Row label="Tags">
          <div className="flex flex-wrap mt-0.5">
            {model.tags.map((t) => <Chip key={t} label={`#${t}`} dim />)}
          </div>
        </Row>
      )}

      <div className="border-t border-gray-800" />

      {/* Run controls */}
      {!isTest && (
        <div className="flex flex-col gap-3">
          <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Run</span>

          {/* Run | Build | Test buttons in a row */}
          <div className="grid grid-cols-3 gap-1.5">
            {([
              { cmd: 'run' as RunCommand,   icon: <Play className="w-3.5 h-3.5" />,         label: 'Run' },
              { cmd: 'build' as RunCommand, icon: <Hammer className="w-3.5 h-3.5" />,       label: 'Build' },
              { cmd: 'test' as RunCommand,  icon: <FlaskConical className="w-3.5 h-3.5" />, label: 'Test' },
            ] as const).map(({ cmd, icon, label }) => (
              <button
                key={cmd}
                onClick={() => handleRun(cmd)}
                disabled={loading !== null}
                className="flex items-center justify-center gap-1.5 py-2 text-xs rounded border bg-surface-elevated border-gray-700 text-gray-200 hover:border-brand-600 hover:text-brand-300 transition-colors disabled:opacity-50"
              >
                {loading === cmd ? <Spinner /> : icon}
                {label}
              </button>
            ))}
          </div>

          <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Options</span>

          <RunOptions state={opts} dispatch={dispatchOpts} />
        </div>
      )}

      {/* Test run button */}
      {isTest && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Run</span>
          <button
            onClick={() => handleRun('test')}
            disabled={loading !== null}
            className="flex items-center justify-center gap-2 w-full py-2.5 text-sm rounded bg-surface-elevated border border-gray-700 hover:border-brand-600 hover:text-brand-300 text-gray-200 transition-colors disabled:opacity-50"
          >
            <FlaskConical className="w-4 h-4" />
            {loading ? 'Running…' : 'Run test'}
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col gap-2 pt-2">
        {page === 'dag' && model.original_file_path && (
          <button
            onClick={onNavigateToFiles}
            className="w-full py-2 text-sm rounded bg-brand-900/40 hover:bg-brand-800/60 text-brand-300 border border-brand-800 transition-colors"
          >
            Open in Files
          </button>
        )}
        {page === 'files' && (
          <button
            onClick={onNavigateToDag}
            className="w-full py-2 text-sm rounded bg-brand-900/40 hover:bg-brand-800/60 text-brand-300 border border-brand-800 transition-colors"
          >
            Open in DAG
          </button>
        )}
        <button
          onClick={onViewDocs}
          className="flex items-center justify-center gap-2 w-full py-2 text-sm rounded bg-surface-elevated hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors"
        >
          <BookOpen className="w-4 h-4" />
          View docs
        </button>
        {model.resource_type === 'model' && model.original_file_path && (
          <button
            onClick={onDelete}
            className="w-full py-2 text-sm rounded border border-red-900/50 hover:bg-red-950/30 text-red-500 hover:text-red-400 transition-colors"
          >
            Delete model
          </button>
        )}
      </div>
    </div>
  );
}

// --- Multi-selection run controls ---

const MULTI_RUN_ORDER = ['seed', 'source', 'model', 'snapshot', 'test'] as const;

const TYPE_LABELS: Partial<Record<string, string>> = {
  seed: 'Seeds',
  source: 'Sources',
  model: 'Models',
  snapshot: 'Snapshots',
  test: 'Tests',
};

function applyScope(name: string, upstream: boolean, downstream: boolean): string {
  const prefix = upstream ? '+' : '';
  const suffix = downstream ? '+' : '';
  return `${prefix}${name}${suffix}`;
}

function effectiveCommand(cmd: RunCommand, type: string): 'run' | 'build' | 'test' | 'seed' {
  if (cmd === 'build') return 'build';
  if (type === 'seed') return 'seed';
  if (cmd === 'test') return 'test';
  if (type === 'test' || type === 'source') return 'test';
  return 'run';
}

function MultiSelectionTab({ projectId, selectedModels }: { projectId: number; selectedModels: ModelNode[] }) {
  const [loading, setLoading] = useState<RunCommand | null>(null);
  const [runOpts, dispatchOpts] = useReducer(runOptionsReducer, undefined, runOptionsInitial);

  const grouped = MULTI_RUN_ORDER.reduce<Record<string, ModelNode[]>>((acc, type) => {
    const nodes = selectedModels.filter((m) => m.resource_type === type);
    if (nodes.length) acc[type] = nodes;
    return acc;
  }, {});
  const extraTypes = [...new Set(selectedModels.map((m) => m.resource_type))]
    .filter((t) => !(MULTI_RUN_ORDER as readonly string[]).includes(t));
  for (const t of extraTypes) grouped[t] = selectedModels.filter((m) => m.resource_type === t);
  const orderedTypes = [...MULTI_RUN_ORDER, ...extraTypes].filter((t) => grouped[t]);

  const handleMultiRun = async (cmd: RunCommand) => {
    setLoading(cmd);
    const { _mode, ...opts } = runOptsFromState(runOpts) as RunOpts & { _mode: string };
    try {
      if (cmd === 'build') {
        const select = selectedModels.map((n) => applyScope(n.name, runOpts.upstream, runOpts.downstream)).join(' ');
        await api.runs.build(projectId, '', _mode, opts, select);
      } else {
        for (const type of orderedTypes) {
          const nodes = grouped[type];
          const select = nodes.map((n) => applyScope(n.name, runOpts.upstream, runOpts.downstream)).join(' ');
          const dbtCmd = effectiveCommand(cmd, type);
          if (dbtCmd === 'seed') {
            await api.runs.seed(projectId, '', _mode, opts, select);
          } else if (dbtCmd === 'run') {
            await api.runs.run(projectId, '', _mode, opts, select);
          } else {
            await api.runs.test(projectId, '', _mode, opts, select);
          }
        }
      }
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="overflow-auto flex-1 p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-brand-400 shrink-0" />
        <span className="font-semibold text-gray-100 text-sm">{selectedModels.length} nodes selected</span>
      </div>

      <div className="flex flex-col gap-3">
        {orderedTypes.map((type) => (
          <div key={type}>
            <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium block mb-1">
              {TYPE_LABELS[type] ?? type} ({grouped[type].length})
            </span>
            <div className="flex flex-col gap-0.5">
              {grouped[type].map((n) => (
                <div key={n.unique_id} className="flex items-center gap-2 px-2 py-1 rounded bg-surface-elevated text-xs">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      n.status === 'success' ? 'bg-emerald-400' :
                      n.status === 'error' ? 'bg-red-400' :
                      n.status === 'running' ? 'bg-brand-400 animate-pulse' :
                      n.status === 'stale' ? 'bg-amber-400' :
                      'bg-gray-600'
                    }`}
                  />
                  <span className="font-mono text-gray-300 truncate">{n.name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-800" />

      <div className="flex flex-col gap-3">
        <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Run selection</span>
        <p className="text-[10px] text-gray-600 leading-relaxed">
          Seeds → sources → models → tests, sequentially. Build runs all at once.
        </p>

        <div className="grid grid-cols-3 gap-1.5">
          {([
            { cmd: 'run' as RunCommand,   icon: <Play className="w-3.5 h-3.5" />,         label: 'Run' },
            { cmd: 'build' as RunCommand, icon: <Hammer className="w-3.5 h-3.5" />,       label: 'Build' },
            { cmd: 'test' as RunCommand,  icon: <FlaskConical className="w-3.5 h-3.5" />, label: 'Test' },
          ] as const).map(({ cmd, icon, label }) => (
            <button
              key={cmd}
              onClick={() => handleMultiRun(cmd)}
              disabled={loading !== null}
              className="flex items-center justify-center gap-1.5 py-2 text-xs rounded border bg-surface-elevated border-gray-700 text-gray-200 hover:border-brand-600 hover:text-brand-300 transition-colors disabled:opacity-50"
            >
              {loading === cmd ? (
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                </svg>
              ) : icon}
              {label}
            </button>
          ))}
        </div>

        <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Options</span>

        <RunOptions state={runOpts} dispatch={dispatchOpts} />
      </div>
    </div>
  );
}
