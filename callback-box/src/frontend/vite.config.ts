import { resolve as resolvePath } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { buildCspPolicy, reportingEndpointsHeader } from "../lib/csp.js";

const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 3210;
const BACKEND_PORT = Number(process.env.BACKEND_PORT) || 3211;

// When this Vite instance is fronted by the monorepo dev router, it gets
// asked to serve at a path prefix like "/main/" or "/foo/". The router
// itself does NO path rewriting — Vite serves at the prefix natively via
// the `base` option, so all built-in URL handling (assets, HMR, proxies)
// stays consistent. When run standalone (no VITE_BASE), base="/" and we
// behave like the original config.
// React Compiler — auto-memoizes components/hooks so we don't hand-roll
// useCallback/useMemo (see the cb-frontend skill, "Performance"). On for every Vite build
// (dev server + the production `vite build` client bundle); set REACT_COMPILER=0
// to opt out for debugging a suspected compiler issue. target:"18" pairs with
// the react-compiler-runtime dependency (React 19 ships the runtime; 18 needs
// the shim).
const REACT_COMPILER = process.env.REACT_COMPILER !== "0";

const VITE_BASE = process.env.VITE_BASE || "/";
const BASE_PREFIX = VITE_BASE.replace(/\/$/, ""); // "" when base is "/", "/main" otherwise

// Dev CSP (Report-Only). Vite serves the dev HTML, so the dev policy is set
// here rather than by Fastify. The report path must carry the base prefix so the
// router→Vite proxy (`^<base>/api`) forwards it to the backend's root-level
// /api/csp-report. The policy is built from the same shared module as prod, so
// the two can't drift; dev relaxes script/style for Vite's inline HMR bits.
const DEV_CSP_REPORT_PATH = `${BASE_PREFIX}/api/csp-report`;
const DEV_CSP_HEADERS = {
  "Content-Security-Policy-Report-Only": buildCspPolicy({ mode: "dev", reportPath: DEV_CSP_REPORT_PATH }),
  "Reporting-Endpoints": reportingEndpointsHeader({ reportPath: DEV_CSP_REPORT_PATH }),
};

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
  plugins: [
    react(
      REACT_COMPILER
        ? { babel: { plugins: [["babel-plugin-react-compiler", { target: "18" }]] } }
        : undefined,
    ),
  ],
  resolve: {
    // Mirror ONLY the `@shared/*` path alias from tsconfig.json so Vite
    // resolves its value imports at runtime. The `@backend/*`, `@core/*`, and
    // `@schemas/*` aliases in tsconfig are deliberately NOT mirrored here:
    // the frontend imports only *types* from those backend trees. Leaving them
    // unaliased means an accidental value import through them fails this client
    // build loudly ("Failed to resolve import @core/...") instead of silently
    // bundling backend source into the browser bundle. Do not add them here.
    // (Probed 2026-07-12: tsx pointed at src/frontend/tsconfig.json resolves a
    // value import through @core, so tsx is not the guard — the eslint rule is;
    // see the tsconfig paths comment.)
    alias: {
      "@shared": resolvePath(__dirname, "../shared"),
    },
  },
  optimizeDeps: {
    // @ianbicking/canvas-loop is a linked workspace package whose subpaths
    // serve raw TypeScript (NodeNext `.js` specifiers → `.ts` sources). Vite
    // serves linked source through its normal transform pipeline (verified
    // 2026-07-14, dev + build: resolves via /@fs/ with no pre-bundling and no
    // mid-session "new dependencies optimized" reload; `vite build` emits its
    // own chunk + extracted figure.css). Excluding it pins that source-serving
    // behavior explicitly so an optimizer change can't start pre-bundling it.
    exclude: ["@ianbicking/canvas-loop"],
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
    // Report-Only CSP on every dev response (incl. the HTML document), so dev
    // exercises the policy and surfaces external-origin mistakes early.
    headers: DEV_CSP_HEADERS,
    proxy: {
      // Root-level API (box list, admin, etc.). Must be listed before the
      // per-box rule so /<base>/api/* doesn't get caught by /<base>/<box>/api/*.
      [`^${BASE_PREFIX}/api`]: {
        target: backendTarget,
        changeOrigin: true,
        rewrite: stripBase,
      },
      // Root-level auth (/auth/login, /auth/setup, /auth/me, /auth/methods,
      // /auth/logout, /auth/callback, the POSTs). All of it proxies straight to
      // the backend: the login/setup pages are now self-contained server-rendered
      // HTML (base-aware via the x-cb-base-prefix header), so there's no SPA
      // navigation to divert to Vite — the earlier `bypass` is gone.
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
