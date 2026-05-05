import { createContext, useContext } from 'react';

export interface CommandPaletteContextValue {
  open: (initialQuery?: string) => void;
  close: () => void;
}

export const CommandPaletteContext = createContext<CommandPaletteContextValue>({
  open: () => {},
  close: () => {},
});

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}
