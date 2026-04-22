import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronUp, ChevronRight, File, Folder } from 'lucide-react';
import { api, type FileNode } from '../../../lib/api';

interface FilePickerModalProps {
  projectPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

function parentOf(absPath: string): string {
  const parts = absPath.split('/').filter(Boolean);
  if (parts.length === 0) return '/';
  return '/' + parts.slice(0, -1).join('/');
}

export function FilePickerModal({ projectPath, onSelect, onClose }: FilePickerModalProps) {
  const [currentDir, setCurrentDir] = useState(projectPath || '/');
  const [selected, setSelected] = useState<string | null>(null);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['filesystem-browse', currentDir],
    queryFn: () => api.filesystem.browse(currentDir),
  });

  const atRoot = currentDir === '/';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-panel border border-gray-700 rounded-lg shadow-2xl w-[520px] max-h-[600px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-200">Select an existing script</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm">✕</button>
        </div>

        {/* Path bar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 bg-surface-elevated/40">
          <button
            onClick={() => setCurrentDir(parentOf(currentDir))}
            disabled={atRoot}
            title="Go up one directory"
            className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-surface-elevated transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <span className="flex-1 text-xs font-mono text-gray-400 truncate" title={currentDir}>
            {currentDir}
          </span>
        </div>

        <p className="px-4 py-1.5 text-xs text-gray-500 border-b border-gray-800">
          Only <span className="font-mono text-gray-400">.sh</span> files are selectable.
        </p>

        <div className="flex-1 overflow-auto py-1">
          {isLoading && <p className="text-xs text-gray-500 px-4 py-3">Loading…</p>}
          {!isLoading && entries.length === 0 && (
            <p className="text-xs text-gray-600 italic px-4 py-3">Empty directory</p>
          )}
          {entries.map((node: FileNode) => {
            const isShFile = !node.is_dir && node.name.endsWith('.sh');
            return (
              <button
                key={node.path}
                onClick={() => {
                  if (node.is_dir) setCurrentDir(node.path);
                  else if (isShFile) setSelected(node.path);
                }}
                className={`w-full flex items-center gap-1.5 py-1 px-3 text-xs rounded transition-colors text-left
                  ${selected === node.path ? 'bg-brand-900/60 text-brand-200' : ''}
                  ${node.is_dir ? 'text-gray-300 hover:bg-surface-elevated cursor-pointer' : ''}
                  ${isShFile ? 'text-gray-200 hover:bg-surface-elevated cursor-pointer' : ''}
                  ${!isShFile && !node.is_dir ? 'text-gray-600 cursor-default' : ''}
                `}
              >
                {node.is_dir ? (
                  <>
                    <ChevronRight className="w-3 h-3 shrink-0 text-gray-500" />
                    <Folder className="w-3.5 h-3.5 shrink-0 text-yellow-500/70" />
                  </>
                ) : (
                  <>
                    <span className="w-3 h-3 shrink-0" />
                    <File className={`w-3.5 h-3.5 shrink-0 ${isShFile ? 'text-green-400/70' : 'text-gray-600'}`} />
                  </>
                )}
                <span className="truncate">{node.name}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-800">
          <span className="text-xs text-gray-500 font-mono truncate">
            {selected ?? 'No file selected'}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              disabled={!selected}
              onClick={() => selected && onSelect(selected)}
              className="px-3 py-1.5 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-40 transition-colors"
            >
              Use this script
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
