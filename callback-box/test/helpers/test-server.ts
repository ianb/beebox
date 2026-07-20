/**
 * Shared test helper for API route tests.
 *
 * Creates a temporary box with git initialized, boots a Fastify server
 * via createServer(), and returns { server, boxRoot, cleanup }.
 *
 * Usage:
 *   const ctx = await createTestServer();
 *   try {
 *     const res = await ctx.server.inject({ method: "GET", url: "/test/api/status" });
 *     t.equal(res.statusCode, 200);
 *   } finally {
 *     await ctx.cleanup();
 *   }
 */

import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import type { FastifyInstance } from "fastify";
import { scaffoldV2Box } from "../../src/core/box/package.js";
import { createServer } from "../../src/webapp/server.js";
import { createEventBus, type EventBus } from "../../src/core/event-bus.js";
import type { Services } from "../../src/services/index.js";

export const TEST_SLUG = "test";

// Auth is always-on by default now, so a test server is only reachable if it
// opts out — which is honest: these servers ARE deliberately open. Set the
// opt-out at MODULE scope (not per createTestServer call) so a doctest that
// exercises auth itself can `delete process.env.CB_ALLOW_UNAUTHENTICATED` in
// its own setup block and have that stick — createTestServer never re-sets it,
// exactly as tests used to toggle GOOGLE_OAUTH_CLIENT_ID. Loopback-only ("1")
// is enough: injected servers never bind a socket, and any that do bind
// loopback.
process.env.CB_ALLOW_UNAUTHENTICATED ??= "1";

export interface TestServerContext {
  server: FastifyInstance;
  boxRoot: string;
  /**
   * The box's event bus — the SAME instance the routes emit on, so a test can
   * subscribe and read transient events (e.g. the server-minted screenshot
   * request id) that never leave the process otherwise.
   */
  eventBus: EventBus;
  cleanup: () => Promise<void>;
}

export interface TestServerOptions {
  services?: Services;
}

// Filter chat-history backfill noise: every makeTestServer() boots a fresh
// box, which triggers the one-time "Scanning JSONLs / Done — added N
// session(s)" log pair from chat-session-history.ts. Production-useful but
// pure noise across hundreds of route tests.
const _origLog = console.log;
console.log = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === "string" && first.startsWith("[chat-history:")) return;
  _origLog(...args);
};

// A fully-initialized box (directories + git repo + initial commit) is
// expensive to stamp out: `initBox` plus two `git` subprocess spawns. Route
// doctests boot a server many times per file, and those serialized git spawns
// are exactly what blocks long enough under heavy machine load to trip tap's
// per-file timeout. So build the box ONCE per test process and clone it per
// boot with `fs.cp` (pure libuv, no fork) — each file pays the git cost once
// instead of N times. The clone is a real, independent repo: a freshly-init'd
// git tree is relocatable, and the box marker / migration manifest hold only
// timestamps, no absolute paths.
let templatePromise: Promise<string> | null = null;
let templateDir: string | null = null;
function getTemplateBox(): Promise<string> {
  if (templatePromise === null) {
    templatePromise = (async () => {
      // Build a real v2 box: package half at `dir`, operational box at
      // `dir/content`. Git lives at the package root (`dir`). `deps` symlinks
      // `node_modules/callback-box` so box-local schema/view resolution works
      // in route tests that need it. `getTemplateBox` returns the PACKAGE
      // root; `createTestServer` points the server at `<clone>/content`.
      const dir = await mkdtemp(join(tmpdir(), "cb-route-tmpl-"));
      await scaffoldV2Box(dir, { deps: true });
      // A real box resolves react/react-dom from its OWN node_modules (view
      // metadata import + node-target render). `scaffoldV2Box({deps})` only
      // symlinks callback-box, so simulate the box's react dependency by
      // symlinking the engine's copy beside it — the same trick `cb view test`
      // and the view doctests use. Without this, view-metadata import fails to
      // resolve react and returns empty dependencies (a view matches no cards).
      const reactNodeModules = dirname(dirname(createRequire(import.meta.url).resolve("react/package.json")));
      for (const mod of ["react", "react-dom"]) {
        await symlink(join(reactNodeModules, mod), join(dir, "node_modules", mod), "dir");
      }
      execSync("git init -q && git add -A && git commit --allow-empty -m init -q", {
        cwd: dir,
        stdio: "pipe",
      });
      templateDir = dir;
      return dir;
    })();
  }
  return templatePromise;
}

// The template outlives every server it seeds, so tear it down on process exit
// rather than per-test. Sync removal — async has no chance to run in an exit
// handler.
process.on("exit", () => {
  if (templateDir !== null) {
    try {
      rmSync(templateDir, { recursive: true, force: true });
    } catch (_e) {
      // best-effort; the OS reaps the temp dir anyway
    }
  }
});

export async function createTestServer(opts?: TestServerOptions): Promise<TestServerContext> {
  const template = await getTemplateBox();
  const tmpDir = await mkdtemp(join(tmpdir(), "cb-route-test-"));

  // Clone the prebuilt v2 package (package files + content/ + git repo) into
  // the fresh dir — no per-boot git subprocess. See getTemplateBox above. The
  // operational box root is `content/` inside the clone.
  await cp(template, tmpDir, { recursive: true });
  const boxRoot = join(tmpDir, "content");

  // Build the box's event bus here and inject it so the test holds the SAME
  // instance the routes emit on (transient events never leave the process).
  const eventBus = createEventBus(boxRoot, { pollInterval: 1000 });

  // Create server pointing at this temp box
  const server = await createServer({
    boxes: [{ slug: TEST_SLUG, boxRoot, eventBus }],
    services: opts?.services,
  });

  return {
    server,
    boxRoot,
    eventBus,
    cleanup: async () => {
      await server.close();
      eventBus.close();
      // maxRetries handles benign ENOTEMPTY races on macOS when background
      // writes (chat-history backfill, scheduler tick) finish just as we walk.
      // Remove the whole package clone (tmpDir), not just content/.
      await rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}

/**
 * Write a card file into the test box at the given relative path.
 * Creates parent directories as needed.
 */
export async function seedCard(opts: { boxRoot: string; relativePath: string; content: string }): Promise<void> {
  const fullPath = join(opts.boxRoot, opts.relativePath);

  await mkdir(dirname(fullPath), { recursive: true });

  await writeFile(fullPath, opts.content);
}

/**
 * Stage all and commit in the test box.
 */
export async function commitAll(boxRoot: string, message: string): Promise<void> {
  execSync("git add -A && git commit --allow-empty -m " + JSON.stringify(message), {
    cwd: boxRoot,
    stdio: "pipe",
  });
}
