import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy API requests to the backend during development
      "/api": {
        target: "http://localhost:3210",
        changeOrigin: true,
      },
    },
  },
});
