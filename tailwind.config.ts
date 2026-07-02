import type { Config } from 'tailwindcss'

// Design tokens per docs/platform/PLATFORM_DESIGN_SYSTEM.md (v1.0).
// Business-application theme: white background, light grey surfaces, black
// typography, orange for primary action / active state — never decoration.
// Semantic colours communicate state. No one-off colours in components.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        charcoal: '#1F1D1B', // primary — typography, dark elements
        'cg-orange': {
          DEFAULT: '#E8722A', // accent — primary action, active state
          hover: '#D4661F',
          soft: '#FDF1E7', // active-state wash
        },
        surface: {
          DEFAULT: '#FFFFFF', // card / content surface
          muted: '#F5F5F4', // light grey surface
          line: '#E7E5E4', // subtle borders
        },
        success: '#15803D',
        warning: '#B45309',
        danger: '#DC2626',
        info: '#2563EB',
      },
    },
  },
  plugins: [],
} satisfies Config
