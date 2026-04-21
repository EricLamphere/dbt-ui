import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { api } from '../../lib/api';
import { useProjectEvents } from '../../lib/sse';

const PLATFORM_ICONS: Record<string, string> = {
  postgres: '🐘', bigquery: '☁️', snowflake: '❄️', redshift: '⬡',
  duckdb: '🦆', spark: '⚡', databricks: '🧱', athena: '🏺',
  trino: '🔷', clickhouse: '🔴', unknown: '⬡',
};

// Editors that use URL protocols (frontend-only open)
const PROTOCOL_EDITORS: { id: string; label: string; protocol: string }[] = [
  { id: 'vscode',  label: 'VS Code',  protocol: 'vscode://file' },
  { id: 'cursor',  label: 'Cursor',   protocol: 'cursor://file' },
];

// Editors that use backend open-in-app (no reliable URL protocol)
const APP_EDITORS: { id: string; label: string; appName: string }[] = [
  { id: 'sublime', label: 'Sublime Text', appName: 'Sublime Text' },
  { id: 'finder',  label: 'Finder',       appName: 'Finder' },
];

type Editor =
  | { id: string; label: string; kind: 'protocol'; protocol: string }
  | { id: string; label: string; kind: 'app'; appName: string }
  | { id: 'other'; label: 'Other'; kind: 'other' };

const ALL_EDITORS: Editor[] = [
  ...PROTOCOL_EDITORS.map((e) => ({ ...e, kind: 'protocol' as const })),
  ...APP_EDITORS.map((e) => ({ ...e, kind: 'app' as const })),
  { id: 'other', label: 'Other', kind: 'other' },
];

const PREF_KEY = 'dbt-ui:preferred-editor';
// For "other" picked app
const OTHER_APP_KEY = 'dbt-ui:other-app-name';

function getPreferredEditor(): Editor {
  const saved = localStorage.getItem(PREF_KEY);
  return ALL_EDITORS.find((e) => e.id === saved) ?? ALL_EDITORS[0];
}

async function openInEditor(editor: Editor, projectPath: string, otherAppName?: string) {
  if (editor.kind === 'protocol') {
    window.open(`${editor.protocol}${projectPath}`, '_self');
  } else if (editor.kind === 'app') {
    await api.projects.openInApp(editor.appName, projectPath);
  } else if (editor.kind === 'other' && otherAppName) {
    await api.projects.openInApp(otherAppName, projectPath);
  }
}

export default function ProjectHome() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const navigate = useNavigate();

  const { data: project, isLoading, error } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.projects.get(id),
  });

  const [preferredEditor, setPreferredEditor] = useState<Editor>(getPreferredEditor);
  const [otherAppName, setOtherAppName] = useState<string>(
    () => localStorage.getItem(OTHER_APP_KEY) ?? ''
  );
  const [editorPickerOpen, setEditorPickerOpen] = useState(false);
  const [appPickerOpen, setAppPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  type InitStatus = 'idle' | 'running' | 'success' | 'error';
  const [initStatus, setInitStatus] = useState<InitStatus>('idle');
  const [initError, setInitError] = useState<string>('');

  const initMutation = useMutation({
    mutationFn: () => api.init.open(id),
    onMutate: () => {
      setInitStatus('running');
      setInitError('');
    },
  });

  useProjectEvents(id, (event) => {
    if (event.type === 'init_pipeline_started') {
      setInitStatus('running');
      setInitError('');
    }
    if (event.type === 'init_pipeline_finished') {
      const data = event.data as { status: string; failed_step?: string };
      if (data.status === 'success') {
        setInitStatus('success');
      } else {
        setInitStatus('error');
        setInitError(data.failed_step ? `Failed at step: ${data.failed_step}` : 'Setup failed');
      }
    }
  });

  // Close dropdown on outside click
  useEffect(() => {
    if (!editorPickerOpen) return;
    const dismiss = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setEditorPickerOpen(false);
      }
    };
    window.addEventListener('mousedown', dismiss);
    return () => window.removeEventListener('mousedown', dismiss);
  }, [editorPickerOpen]);

  if (isLoading) return <div className="p-8 text-gray-500 text-sm">Loading…</div>;
  if (error || !project) return <div className="p-8 text-red-400 text-sm">Project not found.</div>;

  const platformIcon = PLATFORM_ICONS[project.platform?.toLowerCase()] ?? PLATFORM_ICONS.unknown;

  const editorLabel =
    preferredEditor.kind === 'other' && otherAppName
      ? otherAppName
      : preferredEditor.label;

  const handleOpenEditor = () => {
    openInEditor(preferredEditor, project.path, otherAppName || undefined);
  };

  const handleSelectEditor = (editor: Editor) => {
    if (editor.kind === 'other') {
      setEditorPickerOpen(false);
      setAppPickerOpen(true);
      return;
    }
    setPreferredEditor(editor);
    localStorage.setItem(PREF_KEY, editor.id);
    setEditorPickerOpen(false);
    openInEditor(editor, project.path);
  };

  const handleAppPicked = (appName: string) => {
    setOtherAppName(appName);
    localStorage.setItem(OTHER_APP_KEY, appName);
    const otherEditor: Editor = { id: 'other', label: 'Other', kind: 'other' };
    setPreferredEditor(otherEditor);
    localStorage.setItem(PREF_KEY, 'other');
    setAppPickerOpen(false);
    api.projects.openInApp(appName, project.path);
  };

  return (
    <div className="flex-1 overflow-auto p-6 max-w-4xl mx-auto w-full">
      {/* Header tile */}
      <div className="bg-surface-panel border border-gray-800 rounded-xl px-6 py-5 mb-6 w-full">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{platformIcon}</span>
              <h1 className="text-xl font-bold text-gray-100">{project.name}</h1>
            </div>
            <p className="text-xs text-gray-500 font-mono mt-1 truncate">{project.path}</p>
          </div>
          <div className="flex items-center gap-6 shrink-0 ml-8">
            <div className="text-right">
              <dt className="text-[10px] text-gray-600 uppercase tracking-wider">Platform</dt>
              <dd className="text-sm text-gray-200 font-medium capitalize mt-0.5">{project.platform}</dd>
            </div>
            {project.profile && (
              <div className="text-right">
                <dt className="text-[10px] text-gray-600 uppercase tracking-wider">Profile</dt>
                <dd className="text-sm text-gray-200 font-medium mt-0.5">{project.profile}</dd>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => initMutation.mutate()}
                disabled={initStatus === 'running'}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-medium transition-colors whitespace-nowrap"
              >
                {initStatus === 'running' && (
                  <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
                  </svg>
                )}
                {initStatus === 'running' ? 'Running…' : 'Initialize'}
              </button>
              {initStatus !== 'idle' && initStatus !== 'running' && (
                <InitStatusBadge status={initStatus} errorMessage={initError} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Action tiles — order: File Explorer, Open in editor, Docs, DAG, Environment, Initialization */}
      <div className="grid grid-cols-2 gap-3">
        <ActionTile
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
            </svg>
          }
          title="File Explorer"
          description="Browse, view, and edit files in your project directory"
          onClick={() => navigate(`/projects/${id}/files`)}
        />

        {/* Editor tile — split button */}
        <div className="relative" ref={pickerRef}>
          <div className="group flex bg-surface-panel border border-gray-800 hover:border-brand-700 rounded-xl overflow-hidden transition-colors">
            {/* Main open button */}
            <button
              onClick={handleOpenEditor}
              className="flex-1 flex flex-col gap-3 px-5 py-4 text-left hover:bg-surface-elevated/60 transition-colors"
            >
              <div className="text-brand-400 group-hover:text-brand-300 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-100 mb-1">Open in {editorLabel}</div>
                <div className="text-xs text-gray-500 leading-relaxed">Open this project in your preferred editor</div>
              </div>
            </button>

            {/* Chevron — opens picker */}
            <button
              onClick={(e) => { e.stopPropagation(); setEditorPickerOpen((o) => !o); }}
              className="px-3 border-l border-gray-800 text-gray-600 hover:text-gray-300 hover:bg-surface-elevated/60 transition-colors"
              title="Choose editor"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {/* Editor picker dropdown */}
          {editorPickerOpen && (
            <div className="absolute bottom-full mb-1 right-0 min-w-[180px] bg-surface-panel border border-gray-700 rounded-lg shadow-xl py-1 z-50">
              {ALL_EDITORS.map((editor) => {
                const isActive = editor.id === preferredEditor.id;
                const label = editor.kind === 'other' && otherAppName ? `Other (${otherAppName})` : editor.label;
                return (
                  <button
                    key={editor.id}
                    onClick={() => handleSelectEditor(editor)}
                    className={`w-full text-left px-4 py-2 text-xs transition-colors
                      ${isActive ? 'text-brand-300 bg-brand-900/30' : 'text-gray-300 hover:bg-gray-800'}`}
                  >
                    {label}
                    {isActive && <span className="ml-2 text-brand-400">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <ActionTile
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          }
          title="Docs"
          description="Browse generated dbt documentation for models, sources, and tests"
          onClick={() => navigate(`/projects/${id}/docs`)}
        />

        <ActionTile
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zm0 9.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zm9.75-9.75A2.25 2.25 0 0115.75 3.75H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zm0 9.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
          }
          title="DAG"
          description="Visualize your project's model graph, run builds and tests, and edit SQL"
          onClick={() => navigate(`/projects/${id}/models`)}
        />

        <ActionTile
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
          }
          title="Environment"
          description="Manage environment profiles and global variables for init scripts"
          onClick={() => navigate(`/projects/${id}/environment`)}
        />

        <ActionTile
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
            </svg>
          }
          title="Initialization"
          description="Add or update initialization scripts that run during project setup"
          onClick={() => navigate(`/projects/${id}/init`)}
        />
      </div>

      {/* README */}
      {project.readme && (
        <div className="mt-6 bg-surface-panel border border-gray-800 rounded-xl px-6 py-5">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">README</h2>
          <div className="prose-readme">
            <ReactMarkdown>{project.readme}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* App picker modal */}
      {appPickerOpen && (
        <AppPickerModal
          currentApp={otherAppName}
          onPick={handleAppPicked}
          onClose={() => setAppPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ---- Init status badge ----

function InitStatusBadge({ status, errorMessage }: { status: 'success' | 'error'; errorMessage: string }) {
  const [hovered, setHovered] = useState(false);
  const tooltip = status === 'success' ? 'Complete' : `Failed\n${errorMessage}`;

  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {status === 'success' ? (
        <svg className="w-4 h-4 text-green-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg className="w-4 h-4 text-red-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      )}
      {hovered && (
        <div className="absolute right-6 top-1/2 -translate-y-1/2 z-50 min-w-max max-w-xs bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 shadow-xl pointer-events-none">
          <pre className="text-xs text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">{tooltip}</pre>
        </div>
      )}
    </div>
  );
}

// ---- App picker modal ----

function AppPickerModal({
  currentApp,
  onPick,
  onClose,
}: {
  currentApp: string;
  onPick: (appName: string) => void;
  onClose: () => void;
}) {
  const { data: apps = [], isLoading } = useQuery({
    queryKey: ['applications'],
    queryFn: () => api.projects.listApplications(),
  });
  const [search, setSearch] = useState('');

  const filtered = apps.filter((a) => a.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex flex-col bg-surface-panel border border-gray-700 rounded-lg shadow-xl w-80 max-h-[70vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold text-gray-100">Open with…</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm">✕</button>
        </div>
        <div className="px-3 py-2 border-b border-gray-800 shrink-0">
          <input
            autoFocus
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps…"
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div className="overflow-auto flex-1">
          {isLoading && <p className="text-xs text-gray-500 p-4">Loading…</p>}
          {!isLoading && filtered.length === 0 && (
            <p className="text-xs text-gray-600 p-4">No apps found.</p>
          )}
          {filtered.map((app) => (
            <button
              key={app}
              onClick={() => onPick(app)}
              className={`w-full text-left px-4 py-2 text-xs transition-colors
                ${app === currentApp ? 'text-brand-300 bg-brand-900/30' : 'text-gray-300 hover:bg-gray-800'}`}
            >
              {app}
              {app === currentApp && <span className="ml-2 text-brand-400">✓</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}


interface ActionTileProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}

function ActionTile({ icon, title, description, onClick }: ActionTileProps) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col gap-3 bg-surface-panel border border-gray-800 hover:border-brand-700 hover:bg-surface-elevated/60 rounded-xl px-5 py-4 text-left transition-colors"
    >
      <div className="text-brand-400 group-hover:text-brand-300 transition-colors">
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold text-gray-100 mb-1">{title}</div>
        <div className="text-xs text-gray-500 leading-relaxed">{description}</div>
      </div>
    </button>
  );
}
