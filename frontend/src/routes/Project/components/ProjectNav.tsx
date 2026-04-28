import { Link, NavLink } from 'react-router-dom';

export type CurrentPage = 'dag' | 'init' | 'files' | 'environment' | 'docs' | 'git';

interface Props {
  projectId: number;
  current: CurrentPage;
}

const DAG_ICON = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zm0 9.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zm9.75-9.75A2.25 2.25 0 0115.75 3.75H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zm0 9.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
  </svg>
);

const INIT_ICON = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

const FILES_ICON = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
  </svg>
);

const ENV_ICON = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
  </svg>
);

const DOCS_ICON = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
  </svg>
);

const GIT_ICON = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M12 5v7m0 0l-3-3m3 3l3-3M6 19a2 2 0 100-4 2 2 0 000 4zm12 0a2 2 0 100-4 2 2 0 000 4zM6 7a2 2 0 100-4 2 2 0 000 4z" />
  </svg>
);

const SETUP_ITEMS: { key: CurrentPage; label: string; icon: React.ReactNode; path: string }[] = [
  { key: 'environment',  label: 'Environment',    icon: ENV_ICON,  path: 'environment' },
  { key: 'init',         label: 'Initialization', icon: INIT_ICON, path: 'init' },
];

const PROJECT_ITEMS: { key: CurrentPage; label: string; icon: React.ReactNode; path: string }[] = [
  { key: 'files',  label: 'Files',          icon: FILES_ICON, path: 'files' },
  { key: 'dag',    label: 'DAG',            icon: DAG_ICON,   path: 'models' },
  { key: 'docs',   label: 'Docs',           icon: DOCS_ICON,  path: 'docs' },
  { key: 'git',    label: 'Source Control', icon: GIT_ICON,   path: 'git' },
];

function NavSection({
  label,
  items,
  projectId,
  current,
}: {
  label: string;
  items: typeof SETUP_ITEMS;
  projectId: number;
  current: CurrentPage;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-600 select-none">
        {label}
      </p>
      {items.map((item) => {
        const isActive = item.key === current;
        return (
          <NavLink
            key={item.key}
            to={`/projects/${projectId}/${item.path}`}
            className={`flex items-center gap-2.5 mx-2 px-3 py-2 rounded-lg text-sm transition-colors
              ${isActive
                ? 'bg-brand-900/40 text-brand-300 font-medium'
                : 'text-gray-400 hover:bg-surface-elevated hover:text-gray-200'
              }`}
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
          </NavLink>
        );
      })}
    </div>
  );
}

export default function ProjectNav({ projectId, current }: Props) {
  return (
    <nav className="flex flex-col pt-2 overflow-hidden h-full">
      <Link
        to={`/projects/${projectId}`}
        className="mx-2 px-3 py-2 text-sm text-gray-400 hover:text-gray-200 hover:bg-surface-elevated rounded-lg transition-colors"
      >
        ← Project home
      </Link>
      <div className="mx-4 my-2 border-t border-gray-800" />
      <div className="flex flex-col overflow-y-auto">
        <NavSection label="Setup"   items={SETUP_ITEMS}   projectId={projectId} current={current} />
        <NavSection label="Project" items={PROJECT_ITEMS} projectId={projectId} current={current} />
      </div>
    </nav>
  );
}
