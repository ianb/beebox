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
import type { ChatBackend } from "../../src/services/claude-chat-types.js";
import { createEventBus, type EventBus } from "../../src/core/event-bus.js";
import type { Services } from "../../src/services/index.js";
import { makeBoxAnnexShaped } from "./annex-box.js";

export const TEST_SLUG = "test";

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
  /**
   * Serve without an auth wall. Defaults to `true` — most route doctests are
   * deliberately open (they exercise routes, not auth), which the in-process
   * `openAccess` construction option makes honest (it replaced the old
   * module-scope `CB_ALLOW_UNAUTHENTICATED` env opt-out). An auth-exercising
   * doctest passes `openAccess: false` to turn the wall on.
   */
  openAccess?: boolean | undefined;
  /**
   * Serve a box that has been converted to git-annex (assets visible to git,
   * annex holds the bytes). Defaults to `false` — the template box is on the
   * manifest scheme, like a box that has not run `cb attachments to-annex`.
   *
   * Routes that write asset bytes gate on this shape: the scan-upload routes
   * refuse with a 503 on a manifest-scheme box, so their doctests declare which
   * side they are testing rather than inheriting it.
   */
  annexBox?: boolean | undefined;
  /**
   * Chat backend for every session this server creates. Pass
   * `createFakeChatBackend()` to exercise the chat-send path (including a run
   * start that fails) without spawning a real Claude subprocess. Omit and the
   * server builds the real one — which no route doctest should provoke.
   */
  chatBackend?: ChatBackend | undefined;
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

// Same treatment for the scan-upload routes' registration refusal. Every
// makeTestServer() boots a manifest-scheme box unless it asks for
// `annexBox: true`, and the scan routes correctly log one line per boot saying
// they are disabled. Useful on a real box, pure noise across hundreds of route
// tests that never touch scan. Narrow on purpose — only this exact message.
const _origError = console.error;
console.error = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === "string" && first.startsWith("[scan] Box ") && first.includes("not annex-converted")) return;
  _origError(...args);
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

  // Before the server boots: registration-time probes read this shape, so
  // converting after `createServer` would be too late.
  if (opts?.annexBox === true) {
    await makeBoxAnnexShaped({ packageRoot: tmpDir, boxRoot });
  }

  // Build the box's event bus here and inject it so the test holds the SAME
  // instance the routes emit on (transient events never leave the process).
  const eventBus = createEventBus(boxRoot, { pollInterval: 1000 });

  // Create server pointing at this temp box. Open by default (see
  // TestServerOptions.openAccess); an auth-exercising doctest passes false.
  const server = await createServer({
    boxes: [{ slug: TEST_SLUG, boxRoot, eventBus }],
    services: opts?.services,
    openAccess: opts?.openAccess ?? true,
    ...(opts?.chatBackend !== undefined ? { chatBackend: opts.chatBackend } : {}),
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
