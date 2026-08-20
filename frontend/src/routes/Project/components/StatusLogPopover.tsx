import { useCallback, useRef, useState } from 'react';

const HIDE_DELAY_MS = 150;

interface StatusLogPopoverProps {
  /** The status icon (or any trigger element) that opens the panel on hover. */
  icon: React.ReactNode;
  /** Panel content. Pass null to disable the hover panel entirely (icon renders alone). */
  panel: React.ReactNode | null;
  /** Which side of the icon the panel opens on. Default 'start' (panel to the right of the icon). */
  align?: 'start' | 'end';
}

/**
 * Shared hover popover for status icons (init steps, init status badge).
 * Unlike a plain CSS tooltip, the panel stays open when the pointer moves from
 * the icon onto the panel itself (combined mouse-enter/leave with a short
 * hide delay), so its contents can be scrolled.
 */
export function StatusLogPopover({ icon, panel, align = 'start' }: StatusLogPopoverProps) {
  const [open, setOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const handleEnter = useCallback(() => {
    clearHideTimer();
    setOpen(true);
  }, [clearHideTimer]);

  const handleLeave = useCallback(() => {
    clearHideTimer();
    hideTimer.current = setTimeout(() => setOpen(false), HIDE_DELAY_MS);
  }, [clearHideTimer]);

  const positionClass = align === 'start' ? 'left-6' : 'right-6';

  return (
    <div className="relative shrink-0" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      {icon}
      {open && panel && (
        <div
          className={`absolute ${positionClass} top-1/2 -translate-y-1/2 z-50 w-72 max-w-[90vw] max-h-64 overflow-y-auto bg-gray-900 border border-gray-700 rounded px-3 py-2 shadow-xl`}
        >
          {panel}
        </div>
      )}
    </div>
  );
}
