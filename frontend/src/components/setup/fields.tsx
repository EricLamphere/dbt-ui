import type { ReactNode } from 'react';

/**
 * Inline code inside prose. Monospace glyphs are wider and taller than Inter's at the
 * same size (and each sits in a fixed-width cell), so scale down slightly and tighten
 * tracking to sit evenly in the sentence.
 */
export function InlineCode({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <code className={`font-mono text-[0.9em] tracking-tight ${className}`}>{children}</code>;
}

export function StepHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 mb-5">
      <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
      {children && <p className="text-sm text-gray-400 leading-relaxed">{children}</p>}
    </div>
  );
}

interface PathInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  placeholder: string;
  error: string | null;
  hint?: ReactNode;
}

export function PathInput({ label, value, onChange, onEnter, placeholder, error, hint }: PathInputProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-gray-300">{label}</span>
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
        placeholder={placeholder}
        spellCheck={false}
        className={`px-3 py-2 bg-surface-elevated border rounded font-mono text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 ${
          error ? 'border-red-600 focus:ring-red-500' : 'border-gray-700 focus:ring-brand-500'
        }`}
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
      {hint && !error && <span className="text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

interface ChoiceProps {
  selected: boolean;
  onSelect: () => void;
  title: ReactNode;
  detail?: ReactNode;
}

/** A selectable card row, used for radio-style choices. */
export function Choice({ selected, onSelect, title, detail }: ChoiceProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex items-start gap-3 w-full px-3 py-2.5 rounded border text-left transition-colors ${
        selected ? 'border-brand-500 bg-brand-900/20' : 'border-gray-800 bg-surface-elevated hover:border-gray-600'
      }`}
    >
      <span
        className={`mt-0.5 w-3.5 h-3.5 rounded-full border shrink-0 ${
          selected ? 'border-brand-400 bg-brand-400 ring-2 ring-inset ring-surface-elevated' : 'border-gray-600'
        }`}
      />
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm text-gray-100">{title}</span>
        {detail && <span className="text-xs font-mono text-gray-500 truncate">{detail}</span>}
      </span>
    </button>
  );
}
