import { useState } from 'react';
import { api } from '../../../lib/api';

interface Props {
  projectId: number;
  onClose: () => void;
  onCreated: (name: string) => void;
}

// Allow subdirectory paths like "staging/my_model" — each segment is letters/digits/underscores/hyphens
const NAME_RE = /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/;

export default function NewModelModal({ projectId, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [sql, setSql] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Model name is required.');
      return;
    }
    if (!NAME_RE.test(trimmedName)) {
      setError('Use letters, digits, underscores, and hyphens. Separate subdirectories with /.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await api.models.create(projectId, trimmedName, sql);
      onCreated(trimmedName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('409')) {
        setError(`A model named '${trimmedName}' already exists.`);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-100">New model</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-gray-400 font-medium" htmlFor="model-name">
              Model name
            </label>
            <input
              id="model-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my_model"
              autoFocus
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-gray-600">
              Creates <code className="font-mono text-gray-500">models/{name || 'my_model'}.sql</code>
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-gray-400 font-medium" htmlFor="model-sql">
              Initial SQL <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <textarea
              id="model-sql"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              placeholder="select&#10;    1 as id"
              rows={5}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating…' : 'Create model'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
