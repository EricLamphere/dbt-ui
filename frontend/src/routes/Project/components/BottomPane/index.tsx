import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { type GraphDto } from '../../../../lib/api';
import { RunPanel } from './RunPanel';
import { LogPanel } from './LogPanel';
import { SingleTerminal } from './TerminalPanel';

export type PaneTabId = 'run' | 'project-logs' | 'api-logs' | 'terminal';

interface TermTab {
  id: string;      // unique per instance
  label: string;
}

interface BottomPaneProps {
  projectId: number;
  graph: GraphDto | null;
  projectPath: string | null;
}

const MIN_HEIGHT = 180;
const DEFAULT_HEIGHT = 280;
const MAX_HEIGHT = 800;
const COLLAPSE_THRESHOLD = 80;

let termIdCounter = 0;
function newTermTab(): TermTab {
  termIdCounter += 1;
  return { id: `term-${termIdCounter}`, label: 'bash' };
}

export function BottomPane({ projectId, graph, projectPath }: BottomPaneProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PaneTabId>('run');
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const resizing = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);
  const lastHeightRef = useRef(DEFAULT_HEIGHT);

  // Terminal instance management
  const [termTabs, setTermTabs] = useState<TermTab[]>([]);
  const [activeTermId, setActiveTermId] = useState<string | null>(null);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; termId: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleRunStart = useCallback(() => {
    setOpen(true);
    setActiveTab('run');
  }, []);

  // When switching to terminal tab, create first instance if none exist
  const switchToTerminal = useCallback(() => {
    setActiveTab('terminal');
    if (!open) setOpen(true);
    setTermTabs((prev) => {
      if (prev.length > 0) return prev;
      const t = newTermTab();
      setActiveTermId(t.id);
      return [t];
    });
  }, [open]);

  const addTerminal = useCallback(() => {
    setTermTabs((prev) => {
      const t = newTermTab();
      setActiveTermId(t.id);
      return [...prev, t];
    });
  }, []);

  const closeTerminal = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setTermTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveTermId((cur) => {
        if (cur !== id) return cur;
        if (next.length === 0) return null;
        const idx = prev.findIndex((t) => t.id === id);
        return next[Math.min(idx, next.length - 1)].id;
      });
      return next;
    });
  }, []);

  const startRename = useCallback((id: string, currentLabel: string) => {
    setRenamingId(id);
    setRenameValue(currentLabel);
    setCtxMenu(null);
    setTimeout(() => renameInputRef.current?.select(), 30);
  }, []);

  const commitRename = useCallback(() => {
    if (!renamingId) return;
    const val = renameValue.trim();
    if (val) {
      setTermTabs((prev) => prev.map((t) => t.id === renamingId ? { ...t, label: val } : t));
    }
    setRenamingId(null);
  }, [renamingId, renameValue]);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('contextmenu', close); };
  }, [ctxMenu]);

  // Resize drag logic
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const delta = startY.current - e.clientY;
      setHeight(Math.max(0, Math.min(MAX_HEIGHT, startH.current + delta)));
    };
    const onMouseUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      setHeight((h) => {
        if (h < COLLAPSE_THRESHOLD) {
          setOpen(false);
          return lastHeightRef.current;
        }
        const clamped = Math.max(MIN_HEIGHT, h);
        lastHeightRef.current = clamped;
        return clamped;
      });
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const isTerminalActive = open && activeTab === 'terminal';

  return (
    <div className="shrink-0 bg-surface-panel border-t border-gray-700 flex flex-col">
      {/* Tab bar */}
      <div
        className="flex items-center gap-1 px-3 border-b border-gray-800 select-none shrink-0 cursor-row-resize"
        style={{ height: 36 }}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button,input')) return;
          resizing.current = true;
          startY.current = e.clientY;
          if (open) {
            startH.current = height;
          } else {
            startH.current = 0;
            setOpen(true);
            setHeight(0);
          }
          e.preventDefault();
        }}
      >
        {/* Drag affordance */}
        <div className="w-6 flex flex-col gap-0.5 items-center justify-center shrink-0 mr-1 opacity-40">
          <div className="w-4 h-px bg-gray-500" />
          <div className="w-4 h-px bg-gray-500" />
          <div className="w-4 h-px bg-gray-500" />
        </div>

        {/* Pane tabs */}
        {(['run', 'terminal', 'project-logs', 'api-logs'] as PaneTabId[]).map((id) => (
          <button
            key={id}
            onClick={() => {
              if (id === 'terminal') { switchToTerminal(); return; }
              if (!open) setOpen(true);
              setActiveTab(id);
            }}
            className={`px-3 py-1 text-xs rounded transition-colors whitespace-nowrap
              ${open && activeTab === id
                ? 'bg-brand-900/50 text-brand-300 font-medium'
                : 'text-gray-500 hover:text-gray-300'
              }`}
          >
            {id === 'run' ? 'Execution DAG' : id === 'terminal' ? 'Terminal' : id === 'project-logs' ? 'Project Logs' : 'API Logs'}
          </button>
        ))}

        <div className="ml-auto">
          <button
            onClick={() => setOpen((v) => !v)}
            className="p-1 rounded text-gray-500 hover:text-gray-300 transition-colors"
            title={open ? 'Collapse pane' : 'Expand pane'}
          >
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* RunPanel — always mounted */}
      <div
        style={{ height: open && activeTab === 'run' ? height : 0 }}
        className="overflow-hidden flex flex-col"
        aria-hidden={!(open && activeTab === 'run')}
      >
        <RunPanel projectId={projectId} graph={graph} onRunStart={handleRunStart} />
      </div>

      {/* Terminal view — two-column: terminal canvas | terminal tabs strip */}
      {/* All terminal instances stay mounted once created; only display changes */}
      <div
        style={{ height: isTerminalActive ? height : 0 }}
        className="overflow-hidden flex flex-row"
        aria-hidden={!isTerminalActive}
      >
        {/* Terminal canvases — all mounted, only one visible */}
        <div className="flex-1 overflow-hidden relative">
          {termTabs.map((t) => (
            <div
              key={t.id}
              className="absolute inset-0"
              style={{ display: activeTermId === t.id ? 'flex' : 'none', flexDirection: 'column' }}
            >
              {projectPath ? (
                <SingleTerminal
                  instanceId={t.id}
                  projectPath={projectPath}
                  active={isTerminalActive && activeTermId === t.id}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-gray-600">Loading project…</div>
              )}
            </div>
          ))}
          {termTabs.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-600">
              No terminals open
            </div>
          )}
        </div>

        {/* Terminal tab strip (right side, VSCode style) */}
        <div className="w-44 shrink-0 border-l border-gray-800 flex flex-col bg-surface-panel overflow-hidden">
          {/* Strip header */}
          <div className="flex items-center justify-between px-2 py-1 border-b border-gray-800 shrink-0">
            <span className="text-[10px] text-gray-600 uppercase tracking-wide font-medium">Terminals</span>
            <button
              onClick={addTerminal}
              title="New terminal"
              className="p-0.5 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Term tab list */}
          <div className="flex-1 overflow-y-auto">
            {termTabs.map((t) => (
              <div
                key={t.id}
                onClick={() => setActiveTermId(t.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, termId: t.id });
                }}
                onDoubleClick={() => startRename(t.id, t.label)}
                className={`group flex items-center gap-1 px-2 py-1.5 cursor-pointer select-none transition-colors
                  ${activeTermId === t.id
                    ? 'bg-brand-900/40 text-brand-300'
                    : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
                  }`}
              >
                {renamingId === t.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingId(null);
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-gray-800 border border-brand-600 rounded px-1 text-xs text-gray-100 outline-none"
                    autoFocus
                  />
                ) : (
                  <span className="flex-1 min-w-0 text-xs truncate">{t.label}</span>
                )}
                <button
                  onClick={(e) => closeTerminal(t.id, e)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-gray-600 hover:text-gray-100"
                  title="Close terminal"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Logs panels */}
      {open && (activeTab === 'project-logs' || activeTab === 'api-logs') && (
        <div style={{ height }} className="overflow-hidden flex flex-col">
          {activeTab === 'project-logs' && <LogPanel projectId={projectId} logType="project" />}
          {activeTab === 'api-logs' && <LogPanel projectId={projectId} logType="api" />}
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-50 bg-gray-900 border border-gray-700 rounded shadow-xl py-1 min-w-[140px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
            onClick={() => {
              const t = termTabs.find((t) => t.id === ctxMenu.termId);
              if (t) startRename(t.id, t.label);
            }}
          >
            Rename
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-700 transition-colors"
            onClick={() => { closeTerminal(ctxMenu.termId); setCtxMenu(null); }}
          >
            Close terminal
          </button>
        </div>
      )}
    </div>
  );
}
