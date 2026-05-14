import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Copy, Check, Grid3x3, AlignLeft } from 'lucide-react';

export interface ColumnDef {
  key: string;
  align?: 'left' | 'right';
  className?: string;
}

interface Selection {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

interface DataTableProps {
  columns: ColumnDef[];
  rows: unknown[][];
  className?: string;
  maxHeight?: string;
  fontSize?: 'xs' | 'sm' | '2xs';
}

type ViewMode = 'grid' | 'text';

function normalizeSelection(sel: Selection): Selection {
  return {
    startRow: Math.min(sel.startRow, sel.endRow),
    startCol: Math.min(sel.startCol, sel.endCol),
    endRow: Math.max(sel.startRow, sel.endRow),
    endCol: Math.max(sel.startCol, sel.endCol),
  };
}

function isCellSelected(sel: Selection | null, row: number, col: number): boolean {
  if (!sel) return false;
  const n = normalizeSelection(sel);
  return row >= n.startRow && row <= n.endRow && col >= n.startCol && col <= n.endCol;
}

const FONT_CLASS: Record<NonNullable<DataTableProps['fontSize']>, string> = {
  'xs': 'text-xs',
  'sm': 'text-sm',
  '2xs': 'text-[11px]',
};

function buildTextFormat(cols: ColumnDef[], dataRows: unknown[][], widths: number[]): string {
  const header = cols.map((col, ci) => col.key.padEnd(widths[ci])).join(' | ') + ' |';
  const sep    = widths.map(w => '-'.repeat(w)).join('-+-') + '-+';
  const lines  = dataRows.map(row =>
    cols.map((_, ci) => String(row[ci] ?? '').padEnd(widths[ci])).join(' | ') + ' |'
  );
  return [header, sep, ...lines].join('\n');
}

export function DataTable({
  columns,
  rows,
  className,
  maxHeight,
  fontSize = 'xs',
}: DataTableProps) {
  // ── Grid state ────────────────────────────────────────────────────────────
  const [selection, setSelection]   = useState<Selection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused]   = useState(false);
  const gridRef   = useRef<HTMLDivElement>(null);
  const dragOriginRef = useRef<{ row: number; col: number } | null>(null);

  // ── Shared ────────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [copied, setCopied]     = useState(false);

  // ── Text view rect-selection state ────────────────────────────────────────
  const [textSel, setTextSel]       = useState<Selection | null>(null);
  const [textDragging, setTextDragging] = useState(false);
  const preRef       = useRef<HTMLPreElement>(null);
  const textWrapRef  = useRef<HTMLDivElement>(null);
  const [charWidth, setCharWidth]   = useState(0);
  const [lineHeight, setLineHeight] = useState(0);
  const [prePad, setPrePad]         = useState({ left: 0, top: 0 });

  const numRows = rows.length;
  const numCols = columns.length;

  const colWidths = useMemo(() =>
    columns.map((col, ci) => {
      const maxData = rows.reduce((m, row) => Math.max(m, String(row[ci] ?? '').length), 0);
      return Math.max(col.key.length, maxData);
    }),
  [columns, rows]);

  // Measure monospace character metrics after the <pre> is in the DOM
  useEffect(() => {
    if (viewMode !== 'text' || !preRef.current) return;
    const pre = preRef.current;
    const cs  = getComputedStyle(pre);

    const span = document.createElement('span');
    Object.assign(span.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre', font: cs.font });
    span.textContent = 'x'.repeat(200);
    document.body.appendChild(span);
    setCharWidth(span.getBoundingClientRect().width / 200);
    document.body.removeChild(span);

    setLineHeight(parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5);
    setPrePad({ left: parseFloat(cs.paddingLeft), top: parseFloat(cs.paddingTop) });
  }, [viewMode]);

  // ── Copy ─────────────────────────────────────────────────────────────────
  const copyAll = useCallback(() => {
    let text: string;
    if (viewMode === 'text') {
      const full = buildTextFormat(columns, rows, colWidths);
      if (textSel && charWidth > 0) {
        const n = normalizeSelection(textSel);
        text = full.split('\n')
          .slice(n.startRow, n.endRow + 1)
          .map(line => line.slice(n.startCol, n.endCol))
          .join('\n');
      } else {
        text = full;
      }
    } else {
      const lines = [columns.map(c => c.key).join('\t')];
      for (const row of rows) lines.push(columns.map((_, ci) => String(row[ci] ?? '')).join('\t'));
      text = lines.join('\n');
    }
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  }, [columns, rows, colWidths, viewMode, textSel, charWidth]);

  // ── Grid keyboard ─────────────────────────────────────────────────────────
  const handleGridCopy = useCallback(() => {
    if (!selection) return;
    const n = normalizeSelection(selection);
    const lines: string[] = [];
    for (let r = n.startRow; r <= n.endRow; r++) {
      const cells: string[] = [];
      for (let c = n.startCol; c <= n.endCol; c++) cells.push(String(rows[r]?.[c] ?? ''));
      lines.push(cells.join('\t'));
    }
    navigator.clipboard.writeText(lines.join('\n')).catch(() => undefined);
  }, [selection, rows]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isFocused) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'a') {
      e.preventDefault();
      setSelection({ startRow: 0, startCol: 0, endRow: numRows - 1, endCol: numCols - 1 });
      return;
    }
    if (mod && e.key === 'c') { e.preventDefault(); handleGridCopy(); return; }
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    };
    if (arrows[e.key]) {
      e.preventDefault();
      const [dr, dc] = arrows[e.key];
      setSelection(prev => {
        if (!prev) return { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
        if (e.shiftKey) return {
          ...prev,
          endRow: Math.max(0, Math.min(numRows - 1, prev.endRow + dr)),
          endCol: Math.max(0, Math.min(numCols - 1, prev.endCol + dc)),
        };
        const n = normalizeSelection(prev);
        const r = Math.max(0, Math.min(numRows - 1, n.startRow + dr));
        const c = Math.max(0, Math.min(numCols - 1, n.startCol + dc));
        return { startRow: r, startCol: c, endRow: r, endCol: c };
      });
    }
  }, [isFocused, handleGridCopy, numRows, numCols]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Grid mouse ────────────────────────────────────────────────────────────
  const handleCellMouseDown = (row: number, col: number, e: React.MouseEvent) => {
    e.preventDefault();
    gridRef.current?.focus();
    dragOriginRef.current = { row, col };
    setIsDragging(true);
    if (e.shiftKey && selection) {
      setSelection(prev => prev ? { ...prev, endRow: row, endCol: col } : { startRow: row, startCol: col, endRow: row, endCol: col });
    } else {
      setSelection({ startRow: row, startCol: col, endRow: row, endCol: col });
    }
  };
  const handleCellMouseEnter = (row: number, col: number) => {
    if (!isDragging || !dragOriginRef.current) return;
    setSelection({ startRow: dragOriginRef.current.row, startCol: dragOriginRef.current.col, endRow: row, endCol: col });
  };
  const handleMouseUp  = () => { setIsDragging(false); dragOriginRef.current = null; };
  const selectColumn   = (col: number) => { gridRef.current?.focus(); setSelection({ startRow: 0, startCol: col, endRow: numRows - 1, endCol: col }); };
  const selectRow      = (row: number) => { gridRef.current?.focus(); setSelection({ startRow: row, startCol: 0, endRow: row, endCol: numCols - 1 }); };
  const selectAll      = () => { gridRef.current?.focus(); setSelection({ startRow: 0, startCol: 0, endRow: numRows - 1, endCol: numCols - 1 }); };

  // ── Text view rect-selection mouse ────────────────────────────────────────
  const getCharPos = useCallback((e: React.MouseEvent): { row: number; col: number } => {
    const pre = preRef.current;
    if (!pre || charWidth <= 0 || lineHeight <= 0) return { row: 0, col: 0 };
    // getBoundingClientRect() is viewport-relative; as the wrapper scrolls the pre
    // moves in the viewport, so no explicit scroll correction is needed.
    const rect = pre.getBoundingClientRect();
    const col = Math.max(0, Math.floor((e.clientX - rect.left - prePad.left) / charWidth));
    const row = Math.max(0, Math.floor((e.clientY - rect.top  - prePad.top)  / lineHeight));
    return { row, col };
  }, [charWidth, lineHeight, prePad]);

  const handleTextMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); // block native text selection (also blocks automatic focus transfer)
    textWrapRef.current?.focus(); // restore focus so keyboard events reach the wrapper
    const { row, col } = getCharPos(e);
    setTextSel({ startRow: row, startCol: col, endRow: row, endCol: col });
    setTextDragging(true);
  }, [getCharPos]);

  const handleTextMouseMove = useCallback((e: React.MouseEvent) => {
    if (!textDragging) return;
    const { row, col } = getCharPos(e);
    setTextSel(prev => prev ? { ...prev, endRow: row, endCol: col } : null);
  }, [textDragging, getCharPos]);

  const handleTextMouseUp = useCallback(() => setTextDragging(false), []);

  // Cmd+C while the text view wrapper is focused copies rect selection
  const handleTextKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      e.preventDefault();
      copyAll();
    }
    if (e.key === 'Escape') setTextSel(null);
  }, [copyAll]);

  // ── Text view overlay geometry ────────────────────────────────────────────
  const overlayStyle = useMemo((): React.CSSProperties | null => {
    if (!textSel || charWidth <= 0 || lineHeight <= 0) return null;
    const n = normalizeSelection(textSel);
    if (n.startCol === n.endCol && n.startRow === n.endRow) return null; // zero-size
    return {
      left:   prePad.left + n.startCol * charWidth,
      top:    prePad.top  + n.startRow * lineHeight,
      width:  (n.endCol - n.startCol) * charWidth,
      height: (n.endRow - n.startRow + 1) * lineHeight,
    };
  }, [textSel, charWidth, lineHeight, prePad]);

  // ── Styles ────────────────────────────────────────────────────────────────
  const fontCls        = FONT_CLASS[fontSize];
  const containerStyle = maxHeight ? { maxHeight } : undefined;

  const toolbarBtn = 'flex items-center gap-1 px-2 py-0.5 text-xs rounded transition-colors text-gray-500 hover:text-gray-200 hover:bg-gray-700/40';
  const toggleBase     = 'flex items-center gap-1 px-2 py-0.5 text-xs transition-colors';
  const toggleActive   = `${toggleBase} bg-gray-700/60 text-gray-200`;
  const toggleInactive = `${toggleBase} text-gray-500 hover:text-gray-200 hover:bg-gray-700/40`;

  return (
    <div className={`flex flex-col gap-1${className ? ` ${className}` : ''}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-0.5">
        <button
          onClick={copyAll}
          className={toolbarBtn}
          title={viewMode === 'text' && textSel ? 'Copy selection' : 'Copy table'}
        >
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>

        <div className="ml-auto flex items-center rounded overflow-hidden border border-gray-700/60">
          <button onClick={() => setViewMode('grid')} className={viewMode === 'grid' ? toggleActive : toggleInactive} title="View as grid">
            <Grid3x3 size={12} /><span>Grid</span>
          </button>
          <button onClick={() => setViewMode('text')} className={viewMode === 'text' ? toggleActive : toggleInactive} title="View as text">
            <AlignLeft size={12} /><span>Text</span>
          </button>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'text' ? (
        // Outer div is the scroll + positioning container; <pre> has the padding.
        // The selection overlay is absolutely positioned within this div so it scrolls
        // with the content.
        <div
          ref={textWrapRef}
          className="relative overflow-auto rounded border border-gray-800 outline-none"
          style={containerStyle}
          tabIndex={0}
          onKeyDown={handleTextKeyDown}
        >
          <pre
            ref={preRef}
            className={`${fontCls} font-mono text-gray-300 whitespace-pre p-3 select-none cursor-crosshair`}
            onMouseDown={handleTextMouseDown}
            onMouseMove={handleTextMouseMove}
            onMouseUp={handleTextMouseUp}
            onMouseLeave={handleTextMouseUp}
          >
            {buildTextFormat(columns, rows, colWidths)}
          </pre>

          {overlayStyle && (
            <div
              className="pointer-events-none absolute bg-blue-500/25 border border-blue-400/70 rounded-[1px]"
              style={overlayStyle}
            />
          )}
        </div>
      ) : (
        <div
          ref={gridRef}
          tabIndex={0}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="overflow-auto rounded border border-gray-800 outline-none select-none"
          style={containerStyle}
        >
          <table className={`w-full ${fontCls} text-gray-300 border-collapse`}>
            <thead>
              <tr className="bg-surface-elevated sticky top-0 z-10">
                <th
                  onClick={selectAll}
                  className="w-10 min-w-10 px-2 py-1.5 text-center text-gray-600 font-normal border-b border-gray-800 cursor-pointer hover:bg-surface-elevated/70 whitespace-nowrap"
                  title="Select all"
                >
                  #
                </th>
                {columns.map((col, ci) => (
                  <th
                    key={ci}
                    onClick={() => selectColumn(ci)}
                    className={`px-3 py-1.5 text-gray-400 font-medium border-b border-gray-800 whitespace-nowrap cursor-pointer hover:bg-surface-elevated/70 ${col.align === 'right' ? 'text-right' : 'text-left'}${col.className ? ` ${col.className}` : ''}`}
                  >
                    {col.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-gray-800/50 hover:bg-surface-elevated/30">
                  <td
                    onClick={() => selectRow(ri)}
                    className="w-10 min-w-10 px-2 py-1 text-center text-gray-600 border-r border-gray-800/50 cursor-pointer hover:bg-surface-elevated/70 whitespace-nowrap font-mono"
                  >
                    {ri + 1}
                  </td>
                  {columns.map((col, ci) => {
                    const selected = isCellSelected(selection, ri, ci);
                    return (
                      <td
                        key={ci}
                        onMouseDown={(e) => handleCellMouseDown(ri, ci, e)}
                        onMouseEnter={() => handleCellMouseEnter(ri, ci)}
                        className={`px-3 py-1 font-mono whitespace-nowrap cursor-cell ${col.align === 'right' ? 'text-right' : ''}${col.className ? ` ${col.className}` : ''} ${selected ? 'bg-blue-500/20 outline outline-1 outline-blue-500/50' : ''}`}
                      >
                        {String(row[ci] ?? '')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
