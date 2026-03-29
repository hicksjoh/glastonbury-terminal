import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        terminal: '#08080d',
        gold: '#c9a84c',
        'gold-dim': '#8a6f2e',
        secondary: '#1a1a24',
        'border-terminal': '#2a2a3a',
        'text-primary': '#e8e8e8',
        'text-muted': '#6b6b80',
        'green-terminal': '#22c55e',
        'red-terminal': '#ef4444',
      },
      fontFamily: {
        terminal: ['Inter', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
};

export default config;
