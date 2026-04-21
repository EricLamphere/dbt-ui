import { useEffect, useRef, useState } from 'react';
import type { TreeNode } from './types';

interface ContextMenuProps {
  x: number;
  y: number;
  node: TreeNode;
  onRename: () => void;
  onDelete: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onCopyPath: () => void;
  onCopyRelativePath: () => void;
  onClose: () => void;
}

function Item({ label, onClick, danger = false, disabled = false }: {
  label: string; onClick: () => void; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onMouseDown={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      disabled={disabled}
      className={`w-full text-left px-3 py-1.5 text-xs transition-colors rounded-sm
        ${danger ? 'text-red-400 hover:bg-red-900/30' : 'text-gray-300 hover:bg-gray-700'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <div className="my-1 border-t border-gray-700" />;
}

export function ContextMenu({ x, y, onRename, onDelete, onNewFile, onNewFolder, onCopyPath, onCopyRelativePath }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos({
      x: x + rect.width > vw ? vw - rect.width - 8 : x,
      y: y + rect.height > vh ? vh - rect.height - 8 : y,
    });
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] bg-surface-panel border border-gray-700 rounded-lg shadow-xl py-1 text-sm"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Item label="Rename…" onClick={onRename} />
      <Divider />
      <Item label="New File…" onClick={onNewFile} />
      <Item label="New Folder…" onClick={onNewFolder} />
      <Divider />
      <Item label="Copy Path" onClick={onCopyPath} />
      <Item label="Copy Relative Path" onClick={onCopyRelativePath} />
      <Divider />
      <Item label="Delete" onClick={onDelete} danger />
    </div>
  );
}
