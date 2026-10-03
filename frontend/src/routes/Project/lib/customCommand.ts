import { api, ApiError } from '../../../lib/api';

const HISTORY_LIMIT = 10;

const historyKey = (projectId: number) => `dbt-ui:custom-commands:${projectId}`;

/** Most recent first. Per-project, browser-local convenience only. */
export function loadCommandHistory(projectId: number): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(historyKey(projectId)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

function saveToHistory(projectId: number, command: string): void {
  const next = [command, ...loadCommandHistory(projectId).filter((c) => c !== command)].slice(0, HISTORY_LIMIT);
  try {
    localStorage.setItem(historyKey(projectId), JSON.stringify(next));
  } catch {
    // storage unavailable — history is best-effort
  }
}

/** Strips a leading "dbt " so the input can show a fixed `dbt` prefix. */
export function normalizeCommand(raw: string): string {
  return raw.trim().replace(/^dbt(\s+|$)/, '');
}

/**
 * Launch an arbitrary dbt command. Resolves to null on success, or a
 * user-facing error message (e.g. the backend's 400 validation detail).
 */
export async function runCustomCommand(projectId: number, raw: string): Promise<string | null> {
  const command = normalizeCommand(raw);
  if (!command) return 'Enter a dbt command, e.g. ls --select my_model';
  try {
    await api.runs.custom(projectId, command);
    saveToHistory(projectId, command);
    return null;
  } catch (err) {
    if (err instanceof ApiError && typeof err.body === 'string') return err.body;
    return err instanceof Error ? err.message : String(err);
  }
}
