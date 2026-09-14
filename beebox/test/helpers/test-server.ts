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
import { scaffoldBoxRoot } from "../../src/core/box/package.js";
import { createServer } from "../../src/webapp/server.js";
import type { ChatBackend } from "../../src/services/claude-chat-types.js";
import { createEventBus, type EventBus } from "../../src/core/event-bus.js";
import type { Services } from "../../src/services/index.js";
import { annexNewBox } from "../../src/core/annex/annex-new-box.js";
import { createGitAnnexService } from "../../src/services/git-annex.js";
import { getOrCreateAgentToken } from "../../src/core/agent/token.js";
import { signSession, type SessionUser } from "../../src/webapp/auth.js";
import { hideAssetsAgain } from "./legacy-ignore-block.js";

export const TEST_SLUG = "test";

/**
 * The stand-in for a built frontend that test servers are pointed at.
 *
 * The real one (`src/frontend/dist`) is a gitignored build artifact, so a
 * server built against it serves the SPA fallback — and therefore documents,
 * and therefore the login redirect that only exists alongside them — only in
 * checkouts that happen to have run `build:frontend`. Tests construct the
 * built-frontend shape explicitly instead. Also passed by hand to tests that
 * register `registerSpaFallback` themselves.
 */
export const TEST_FRONTEND_PATH = join(import.meta.dirname, "../fixtures/frontend-dist");

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
  /** Explicitly enable the local-only external-file and mock-TTS facilities. */
  devSurfaces?: boolean | undefined;
  /**
   * Serve without an auth wall. Defaults to `true` — most route doctests are
   * deliberately open (they exercise routes, not auth), which the in-process
   * `openAccess` construction option makes honest (it replaced the old
   * module-scope `BBX_ALLOW_UNAUTHENTICATED` env opt-out). An auth-exercising
   * doctest passes `openAccess: false` to turn the wall on.
   */
  openAccess?: boolean | undefined;
  /**
   * Hand-edit the box `.gitignore` back to hiding its assets, BEFORE the server
   * boots — the scan routes probe the box's shape at registration.
   *
   * Nothing produces this state any more; a box is annex-shaped from creation.
   * It is built deliberately here because the guards that answer it — the scan
   * routes' retryable 503 above all — still have to be tested, and a guard
   * whose condition no test can reach is a guard nobody knows works.
   */
  assetsHiddenAgain?: boolean | undefined;
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
      // Build a real v3 box (one root: package half + operational half both
      // at `dir`). `deps` symlinks `node_modules/beebox` so box-local
      // schema/view resolution works in route tests that need it.
      // `getTemplateBox` returns that root; `createTestServer` points the
      // server at the clone directly.
      const dir = await mkdtemp(join(tmpdir(), "bbx-route-tmpl-"));
      await scaffoldBoxRoot(dir, { deps: true });
      // A real box resolves react/react-dom from its OWN node_modules (view
      // metadata import + node-target render). `scaffoldBoxRoot({deps})` only
      // symlinks beebox, so simulate the box's react dependency by
      // symlinking the engine's copy beside it — the same trick `bbx view test`
      // and the view doctests use. Without this, view-metadata import fails to
      // resolve react and returns empty dependencies (a view matches no cards).
      const reactNodeModules = dirname(dirname(createRequire(import.meta.url).resolve("react/package.json")));
      for (const mod of ["react", "react-dom"]) {
        await symlink(join(reactNodeModules, mod), join(dir, "node_modules", mod), "dir");
      }
      // Annex between `git init` and the initial commit, as real `bbx init`
      // does. Every clone of this template inherits the shape, because there is
      // no other box shape.
      execSync("git init -q -b main", { cwd: dir, stdio: "pipe" });
      await annexNewBox(createGitAnnexService(), dir);
      execSync("git add -A && git commit --allow-empty -m init -q", { cwd: dir, stdio: "pipe" });
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
      // Same read-only annex objects as rmBoxDir, in the sync exit handler.
      try {
        execSync(`chmod -R u+w ${JSON.stringify(templateDir)}`, { stdio: "pipe" });
      } catch (_e) {
        /* best-effort: the rmSync below is what matters */
      }
      rmSync(templateDir, { recursive: true, force: true });
    } catch (_e) {
      // best-effort; the OS reaps the temp dir anyway
    }
  }
});

/**
 * Clone the shared template box (package files + `content/` + git repo) into
 * a fresh temp directory, optionally converting it to git-annex shape. The
 * one place both `createTestServer` (one box) and `createTwoBoxTestServer`
 * (two independent boxes on one server) get their box(es) from, so the clone
 * + annex-conversion steps live in exactly one place.
 */
/**
 * Remove a temp box directory.
 *
 * git-annex marks object files and their parent directories read-only so
 * content cannot be modified in place, which makes `rm` fail with EACCES on
 * any box that annexed something. Restore write permission first.
 */
async function rmBoxDir(dir: string): Promise<void> {
  try {
    execSync(`chmod -R u+w ${JSON.stringify(dir)}`, { stdio: "pipe" });
  } catch (_e) {
    /* best-effort: the rm below reports anything that actually matters */
  }
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

async function cloneTemplateBox(): Promise<{ tmpDir: string; boxRoot: string }> {
  const template = await getTemplateBox();
  const tmpDir = await mkdtemp(join(tmpdir(), "bbx-route-test-"));

  // Clone the prebuilt v3 box (package files + operational areas + git repo)
  // into the fresh dir — no per-boot git subprocess. See getTemplateBox
  // above. The clone IS the box root — one root, no nesting.
  await cp(template, tmpDir, { recursive: true });
  const boxRoot = tmpDir;

  return { tmpDir, boxRoot };
}

export async function createTestServer(opts?: TestServerOptions): Promise<TestServerContext> {
  const { tmpDir, boxRoot } = await cloneTemplateBox();
  if (opts?.assetsHiddenAgain === true) await hideAssetsAgain(boxRoot);

  // Build the box's event bus here and inject it so the test holds the SAME
  // instance the routes emit on (transient events never leave the process).
  const eventBus = createEventBus(boxRoot, { pollInterval: 1000 });

  // Create server pointing at this temp box. Open by default (see
  // TestServerOptions.openAccess); an auth-exercising doctest passes false.
  const server = await createServer({
    boxes: [{ slug: TEST_SLUG, boxRoot, eventBus }],
    services: opts?.services,
    openAccess: opts?.openAccess ?? true,
    devSurfaces: opts?.devSurfaces === true,
    frontendPath: TEST_FRONTEND_PATH,
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
      await rmBoxDir(tmpDir);
    },
  };
}

/**
 * One box's handle within a `createTwoBoxTestServer` fixture: the same
 * `{ slug, boxRoot, eventBus }` shape route doctests already know, plus
 * small credential-minting helpers so a cross-box auth test doesn't have to
 * re-derive them. Named generally (not "leak"/"probe") because this fixture
 * is meant to carry more than one kind of cross-box test.
 */
export interface TwoBoxFixtureBox {
  slug: string;
  boxRoot: string;
  eventBus: EventBus;
  /**
   * This box's per-box agent loopback token (`.beebox/agent-token`), as a
   * ready-to-send `Authorization` header value. Minted (and persisted) on
   * first call via `getOrCreateAgentToken` — see `src/core/agent/token.ts`.
   * The per-box auth wall (`server-box-scope.ts`) accepts this bearer as
   * box-scoped authentication for THIS box only, so box B's handle never
   * satisfies box A's wall.
   */
  agentBearerHeader(): string;
  /**
   * A signed `bbx_session` cookie VALUE (not the `name=value` pair) for the
   * given identity, via `signSession` (`src/webapp/auth.ts`). Session
   * identity is not box-scoped — `canAccessBox` decides per box from the
   * server's single `BBX_OWNER_EMAIL`/local-user store plus each box's own
   * `allowedEmails` — so a caller that needs a cookie to actually clear a
   * box's wall must also set up that box's access config; this only signs
   * the cookie.
   */
  sessionCookie(user?: SessionUser): string;
}

export interface TwoBoxTestServerOptions {
  services?: Services;
  devSurfaces?: boolean | undefined;
  /**
   * Serve behind the real auth wall. Defaults to `false` (unlike
   * `createTestServer`, which defaults open) — this fixture exists to
   * exercise cross-box auth, so real auth is the useful default; pass
   * `true` to boot it open instead.
   */
  openAccess?: boolean | undefined;
  chatBackend?: ChatBackend | undefined;
}

export interface TwoBoxTestServerContext {
  server: FastifyInstance;
  a: TwoBoxFixtureBox;
  b: TwoBoxFixtureBox;
  cleanup: () => Promise<void>;
}

const TWO_BOX_SLUG_A = "alpha";
const TWO_BOX_SLUG_B = "beta";

/**
 * Boot ONE server serving TWO independent boxes — each its own template
 * clone (own git repo, own `.beebox/agent-token`), each its own event bus —
 * for tests that need to prove one box's credentials/data can't reach the
 * other's scope. Reuses `cloneTemplateBox`, the same clone logic
 * `createTestServer` uses, so the two fixtures can't drift.
 */
export async function createTwoBoxTestServer(opts?: TwoBoxTestServerOptions): Promise<TwoBoxTestServerContext> {
  const [cloneA, cloneB] = await Promise.all([cloneTemplateBox(), cloneTemplateBox()]);
  const eventBusA = createEventBus(cloneA.boxRoot, { pollInterval: 1000 });
  const eventBusB = createEventBus(cloneB.boxRoot, { pollInterval: 1000 });

  const server = await createServer({
    boxes: [
      { slug: TWO_BOX_SLUG_A, boxRoot: cloneA.boxRoot, eventBus: eventBusA },
      { slug: TWO_BOX_SLUG_B, boxRoot: cloneB.boxRoot, eventBus: eventBusB },
    ],
    services: opts?.services,
    openAccess: opts?.openAccess ?? false,
    devSurfaces: opts?.devSurfaces === true,
    frontendPath: TEST_FRONTEND_PATH,
    ...(opts?.chatBackend !== undefined ? { chatBackend: opts.chatBackend } : {}),
  });

  function makeFixtureBox({
    slug,
    boxRoot,
    eventBus,
  }: {
    slug: string;
    boxRoot: string;
    eventBus: EventBus;
  }): TwoBoxFixtureBox {
    return {
      slug,
      boxRoot,
      eventBus,
      agentBearerHeader: () => `Bearer ${getOrCreateAgentToken(boxRoot)}`,
      sessionCookie: (user?: SessionUser) =>
        signSession(user ?? { email: `${slug}-owner@example.com`, name: `${slug} owner` }),
    };
  }

  return {
    server,
    a: makeFixtureBox({ slug: TWO_BOX_SLUG_A, boxRoot: cloneA.boxRoot, eventBus: eventBusA }),
    b: makeFixtureBox({ slug: TWO_BOX_SLUG_B, boxRoot: cloneB.boxRoot, eventBus: eventBusB }),
    cleanup: async () => {
      await server.close();
      eventBusA.close();
      eventBusB.close();
      await Promise.all([
        rmBoxDir(cloneA.tmpDir),
        rmBoxDir(cloneB.tmpDir),
      ]);
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
