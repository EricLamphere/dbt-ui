import { useMemo, useRef, useState, useEffect } from 'react';
import { X, ChevronDown, FlaskConical } from 'lucide-react';
import type { GraphDto } from '../../../lib/api';
import { type FilterState, emptyFilter, isFilterActive, getAvailableFilters } from '../lib/dagFilter';

interface FilterDropdownProps {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  closeSignal: number;
}

function FilterDropdown({ label, options, selected, onChange, closeSignal }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (closeSignal > 0) setOpen(false);
  }, [closeSignal]);

  if (options.length === 0) return null;

  const count = selected.size;

  const toggle = (opt: string) => {
    const next = new Set(selected);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange(next);
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded border transition-colors ${
          count > 0
            ? 'bg-brand-600/20 border-brand-500 text-brand-300'
            : 'bg-surface-elevated border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
        }`}
      >
        {label}
        {count > 0 && (
          <span className="ml-0.5 bg-brand-500 text-white rounded-full px-1 text-[10px] leading-none py-0.5">
            {count}
          </span>
        )}
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[140px] bg-gray-900 border border-gray-700 rounded shadow-xl py-1">
          {options.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(opt)}
                onChange={() => toggle(opt)}
                className="accent-brand-500"
              />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

interface DagFilterBarProps {
  graph: GraphDto | null;
  filter: FilterState;
  onChange: (f: FilterState) => void;
  nodeCount: number;
  compiling: boolean;
  onRefresh: () => void;
  onNewModel: () => void;
  closeDropdownsSignal?: number;
  coverageOverlay?: boolean;
  onToggleCoverage?: () => void;
  columnLineageLoaded: boolean;
  columnLineageLoading: boolean;
  onLoadColumnLineage: () => void;
}

export default function DagFilterBar({
  graph,
  filter,
  onChange,
  nodeCount,
  compiling,
  onRefresh,
  onNewModel,
  closeDropdownsSignal = 0,
  coverageOverlay,
  onToggleCoverage,
  columnLineageLoaded,
  columnLineageLoading,
  onLoadColumnLineage,
}: DagFilterBarProps) {
  const available = useMemo(
    () => (graph ? getAvailableFilters(graph) : { resourceTypes: [], materializations: [], tags: [], statuses: [] }),
    [graph],
  );

  const anyActive = isFilterActive(filter);

  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    onChange({ ...filter, [key]: value });

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-surface-panel border-b border-gray-800 flex-wrap">
      {/* Text selector input */}
      <input
        type="search"
        placeholder="Filter: +model, tag:nightly, source:…"
        value={filter.selector}
        onChange={(e) => set('selector', e.target.value)}
        className="flex-1 min-w-[180px] bg-surface-elevated border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />

      {/* Dropdown filters */}
      <FilterDropdown
        label="Type"
        options={available.resourceTypes}
        selected={filter.resourceTypes}
        onChange={(v) => set('resourceTypes', v)}
        closeSignal={closeDropdownsSignal}
      />
      <FilterDropdown
        label="Materialization"
        options={available.materializations}
        selected={filter.materializations}
        onChange={(v) => set('materializations', v)}
        closeSignal={closeDropdownsSignal}
      />
      <FilterDropdown
        label="Tag"
        options={available.tags}
        selected={filter.tags}
        onChange={(v) => set('tags', v)}
        closeSignal={closeDropdownsSignal}
      />
      <FilterDropdown
        label="Status"
        options={available.statuses}
        selected={filter.statuses}
        onChange={(v) => set('statuses', v)}
        closeSignal={closeDropdownsSignal}
      />

      {/* Coverage overlay toggle */}
      {onToggleCoverage && (
        <button
          onClick={onToggleCoverage}
          title="Toggle column-level test coverage overlay"
          className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded border transition-colors shrink-0 ${
            coverageOverlay
              ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
              : 'bg-surface-elevated border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
          }`}
        >
          <FlaskConical size={12} />
          Coverage
        </button>
      )}

      {/* Clear */}
      {anyActive && (
        <button
          onClick={() => onChange(emptyFilter())}
          className="flex items-center gap-1 px-2 py-1.5 text-xs rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
        >
          <X size={12} />
          Clear
        </button>
      )}

      {/* Node count */}
      <span className="text-xs text-gray-500 shrink-0">{nodeCount} nodes</span>

      {/* Compiling spinner */}
      {compiling && (
        <span className="flex items-center gap-1.5 text-xs text-brand-400 shrink-0">
          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
          </svg>
          Compiling…
        </span>
      )}

      {/* Action buttons */}
      <button
        onClick={onLoadColumnLineage}
        disabled={columnLineageLoading}
        className="px-3 py-1.5 text-xs rounded bg-surface-elevated hover:bg-gray-700 text-gray-400 disabled:opacity-50 transition-colors shrink-0"
      >
        {columnLineageLoading ? 'Column lineage loading…' : columnLineageLoaded ? 'Refresh column lineage' : 'Load column lineage'}{!columnLineageLoading && <span className="ml-1 text-[10px] text-zinc-500">(beta)</span>}
      </button>
      <button
        onClick={onRefresh}
        disabled={compiling}
        className="px-3 py-1.5 text-xs rounded bg-surface-elevated hover:bg-gray-700 text-gray-300 disabled:opacity-50 transition-colors shrink-0"
      >
        ↻ Refresh DAG
      </button>
      <button
        onClick={onNewModel}
        className="px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors shrink-0"
      >
        + New model
      </button>
    </div>
  );
}
