import { useState, useRef, useEffect, useCallback } from 'react';

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

export function DataTable({
  columns,
  rows,
  className,
  maxHeight,
  fontSize = 'xs',
}: DataTableProps) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragOriginRef = useRef<{ row: number; col: number } | null>(null);

  const numRows = rows.length;
  const numCols = columns.length;

  // ── Copy handler ──────────────────────────────────────────────────────────
  const handleCopy = useCallback(() => {
    if (!selection) return;
    const n = normalizeSelection(selection);
    const lines: string[] = [];
    for (let r = n.startRow; r <= n.endRow; r++) {
      const cells: string[] = [];
      for (let c = n.startCol; c <= n.endCol; c++) {
        cells.push(String(rows[r]?.[c] ?? ''));
      }
      lines.push(cells.join('\t'));
    }
    navigator.clipboard.writeText(lines.join('\n')).catch(() => undefined);
  }, [selection, rows]);

  // ── Keyboard handler ──────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isFocused) return;

    const isMod = e.ctrlKey || e.metaKey;

    if (isMod && e.key === 'a') {
      e.preventDefault();
      setSelection({ startRow: 0, startCol: 0, endRow: numRows - 1, endCol: numCols - 1 });
      return;
    }

    if (isMod && e.key === 'c') {
      e.preventDefault();
      handleCopy();
      return;
    }

    const arrowKeys: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };

    if (arrowKeys[e.key]) {
      e.preventDefault();
      const [dr, dc] = arrowKeys[e.key];
      setSelection((prev) => {
        if (!prev) return { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
        if (e.shiftKey) {
          const newEnd = {
            endRow: Math.max(0, Math.min(numRows - 1, prev.endRow + dr)),
            endCol: Math.max(0, Math.min(numCols - 1, prev.endCol + dc)),
          };
          return { ...prev, ...newEnd };
        }
        const n = normalizeSelection(prev);
        const anchor = { row: n.startRow + dr, col: n.startCol + dc };
        anchor.row = Math.max(0, Math.min(numRows - 1, anchor.row));
        anchor.col = Math.max(0, Math.min(numCols - 1, anchor.col));
        return { startRow: anchor.row, startCol: anchor.col, endRow: anchor.row, endCol: anchor.col };
      });
    }
  }, [isFocused, handleCopy, numRows, numCols]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Mouse drag ────────────────────────────────────────────────────────────
  const handleCellMouseDown = (row: number, col: number, e: React.MouseEvent) => {
    e.preventDefault();
    containerRef.current?.focus();
    dragOriginRef.current = { row, col };
    setIsDragging(true);
    if (e.shiftKey && selection) {
      setSelection((prev) => prev ? { ...prev, endRow: row, endCol: col } : { startRow: row, startCol: col, endRow: row, endCol: col });
    } else {
      setSelection({ startRow: row, startCol: col, endRow: row, endCol: col });
    }
  };

  const handleCellMouseEnter = (row: number, col: number) => {
    if (!isDragging || !dragOriginRef.current) return;
    const { row: sr, col: sc } = dragOriginRef.current;
    setSelection({ startRow: sr, startCol: sc, endRow: row, endCol: col });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    dragOriginRef.current = null;
  };

  // ── Column / row / all selection ─────────────────────────────────────────
  const selectColumn = (col: number) => {
    containerRef.current?.focus();
    setSelection({ startRow: 0, startCol: col, endRow: numRows - 1, endCol: col });
  };

  const selectRow = (row: number) => {
    containerRef.current?.focus();
    setSelection({ startRow: row, startCol: 0, endRow: row, endCol: numCols - 1 });
  };

  const selectAll = () => {
    containerRef.current?.focus();
    setSelection({ startRow: 0, startCol: 0, endRow: numRows - 1, endCol: numCols - 1 });
  };

  // ── Styles ────────────────────────────────────────────────────────────────
  const fontCls = FONT_CLASS[fontSize];
  const containerStyle = maxHeight ? { maxHeight } : undefined;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      className={`overflow-auto rounded border border-gray-800 outline-none select-none${className ? ` ${className}` : ''}`}
      style={containerStyle}
    >
      <table className={`w-full ${fontCls} text-gray-300 border-collapse`}>
        <thead>
          <tr className="bg-surface-elevated sticky top-0 z-10">
            {/* Select-all corner */}
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
              {/* Row number */}
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
  );
}
