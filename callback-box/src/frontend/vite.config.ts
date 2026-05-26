import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 3210;
const BACKEND_PORT = Number(process.env.BACKEND_PORT) || 3211;

// When this Vite instance is fronted by the monorepo dev router, it gets
// asked to serve at a path prefix like "/main/" or "/foo/". The router
// itself does NO path rewriting — Vite serves at the prefix natively via
// the `base` option, so all built-in URL handling (assets, HMR, proxies)
// stays consistent. When run standalone (no VITE_BASE), base="/" and we
// behave like the original config.
const VITE_BASE = process.env.VITE_BASE || "/";
const BASE_PREFIX = VITE_BASE.replace(/\/$/, ""); // "" when base is "/", "/main" otherwise

// Build proxy patterns relative to BASE_PREFIX so /main/<box>/api/... is
// rewritten to /<box>/api/... before reaching the backend. Backend routes
// are defined as /<box>/api/..., they don't know about the worktree prefix.
const backendTarget = `http://localhost:${BACKEND_PORT}`;
const stripBase = (incoming: string) =>
  BASE_PREFIX ? incoming.replace(new RegExp(`^${BASE_PREFIX}`), "") : incoming;

// HMR connects DIRECTLY to this Vite's port — bypassing the router so the
// router never has to deal with WebSocket upgrades. The browser learns the
// real internal port from this setting.
const hmrConfig = {
  clientPort: FRONTEND_PORT,
};

// https://vitejs.dev/config/
export default defineConfig({
  base: VITE_BASE,
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: FRONTEND_PORT,
    // Bind IPv4 explicitly so the dev router (which targets 127.0.0.1) can
    // reach us. Vite's default localhost-resolution sometimes lands on ::1
    // only, which the router doesn't follow.
    host: "127.0.0.1",
    hmr: hmrConfig,
    proxy: {
      // Root-level API (box list).
      [`^${BASE_PREFIX}/api`]: {
        target: backendTarget,
        changeOrigin: true,
        rewrite: stripBase,
      },
      // Per-box API: /<base>/<box>/api/...
      [`^${BASE_PREFIX}/[^/]+/api/`]: {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
        rewrite: stripBase,
      },
      // Per-box auth: /<base>/<box>/auth/...
      [`^${BASE_PREFIX}/[^/]+/auth/`]: {
        target: backendTarget,
        changeOrigin: true,
        rewrite: stripBase,
      },
    },
  },
});
