import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ModelNode } from '../../../../lib/api';
import { ProFeatureButton } from '../../../../components/ProFeatureButton';
import { UpgradeModal } from '../UpgradeModal';
import type { useColumnLineageData } from '../../lib/useColumnLineageData';

type LineageState = ReturnType<typeof useColumnLineageData>;

/** Picked columns per seed: a list, or 'all'. */
export type PickedColumns = ReadonlyMap<string, readonly string[] | 'all'>;

const FEATURE = 'Column-level impact analysis';

function Chip({ active, label, onClick, title }: { active: boolean; label: string; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-1.5 py-0.5 rounded border font-mono text-[11px] transition-colors ${
        active
          ? 'bg-brand-900/60 border-brand-600 text-brand-200'
          : 'bg-surface-elevated border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

function SeedPicker({ seed, columns, picked, onChange }: {
  seed: ModelNode;
  columns: readonly string[];
  picked: readonly string[] | 'all';
  onChange: (next: readonly string[] | 'all') => void;
}) {
  const isPicked = (c: string) => picked === 'all' || picked.includes(c);
  const toggle = (c: string) => {
    const current = picked === 'all' ? columns : picked;
    onChange(current.includes(c) ? current.filter((x) => x !== c) : [...current, c]);
  };
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className="shrink-0 pt-0.5 font-mono text-[11px] text-gray-300">{seed.name}</span>
      <div className="flex flex-wrap gap-1 min-w-0">
        <Chip
          active={picked === 'all'}
          label="all columns"
          title="Treat every column as changed (e.g. a filter or join change)"
          onClick={() => onChange(picked === 'all' ? [] : 'all')}
        />
        {columns.map((c) => <Chip key={c} active={isPicked(c)} label={c} onClick={() => toggle(c)} />)}
        {columns.length === 0 && <span className="text-[11px] text-gray-600">No traced columns</span>}
      </div>
    </div>
  );
}

interface ImpactColumnBarProps {
  lineage: LineageState;
  seeds: readonly ModelNode[];
  columnsFor: (seed: ModelNode) => readonly string[];
  picked: PickedColumns;
  onPick: (uid: string, next: readonly string[] | 'all') => void;
  /** Picks come from the DAG's column selection: show them instead of the picker. */
  fromDag: boolean;
}

function DagSelectionSummary({ seeds, picked }: { seeds: readonly ModelNode[]; picked: PickedColumns }) {
  const labels = seeds.flatMap((s) => {
    const cols = picked.get(s.unique_id);
    return cols && cols !== 'all' ? cols.map((c) => `${s.name}.${c}`) : [];
  });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-gray-500">From your DAG column selection:</span>
      {labels.map((l) => (
        <span key={l} className="px-1.5 py-0.5 rounded border border-brand-600 bg-brand-900/60 font-mono text-[11px] text-brand-200">{l}</span>
      ))}
      <span className="text-[11px] text-gray-600">Click columns on the DAG to change (Cmd+click to add), or click the canvas to clear.</span>
    </div>
  );
}

/** Column-level controls under the Impact toolbar: unlock / load lineage, then pick changed columns. */
export function ImpactColumnBar({ lineage, seeds, columnsFor, picked, onPick, fromDag }: ImpactColumnBarProps) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const body = (() => {
    if (lineage.locked) {
      return (
        <div className="flex items-center gap-3">
          <ProFeatureButton onClick={() => setUpgradeOpen(true)}>Unlock column-level impact</ProFeatureButton>
          <span className="text-xs text-gray-500">See which downstream columns a change reaches, including through filters and joins.</span>
        </div>
      );
    }
    if (lineage.running) {
      return (
        <span className="flex items-center gap-2 text-xs text-gray-400">
          <Loader2 size={12} className="animate-spin" />
          {lineage.compiling ? 'Compiling project…'
            : lineage.progress ? `Tracing column lineage ${lineage.progress.checked}/${lineage.progress.total}…`
            : 'Tracing column lineage…'}
        </span>
      );
    }
    if (!lineage.ready) {
      const outdated = lineage.snapshot?.status === 'done';
      return (
        <div className="flex items-center gap-3">
          <ProFeatureButton onClick={() => lineage.start()}>
            {outdated ? 'Refresh column lineage' : 'Load column lineage'}
          </ProFeatureButton>
          <span className="text-xs text-gray-500">
            {outdated
              ? 'The saved lineage predates filter and join tracking, which column-level impact needs.'
              : 'Column-level impact traces each column through the compiled SQL.'}
          </span>
          {lineage.error && <span className="text-xs text-red-400 truncate">{lineage.error}</span>}
        </div>
      );
    }
    if (fromDag) return <DagSelectionSummary seeds={seeds} picked={picked} />;
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-gray-500">Pick the columns you're changing:</span>
        {seeds.map((seed) => (
          <SeedPicker
            key={seed.unique_id}
            seed={seed}
            columns={columnsFor(seed)}
            picked={picked.get(seed.unique_id) ?? []}
            onChange={(next) => onPick(seed.unique_id, next)}
          />
        ))}
      </div>
    );
  })();

  return (
    <div className="px-4 py-2 border-b border-gray-800 shrink-0 max-h-40 overflow-y-auto">
      {body}
      {upgradeOpen && <UpgradeModal feature={FEATURE} onClose={() => setUpgradeOpen(false)} />}
    </div>
  );
}
