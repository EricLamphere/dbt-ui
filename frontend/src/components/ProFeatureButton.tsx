import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';

interface ProFeatureButtonProps {
  onClick: () => void;
  children: ReactNode;
  title?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Standard "shiny" treatment for gated dbt-ui Pro features — an animated
 * gradient border/sheen so locked Pro actions read as premium, not disabled.
 * Use this for every Pro-gated action button in the app.
 */
export function ProFeatureButton({ onClick, children, title, className = '', disabled = false }: ProFeatureButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded shrink-0 overflow-hidden
        text-brand-300 bg-surface-elevated disabled:opacity-60 disabled:pointer-events-none
        transition-transform duration-150 hover:scale-[1.03] active:scale-[0.98] ${className}`}
    >
      {/* Animated gradient border. brand-300/400/500/600 are remapped to dark
          teal-on-light-bg text colors in light mode (for text contrast), which
          would make this border look dull there — brand-200/700 are the pair
          that stay real, vivid teal in both themes. */}
      <span
        className="pointer-events-none absolute inset-0 rounded bg-[length:200%_100%] animate-pro-shimmer opacity-90"
        style={{
          background:
            'linear-gradient(110deg, rgb(var(--brand-700)) 0%, rgb(var(--brand-200)) 25%, rgb(var(--brand-700)) 50%, rgb(var(--brand-200)) 75%, rgb(var(--brand-700)) 100%)',
          backgroundSize: '200% 100%',
        }}
      />
      {/* Inner fill, inset by 1px to leave the gradient as a border */}
      <span className="pointer-events-none absolute inset-[1px] rounded-[3px] bg-surface-elevated group-hover:bg-surface-elevated/80 transition-colors" />

      <span className="relative flex items-center gap-1.5">
        <Sparkles size={12} className="text-brand-300" />
        {children}
      </span>
    </button>
  );
}
