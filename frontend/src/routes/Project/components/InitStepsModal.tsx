import { useEffect, useRef, useState } from 'react';
import { useProjectEvents } from '../../../lib/sse';

type StepStatus = 'pending' | 'running' | 'success' | 'error';

interface StepState {
  name: string;
  status: StepStatus;
  log?: string;
}

interface Props {
  projectId: number;
  onClose: (success: boolean) => void;
}

export default function InitStepsModal({ projectId, onClose }: Props) {
  const [steps, setSteps] = useState<StepState[]>([]);
  const [done, setDone] = useState(false);
  const [finalStatus, setFinalStatus] = useState<'success' | 'error' | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useProjectEvents(
    projectId,
    (event) => {
      if (event.type === 'init_pipeline_started') {
        const d = event.data as { steps: string[] };
        setSteps(d.steps.map((name) => ({ name, status: 'pending' })));
        setDone(false);
        setFinalStatus(null);
      }
      if (event.type === 'init_step') {
        const d = event.data as {
          name: string;
          status: StepStatus;
          log?: string;
        };
        setSteps((prev) =>
          prev.map((s) =>
            s.name === d.name ? { ...s, status: d.status, log: d.log } : s,
          ),
        );
      }
      if (event.type === 'init_pipeline_finished') {
        const d = event.data as { status: 'success' | 'error' };
        setFinalStatus(d.status);
        setDone(true);
      }
    },
  );

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [expandedLog, steps]);

  const StatusIcon = ({ status }: { status: StepStatus }) => {
    if (status === 'pending')
      return <span className="w-5 h-5 rounded-full border-2 border-gray-600 shrink-0 inline-block" />;
    if (status === 'running')
      return (
        <span className="w-5 h-5 rounded-full border-2 border-blue-400 border-t-transparent shrink-0 inline-block animate-spin" />
      );
    if (status === 'success')
      return (
        <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 shrink-0 flex items-center justify-center text-xs">
          ✓
        </span>
      );
    return (
      <span className="w-5 h-5 rounded-full bg-red-500/20 text-red-400 shrink-0 flex items-center justify-center text-xs">
        ✕
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="flex flex-col w-full max-w-lg bg-gray-900 rounded-xl shadow-2xl border border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-gray-100">Initializing project…</h2>
          {done && (
            <button
              onClick={() => onClose(finalStatus === 'success')}
              className="text-gray-500 hover:text-gray-300 text-lg leading-none"
            >
              ✕
            </button>
          )}
        </div>

        {/* Steps */}
        <div className="flex flex-col gap-2 p-5 max-h-[60vh] overflow-auto">
          {steps.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">Waiting for steps…</p>
          )}
          {steps.map((step) => (
            <div key={step.name} className="flex flex-col gap-1">
              <div
                className="flex items-center gap-3 cursor-pointer"
                onClick={() =>
                  step.log
                    ? setExpandedLog(expandedLog === step.name ? null : step.name)
                    : undefined
                }
              >
                <StatusIcon status={step.status} />
                <span className="text-sm text-gray-200 flex-1">{step.name}</span>
                {step.log && (
                  <span className="text-[10px] text-gray-500 hover:text-gray-400">
                    {expandedLog === step.name ? '▲' : '▼'} logs
                  </span>
                )}
              </div>
              {expandedLog === step.name && step.log && (
                <div
                  ref={logRef}
                  className="ml-8 bg-gray-950 rounded p-3 text-[10px] font-mono text-gray-400 max-h-40 overflow-auto whitespace-pre-wrap"
                >
                  {step.log}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        {done && (
          <div
            className={`px-5 py-4 border-t border-gray-800 flex items-center justify-between ${
              finalStatus === 'success' ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            <span className="text-sm font-medium">
              {finalStatus === 'success' ? '✓ Initialization complete' : '✕ Initialization failed'}
            </span>
            <button
              onClick={() => onClose(finalStatus === 'success')}
              className="px-3 py-1.5 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              {finalStatus === 'success' ? 'Continue →' : 'Close'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
