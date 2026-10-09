import { ApiError, type DocumentResultDto } from '../../../lib/api';

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** One-line summary of what POST /document changed, for inline feedback. */
export function describeDocumentResult(result: DocumentResultDto): string {
  const cols = plural(result.added_columns.length, 'column');
  if (result.created_file) return `Created ${result.path} with ${cols}`;
  if (result.added_entry) return `Added model + ${cols} to ${result.path}`;
  if (result.added_columns.length > 0) return `Added ${cols} to ${result.path}`;
  return `Already documented in ${result.path}`;
}

export function documentErrorMessage(err: unknown): string {
  if (err instanceof ApiError && typeof err.body === 'string') return err.body;
  if (err instanceof Error) return err.message;
  return 'Failed to generate docs';
}
