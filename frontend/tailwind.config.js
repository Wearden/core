/** @type {import('tailwindcss').Config} */
// Colours come from CSS variables in src/index.css (black theme by default, white theme via data-theme="light").
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        slate: {50: 'rgb(var(--slate-50) / <alpha-value>)', 100: 'rgb(var(--slate-100) / <alpha-value>)', 200: 'rgb(var(--slate-200) / <alpha-value>)', 300: 'rgb(var(--slate-300) / <alpha-value>)', 400: 'rgb(var(--slate-400) / <alpha-value>)', 500: 'rgb(var(--slate-500) / <alpha-value>)', 600: 'rgb(var(--slate-600) / <alpha-value>)', 700: 'rgb(var(--slate-700) / <alpha-value>)', 800: 'rgb(var(--slate-800) / <alpha-value>)', 900: 'rgb(var(--slate-900) / <alpha-value>)', 950: 'rgb(var(--slate-950) / <alpha-value>)'},
        cyan: {50: 'rgb(var(--cyan-50) / <alpha-value>)', 100: 'rgb(var(--cyan-100) / <alpha-value>)', 200: 'rgb(var(--cyan-200) / <alpha-value>)', 300: 'rgb(var(--cyan-300) / <alpha-value>)', 400: 'rgb(var(--cyan-400) / <alpha-value>)', 500: 'rgb(var(--cyan-500) / <alpha-value>)', 600: 'rgb(var(--cyan-600) / <alpha-value>)', 700: 'rgb(var(--cyan-700) / <alpha-value>)', 800: 'rgb(var(--cyan-800) / <alpha-value>)', 900: 'rgb(var(--cyan-900) / <alpha-value>)', 950: 'rgb(var(--cyan-950) / <alpha-value>)'},
        red: {50: 'rgb(var(--red-50) / <alpha-value>)', 100: 'rgb(var(--red-100) / <alpha-value>)', 200: 'rgb(var(--red-200) / <alpha-value>)', 300: 'rgb(var(--red-300) / <alpha-value>)', 400: 'rgb(var(--red-400) / <alpha-value>)', 500: 'rgb(var(--red-500) / <alpha-value>)', 600: 'rgb(var(--red-600) / <alpha-value>)', 700: 'rgb(var(--red-700) / <alpha-value>)', 800: 'rgb(var(--red-800) / <alpha-value>)', 900: 'rgb(var(--red-900) / <alpha-value>)', 950: 'rgb(var(--red-950) / <alpha-value>)'},
        amber: {50: 'rgb(var(--amber-50) / <alpha-value>)', 100: 'rgb(var(--amber-100) / <alpha-value>)', 200: 'rgb(var(--amber-200) / <alpha-value>)', 300: 'rgb(var(--amber-300) / <alpha-value>)', 400: 'rgb(var(--amber-400) / <alpha-value>)', 500: 'rgb(var(--amber-500) / <alpha-value>)', 600: 'rgb(var(--amber-600) / <alpha-value>)', 700: 'rgb(var(--amber-700) / <alpha-value>)', 800: 'rgb(var(--amber-800) / <alpha-value>)', 900: 'rgb(var(--amber-900) / <alpha-value>)', 950: 'rgb(var(--amber-950) / <alpha-value>)'},
        emerald: {50: 'rgb(var(--emerald-50) / <alpha-value>)', 100: 'rgb(var(--emerald-100) / <alpha-value>)', 200: 'rgb(var(--emerald-200) / <alpha-value>)', 300: 'rgb(var(--emerald-300) / <alpha-value>)', 400: 'rgb(var(--emerald-400) / <alpha-value>)', 500: 'rgb(var(--emerald-500) / <alpha-value>)', 600: 'rgb(var(--emerald-600) / <alpha-value>)', 700: 'rgb(var(--emerald-700) / <alpha-value>)', 800: 'rgb(var(--emerald-800) / <alpha-value>)', 900: 'rgb(var(--emerald-900) / <alpha-value>)', 950: 'rgb(var(--emerald-950) / <alpha-value>)'},
        orange: {50: 'rgb(var(--orange-50) / <alpha-value>)', 100: 'rgb(var(--orange-100) / <alpha-value>)', 200: 'rgb(var(--orange-200) / <alpha-value>)', 300: 'rgb(var(--orange-300) / <alpha-value>)', 400: 'rgb(var(--orange-400) / <alpha-value>)', 500: 'rgb(var(--orange-500) / <alpha-value>)', 600: 'rgb(var(--orange-600) / <alpha-value>)', 700: 'rgb(var(--orange-700) / <alpha-value>)', 800: 'rgb(var(--orange-800) / <alpha-value>)', 900: 'rgb(var(--orange-900) / <alpha-value>)', 950: 'rgb(var(--orange-950) / <alpha-value>)'},
      },
    },
  },
  plugins: [],
};
