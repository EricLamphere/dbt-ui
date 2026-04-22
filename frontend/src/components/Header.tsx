import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

function ProjectSelectors({ projectId }: { projectId: number }) {
  const qc = useQueryClient();

  const { data: profiles } = useQuery({
    queryKey: ['profiles', projectId],
    queryFn: () => api.profiles.list(projectId),
    enabled: !!projectId,
    refetchInterval: false,
  });

  const { data: targetsData } = useQuery({
    queryKey: ['dbt-targets', projectId],
    queryFn: () => api.profiles.dbtTargets(projectId),
    enabled: !!projectId,
    refetchInterval: false,
  });

  const { data: activeTargetData } = useQuery({
    queryKey: ['dbt-target', projectId],
    queryFn: () => api.profiles.getDbtTarget(projectId),
    enabled: !!projectId,
    refetchInterval: false,
  });

  const activeProfile = profiles?.find((p) => p.is_active);
  const activeTarget = activeTargetData?.target ?? targetsData?.default_target ?? null;

  const handleProfileChange = async (profileId: number) => {
    await api.profiles.activate(projectId, profileId);
    qc.invalidateQueries({ queryKey: ['profiles', projectId] });
  };

  const handleTargetChange = async (target: string) => {
    await api.profiles.setDbtTarget(projectId, target);
    qc.invalidateQueries({ queryKey: ['dbt-target', projectId] });
  };

  if (!profiles?.length && !targetsData?.targets.length) return null;

  return (
    <div className="flex items-center gap-2">
      {profiles && profiles.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Profile</span>
          <select
            value={activeProfile?.id ?? ''}
            onChange={(e) => handleProfileChange(Number(e.target.value))}
            className="bg-surface-elevated border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {targetsData && targetsData.targets.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Target</span>
          <select
            value={activeTarget ?? ''}
            onChange={(e) => handleTargetChange(e.target.value)}
            className="bg-surface-elevated border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
          >
            {targetsData.targets.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const isHomepage = location.pathname === '/';
  // Header is outside <Routes> so useParams returns {}; extract projectId from path directly
  const projectIdMatch = location.pathname.match(/^\/projects\/(\d+)/);
  const numericProjectId = projectIdMatch ? Number(projectIdMatch[1]) : null;

  return (
    <header className="flex items-center justify-between px-4 h-12 bg-surface-panel border-b border-gray-800 shrink-0 z-50">
      {/* Left — home */}
      <Link
        to="/"
        className="flex items-center gap-2 text-brand-400 hover:text-brand-300 font-semibold text-sm transition-colors"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7m-9 5v6h4v-6m-4 0H9m6 0h2" />
        </svg>
        dbt-ui
      </Link>

      {/* Right actions */}
      <div className="flex items-center gap-3">
        {numericProjectId && (
          <>
            <ProjectSelectors projectId={numericProjectId} />
            <div className="w-px h-5 bg-gray-800" />
            <button
              onClick={() => navigate(`/projects/${numericProjectId}`)}
              className="px-3 py-1.5 text-xs rounded bg-surface-elevated hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
            >
              Project home
            </button>
          </>
        )}
        {isHomepage && (
          <>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('dbt-ui:global-settings'))}
              className="p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-surface-elevated transition-colors"
              title="Global settings"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('dbt-ui:new-project'))}
              className="px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors"
            >
              + New project
            </button>
          </>
        )}
      </div>
    </header>
  );
}
