/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Design tokens from Equilibrium / DESIGN.md (locked visual direction)
        bg: 'var(--c-bg)',
        surface: 'var(--c-surface)',
        raised: 'var(--c-raised)',
        lowest: 'var(--c-lowest)',
        line: 'var(--c-border)',
        ink: 'var(--c-text)',
        muted: 'var(--c-muted)',
        lime: {
          DEFAULT: '#B7F774',
          soft: '#8FE35D',
          fixed: '#D2FFAD',
          on: '#003824',
        },
        violet: { DEFAULT: '#9B8AFB', soft: '#b090ff', on: '#1a1140' },
        coral: { DEFAULT: '#FF9EAE', soft: '#ff7f95', on: '#3a0011' },
        success: 'var(--c-success)',
        warning: 'var(--c-warning)',
        danger: 'var(--c-danger)',
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '1rem',
        field: '0.5rem',
      },
      boxShadow: {
        card: '0 12px 32px -12px rgba(0,0,0,0.55)',
        lime: '0 0 24px -8px rgba(183,247,116,0.35)',
        violet: '0 0 24px -8px rgba(155,138,251,0.35)',
        coral: '0 0 24px -8px rgba(255,158,174,0.35)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 0.4s ease both',
        'scale-in': 'scale-in 0.2s cubic-bezier(0.22,1,0.36,1) both',
        'slide-in': 'slide-in 0.3s cubic-bezier(0.22,1,0.36,1) both',
      },
    },
  },
  plugins: [],
};
