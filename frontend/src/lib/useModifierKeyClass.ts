import { useEffect } from 'react';

/** Class set on <html> while Cmd (macOS) or Ctrl is held; drives the Tailwind `mod:` variant. */
export const MOD_HELD_CLASS = 'mod-held';

/**
 * Tracks whether Cmd/Ctrl is held and mirrors it as a class on <html>, so
 * Cmd+clickable elements can show `cursor-pointer` only while the key is down
 * (`cursor-default mod:cursor-pointer`).
 *
 * Mouse events re-sync from `e.metaKey`/`e.ctrlKey` because a keyup can be
 * missed (e.g. Cmd released while another window has focus).
 */
export function useModifierKeyClass(): void {
  useEffect(() => {
    const root = document.documentElement;
    const sync = (held: boolean) => root.classList.toggle(MOD_HELD_CLASS, held);

    const onKey = (e: KeyboardEvent) => sync(e.metaKey || e.ctrlKey);
    const onMouse = (e: MouseEvent) => sync(e.metaKey || e.ctrlKey);
    const onBlur = () => sync(false);

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('mousemove', onMouse, { passive: true });
    window.addEventListener('mousedown', onMouse);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('mousedown', onMouse);
      window.removeEventListener('blur', onBlur);
      sync(false);
    };
  }, []);
}
