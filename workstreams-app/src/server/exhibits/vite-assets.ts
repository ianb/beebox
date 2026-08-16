// Vite dev server in middleware mode for the exhibits origin.
//
// Mechanism proven by the Track B spike; the pitfalls it hit are encoded here:
//  - HMR shares the Fastify http.Server (server.hmr.server), so page, assets,
//    and the HMR socket are one origin and one port.
//  - server.fs.allow covers the store and the package, because page modules
//    live OUTSIDE the Vite root and are imported through /@fs.
//  - No import.meta.glob over the store: an absolute out-of-root glob compiles
//    to {} silently. Routing is a per-request readdir (store.ts) plus a runtime
//    import of /@fs/<abs>/index.tsx.
//  - optimizeDeps.include is mandatory under appType "custom": with no HTML
//    entry the dep scanner finds nothing, and the first store page would
//    trigger a full-reload re-optimization.
//  - Tailwind is configured inline rather than through a config file so the
//    out-of-repo content globs stay derived from the resolved roots.

import path from "node:path";
import type http from "node:http";

import viteReact from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss, { type Config } from "tailwindcss";
import typography from "@tailwindcss/typography";
import { createServer as createViteServer, type InlineConfig, type ViteDevServer } from "vite";

import type { ExhibitsAssets } from "./assets.js";

export interface ViteAssetsOptions {
  /** The Fastify http server, so HMR rides the same port. */
  server: http.Server;
  /** The exhibits container source (the Vite root). */
  frontendRoot: string;
  /** workstreams-app itself — shared components live outside the Vite root. */
  packageRoot: string;
  /** The monorepo, for hoisted node_modules. */
  repoRoot: string;
  /** Page trees whose classes Tailwind must scan: the store and dev/apps. */
  contentRoots: string[];
}

/**
 * The Tailwind config this origin compiles with. Exported so a test can hold it
 * to the classes the container actually emits without booting a dev server.
 */
export function exhibitsTailwindConfig(options: ViteAssetsOptions): Config {
  return {
    content: [
      path.join(options.frontendRoot, "**/*.{ts,tsx}"),
      path.join(options.packageRoot, "src/frontend/components/**/*.tsx"),
      ...options.contentRoots.map((root) => path.join(root, "**/*.{tsx,jsx,js,html}")),
    ],
    corePlugins: { preflight: false },
    theme: { extend: {} },
    // Markdown.tsx renders doc.md as `prose prose-sm`; without the plugin those
    // classes generate nothing and every rendered document loses its typography
    // (and its <pre> scrolling). Same dependency the package's tailwind.config.js
    // uses for the workstreams origin.
    plugins: [typography],
  };
}

/** Long enough for an ordinary close, short enough not to stall a restart. */
const CLOSE_TIMEOUT_MS = 1_000;

/**
 * The dev-server config for this origin. Exported for the same reason as the
 * Tailwind config: the two settings that keep React single-copy are invisible
 * at runtime until a page throws "Invalid hook call".
 */
export function exhibitsViteConfig(options: ViteAssetsOptions): InlineConfig {
  return {
    configFile: false,
    root: options.frontendRoot,
    base: "/",
    appType: "custom",
    // Two Vite servers run in this package (the /workstreams/ one and this
    // one). They default to the same node_modules/.vite/deps, and because
    // their configs differ each invalidates the other's optimized deps on
    // start — which hands out a second copy of React and every page dies on
    // "Invalid hook call" until a cache happens to be warm. A private cacheDir
    // keeps them apart; dedupe keeps one React inside this one.
    cacheDir: path.join(options.packageRoot, "node_modules/.vite-exhibits"),
    plugins: [viteReact()],
    // Store pages live outside the repo, so the container's typed client is
    // reachable by name rather than by a relative path into the package.
    resolve: {
      alias: { "@exhibits/client": path.join(options.frontendRoot, "client.ts") },
      // Store pages are imported from outside the root through /@fs; dedupe
      // guarantees they and the container share one React instance.
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      include: ["react", "react-dom/client", "react/jsx-dev-runtime", "@markdoc/markdoc"],
    },
    css: { postcss: { plugins: [tailwindcss(exhibitsTailwindConfig(options)), autoprefixer()] } },
    server: {
      middlewareMode: true,
      hmr: { server: options.server },
      fs: {
        strict: true,
        allow: [options.frontendRoot, options.packageRoot, options.repoRoot, ...options.contentRoots],
      },
      // Vite only watches module-graph files today, so these are cheap
      // insurance: an instrument writing captures must never drive the dev loop.
      watch: { ignored: ["**/data/**", "**/captures/**", "**/events.jsonl"] },
    },
  };
}

export async function createViteAssets(options: ViteAssetsOptions): Promise<ExhibitsAssets> {
  const stylesheet = path.join(options.frontendRoot, "styles.css");
  const vite: ViteDevServer = await createViteServer(exhibitsViteConfig(options));

  const seen = new Set<string>();
  return {
    transformIndexHtml: (url, html) => vite.transformIndexHtml(url, html),
    preflightModule: async (absPath) => {
      await vite.transformRequest(`/@fs${absPath}`);
    },
    noticeExhibit: (dir) => {
      if (seen.has(dir)) return;
      seen.add(dir);
      for (const module of vite.moduleGraph.getModulesByFile(stylesheet) ?? []) {
        vite.moduleGraph.invalidateModule(module);
      }
    },
    handle: (exchange, next) => vite.middlewares(exchange.req, exchange.res, next),
    close: async () => {
      // Vite's close does not settle while a dependency optimization is in
      // flight (the optimizer reports a canceled build and the promise
      // hangs), which would turn every restart into a SIGKILL. Shutdown is
      // allowed to abandon it.
      const outcome = await Promise.race([
        vite.close().then(
          () => "closed" as const,
          (error: unknown) => {
            console.warn(`[exhibits] vite close failed: ${error instanceof Error ? error.message : String(error)}`);
            return "closed" as const;
          },
        ),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), CLOSE_TIMEOUT_MS).unref()),
      ]);
      if (outcome === "timeout") {
        console.warn(`[exhibits] vite did not close within ${String(CLOSE_TIMEOUT_MS)}ms; abandoning it`);
      }
    },
  };
}
