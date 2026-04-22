import { useEffect, useState } from 'react';
import { BookOpen, Play, Hammer, FlaskConical } from 'lucide-react';
import { api, type ModelNode, type GraphDto } from '../../../../lib/api';

type RunCommand = 'run' | 'build' | 'test';
type RunMode = 'only' | 'upstream' | 'downstream' | 'full';

const RUN_ACTIONS: { cmd: RunCommand; icon: React.ReactNode; label: string }[] = [
  { cmd: 'run',   icon: <Play className="w-4 h-4" />,         label: 'Run' },
  { cmd: 'build', icon: <Hammer className="w-4 h-4" />,       label: 'Build' },
  { cmd: 'test',  icon: <FlaskConical className="w-4 h-4" />, label: 'Test' },
];

const SCOPE_LABELS: Record<RunMode, string> = {
  only: 'Only', upstream: '+ Upstream', downstream: '+ Downstream', full: 'Full',
};

interface PropertiesTabProps {
  projectId: number;
  model: ModelNode | null;
  graph: GraphDto | null;
  page: 'files' | 'dag';
  failedTestUid?: string | null;
  onNavigateToFiles?: () => void;
  onNavigateToDag?: () => void;
  onViewDocs?: () => void;
  onDelete?: () => void;
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

export function PropertiesTab({
  projectId, model, graph, page, failedTestUid,
  onNavigateToFiles, onNavigateToDag, onViewDocs, onDelete,
}: PropertiesTabProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [showRows, setShowRows] = useState<{ columns: string[]; rows: unknown[][] } | null>(null);
  const [loadingShow, setLoadingShow] = useState(false);

  // Auto-fetch failing test rows when this test just failed
  useEffect(() => {
    if (!model || model.resource_type !== 'test') return;
    if (failedTestUid !== model.unique_id) return;
    setLoadingShow(true);
    api.models.show(projectId, model.unique_id, 100)
      .then((r) => setShowRows(r))
      .catch(() => setShowRows(null))
      .finally(() => setLoadingShow(false));
  }, [failedTestUid, model?.unique_id, model?.resource_type, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset showRows when model changes
  useEffect(() => {
    setShowRows(null);
  }, [model?.unique_id]);

  const handleRun = async (cmd: RunCommand, mode: RunMode) => {
    if (!model) return;
    const key = `${cmd}:${mode}`;
    setLoading(key);
    try {
      await (cmd === 'run'
        ? api.runs.run(projectId, model.name, mode)
        : cmd === 'build'
        ? api.runs.build(projectId, model.name, mode)
        : api.runs.test(projectId, model.name, mode));
    } finally {
      setLoading(null);
    }
  };

  if (!model) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm select-none px-4 text-center">
        Select a model to view its properties
      </div>
    );
  }

  const isTest = model.resource_type === 'test';

  const upstreamCount = graph
    ? graph.edges.filter((e) => e.target === model.unique_id).length
    : null;
  const downstreamCount = graph
    ? graph.edges.filter((e) => e.source === model.unique_id).length
    : null;

  return (
    <div className="overflow-auto flex-1 p-4 flex flex-col gap-4">
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

      {/* Error/warn message only */}
      {model.message && ERROR_STATUSES.has(model.status) && (
        <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded px-3 py-2">
          {model.message}
        </p>
      )}

      {/* Description */}
      {model.description && (
        <Row label="Description">
          <span className="text-gray-300 leading-relaxed">{model.description}</span>
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

        {(upstreamCount !== null || downstreamCount !== null) && (
          <Row label="Dependencies">
            <span className="font-mono">
              {upstreamCount ?? '—'} upstream · {downstreamCount ?? '—'} downstream
            </span>
          </Row>
        )}
      </div>

      {/* Tags */}
      {model.tags.length > 0 && (
        <Row label="Tags">
          <div className="flex flex-wrap mt-0.5">
            {model.tags.map((t) => <Chip key={t} label={`#${t}`} dim />)}
          </div>
        </Row>
      )}

      {/* Divider */}
      <div className="border-t border-gray-800" />

      {/* Run controls */}
      {!isTest && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Run</span>
          {RUN_ACTIONS.map(({ cmd, icon, label }) => (
            <div key={cmd} className="grid grid-cols-4 gap-1">
              {(['only', 'upstream', 'downstream', 'full'] as RunMode[]).map((mode) => {
                const key = `${cmd}:${mode}`;
                return (
                  <button
                    key={mode}
                    title={`${label} ${SCOPE_LABELS[mode]}`}
                    onClick={() => handleRun(cmd, mode)}
                    disabled={loading !== null}
                    className={`flex items-center justify-center gap-1.5 py-2 px-1 text-xs rounded border transition-colors disabled:opacity-50
                      ${mode === 'only'
                        ? 'bg-surface-elevated border-gray-700 text-gray-200 hover:border-brand-600 hover:text-brand-300'
                        : 'bg-transparent border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300'
                      }`}
                  >
                    {loading === key ? (
                      <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                      </svg>
                    ) : (
                      <>
                        {mode === 'only' && icon}
                        <span className="truncate">{mode === 'only' ? label : SCOPE_LABELS[mode]}</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Test run button */}
      {isTest && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Run</span>
          <button
            onClick={() => handleRun('test', 'only')}
            disabled={loading !== null}
            className="flex items-center justify-center gap-2 w-full py-2.5 text-sm rounded bg-surface-elevated border border-gray-700 hover:border-brand-600 hover:text-brand-300 text-gray-200 transition-colors disabled:opacity-50"
          >
            <FlaskConical className="w-4 h-4" />
            {loading ? 'Running…' : 'Run test'}
          </button>
        </div>
      )}

      {/* Failing test rows */}
      {isTest && loadingShow && (
        <p className="text-xs text-gray-500">Loading failing rows…</p>
      )}
      {isTest && showRows && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-red-400 font-medium">
            {showRows.rows.length} failing row{showRows.rows.length !== 1 ? 's' : ''}
          </p>
          <div className="overflow-auto max-h-48 rounded border border-gray-800">
            <table className="w-full text-[11px] text-gray-300 border-collapse">
              <thead>
                <tr className="bg-surface-elevated">
                  {showRows.columns.map((c) => (
                    <th key={c} className="px-2 py-1 text-left text-gray-500 font-medium border-b border-gray-800 whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {showRows.rows.map((row, i) => (
                  <tr key={i} className="border-b border-gray-800/50 hover:bg-surface-elevated/40">
                    {(row as unknown[]).map((cell, j) => (
                      <td key={j} className="px-2 py-1 font-mono whitespace-nowrap">{String(cell ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col gap-2 mt-auto pt-2">
        {page === 'dag' && model.original_file_path && (
          <button
            onClick={onNavigateToFiles}
            className="w-full py-2 text-sm rounded bg-brand-900/40 hover:bg-brand-800/60 text-brand-300 border border-brand-800 transition-colors"
          >
            Edit in Files
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
