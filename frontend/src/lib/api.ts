const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${text}`);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

export function patch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ---- typed helpers ----

export interface RunOpts {
  full_refresh?: boolean;
  threads?: number | null;
  debug?: boolean;
  empty?: boolean;
  vars?: Record<string, string> | null;
}

export interface Project {
  id: number;
  name: string;
  path: string;
  platform: string;
  profile: string | null;
  vscode_cmd: string | null;
  init_script_path: string;
  ignored: boolean;
  readme: string | null;
  dbt_project_yml: string | null;
  profiles_yml: string | null;
}

export interface ModelNode {
  unique_id: string;
  name: string;
  resource_type: string;
  schema_: string | null;
  database: string | null;
  materialized: string | null;
  tags: string[];
  description: string;
  original_file_path: string | null;
  source_name: string | null;
  status: 'idle' | 'pending' | 'running' | 'success' | 'error' | 'stale' | 'warn';
  message: string | null;
}

export interface Edge {
  source: string;
  target: string;
}

export interface GraphDto {
  nodes: ModelNode[];
  edges: Edge[];
}

export interface InitStepDto {
  id: number | null;
  name: string;
  order: number;
  is_base: boolean;
  enabled: boolean;
  script_path: string | null;
}

export interface SqlDto {
  unique_id: string;
  path: string;
  content: string;
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[] | null;
}

export interface FileContentDto {
  path: string;
  content: string;
  language: string;
}

export interface EnvVarDto {
  key: string;
  value: string;
}

export interface GlobalProfileVarDto {
  key: string;
  value: string;
}

export interface GlobalProfileDto {
  id: number;
  name: string;
  vars: GlobalProfileVarDto[];
}

export interface DbtTargetsDto {
  targets: string[];
  default_target: string | null;
}

export interface DbtTargetDto {
  target: string | null;
}

export interface DocsColumnDto {
  name: string;
  description: string;
  data_type: string;
  meta: Record<string, unknown>;
  tags: string[];
  constraints: unknown[];
  tests: string[];
}

export interface DocsArgumentDto {
  name: string;
  type: string | null;
  description: string;
}

export interface DocsNodeDto {
  unique_id: string;
  name: string;
  resource_type: string;
  schema: string | null;
  database: string | null;
  package_name: string | null;
  path: string | null;
  language: string | null;
  materialized: string | null;
  access: string | null;
  group: string | null;
  contract: boolean;
  relation_name: string | null;
  owner: string | null;
  catalog_type: string | null;
  tags: string[];
  description: string;
  meta: Record<string, unknown>;
  columns: DocsColumnDto[];
  node_level_tests: string[];
  raw_code: string;
  compiled_code: string;
  depends_on_nodes: string[];
  depends_on_macros: string[];
  refs: string[];
  sources: unknown[];
  child_models: string[];
  child_tests: string[];
  parents: string[];
  // test-specific
  attached_node: string | null;
  column_name: string | null;
  test_metadata: { name: string; kwargs: Record<string, unknown> } | null;
}

export interface DocsMacroDto {
  unique_id: string;
  name: string;
  resource_type: 'macro';
  package_name: string | null;
  path: string | null;
  description: string;
  meta: Record<string, unknown>;
  arguments: DocsArgumentDto[];
  macro_sql: string;
  depends_on_macros: string[];
  child_models: string[];
  child_tests: string[];
  parents: string[];
  tags: string[];
}

export interface DocsDataDto {
  nodes: DocsNodeDto[];
  macros: DocsMacroDto[];
  project_name: string;
  project_description: string;
}

// ---- git interfaces ----

export interface GitBranchInfo {
  name: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  oid: string | null;
}

export interface GitFileChange {
  path: string;
  index_status: string;
  worktree_status: string;
  staged: boolean;
  is_untracked: boolean;
  is_conflict: boolean;
  renamed_from: string | null;
}

export interface GitStatusDto {
  repo_root: string;
  branch: GitBranchInfo;
  changes: GitFileChange[];
}

export interface GitDiffDto {
  path: string;
  staged: boolean;
  diff: string;
}

export interface GitFileAtHeadDto {
  path: string;
  content: string;
}

export interface GitBranchDto {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
}

export interface GitBranchesDto {
  branches: GitBranchDto[];
}

export interface GitCommitLogEntry {
  hash: string;
  short_hash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitCommitLogDto {
  entries: GitCommitLogEntry[];
}

export interface GitAcceptedDto {
  accepted: boolean;
}

export const api = {
  projects: {
    list: () => get<Project[]>('/projects'),
    get: (id: number) => get<Project>(`/projects/${id}`),
    rescan: () => post<Project[]>('/projects/rescan'),
    listApplications: () => get<string[]>('/projects/applications'),
    openInApp: (appName: string, path: string) =>
      post<{ ok: boolean }>('/projects/open-in-app', { app_name: appName, path }),
    updateSettings: (projectId: number, body: { init_script_path: string }) =>
      patch<Project>(`/projects/${projectId}/settings`, body),
    ensureProfilesYml: (projectId: number) =>
      post<{ created: boolean }>(`/projects/${projectId}/ensure-profiles-yml`),
    ignore: (id: number, ignored: boolean) =>
      patch<Project>(`/projects/${id}/ignore`, { ignored }),
  },
  filesystem: {
    browse: (path = '') =>
      get<FileNode[]>(`/filesystem/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  },
  models: {
    graph: (projectId: number) => get<GraphDto>(`/projects/${projectId}/models`),
    sql: (projectId: number, uniqueId: string) =>
      get<SqlDto>(`/projects/${projectId}/models/${encodeURIComponent(uniqueId)}/sql`),
    saveSql: (projectId: number, uniqueId: string, content: string) =>
      put<SqlDto>(`/projects/${projectId}/models/${encodeURIComponent(uniqueId)}/sql`, { content }),
    create: (projectId: number, name: string, sql: string) =>
      post<{ name: string; path: string }>(`/projects/${projectId}/models`, { name, sql }),
    delete: (projectId: number, uniqueId: string) =>
      request<void>(`/projects/${projectId}/models/${encodeURIComponent(uniqueId)}`, { method: 'DELETE' }),
    compile: (projectId: number) =>
      post<{ status: string }>(`/projects/${projectId}/compile`),
    getCompiled: (projectId: number, uniqueId: string, force = false) =>
      get<{ compiled_sql: string }>(`/projects/${projectId}/models/${encodeURIComponent(uniqueId)}/compiled${force ? '?force=true' : ''}`),
    show: (projectId: number, uniqueId: string, limit = 1000) =>
      post<{ columns: string[]; rows: unknown[][] }>(`/projects/${projectId}/models/${encodeURIComponent(uniqueId)}/show`, { limit }),
  },
  runs: {
    run: (projectId: number, model: string, mode: string, opts?: RunOpts, select?: string) =>
      post(`/projects/${projectId}/run`, { model: model || null, mode, select: select ?? null, ...opts }),
    build: (projectId: number, model: string, mode: string, opts?: RunOpts, select?: string) =>
      post(`/projects/${projectId}/build`, { model: model || null, mode, select: select ?? null, ...opts }),
    test: (projectId: number, model: string, mode: string, opts?: RunOpts, select?: string) =>
      post(`/projects/${projectId}/test`, { model: model || null, mode, select: select ?? null, ...opts }),
    seed: (projectId: number, model: string, mode: string, opts?: RunOpts, select?: string) =>
      post(`/projects/${projectId}/seed`, { model: model || null, mode, select: select ?? null, ...opts }),
  },
  files: {
    list: (projectId: number, path = '') =>
      get<FileNode[]>(`/projects/${projectId}/files${path ? `?path=${encodeURIComponent(path)}` : ''}`),
    getContent: (projectId: number, path: string) =>
      get<FileContentDto>(`/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`),
    putContent: (projectId: number, path: string, content: string) =>
      request<FileContentDto>(`/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      }),
    rename: (projectId: number, path: string, newName: string) =>
      request<FileNode>(`/projects/${projectId}/files/rename?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        body: JSON.stringify({ new_name: newName }),
      }),
    delete: (projectId: number, path: string) =>
      request<void>(`/projects/${projectId}/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
    newFile: (projectId: number, name: string, dirPath: string, isDir = false) =>
      request<FileNode>(`/projects/${projectId}/files/new`, {
        method: 'POST',
        body: JSON.stringify({ name, dir_path: dirPath, is_dir: isDir }),
      }),
  },
  init: {
    steps: (projectId: number) => get<InitStepDto[]>(`/projects/${projectId}/init/steps`),
    open: (projectId: number) => post(`/projects/${projectId}/open`),
    createStep: (projectId: number, name: string, content: string) =>
      post(`/projects/${projectId}/init/steps`, { name, content }),
    deleteStep: (projectId: number, name: string) =>
      del(`/projects/${projectId}/init/steps/${encodeURIComponent(name)}`),
    toggleStep: (projectId: number, name: string, enabled: boolean) =>
      request<InitStepDto>(`/projects/${projectId}/init/steps/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
    getScriptContent: (projectId: number, name: string) =>
      get<{ content: string }>(`/projects/${projectId}/init/steps/${encodeURIComponent(name)}/content`)
        .then((r) => r.content),
    putScriptContent: (projectId: number, name: string, content: string) =>
      put<{ ok: string }>(`/projects/${projectId}/init/steps/${encodeURIComponent(name)}/content`, { content }),
    reorder: (projectId: number, ordered_names: string[]) =>
      post(`/projects/${projectId}/init/reorder`, { ordered_names }),
    linkStep: (projectId: number, path: string) =>
      post<InitStepDto>(`/projects/${projectId}/init/steps/link`, { path }),
    runStep: (projectId: number, stepName: string) =>
      post<void>(`/projects/${projectId}/init/run-step`, { step_name: stepName }),
    getEnvVars: (projectId: number) =>
      get<EnvVarDto[]>(`/projects/${projectId}/init/env`),
    setEnvVar: (projectId: number, key: string, value: string) =>
      request<EnvVarDto>(`/projects/${projectId}/init/env/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ key, value }),
      }),
    deleteEnvVar: (projectId: number, key: string) =>
      request<void>(`/projects/${projectId}/init/env/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    startSession: (platform: string, cwd?: string, skipInstall?: boolean) =>
      post<{ session_id: string }>('/projects/init-session/start', { platform, cwd: cwd ?? null, skip_install: skipInstall ?? false }),
    sendInput: (sessionId: string, data: string) =>
      post(`/projects/init-session/${sessionId}/input`, { data }),
    stopSession: (sessionId: string) =>
      post(`/projects/init-session/${sessionId}/stop`),
    checkPackage: (pkg: string) =>
      get<{ package: string; installed_version: string | null }>(`/init/package-info?package=${encodeURIComponent(pkg)}`),
    dbtCoreStatus: () =>
      get<{ installed: boolean; version: string | null }>('/init/dbt-core-status'),
    appendRequirement: (line: string) =>
      post<{ ok: boolean }>('/init/append-requirement', { line }),
    runGlobalSetup: () =>
      post<{ ok: boolean }>('/init/global-setup'),
    cancelGlobalSetup: () =>
      post<{ ok: boolean }>('/init/global-setup/cancel'),
  },
  profiles: {
    dbtTargets: (projectId: number) =>
      get<DbtTargetsDto>(`/projects/${projectId}/dbt-targets`),
    getDbtTarget: (projectId: number) =>
      get<DbtTargetDto>(`/projects/${projectId}/dbt-target`),
    setDbtTarget: (projectId: number, target: string) =>
      put<DbtTargetDto>(`/projects/${projectId}/dbt-target`, { target }),
  },
  docs: {
    status: (projectId: number) =>
      get<{ generated_at: string | null }>(`/projects/${projectId}/docs/status`),
    generate: (projectId: number) =>
      post<{ status: string }>(`/projects/${projectId}/docs/generate`),
    data: (projectId: number) =>
      get<DocsDataDto>(`/projects/${projectId}/docs/data`),
  },
  terminal: {
    start: (cwd: string, cols: number, rows: number) =>
      post<{ session_id: string }>('/terminal/start', { cwd, cols, rows }),
    input: (sessionId: string, data: string) =>
      post<{ ok: boolean }>(`/terminal/${sessionId}/input`, { data }),
    resize: (sessionId: string, cols: number, rows: number) =>
      post<{ ok: boolean }>(`/terminal/${sessionId}/resize`, { cols, rows }),
    stop: (sessionId: string) =>
      post<{ ok: boolean }>(`/terminal/${sessionId}/stop`),
  },
  globalProfiles: {
    list: () => get<GlobalProfileDto[]>('/global-profiles'),
    create: (name: string) => post<GlobalProfileDto>('/global-profiles', { name }),
    delete: (id: number) => request<void>(`/global-profiles/${id}`, { method: 'DELETE' }),
    setVar: (id: number, key: string, value: string) =>
      put<GlobalProfileVarDto>(`/global-profiles/${id}/vars/${encodeURIComponent(key)}`, { value }),
    deleteVar: (id: number, key: string) =>
      request<void>(`/global-profiles/${id}/vars/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    getActiveForProject: (projectId: number) =>
      get<{ profile_id: number | null }>(`/projects/${projectId}/active-global-profile`),
    setActiveForProject: (projectId: number, profileId: number) =>
      put<{ profile_id: number }>(`/projects/${projectId}/active-global-profile`, { profile_id: profileId }),
    clearActiveForProject: (projectId: number) =>
      del<void>(`/projects/${projectId}/active-global-profile`),
  },
  git: {
    status: (projectId: number) =>
      get<GitStatusDto>(`/projects/${projectId}/git/status`),
    diff: (projectId: number, path: string, staged = false) =>
      get<GitDiffDto>(`/projects/${projectId}/git/diff?path=${encodeURIComponent(path)}&staged=${staged}`),
    fileAtHead: (projectId: number, path: string) =>
      get<GitFileAtHeadDto>(`/projects/${projectId}/git/file-at-head?path=${encodeURIComponent(path)}`),
    stage: (projectId: number, paths: string[]) =>
      post<GitAcceptedDto>(`/projects/${projectId}/git/stage`, { paths }),
    unstage: (projectId: number, paths: string[]) =>
      post<GitAcceptedDto>(`/projects/${projectId}/git/unstage`, { paths }),
    discard: (projectId: number, paths: string[]) =>
      post<GitAcceptedDto>(`/projects/${projectId}/git/discard`, { paths }),
    deleteNew: (projectId: number, paths: string[]) =>
      post<GitAcceptedDto>(`/projects/${projectId}/git/delete-new`, { paths }),
    commit: (projectId: number, message: string, amend = false) =>
      post<GitAcceptedDto>(`/projects/${projectId}/git/commit`, { message, amend }),
    branches: (projectId: number) =>
      get<GitBranchesDto>(`/projects/${projectId}/git/branches`),
    createBranch: (projectId: number, name: string, fromRef?: string) =>
      post<GitAcceptedDto>(`/projects/${projectId}/git/branches`, { name, from_ref: fromRef ?? null }),
    checkout: (projectId: number, name: string) =>
      post<GitAcceptedDto>(`/projects/${projectId}/git/checkout`, { name }),
    log: (projectId: number, path?: string, limit = 50) =>
      get<GitCommitLogDto>(
        `/projects/${projectId}/git/log?limit=${limit}${path ? `&path=${encodeURIComponent(path)}` : ''}`
      ),
  },
  settings: {
    get: () => get<{ dbt_projects_path: string | null; data_dir: string | null; log_level: string | null; global_requirements_path: string | null; theme: string | null; configured: boolean }>('/settings'),
    update: (body: { dbt_projects_path?: string; data_dir?: string; log_level?: string; global_requirements_path?: string; theme?: string }) =>
      put<{ dbt_projects_path: string | null; data_dir: string | null; log_level: string | null; global_requirements_path: string | null; theme: string | null; configured: boolean }>('/settings', body),
  },
  requirementsFile: {
    get: () => get<{ content: string }>('/settings/requirements-file'),
    put: (content: string) => put<{ content: string }>('/settings/requirements-file', { content }),
  },
  logs: {
    projectLogs: (projectId: number, tail = 500) =>
      get<{ lines: string[] }>(`/projects/${projectId}/logs/project?tail=${tail}`),
    clearProjectLogs: (projectId: number) =>
      del<{ ok: boolean }>(`/projects/${projectId}/logs/project`),
    apiLogs: (projectId: number, tail = 500) =>
      get<{ lines: string[] }>(`/projects/${projectId}/logs/api?tail=${tail}`),
    clearApiLogs: (projectId: number) =>
      del<{ ok: boolean }>(`/projects/${projectId}/logs/api`),
  },
};
