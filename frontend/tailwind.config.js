/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Placeholder brand palette; the status colours are used for compliance states later.
        brand: { 500: "#22d3ee", 600: "#0891b2" },
      },
    },
  },
  plugins: [],
};
