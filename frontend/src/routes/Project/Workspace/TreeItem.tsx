import { useEffect, useRef, useState } from 'react';
import { FileIcon } from '../FileExplorer/FileIcon';
import type { RenameState, TreeNode } from './types';

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  pathParts: string[];
  onToggle: (node: TreeNode, pathParts: string[]) => void;
  onOpen: (path: string) => void;
  activePath: string | null;
  loadingPath: string | null;
  onContextMenu: (e: React.MouseEvent, node: TreeNode, pathParts: string[]) => void;
  renameState: RenameState | null;
  onRenameSubmit: (newName: string) => void;
}

export function TreeItem({
  node, depth, pathParts, onToggle, onOpen, activePath, loadingPath,
  onContextMenu, renameState, onRenameSubmit,
}: TreeItemProps) {
  const indent = depth * 12 + 8;
  const isActive = node.path === activePath;
  const isLoading = node.path === loadingPath;
  const isRenaming = renameState?.path === node.path;
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(node.name);
      setTimeout(() => renameInputRef.current?.select(), 0);
    }
  }, [isRenaming, node.name]);

  const handleClick = () => {
    if (isRenaming) return;
    if (node.is_dir) {
      onToggle(node, pathParts);
    } else {
      onOpen(node.path);
    }
  };

  return (
    <>
      {isRenaming ? (
        <div className="flex items-center gap-1.5 py-[3px] pr-2" style={{ paddingLeft: indent }}>
          {node.is_dir ? (
            <span className="text-[10px] text-gray-600 w-3 shrink-0" />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <FileIcon name={node.name} isDir={node.is_dir} />
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit(renameValue);
              if (e.key === 'Escape') onRenameSubmit(node.name);
            }}
            onBlur={() => onRenameSubmit(renameValue)}
            className="flex-1 bg-surface-elevated border border-brand-500 rounded px-1 py-0 text-xs text-gray-100 focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : (
        <button
          onClick={handleClick}
          onContextMenu={(e) => onContextMenu(e, node, pathParts)}
          className={`w-full flex items-center gap-1.5 py-[3px] pr-2 text-left text-xs transition-colors rounded-sm
            ${isActive ? 'bg-brand-900/50 text-brand-300' : 'text-gray-400 hover:bg-surface-elevated/60 hover:text-gray-200'}`}
          style={{ paddingLeft: indent }}
        >
          {node.is_dir ? (
            <span className="text-[10px] text-gray-600 w-3 shrink-0">
              {node.expanded ? '▼' : '▶'}
            </span>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <FileIcon name={node.name} isDir={node.is_dir} expanded={node.expanded} />
          <span className="truncate">{node.name}</span>
          {isLoading && (
            <svg className="w-3 h-3 animate-spin ml-auto shrink-0 text-brand-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
            </svg>
          )}
        </button>
      )}

      {node.is_dir && node.expanded && node.children && (
        node.children.map((child, i) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            pathParts={[...pathParts, String(i)]}
            onToggle={onToggle}
            onOpen={onOpen}
            activePath={activePath}
            loadingPath={loadingPath}
            onContextMenu={onContextMenu}
            renameState={renameState}
            onRenameSubmit={onRenameSubmit}
          />
        ))
      )}
    </>
  );
}
