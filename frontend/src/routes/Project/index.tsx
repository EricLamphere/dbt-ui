import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import Editor from '@monaco-editor/react';
import { api, type GraphDto, type Project, type RunInvocationDto } from '../../lib/api';
import { useProjectEvents } from '../../lib/sse';
import { useTheme } from '../../lib/useTheme';
import NavRail from './components/NavRail';

const PLATFORM_ICONS: Record<string, string> = {
  postgres: '🐘', bigquery: '☁️', snowflake: '❄️', redshift: '🔴',
  duckdb: '🦆', spark: '⚡', databricks: '🧱', athena: '🦉',
  trino: '🔷', clickhouse: '🏡', unknown: '⬡',
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

type EditorChoice =
  | { id: string; label: string; kind: 'protocol'; protocol: string }
  | { id: string; label: string; kind: 'app'; appName: string }
  | { id: 'other'; label: 'Other'; kind: 'other' };

const ALL_EDITORS: EditorChoice[] = [
  ...PROTOCOL_EDITORS.map((e) => ({ ...e, kind: 'protocol' as const })),
  ...APP_EDITORS.map((e) => ({ ...e, kind: 'app' as const })),
  { id: 'other', label: 'Other', kind: 'other' },
];

const PREF_KEY = 'dbt-ui:preferred-editor';
const OTHER_APP_KEY = 'dbt-ui:other-app-name';

function getPreferredEditor(): EditorChoice {
  const saved = localStorage.getItem(PREF_KEY);
  return ALL_EDITORS.find((e) => e.id === saved) ?? ALL_EDITORS[0];
}

async function openInEditor(editor: EditorChoice, projectPath: string, otherAppName?: string) {
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
  const qc = useQueryClient();

  const { data: project, isLoading, error } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.projects.get(id),
  });

  const { data: graph } = useQuery({
    queryKey: ['graph', id],
    queryFn: () => api.models.graph(id),
    enabled: !!id,
  });

  const { data: recentRunsPage } = useQuery({
    queryKey: ['run-history', id, 'recent'],
    queryFn: () => api.runHistory.list(id, { limit: 5 }),
    enabled: !!id,
  });

  useProjectEvents(id, useCallback((event) => {
    if (event.type === 'statuses_changed' || event.type === 'graph_changed') {
      qc.invalidateQueries({ queryKey: ['graph', id] });
    }
    if (event.type === 'run_started' || event.type === 'run_history_changed') {
      qc.invalidateQueries({ queryKey: ['run-history', id, 'recent'] });
    }
  }, [id, qc]));

  const [preferredEditor, setPreferredEditor] = useState<EditorChoice>(getPreferredEditor);
  const [otherAppName, setOtherAppName] = useState<string>(
    () => localStorage.getItem(OTHER_APP_KEY) ?? ''
  );
  const [editorPickerOpen, setEditorPickerOpen] = useState(false);
  const [appPickerOpen, setAppPickerOpen] = useState(false);
  const editorPickerRef = useRef<HTMLDivElement>(null);

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

  useProjectEvents(id, useCallback((event) => {
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
  }, []));

  // Quick-run state
  const [activeRun, setActiveRun] = useState<RunKind | null>(null);

  const handleQuickRun = async (kind: RunKind) => {
    if (activeRun) return;
    setActiveRun(kind);
    try {
      if (kind === 'seed') api.runs.seed(id, '', 'only').catch(() => {});
      else api.runs[kind](id, '', 'only').catch(() => {});
    } finally {
      setActiveRun(null);
    }
  };

  useProjectEvents(id, useCallback((event) => {
    if (event.type === 'run_finished' || event.type === 'run_error') {
      setActiveRun(null);
    }
  }, []));

  // Close editor picker on outside click
  useEffect(() => {
    if (!editorPickerOpen) return;
    const dismiss = (e: MouseEvent) => {
      if (editorPickerRef.current && !editorPickerRef.current.contains(e.target as Node)) {
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

  const handleSelectEditor = (editor: EditorChoice) => {
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
    const otherEditor: EditorChoice = { id: 'other', label: 'Other', kind: 'other' };
    setPreferredEditor(otherEditor);
    localStorage.setItem(PREF_KEY, 'other');
    setAppPickerOpen(false);
    api.projects.openInApp(appName, project.path);
  };

  return (
    <div className="flex h-full overflow-hidden">
      <NavRail projectId={id} current="home" />
      <div className="flex-1 overflow-auto">
        <div className="p-6 pb-12 max-w-4xl mx-auto w-full">

          {/* Header tile */}
          <div className="bg-surface-panel border border-gray-800 rounded-xl mb-6 w-full flex">
            {/* Left: project info */}
            <div className="flex-1 px-6 py-5 flex flex-col justify-center gap-1 min-w-0">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{platformIcon}</span>
                <h1 className="text-xl font-bold text-gray-100">{project.name}</h1>
              </div>
              <p className="text-xs text-gray-500 font-mono mt-1 truncate">{project.path}</p>
              <div className="flex items-center gap-6 mt-2">
                <div>
                  <dt className="text-[10px] text-gray-600 uppercase tracking-wider">Platform</dt>
                  <dd className="text-sm text-gray-200 font-medium capitalize mt-0.5">{project.platform}</dd>
                </div>
                {project.profile && (
                  <div>
                    <dt className="text-[10px] text-gray-600 uppercase tracking-wider">Profile</dt>
                    <dd className="text-sm text-gray-200 font-medium mt-0.5">{project.profile}</dd>
                  </div>
                )}
              </div>
            </div>

            {/* Right: stacked action buttons — full height of header */}
            <div className="relative border-l border-gray-800 flex flex-col shrink-0 w-56" ref={editorPickerRef}>
              {/* Top half: Initialize */}
              <button
                onClick={() => initMutation.mutate()}
                disabled={initStatus === 'running'}
                className="flex-1 flex items-center justify-between px-4 border-b border-gray-800 text-xs font-medium text-gray-200 hover:bg-surface-elevated/60 disabled:opacity-50 transition-colors group"
              >
                <div className="flex items-center gap-2">
                  {initStatus === 'running' ? (
                    <svg className="w-3.5 h-3.5 animate-spin text-brand-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-brand-400 group-hover:text-brand-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
                    </svg>
                  )}
                  <span>{initStatus === 'running' ? 'Running…' : 'Initialize'}</span>
                </div>
                {initStatus !== 'idle' && initStatus !== 'running' && (
                  <InitStatusBadge status={initStatus} errorMessage={initError} />
                )}
              </button>

              {/* Bottom half: Open in editor (split button) */}
              <div className="flex-1 flex">
                <button
                  onClick={handleOpenEditor}
                  className="flex-1 min-w-0 flex items-center gap-2 px-4 text-xs font-medium text-gray-200 hover:bg-surface-elevated/60 transition-colors group"
                >
                  <svg className="w-3.5 h-3.5 text-brand-400 group-hover:text-brand-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                  <span className="truncate">Open in {editorLabel}</span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setEditorPickerOpen((o) => !o); }}
                  className="px-3 border-l border-gray-800 text-gray-600 hover:text-gray-300 hover:bg-surface-elevated/60 transition-colors"
                  title="Choose editor"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {/* Editor picker dropdown */}
              {editorPickerOpen && (
                <div className="absolute bottom-0 right-0 translate-y-full min-w-[180px] bg-surface-panel border border-gray-700 rounded-lg shadow-xl py-1 z-50">
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
          </div>

          {/* Stats summary */}
          {graph && <StatsSummary graph={graph} recentRuns={recentRunsPage?.items ?? []} />}

          {/* Quick-run bar */}
          <QuickRunBar activeRun={activeRun} onRun={handleQuickRun} />

          {/* Recent runs */}
          <RecentRuns
            runs={recentRunsPage?.items ?? []}
            onViewAll={() => navigate(`/projects/${id}/runs`)}
          />

          {/* Project files panel */}
          <ProjectFilesPanel project={project} />

        </div>
      </div>

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

// ---- Stats summary ----

const CMD_COLORS: Record<string, string> = {
  run:   'text-blue-400',
  build: 'text-purple-400',
  test:  'text-yellow-400',
  seed:  'text-green-400',
};

function StatsSummary({ graph, recentRuns }: { graph: GraphDto; recentRuns: RunInvocationDto[] }) {
  const models = graph.nodes.filter((n) => n.resource_type === 'model');
  const tests = graph.nodes.filter((n) => n.resource_type === 'test');
  const sources = graph.nodes.filter((n) => n.resource_type === 'source');

  const lastRun = recentRuns[0] ?? null;

  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      <StatTile label="Models" value={models.length} />
      <StatTile label="Tests" value={tests.length} />
      <StatTile label="Sources" value={sources.length} />

      {/* Last run tile */}
      <div className="bg-surface-panel border border-gray-800 rounded-xl px-5 py-4">
        <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Last Run</div>
        {lastRun ? (
          <>
            <div className={`text-xl font-bold capitalize ${CMD_COLORS[lastRun.command] ?? 'text-gray-100'}`}>
              {lastRun.command}
            </div>
            <div className="flex items-center gap-2 mt-1">
              {lastRun.status === 'running' ? (
                <span className="text-[10px] text-brand-400">running…</span>
              ) : (
                <>
                  <span className="text-[10px] text-green-400">{lastRun.success_count} ok</span>
                  {lastRun.error_count > 0 && (
                    <span className="text-[10px] text-red-400">{lastRun.error_count} err</span>
                  )}
                </>
              )}
              {lastRun.started_at && (
                <span className="text-[10px] text-gray-600 ml-auto">{formatRelativeTime(lastRun.started_at)}</span>
              )}
            </div>
          </>
        ) : (
          <div className="text-xl font-bold text-gray-600">—</div>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface-panel border border-gray-800 rounded-xl px-5 py-4">
      <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold text-gray-100">{value}</div>
    </div>
  );
}

// ---- Quick-run bar ----

type RunKind = 'run' | 'build' | 'test' | 'seed';

const RUN_BUTTONS: { kind: RunKind; label: string; color: string }[] = [
  { kind: 'run',   label: 'Run',   color: 'border-blue-600 text-blue-400 hover:bg-blue-900/40' },
  { kind: 'build', label: 'Build', color: 'border-purple-600 text-purple-400 hover:bg-purple-900/40' },
  { kind: 'test',  label: 'Test',  color: 'border-yellow-600 text-yellow-400 hover:bg-yellow-900/40' },
  { kind: 'seed',  label: 'Seed',  color: 'border-green-600 text-green-400 hover:bg-green-900/40' },
];

function QuickRunBar({
  activeRun,
  onRun,
}: {
  activeRun: RunKind | null;
  onRun: (kind: RunKind) => void;
}) {
  return (
    <div className="mb-4 bg-surface-panel border border-gray-800 rounded-xl px-5 py-4">
      <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-3">Quick Run</div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-600 mr-1">Full project:</span>
        {RUN_BUTTONS.map(({ kind, label, color }) => (
          <button
            key={kind}
            onClick={() => onRun(kind)}
            disabled={activeRun !== null}
            className={`px-3 py-1 rounded text-xs font-semibold tracking-wide border transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed ${color}`}
          >
            {label}
          </button>
        ))}
        {activeRun && (
          <span className="ml-2 text-xs text-gray-500 italic">
            Running… check the Run tab below for live output
          </span>
        )}
      </div>
    </div>
  );
}

// ---- Recent runs ----

const STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-900/40 text-green-400 border-green-800',
  error:   'bg-red-900/40 text-red-400 border-red-800',
  warn:    'bg-yellow-900/40 text-yellow-400 border-yellow-800',
  running: 'bg-brand-900/40 text-brand-400 border-brand-800',
};

function RecentRuns({ runs, onViewAll }: { runs: RunInvocationDto[]; onViewAll: () => void }) {
  if (runs.length === 0) return null;

  return (
    <div className="mb-4 bg-surface-panel border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
        <span className="text-[10px] text-gray-600 uppercase tracking-wider">Recent Runs</span>
        <button
          onClick={onViewAll}
          className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
        >
          View all →
        </button>
      </div>
      <div className="divide-y divide-gray-800/50">
        {runs.map((run) => {
          const statusStyle = STATUS_COLORS[run.status] ?? 'bg-gray-800 text-gray-400 border-gray-700';
          const selector = run.selector ? run.selector : 'all models';
          const duration = run.duration_seconds != null
            ? run.duration_seconds < 60
              ? `${run.duration_seconds.toFixed(1)}s`
              : `${(run.duration_seconds / 60).toFixed(1)}m`
            : null;

          return (
            <div key={run.id} className="flex items-center gap-4 px-5 py-3">
              <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-medium uppercase tracking-wider shrink-0 ${statusStyle}`}>
                {run.status}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-gray-200 font-mono font-medium">dbt {run.command}</span>
                {run.selector && (
                  <span className="ml-1.5 text-xs text-gray-500 font-mono truncate">{selector}</span>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0 text-right">
                {duration && <span className="text-xs text-gray-500">{duration}</span>}
                {run.model_count > 0 && (
                  <span className="text-xs text-gray-600">{run.model_count} model{run.model_count !== 1 ? 's' : ''}</span>
                )}
                {run.started_at && (
                  <span className="text-xs text-gray-600">{formatRelativeTime(run.started_at)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Project files panel (README / dbt_project.yml / profiles.yml) ----

type FileTab = 'readme' | 'dbt_project' | 'profiles';

const FILE_TABS: { id: FileTab; label: string; field: keyof Project; language: string }[] = [
  { id: 'readme',      label: 'README.md',       field: 'readme',         language: 'markdown' },
  { id: 'dbt_project', label: 'dbt_project.yml', field: 'dbt_project_yml', language: 'yaml' },
  { id: 'profiles',   label: 'profiles.yml',     field: 'profiles_yml',   language: 'yaml' },
];

function YamlViewer({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const monacoTheme = useTheme() === 'light' ? 'vs-light' : 'vs-dark';

  return (
    <div
      ref={containerRef}
      style={{ minHeight: 100 }}
      onWheelCapture={(e) => {
        const target = e.currentTarget;
        let ancestor = target.parentElement;
        while (ancestor) {
          const { overflowY } = getComputedStyle(ancestor);
          const canScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
          if (canScroll && ancestor.scrollHeight > ancestor.clientHeight) {
            ancestor.scrollTop += e.deltaY;
            e.stopPropagation();
            return;
          }
          ancestor = ancestor.parentElement;
        }
      }}
    >
      <Editor
        language="yaml"
        value={content}
        theme={monacoTheme}
        onMount={(editor) => {
          const applyHeight = () => {
            const h = editor.getContentHeight();
            if (containerRef.current) {
              containerRef.current.style.height = `${h}px`;
            }
            editor.layout();
          };
          applyHeight();
          editor.onDidContentSizeChange(applyHeight);
        }}
        options={{
          fontSize: 13,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          lineNumbers: 'on',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          readOnly: true,
          automaticLayout: true,
          scrollbar: { vertical: 'hidden', horizontal: 'auto' },
          overviewRulerLanes: 0,
          renderLineHighlight: 'none',
          padding: { top: 12, bottom: 12 },
          guides: { indentation: true },
          folding: false,
          lineDecorationsWidth: 16,
        }}
      />
    </div>
  );
}

function ProjectFilesPanel({ project }: { project: Project }) {
  const available = FILE_TABS.filter((t) => project[t.field] != null);
  const [activeTab, setActiveTab] = useState<FileTab>(() => available[0]?.id ?? 'readme');

  if (available.length === 0) return null;

  const active = available.find((t) => t.id === activeTab) ?? available[0];
  const content = project[active.field] as string;

  return (
    <div className="mt-4 bg-surface-panel border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-1 px-4 border-b border-gray-800" style={{ height: 40 }}>
        {available.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1 text-xs rounded transition-colors font-mono
              ${active.id === tab.id
                ? 'bg-brand-900/50 text-brand-300 font-medium'
                : 'text-gray-500 hover:text-gray-300'
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active.id === 'readme' ? (
        <div className="px-6 py-5 prose-readme">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      ) : (
        <YamlViewer key={active.id} content={content} />
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
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
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

// ---- Utilities ----

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
