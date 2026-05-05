import { COVERAGE_CLASS, type CoverageBucket } from '../lib/testCoverage';

const BUCKETS: Array<{ bucket: CoverageBucket; label: string }> = [
  { bucket: 'untested', label: 'untested' },
  { bucket: 'low',      label: '1 test' },
  { bucket: 'med',      label: '2 tests' },
  { bucket: 'high',     label: '3+ tests' },
];

export default function CoverageLegend() {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-zinc-800/90 border border-zinc-700 text-[10px] text-zinc-400 shadow-lg">
      {BUCKETS.map(({ bucket, label }) => (
        <span key={bucket} className="flex items-center gap-1">
          <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${COVERAGE_CLASS[bucket].dot}`} />
          {label}
        </span>
      ))}
    </div>
  );
}
