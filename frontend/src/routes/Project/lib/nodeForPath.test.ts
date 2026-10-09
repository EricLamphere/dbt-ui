import { describe, expect, it } from 'vitest';
import type { GraphDto, ModelNode } from '../../../lib/api';
import { nodeForRepoPath } from './nodeForPath';

const node = (uid: string, path: string | null): ModelNode => ({
  unique_id: uid, name: uid.split('.').pop()!, resource_type: uid.split('.')[0],
  schema_: null, database: null, materialized: null, tags: [], description: '',
  original_file_path: path, source_name: null, status: 'idle', message: null, columns: [],
  test_metadata_name: null, column_name: null, attached_node: null, patch_path: null,
});

const graph: GraphDto = {
  nodes: [
    node('model.p.stg', 'models/stg.sql'),
    node('test.p.not_null_x', 'models/_sources.yml'),
    node('source.p.raw.orders', 'models/_sources.yml'),
    node('test.p.only_tests', 'models/_tests.yml'),
  ],
  edges: [],
};

describe('nodeForRepoPath', () => {
  it('matches a project-relative path when the project is the repo root', () => {
    expect(nodeForRepoPath(graph, 'models/stg.sql', '')).toBe('model.p.stg');
  });

  it('treats "." (what git status reports for a project at the repo root) as no subpath', () => {
    expect(nodeForRepoPath(graph, 'models/stg.sql', '.')).toBe('model.p.stg');
  });

  it('strips the project subpath in a monorepo', () => {
    expect(nodeForRepoPath(graph, 'analytics/models/stg.sql', 'analytics')).toBe('model.p.stg');
    expect(nodeForRepoPath(graph, 'other/models/stg.sql', 'analytics')).toBeNull();
  });

  it('prefers a non-test node in a shared YAML file, else the first test', () => {
    expect(nodeForRepoPath(graph, 'models/_sources.yml', '')).toBe('source.p.raw.orders');
    expect(nodeForRepoPath(graph, 'models/_tests.yml', '')).toBe('test.p.only_tests');
  });

  it('returns null for unknown files or missing inputs', () => {
    expect(nodeForRepoPath(graph, 'README.md', '')).toBeNull();
    expect(nodeForRepoPath(null, 'models/stg.sql', '')).toBeNull();
    expect(nodeForRepoPath(graph, null, '')).toBeNull();
  });
});
