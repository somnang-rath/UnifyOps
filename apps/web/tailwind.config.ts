import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Accent (driven by [data-accent])
        accent: {
          DEFAULT: 'var(--a)',
          50:  'var(--a-50)',
          100: 'var(--a-100)',
          200: 'var(--a-200)',
          400: 'var(--a-400)',
          500: 'var(--a-500)',
          600: 'var(--a-600)',
          700: 'var(--a-700)',
        },
        // Static palette
        violet:  '#8b5cf6',
        indigo:  '#6366f1',
        blue:    '#3b82f6',
        cyan:    '#06b6d4',
        green:   '#10b981',
        amber:   '#f59e0b',
        red:     '#ef4444',
        pink:    '#ec4899',
        rose:    '#f43f5e',
        // Surfaces
        bg:           'var(--bg)',
        'bg-card':    'var(--bg-card)',
        'bg-input':   'var(--bg-input)',
        'bg-hover':   'var(--bg-hover)',
        'bg-subtle':  'var(--bg-subtle)',
        'bg-code':    'var(--bg-code)',
        text:         'var(--text)',
        'text-sub':   'var(--text-sub)',
        'text-muted': 'var(--text-muted)',
        border:        'var(--border)',
        'border-strong': 'var(--border-strong)',
      },
      backgroundImage: {
        grad:       'var(--grad)',
        'grad-soft':'var(--grad-soft)',
      },
      borderRadius: {
        xs:    '4px',
        sm:    '6px',
        DEFAULT:'10px',
        lg:    '14px',
        xl:    '20px',
        '2xl': '28px',
        full:  '9999px',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        a:  'var(--shadow-a)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', '"JetBrains Mono"', 'monospace'],
      },
      fontSize: { base: ['14px', '1.5'] },
      spacing: {
        sb:           '240px',
        'sb-collapsed':'68px',
        tb:           '60px',
        'tb-compact': '52px',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)',
        out:     'cubic-bezier(0.16, 1, 0.3, 1)',
        spring:  'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      transitionDuration: { DEFAULT: '200ms' },
      keyframes: {
        float: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%':     { transform: 'translate(40px,-30px) scale(1.05)' },
          '66%':     { transform: 'translate(-30px,40px) scale(.95)' },
        },
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        modalIn: {
          from: { opacity: '0', transform: 'scale(.94) translateY(10px)' },
          to:   { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        popoverIn: {
          from: { opacity: '0', transform: 'scale(.97) translateY(-6px)' },
          to:   { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        toastIn: {
          from: { opacity: '0', transform: 'translateX(30px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        float:    'float 18s ease-in-out infinite',
        'fade-in':'fadeIn 200ms cubic-bezier(0.4,0,0.2,1)',
        'slide-up':'slideUp 200ms cubic-bezier(0.4,0,0.2,1)',
        'modal-in':'modalIn 280ms cubic-bezier(0.16,1,0.3,1)',
        'popover-in':'popoverIn 220ms cubic-bezier(0.16,1,0.3,1)',
        'toast-in':'toastIn 300ms cubic-bezier(0.16,1,0.3,1)',
      },
    },
  },
  plugins: [],
};
export default config;
