import { useRef, useState, useEffect } from 'react';
import ProjectNav, { type CurrentPage } from './ProjectNav';

const COLLAPSED_WIDTH = 48;
const DEFAULT_WIDTH = 192;
const MIN_WIDTH = 120;
const MAX_WIDTH = 320;

interface Props {
  projectId: number;
  current: CurrentPage;
}

const STORAGE_KEY = 'nav-rail-collapsed';

export default function NavRail({ projectId, current }: Props) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true');
  const [expandedWidth, setExpandedWidth] = useState(DEFAULT_WIDTH);
  const resizing = useRef(false);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing.current || collapsed) return;
      setExpandedWidth((w) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w + e.movementX)));
    };
    const onMouseUp = () => { resizing.current = false; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [collapsed]);

  const width = collapsed ? COLLAPSED_WIDTH : expandedWidth;

  return (
    <div
      style={{ width }}
      className="shrink-0 bg-surface-panel border-r border-gray-800 flex flex-col overflow-hidden relative transition-[width] duration-150"
    >
      <ProjectNav
        projectId={projectId}
        current={current}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => {
          const next = !c;
          localStorage.setItem(STORAGE_KEY, String(next));
          return next;
        })}
      />
      {!collapsed && (
        <div
          onMouseDown={() => { resizing.current = true; }}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-brand-500/40 transition-colors z-10"
        />
      )}
    </div>
  );
}
