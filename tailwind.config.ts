import type { Config } from 'tailwindcss';

// Cores semânticas ligadas a variáveis CSS (definidas em src/index.css).
// Assim os componentes não precisam repetir variantes "dark:" em cada elemento.
const token = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        page: token('page'),
        surface: token('surface'),
        subtle: token('subtle'),
        line: token('line'),
        ink: token('ink'),
        mute: token('mute'),
        brand: token('brand'),
        'brand-strong': token('brand-strong'),
        'brand-soft': token('brand-soft'),
        'brand-ink': token('brand-ink'),
        danger: token('danger'),
        'danger-soft': token('danger-soft'),
        success: token('success'),
        'success-soft': token('success-soft'),
        warn: token('warn'),
        'warn-soft': token('warn-soft'),
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04)',
        pop: '0 8px 24px rgb(0 0 0 / 0.14)',
      },
    },
  },
  plugins: [],
} satisfies Config;
