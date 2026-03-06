import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  server: {
    port: 3210,
    proxy: {
      // Proxy root-level API (box list)
      "/api": {
        target: "http://localhost:3211",
        changeOrigin: true,
      },
      // Proxy per-box API requests: /<slug>/api/...
      "^/[^/]+/api/": {
        target: "http://localhost:3211",
        changeOrigin: true,
        ws: true,
      },
      // Proxy auth routes
      "^/[^/]+/auth/": {
        target: "http://localhost:3211",
        changeOrigin: true,
      },
    },
  },
});
