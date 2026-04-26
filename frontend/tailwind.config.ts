import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Spread all built-in colors, then override gray with CSS variables
    colors: {
      ...colors,
      // Gray scale — theme-aware via CSS variables (inverted in light mode)
      gray: {
        100: 'rgb(var(--gray-100) / <alpha-value>)',
        200: 'rgb(var(--gray-200) / <alpha-value>)',
        300: 'rgb(var(--gray-300) / <alpha-value>)',
        400: 'rgb(var(--gray-400) / <alpha-value>)',
        500: 'rgb(var(--gray-500) / <alpha-value>)',
        600: 'rgb(var(--gray-600) / <alpha-value>)',
        700: 'rgb(var(--gray-700) / <alpha-value>)',
        800: 'rgb(var(--gray-800) / <alpha-value>)',
        900: 'rgb(var(--gray-900) / <alpha-value>)',
      },
    },
    extend: {
      colors: {
        // Teal accent ramp — reads from CSS variables so runtime theming is possible
        brand: {
          50:  'rgb(var(--brand-50)  / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
          950: 'rgb(var(--brand-950) / <alpha-value>)',
        },
        // Surface layers
        surface: {
          app:      'rgb(var(--bg-app)      / <alpha-value>)',
          panel:    'rgb(var(--bg-panel)    / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
        },
        // Semantic text/border tokens (theme-aware)
        'text-primary':   'rgb(var(--text-primary)   / <alpha-value>)',
        'text-secondary': 'rgb(var(--text-secondary) / <alpha-value>)',
        'text-muted':     'rgb(var(--text-muted)     / <alpha-value>)',
        'border-default': 'rgb(var(--border-default) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
