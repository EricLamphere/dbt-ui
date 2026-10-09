import { ApiError, type ImpactChangeReasonDto, type ImpactChangesDto } from '../../../lib/api';

/** Where the Impact tab takes its starting nodes from. */
export type ImpactMode = 'selection' | 'working' | 'branch';

const REASON_ORDER: Record<ImpactChangeReasonDto['kind'], number> = { file: 0, yaml: 1, macro: 2 };

const FILE_CHANGE_LABEL: Record<ImpactChangeReasonDto['change'], string> = {
  modified: 'edited',
  added: 'new file',
  deleted: 'deleted',
  renamed: 'renamed',
};

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Short label for why a node counts as changed, e.g. "edited", "_staging.yml", "via macro x". */
export function describeReason(reason: ImpactChangeReasonDto): string {
  if (reason.kind === 'macro') return `via macro ${reason.macro ?? basename(reason.path)}`;
  if (reason.kind === 'yaml') return basename(reason.path);
  return FILE_CHANGE_LABEL[reason.change];
}

export function describeReasons(reasons: readonly ImpactChangeReasonDto[]): string {
  return [...reasons]
    .sort((a, b) => REASON_ORDER[a.kind] - REASON_ORDER[b.kind])
    .map(describeReason)
    .join(' · ');
}

export function seedIdsFrom(data: ImpactChangesDto | undefined): string[] {
  return data ? data.nodes.map((n) => n.unique_id) : [];
}

export function reasonsByNode(data: ImpactChangesDto | undefined): Map<string, string> {
  return new Map((data?.nodes ?? []).map((n) => [n.unique_id, describeReasons(n.reasons)]));
}

export function changeErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 422) return "This project isn't inside a git repository.";
  if (err instanceof ApiError && typeof err.body === 'string') return err.body;
  if (err instanceof Error) return err.message;
  return "Couldn't load changes";
}
