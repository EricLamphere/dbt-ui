import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../lib/api';
import { describeDocumentResult, documentErrorMessage } from './documentModel';

const base = { path: 'models/marts/schema.yml', created_file: false, added_entry: false, added_columns: [] };

describe('describeDocumentResult', () => {
  it('reports a new file with columns', () => {
    expect(describeDocumentResult({ ...base, created_file: true, added_entry: true, added_columns: ['a', 'b'] }))
      .toBe('Created models/marts/schema.yml with 2 columns');
  });

  it('reports a new entry in an existing file', () => {
    expect(describeDocumentResult({ ...base, added_entry: true, added_columns: ['a'] }))
      .toBe('Added model + 1 column to models/marts/schema.yml');
  });

  it('reports columns added to an existing entry', () => {
    expect(describeDocumentResult({ ...base, added_columns: ['a', 'b', 'c'] }))
      .toBe('Added 3 columns to models/marts/schema.yml');
  });

  it('reports nothing to do', () => {
    expect(describeDocumentResult(base)).toBe('Already documented in models/marts/schema.yml');
  });
});

describe('documentErrorMessage', () => {
  it('prefers the API detail string', () => {
    expect(documentErrorMessage(new ApiError(422, '{"detail":"boom"}', 'boom'))).toBe('boom');
  });

  it('falls back to the error message', () => {
    expect(documentErrorMessage(new Error('network down'))).toBe('network down');
  });

  it('handles non-errors', () => {
    expect(documentErrorMessage('???')).toBe('Failed to generate docs');
  });
});
