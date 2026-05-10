import { ChevronDown, ChevronRight, Play, Hammer, FlaskConical, Sprout } from 'lucide-react';
import {
  RunOptions,
  type RunOptionsState,
  type RunOptionsAction,
} from './SidePane/PropertiesTab';

export type RunKind = 'run' | 'build' | 'test' | 'seed';

const FULL_PROJECT_BUTTONS: { kind: RunKind; label: string; icon: React.ReactNode; color: string }[] = [
  { kind: 'run',   label: 'Run',   icon: <Play className="w-3.5 h-3.5" />,         color: 'border-blue-700 text-blue-400 hover:bg-blue-900/30 hover:border-blue-500' },
  { kind: 'build', label: 'Build', icon: <Hammer className="w-3.5 h-3.5" />,       color: 'border-purple-700 text-purple-400 hover:bg-purple-900/30 hover:border-purple-500' },
  { kind: 'test',  label: 'Test',  icon: <FlaskConical className="w-3.5 h-3.5" />, color: 'border-yellow-700 text-yellow-400 hover:bg-yellow-900/30 hover:border-yellow-500' },
  { kind: 'seed',  label: 'Seed',  icon: <Sprout className="w-3.5 h-3.5" />,       color: 'border-green-700 text-green-400 hover:bg-green-900/30 hover:border-green-500' },
];

const CUSTOM_RUN_BUTTONS: { kind: RunKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'run',   label: 'Run',   icon: <Play className="w-3.5 h-3.5" /> },
  { kind: 'build', label: 'Build', icon: <Hammer className="w-3.5 h-3.5" /> },
  { kind: 'test',  label: 'Test',  icon: <FlaskConical className="w-3.5 h-3.5" /> },
  { kind: 'seed',  label: 'Seed',  icon: <Sprout className="w-3.5 h-3.5" /> },
];

export interface QuickRunBarProps {
  activeRun: RunKind | null;
  onRun: (kind: RunKind) => void;
  customSelector: string;
  onCustomSelectorChange: (v: string) => void;
  customOpts: RunOptionsState;
  dispatchCustomOpts: (a: RunOptionsAction) => void;
  customActiveRun: RunKind | null;
  onCustomRun: (kind: RunKind) => void;
  customExpanded: boolean;
  onToggleCustomExpanded: () => void;
}

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
    </svg>
  );
}

export function QuickRunBar({
  activeRun,
  onRun,
  customSelector,
  onCustomSelectorChange,
  customOpts,
  dispatchCustomOpts,
  customActiveRun,
  onCustomRun,
  customExpanded,
  onToggleCustomExpanded,
}: QuickRunBarProps) {
  const anyRunning = activeRun !== null || customActiveRun !== null;

  return (
    <div className="mb-4 bg-surface-panel border border-gray-800 rounded-xl overflow-hidden">
      {/* Full-project row */}
      <div className="px-5 py-4">
        <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-3">Quick Run</div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-600 mr-1 shrink-0">Full project:</span>
          {FULL_PROJECT_BUTTONS.map(({ kind, label, icon, color }) => (
            <button
              key={kind}
              onClick={() => onRun(kind)}
              disabled={anyRunning}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed ${color}`}
            >
              {activeRun === kind ? <Spinner /> : icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom run section */}
      <div className="border-t border-gray-800">
        <button
          onClick={onToggleCustomExpanded}
          className="w-full flex items-center gap-2 px-5 py-3 text-xs text-gray-500 hover:text-gray-300 hover:bg-surface-elevated/40 transition-colors"
        >
          {customExpanded
            ? <ChevronDown className="w-3.5 h-3.5 text-gray-600 shrink-0" />
            : <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
          }
          <span className="font-medium">Custom Run</span>
          {!customExpanded && customSelector.trim() && (
            <span className="text-gray-600 font-mono truncate max-w-[200px]">{customSelector.trim()}</span>
          )}
        </button>

        {customExpanded && (
          <div className="px-5 pb-5 flex flex-col gap-4">
            {/* Selector input */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Selector</label>
              <input
                type="text"
                value={customSelector}
                onChange={(e) => onCustomSelectorChange(e.target.value)}
                placeholder="e.g. my_model, tag:nightly, path:models/staging"
                className="w-full px-3 py-2 text-xs bg-surface-elevated border border-gray-700 rounded text-gray-200 font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500 transition-colors"
              />
            </div>

            {/* Run options */}
            <RunOptions state={customOpts} dispatch={dispatchCustomOpts} />

            {/* Execute buttons */}
            <div className="flex flex-col gap-2 pt-1">
              <div className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Execute</div>
              <div className="grid grid-cols-4 gap-2">
                {CUSTOM_RUN_BUTTONS.map(({ kind, label, icon }) => (
                  <button
                    key={kind}
                    onClick={() => onCustomRun(kind)}
                    disabled={anyRunning}
                    className="flex items-center justify-center gap-1.5 py-2 text-xs rounded border bg-surface-elevated border-gray-700 text-gray-300 hover:border-blue-600 hover:text-blue-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                  >
                    {customActiveRun === kind ? <Spinner /> : icon}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
