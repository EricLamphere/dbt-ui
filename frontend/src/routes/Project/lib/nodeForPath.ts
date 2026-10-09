import type { GraphDto } from '../../../lib/api';

/**
 * The node defined by a repo-relative file path (as the Git page lists them),
 * matched on `original_file_path` like the Files page does. `projectSubpath`
 * is the dbt project's directory inside the repo ('' or '.' when they're the same).
 * In a YAML file that defines several nodes, a non-test node (source,
 * exposure, …) wins over its tests.
 */
export function nodeForRepoPath(graph: GraphDto | null | undefined, repoPath: string | null, projectSubpath: string): string | null {
  if (!graph || !repoPath) return null;
  const trimmed = projectSubpath.replace(/^\/+|\/+$/g, '');
  const prefix = trimmed === '.' ? '' : trimmed;
  if (prefix && !repoPath.startsWith(`${prefix}/`)) return null;
  const path = prefix ? repoPath.slice(prefix.length + 1) : repoPath;

  const matches = graph.nodes.filter((n) => n.original_file_path === path);
  return (matches.find((n) => n.resource_type !== 'test') ?? matches[0])?.unique_id ?? null;
}
