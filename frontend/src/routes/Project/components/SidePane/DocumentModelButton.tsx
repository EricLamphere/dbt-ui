import { useMutation } from '@tanstack/react-query';
import { FilePlus2, Loader2 } from 'lucide-react';
import { api, type ModelNode } from '../../../../lib/api';
import { describeDocumentResult, documentErrorMessage } from '../../lib/documentModel';

const DOCUMENTABLE_TYPES = new Set(['model', 'seed', 'snapshot']);

export function canDocument(model: ModelNode): boolean {
  return DOCUMENTABLE_TYPES.has(model.resource_type) && !!model.original_file_path;
}

interface DocumentModelButtonProps {
  projectId: number;
  model: ModelNode;
}

/**
 * Adds the node and all of its warehouse columns to the schema YAML in its
 * folder. Mount with `key={model.unique_id}` so feedback resets per node.
 */
export function DocumentModelButton({ projectId, model }: DocumentModelButtonProps) {
  const mutation = useMutation({
    mutationFn: () => api.models.document(projectId, model.unique_id),
  });

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        title="Add this node and its warehouse columns to the schema YAML in its folder"
        className="flex items-center justify-center gap-2 w-full py-2 bg-surface-elevated border border-gray-700 rounded text-sm text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50"
      >
        {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus2 className="w-4 h-4" />}
        {mutation.isPending ? 'Reading columns…' : 'Generate docs YAML'}
      </button>
      {mutation.isSuccess && (
        <p className="text-[10px] text-emerald-400 break-all">{describeDocumentResult(mutation.data)}</p>
      )}
      {mutation.isError && (
        <p className="text-[10px] text-red-400 break-all">{documentErrorMessage(mutation.error)}</p>
      )}
    </div>
  );
}
