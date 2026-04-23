import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ModelNode, type GraphDto } from '../../../../lib/api';
import { PropertiesTab } from './PropertiesTab';

interface SidePaneProps {
  projectId: number;
  model: ModelNode | null;
  selectedModels?: ModelNode[];
  graph: GraphDto | null;
  /** 'files' hides "Edit in Files" and shows "Open in DAG" instead */
  page: 'files' | 'dag';
  onNavigateToFiles?: () => void;
  onNavigateToDag?: () => void;
  onViewDocs?: () => void;
  onDelete?: () => void;
  failedTestUid?: string | null;
}

const MIN_WIDTH = 200;
const DEFAULT_WIDTH = 320;
const MAX_WIDTH = 600;
const COLLAPSE_THRESHOLD = 80;

export function SidePane({
  projectId,
  model,
  selectedModels = [],
  graph,
  page,
  onNavigateToFiles,
  onNavigateToDag,
  onViewDocs,
  onDelete,
  failedTestUid,
}: SidePaneProps) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const resizing = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const lastWidthRef = useRef(DEFAULT_WIDTH);

  // Auto-open when a model is selected (single or multi)
  useEffect(() => {
    if (model || selectedModels.length > 1) setOpen(true);
  }, [model?.unique_id, selectedModels.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const delta = startX.current - e.clientX;
      setWidth(Math.max(0, Math.min(MAX_WIDTH, startW.current + delta)));
    };
    const onMouseUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      setWidth((w) => {
        if (w < COLLAPSE_THRESHOLD) {
          setOpen(false);
          return lastWidthRef.current;
        }
        const clamped = Math.max(MIN_WIDTH, w);
        lastWidthRef.current = clamped;
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

  const toggleOpen = () => {
    setOpen((v) => {
      if (!v) setWidth(lastWidthRef.current);
      return !v;
    });
  };

  return (
    <div className="shrink-0 bg-surface-panel border-l border-gray-700 flex flex-row">
      {/* Drag handle + toggle button strip */}
      <div
        className="flex flex-col items-center justify-between py-2 border-r border-gray-800 select-none cursor-col-resize bg-surface-panel"
        style={{ width: 20 }}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          resizing.current = true;
          startX.current = e.clientX;
          if (open) {
            startW.current = width;
          } else {
            startW.current = 0;
            setOpen(true);
            setWidth(0);
          }
          e.preventDefault();
        }}
      >
        {/* Drag affordance */}
        <div className="flex flex-col gap-0.5 items-center opacity-40 mt-2">
          <div className="w-px h-4 bg-gray-500" />
          <div className="w-px h-4 bg-gray-500" />
          <div className="w-px h-4 bg-gray-500" />
        </div>

        {/* Toggle button */}
        <button
          onClick={toggleOpen}
          className="p-0.5 rounded text-gray-500 hover:text-gray-300 transition-colors mb-2"
          title={open ? 'Collapse panel' : 'Expand panel'}
        >
          {open ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Panel content */}
      <div
        style={{ width: open ? width : 0 }}
        className="overflow-hidden flex flex-col transition-none"
        aria-hidden={!open}
      >
        <div style={{ width }} className="flex flex-col h-full overflow-hidden">
          <PropertiesTab
            projectId={projectId}
            model={model}
            selectedModels={selectedModels}
            graph={graph}
            page={page}
            failedTestUid={failedTestUid}
            onNavigateToFiles={onNavigateToFiles}
            onNavigateToDag={onNavigateToDag}
            onViewDocs={onViewDocs}
            onDelete={onDelete}
          />
        </div>
      </div>
    </div>
  );
}
