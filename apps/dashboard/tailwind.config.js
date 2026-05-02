/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0b0d10',
          subtle: '#11151a',
          card: '#151b22',
          hover: '#1c232c',
        },
        border: {
          DEFAULT: '#262d36',
          strong: '#3a4350',
        },
        text: {
          DEFAULT: '#e6edf3',
          muted: '#8b95a5',
          subtle: '#5a6470',
        },
        brand: {
          DEFAULT: '#3b82f6',
          fg: '#ffffff',
        },
        ok: '#22c55e',
        warn: '#f59e0b',
        danger: '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
