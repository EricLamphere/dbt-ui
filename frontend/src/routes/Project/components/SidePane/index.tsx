import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { api, type ModelNode, type GraphDto } from '../../../../lib/api';
import { PropertiesTab } from './PropertiesTab';
import ProfilePanel from './ProfilePanel';
import { DataTable } from '../../../../components/DataTable';

export type PreviewCache = Map<string, { columns: string[]; rows: unknown[][] }>;

interface SidePaneProps {
  projectId: number;
  model: ModelNode | null;
  selectedModels?: ModelNode[];
  graph: GraphDto | null;
  /** 'files' hides "Edit in Files" and shows "Open in DAG" instead */
  page: 'files' | 'dag';
  onNavigateToFiles?: () => void;
  onNavigateToDag?: () => void;
  onViewDocs?: () => void;
  onDelete?: () => void;
  onNavigateToFile?: (path: string) => void;
  failedTestUid?: string | null;
  onFailedTestConsumed?: () => void;
  previewCache?: PreviewCache;
  onPreviewCached?: (uid: string, data: { columns: string[]; rows: unknown[][] }) => void;
  failedRowsCache?: FailedRowsCache;
  onFailedRowsCached?: (uid: string, data: { columns: string[]; rows: unknown[][] }) => void;
}

const MIN_WIDTH = 200;
const DEFAULT_WIDTH = 320;
const MAX_WIDTH = 1200;
const COLLAPSE_THRESHOLD = 80;

function storageKey(page: string) {
  return `dbt-ui:side-pane-width:${page}`;
}

function readStoredWidth(page: string): number {
  try {
    const v = localStorage.getItem(storageKey(page));
    if (v) {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
  } catch {}
  return DEFAULT_WIDTH;
}

// ---------------------------------------------------------------------------
// DataPreviewPanel — inline Data Preview for the SidePane
// ---------------------------------------------------------------------------

// Module-level guard: prevents concurrent duplicate dbt show invocations for
// the same model. React StrictMode (dev) double-mounts components, so
// useEffect([]) fires twice before the first fetch completes. Without this
// guard both mounts would each start a separate backend dbt show run.
const _previewInflight = new Set<string>();

interface DataPreviewPanelProps {
  projectId: number;
  model: ModelNode;
  previewCache?: PreviewCache;
  onPreviewCached?: (uid: string, data: { columns: string[]; rows: unknown[][] }) => void;
}

function DataPreviewPanel({ projectId, model, previewCache, onPreviewCached }: DataPreviewPanelProps) {
  const key = `${projectId}:${model.unique_id}`;
  const cached = previewCache?.get(model.unique_id) ?? null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // True when another mount has the fetch in-flight; show spinner without
  // duplicating the request.
  const peerInFlight = !cached && !loading && _previewInflight.has(key);

  const fetchPreview = async () => {
    if (_previewInflight.has(key)) return;
    _previewInflight.add(key);
    setLoading(true);
    setError(null);
    try {
      const result = await api.models.show(projectId, model.unique_id, 1000);
      onPreviewCached?.(model.unique_id, result);
    } catch (e) {
      setError(String(e));
    } finally {
      _previewInflight.delete(key);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!cached && !_previewInflight.has(key)) {
      fetchPreview();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs text-gray-500">{cached ? `${cached.rows.length} rows` : ' '}</span>
        <button
          onClick={fetchPreview}
          disabled={loading || peerInFlight}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface-elevated hover:bg-gray-700 text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors"
          title="Re-run dbt show"
        >
          <RotateCw className={`w-3 h-3 ${loading || peerInFlight ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {(loading || peerInFlight) && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Running dbt show…
          </div>
        )}
        {error && !loading && !peerInFlight && (
          <div className="flex items-center justify-center h-full text-red-400 text-sm px-4 text-center">
            {error}
          </div>
        )}
        {!loading && !peerInFlight && !error && cached && cached.rows.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            No rows returned
          </div>
        )}
        {!loading && !peerInFlight && !error && cached && cached.rows.length > 0 && (
          <DataTable
            columns={cached.columns.map((c) => ({ key: c }))}
            rows={cached.rows as unknown[][]}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FailedRowsPanel — runs dbt show on a failing test node
// ---------------------------------------------------------------------------

export type FailedRowsCache = Map<string, { columns: string[]; rows: unknown[][] }>;

// Same StrictMode guard as _previewInflight above.
const _failedRowsInflight = new Set<string>();

interface FailedRowsPanelProps {
  projectId: number;
  model: { unique_id: string };
  failedRowsCache?: FailedRowsCache;
  onFailedRowsCached?: (uid: string, data: { columns: string[]; rows: unknown[][] }) => void;
}

export function FailedRowsPanel({ projectId, model, failedRowsCache, onFailedRowsCached }: FailedRowsPanelProps) {
  const key = `${projectId}:${model.unique_id}`;
  const cached = failedRowsCache?.get(model.unique_id) ?? null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const peerInFlight = !cached && !loading && _failedRowsInflight.has(key);

  const fetchRows = async () => {
    if (_failedRowsInflight.has(key)) return;
    _failedRowsInflight.add(key);
    setLoading(true);
    setError(null);
    try {
      const result = await api.models.show(projectId, model.unique_id, 100);
      onFailedRowsCached?.(model.unique_id, result);
    } catch (e) {
      setError(String(e));
    } finally {
      _failedRowsInflight.delete(key);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!cached && !_failedRowsInflight.has(key)) {
      fetchRows();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs text-gray-500">{cached ? `${cached.rows.length} row${cached.rows.length !== 1 ? 's' : ''}` : ' '}</span>
        <button
          onClick={fetchRows}
          disabled={loading || peerInFlight}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface-elevated hover:bg-gray-700 text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors"
          title="Re-run dbt show"
        >
          <RotateCw className={`w-3 h-3 ${loading || peerInFlight ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {(loading || peerInFlight) && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Running dbt show…
          </div>
        )}
        {error && !loading && !peerInFlight && (
          <div className="flex items-center justify-center h-full text-red-400 text-sm px-4 text-center">
            {error}
          </div>
        )}
        {!loading && !peerInFlight && !error && cached && cached.rows.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            No failing rows
          </div>
        )}
        {!loading && !peerInFlight && !error && cached && cached.rows.length > 0 && (
          <DataTable
            columns={cached.columns.map((c) => ({ key: c }))}
            rows={cached.rows}
          />
        )}
      </div>
    </div>
  );
}

type SidePaneTab = 'properties' | 'preview' | 'profile' | 'failed_rows';

export function SidePane({
  projectId,
  model,
  selectedModels = [],
  graph,
  page,
  onNavigateToFiles,
  onNavigateToDag,
  onViewDocs,
  onDelete,
  onNavigateToFile,
  failedTestUid,
  onFailedTestConsumed,
  previewCache,
  onPreviewCached,
  failedRowsCache,
  onFailedRowsCached,
}: SidePaneProps) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(() => readStoredWidth(page));
  const [activeTab, setActiveTab] = useState<SidePaneTab>('properties');
  const resizing = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const lastWidthRef = useRef(readStoredWidth(page));

  // Auto-open when a model is selected (single or multi)
  useEffect(() => {
    if (model || selectedModels.length > 1) setOpen(true);
  }, [model?.unique_id, selectedModels.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset tab to 'properties' when the selected model changes
  useEffect(() => {
    setActiveTab('properties');
  }, [model?.unique_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-switch to 'failed_rows' tab when failedTestUid matches the current test node
  useEffect(() => {
    if (!model || model.resource_type !== 'test') return;
    if (failedTestUid !== model.unique_id) return;
    onFailedTestConsumed?.();
    setActiveTab('failed_rows');
  }, [failedTestUid, model?.unique_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const delta = startX.current - e.clientX;
      setWidth(Math.max(0, Math.min(MAX_WIDTH, startW.current + delta)));
    };
    const onMouseUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      setWidth((w) => {
        if (w < COLLAPSE_THRESHOLD) {
          setOpen(false);
          return lastWidthRef.current;
        }
        const clamped = Math.max(MIN_WIDTH, w);
        lastWidthRef.current = clamped;
        try { localStorage.setItem(storageKey(page), String(clamped)); } catch {}
        return clamped;
      });
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const toggleOpen = () => {
    setOpen((v) => {
      if (!v) setWidth(lastWidthRef.current);
      return !v;
    });
  };

  return (
    <div className="shrink-0 bg-surface-panel border-l border-gray-700 flex flex-row">
      {/* Drag handle + toggle button strip */}
      <div
        className="flex flex-col items-center justify-between py-2 border-r border-gray-800 select-none cursor-col-resize bg-surface-panel"
        style={{ width: 20 }}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          resizing.current = true;
          startX.current = e.clientX;
          if (open) {
            startW.current = width;
          } else {
            startW.current = 0;
            setOpen(true);
            setWidth(0);
          }
          e.preventDefault();
        }}
      >
        {/* Drag affordance */}
        <div className="flex flex-col gap-0.5 items-center opacity-40 mt-2">
          <div className="w-px h-4 bg-gray-500" />
          <div className="w-px h-4 bg-gray-500" />
          <div className="w-px h-4 bg-gray-500" />
        </div>

        {/* Toggle button */}
        <button
          onClick={toggleOpen}
          className="p-0.5 rounded text-gray-500 hover:text-gray-300 transition-colors mb-2"
          title={open ? 'Collapse panel' : 'Expand panel'}
        >
          {open ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Panel content */}
      <div
        style={{ width: open ? width : 0 }}
        className="overflow-hidden flex flex-col transition-none"
        aria-hidden={!open}
      >
        <div style={{ width }} className="flex flex-col h-full">
          {/* Tab bar */}
          {model && (model.resource_type === 'model' || (model.resource_type === 'test' && (model.status === 'error' || model.status === 'warn' || activeTab === 'failed_rows'))) && (() => {
            const tabs: SidePaneTab[] = model.resource_type === 'model'
              ? ['properties', 'preview', 'profile']
              : ['properties', 'failed_rows'];
            const TAB_LABELS: Record<SidePaneTab, string> = {
              properties: 'Properties',
              preview: 'Data Preview',
              profile: 'Profile',
              failed_rows: 'Failed Rows',
            };
            return (
              <div className="flex items-center gap-0 border-b border-gray-800 shrink-0 px-2">
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                      activeTab === tab
                        ? 'border-brand-500 text-brand-300'
                        : 'border-transparent text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {TAB_LABELS[tab]}
                  </button>
                ))}
              </div>
            );
          })()}

          {/* Tab content */}
          <div className="flex-1 overflow-auto">
            {activeTab === 'preview' && model && model.resource_type === 'model' ? (
              <DataPreviewPanel
                key={model.unique_id}
                projectId={projectId}
                model={model}
                previewCache={previewCache}
                onPreviewCached={onPreviewCached}
              />
            ) : activeTab === 'profile' && model && model.resource_type === 'model' ? (
              <ProfilePanel
                key={model.unique_id}
                projectId={projectId}
                model={model}
              />
            ) : activeTab === 'failed_rows' && model && model.resource_type === 'test' ? (
              <FailedRowsPanel
                key={model.unique_id}
                projectId={projectId}
                model={model}
                failedRowsCache={failedRowsCache}
                onFailedRowsCached={onFailedRowsCached}
              />
            ) : (
              <PropertiesTab
                projectId={projectId}
                model={model}
                selectedModels={selectedModels}
                graph={graph}
                page={page}
                onNavigateToFiles={onNavigateToFiles}
                onNavigateToDag={onNavigateToDag}
                onViewDocs={onViewDocs}
                onDelete={onDelete}
                onNavigateToFile={onNavigateToFile}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
