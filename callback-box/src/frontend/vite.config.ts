import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 3210;
const BACKEND_PORT = Number(process.env.BACKEND_PORT) || 3211;
const backendTarget = `http://localhost:${BACKEND_PORT}`;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: FRONTEND_PORT,
    proxy: {
      // Proxy root-level API (box list)
      "/api": {
        target: backendTarget,
        changeOrigin: true,
      },
      // Proxy per-box API requests: /<slug>/api/...
      "^/[^/]+/api/": {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
      },
      // Proxy auth routes
      "^/[^/]+/auth/": {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
});
