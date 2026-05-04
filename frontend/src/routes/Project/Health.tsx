import { useState } from 'react';
import { useParams } from 'react-router-dom';
import NavRail from './components/NavRail';
import HealthCheckPanel from './components/HealthCheckPanel';
import DriftPanel from './components/DriftPanel';

type HealthTab = 'health-check' | 'schema-drift';

const TABS: { id: HealthTab; label: string }[] = [
  { id: 'health-check', label: 'dbt Health Check' },
  { id: 'schema-drift', label: 'Schema Drift' },
];

export default function HealthPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const storageKey = `health-tab:${id}`;
  const [activeTab, setActiveTab] = useState<HealthTab>(
    () => (sessionStorage.getItem(storageKey) as HealthTab) ?? 'health-check'
  );

  function handleTabChange(tab: HealthTab) {
    sessionStorage.setItem(storageKey, tab);
    setActiveTab(tab);
  }

  return (
    <div className="flex h-full overflow-hidden">
      <NavRail projectId={id} current="health" />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Page header + tab bar */}
        <div className="shrink-0 border-b border-gray-800 px-6 pt-5 pb-0 bg-surface-app">
          <div className="flex items-center gap-2.5 mb-4">
            <svg
              className="w-5 h-5 text-rose-400 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 12h3l2-4 3 8 2-4 1 2h3.5" strokeWidth={1.5} />
            </svg>
            <h1 className="text-base font-semibold text-gray-100">Health</h1>
          </div>

          <div className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`px-4 py-2 text-sm rounded-t transition-colors border-b-2 -mb-px ${
                  activeTab === tab.id
                    ? 'text-brand-300 border-brand-500 font-medium'
                    : 'text-gray-500 border-transparent hover:text-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-auto">
          {activeTab === 'health-check' && (
            <div className="p-6 pb-12 max-w-3xl mx-auto w-full">
              <HealthCheckPanel projectId={id} />
            </div>
          )}
          {activeTab === 'schema-drift' && <DriftPanel projectId={id} />}
        </div>
      </div>
    </div>
  );
}
