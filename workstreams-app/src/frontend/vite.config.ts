import { resolve } from "node:path";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";

const base = process.env.VITE_BASE ?? "/workstreams/";
const backendPort = Number(process.env.WORKSTREAMS_APP_PORT ?? 3220);
const routerCapability = process.env.WORKSTREAMS_APP_ROUTER_CAPABILITY;

export default defineConfig({
  root: resolve(import.meta.dirname),
  base,
  plugins: [viteReact()],
  build: {
    outDir: resolve(import.meta.dirname, "../../dist/frontend"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Keep the two document-rendering payloads out of the already-large
          // app bundle so routine builds remain warning-free. Separate chunks
          // because they answer to different views: every rendered document
          // needs the parser, and every source file needs the highlighter.
          if (id.includes("@markdoc/markdoc")) return "markdown";
          if (id.includes("highlight.js")) return "highlight";
          return null;
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WORKSTREAMS_APP_FRONTEND_PORT ?? 3221),
    strictPort: true,
    proxy: {
      "/workstreams/api": {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
        ...(routerCapability ? { headers: { "x-bbx-workstreams-capability": routerCapability } } : {}),
      },
    },
  },
});
