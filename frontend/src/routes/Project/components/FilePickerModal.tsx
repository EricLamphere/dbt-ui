import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ChevronDown, File, Folder } from 'lucide-react';
import { api, type FileNode } from '../../../lib/api';

interface FilePickerModalProps {
  projectId: number;
  onSelect: (path: string) => void;
  onClose: () => void;
}

interface TreeNodeProps {
  node: FileNode;
  projectId: number;
  selected: string | null;
  onSelect: (path: string) => void;
  depth: number;
}

function TreeNode({ node, projectId, selected, onSelect, depth }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isShFile = !node.is_dir && node.name.endsWith('.sh');
  const isSelectable = isShFile;

  const { data: children } = useQuery({
    queryKey: ['file-tree', projectId, node.path],
    queryFn: () => api.files.list(projectId, node.path),
    enabled: node.is_dir && expanded,
  });

  const handleClick = () => {
    if (node.is_dir) {
      setExpanded((v) => !v);
    } else if (isSelectable) {
      onSelect(node.path);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        className={`w-full flex items-center gap-1.5 py-1 pr-3 text-xs rounded transition-colors text-left
          ${selected === node.path ? 'bg-brand-900/60 text-brand-200' : ''}
          ${isSelectable ? 'text-gray-200 hover:bg-surface-elevated' : ''}
          ${node.is_dir ? 'text-gray-300 hover:bg-surface-elevated' : ''}
          ${!isSelectable && !node.is_dir ? 'text-gray-600 cursor-default' : 'cursor-pointer'}
        `}
      >
        {node.is_dir ? (
          <>
            {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
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

      {node.is_dir && expanded && children && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              projectId={projectId}
              selected={selected}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
          {children.length === 0 && (
            <p style={{ paddingLeft: `${24 + depth * 16}px` }} className="text-xs text-gray-600 italic py-1">
              Empty
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function FilePickerModal({ projectId, onSelect, onClose }: FilePickerModalProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const { data: rootNodes = [], isLoading } = useQuery({
    queryKey: ['file-tree', projectId, ''],
    queryFn: () => api.files.list(projectId, ''),
  });

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

        <p className="px-4 py-2 text-xs text-gray-500 border-b border-gray-800">
          Only <span className="font-mono text-gray-400">.sh</span> files are selectable.
        </p>

        <div className="flex-1 overflow-auto py-1">
          {isLoading && <p className="text-xs text-gray-500 px-4 py-3">Loading…</p>}
          {rootNodes.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              projectId={projectId}
              selected={selected}
              onSelect={setSelected}
              depth={0}
            />
          ))}
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
