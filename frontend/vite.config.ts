import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In production nginx serves everything on one origin. These proxies only matter for `npm run dev`.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/install-agent.sh": "http://localhost:8000",
      "/downloads": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
      "/guac": { target: "ws://localhost:8080", ws: true, rewrite: (p) => p.replace(/^\/guac/, "") },
    },
  },
});
