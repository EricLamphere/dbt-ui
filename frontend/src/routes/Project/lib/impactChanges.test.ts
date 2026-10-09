import { describe, expect, it } from 'vitest';
import { ApiError, type ImpactChangeReasonDto, type ImpactChangesDto } from '../../../lib/api';
import { changeErrorMessage, describeReason, describeReasons, reasonsByNode, seedIdsFrom } from './impactChanges';

const reason = (overrides: Partial<ImpactChangeReasonDto>): ImpactChangeReasonDto => ({
  kind: 'file', path: 'models/a.sql', change: 'modified', macro: null, ...overrides,
});

const dto = (overrides: Partial<ImpactChangesDto> = {}): ImpactChangesDto => ({
  scope: 'working', branch: 'main', base: null, merge_base: null, manifest_available: true,
  changed_files: 0, nodes: [], unmapped: [], project_wide: [], ...overrides,
});

describe('describeReason', () => {
  it('describes direct file edits by change kind', () => {
    expect(describeReason(reason({}))).toBe('edited');
    expect(describeReason(reason({ change: 'added' }))).toBe('new file');
    expect(describeReason(reason({ change: 'deleted' }))).toBe('deleted');
    expect(describeReason(reason({ change: 'renamed' }))).toBe('renamed');
  });

  it('names the YAML file and the macro', () => {
    expect(describeReason(reason({ kind: 'yaml', path: 'models/staging/_staging.yml' }))).toBe('_staging.yml');
    expect(describeReason(reason({ kind: 'macro', path: 'macros/m.sql', macro: 'cents_to_dollars' })))
      .toBe('via macro cents_to_dollars');
  });
});

describe('describeReasons', () => {
  it('joins reasons, file edits first', () => {
    expect(describeReasons([
      reason({ kind: 'macro', macro: 'm' }),
      reason({}),
      reason({ kind: 'yaml', path: 'x/schema.yml' }),
    ])).toBe('edited · schema.yml · via macro m');
  });
});

describe('seedIdsFrom / reasonsByNode', () => {
  const data = dto({ nodes: [
    { unique_id: 'model.p.a', reasons: [reason({})] },
    { unique_id: 'model.p.b', reasons: [reason({ kind: 'macro', macro: 'm' })] },
  ] });

  it('lists changed node ids', () => {
    expect(seedIdsFrom(data)).toEqual(['model.p.a', 'model.p.b']);
    expect(seedIdsFrom(undefined)).toEqual([]);
  });

  it('maps node ids to a reason label', () => {
    expect(reasonsByNode(data)).toEqual(new Map([['model.p.a', 'edited'], ['model.p.b', 'via macro m']]));
  });
});

describe('changeErrorMessage', () => {
  it('explains a project outside git', () => {
    expect(changeErrorMessage(new ApiError(422, 'x', 'project is not inside a git repository')))
      .toBe("This project isn't inside a git repository.");
  });

  it('passes through the API detail', () => {
    expect(changeErrorMessage(new ApiError(400, 'x', "Unknown base ref: 'nope'"))).toBe("Unknown base ref: 'nope'");
  });

  it('falls back to the error message', () => {
    expect(changeErrorMessage(new Error('offline'))).toBe('offline');
    expect(changeErrorMessage(42)).toBe("Couldn't load changes");
  });
});
