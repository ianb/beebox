import { resolve as resolvePath } from "node:path";
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
  BASE_PREFIX && incoming.startsWith(BASE_PREFIX)
    ? incoming.slice(BASE_PREFIX.length)
    : incoming;

// HMR deliberately has NO host/port config: with nothing set, Vite's client
// connects its HMR WebSocket (and sends its reconnect pings) to the page's
// own origin — i.e. through the dev router, which proxies upgrades to this
// Vite. That makes stale tabs self-healing: the router restarts a shut-down
// worktree on the ping (an HTTP GET, sent only while the tab is visible),
// the ping then succeeds, and Vite's client reloads the page. Pinning
// `hmr.clientPort` to this Vite's internal port (the old setup) wedged tabs
// forever, because each restart picks a fresh random port.

// https://vitejs.dev/config/
export default defineConfig({
  base: VITE_BASE,
  plugins: [react()],
  resolve: {
    // Mirror the `@shared/*` path alias from tsconfig.json so Vite
    // resolves value imports at runtime. The matching `@backend/*` alias
    // in tsconfig is type-only (frontend only imports types from there);
    // a runtime alias is only needed for paths used as value imports.
    alias: {
      "@shared": resolvePath(__dirname, "../shared"),
      // @apache-annotator/dom (used for commentary text anchoring) pulls in
      // optimal-select via its unused CSS-selector path; that package's
      // `module` field points at a `src/` dir it doesn't actually publish, so
      // Vite fails to resolve it. Pin to its real entry. We never call into
      // it (only the TextQuoteSelector matcher is used), so this just lets the
      // import graph resolve.
      "optimal-select": resolvePath(__dirname, "../../../node_modules/optimal-select/lib/index.js"),
    },
  },
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
    proxy: {
      // Root-level API (box list, admin, etc.). Must be listed before the
      // per-box rule so /<base>/api/* doesn't get caught by /<base>/<box>/api/*.
      [`^${BASE_PREFIX}/api`]: {
        target: backendTarget,
        changeOrigin: true,
        rewrite: stripBase,
      },
      // Root-level auth (e.g. /auth/me, /auth/login, /auth/logout).
      [`^${BASE_PREFIX}/auth`]: {
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
