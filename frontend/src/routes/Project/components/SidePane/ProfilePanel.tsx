import { useState } from 'react';
import { api, type ModelNode, type ProfileResponse } from '../../../../lib/api';
import { DataTable, type ColumnDef } from '../../../../components/DataTable';

interface ProfilePanelProps {
  projectId: number;
  model: ModelNode;
}

type Status = 'idle' | 'loading' | 'success' | 'error';

// Session-level cache so results survive navigating away and back
const _cache = new Map<string, ProfileResponse>();

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
    </svg>
  );
}

function pct(val: number | null): string {
  if (val === null) return '—';
  return `${(val * 100).toFixed(1)}%`;
}

function fmt(val: string | null): string {
  return val ?? '—';
}

export default function ProfilePanel({ projectId, model }: ProfilePanelProps) {
  const cached = _cache.get(model.unique_id) ?? null;
  const [status, setStatus] = useState<Status>(cached ? 'success' : 'idle');
  const [result, setResult] = useState<ProfileResponse | null>(cached);
  const [error, setError] = useState<string | null>(null);

  const canProfile = model.resource_type === 'model' || model.resource_type === 'snapshot' || model.resource_type === 'seed';

  const handleProfile = async () => {
    setStatus('loading');
    setError(null);
    try {
      const r = await api.models.profile(projectId, model.unique_id);
      _cache.set(model.unique_id, r);
      setResult(r);
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Profile failed');
      setStatus('error');
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Run button + summary */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleProfile}
          disabled={status === 'loading' || !canProfile}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded border border-gray-700 bg-surface-elevated text-gray-300 hover:border-gray-500 hover:text-white transition-colors disabled:opacity-40 shrink-0"
        >
          {status === 'loading' ? <Spinner /> : null}
          {status === 'loading' ? 'Running…' : 'Run Profile'}
        </button>

        {status === 'success' && result && (
          <span className="text-sm text-gray-500">
            <span className="text-gray-200 font-mono">{result.row_count.toLocaleString()}</span> rows
            &nbsp;·&nbsp;
            <span className="text-gray-200 font-mono">{result.column_count}</span> columns
            &nbsp;·&nbsp;{result.duration_ms}ms
          </span>
        )}
      </div>

      <div className="text-sm text-gray-500 leading-relaxed">
        <span className="text-gray-400 font-medium">Notes:</span>
        <ul className="mt-1 ml-2 flex flex-col gap-1">
          {model.materialized === 'view' && (
            <li className="text-amber-400/80">Profiling a view re-runs the underlying query — may be slow.</li>
          )}
          <li>Type is inherited from the manifest. Add <code className="text-gray-300 bg-surface-elevated px-1 rounded text-xs">data_type: &lt;type&gt;</code> to your <code className="text-gray-300 bg-surface-elevated px-1 rounded text-xs">schema.yml</code> column configs to populate.</li>
        </ul>
      </div>

      {status === 'error' && (
        <p className="text-sm text-red-400 bg-red-950/20 border border-red-900/30 rounded px-3 py-2 break-all">
          {error}
        </p>
      )}

      {status === 'idle' && (
        <p className="text-sm text-gray-600">Click "Run Profile" to profile this model.</p>
      )}

      {status === 'loading' && (
        <p className="text-sm text-gray-500 flex items-center gap-2">
          <Spinner />
          Profiling… this may take a moment.
        </p>
      )}

      {status === 'success' && result && (() => {
        const profileCols: ColumnDef[] = [
          { key: 'Column' },
          { key: 'Type' },
          { key: 'Nulls%', align: 'right' },
          { key: 'Distinct', align: 'right' },
          { key: 'Min', align: 'right' },
          { key: 'Max', align: 'right' },
        ];
        const profileRows: unknown[][] = result.columns.map((col) => [
          col.name,
          col.data_type || '—',
          col.null_count !== null ? pct(col.null_pct) : '—',
          col.distinct_count !== null ? col.distinct_count.toLocaleString() : '—',
          fmt(col.min_value),
          fmt(col.max_value),
        ]);
        return (
          <DataTable columns={profileCols} rows={profileRows} />
        );
      })()}
    </div>
  );
}
