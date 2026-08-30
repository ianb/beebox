/**
 * Shared types for the web app server and its sibling helper modules.
 * A leaf module (no value imports) so siblings can share these without
 * forming an import cycle with server.ts.
 */

import type { ChatBackend } from "../services/claude-chat-types.js";
import type { FastifyInstance } from "fastify";
import type { Services } from "../services/index.js";
import type { EventBus } from "../core/event-bus.js";

export interface BoxSpec {
  slug: string;
  boxRoot: string;
  /**
   * Pre-built event bus to use for this box. Production leaves this undefined
   * (the server creates one per box); tests inject a bus they also hold a
   * reference to, so they can subscribe to the SAME in-memory instance and
   * observe transient events (e.g. `screenshot-request`) the server emits.
   */
  eventBus?: EventBus | undefined;
}

export interface ServerOptions {
  port?: number | undefined;
  host?: string | undefined;
  boxes?: BoxSpec[] | undefined;
  /** @deprecated Use boxes instead */
  boxRoot?: string | undefined;
  /** External service implementations — pass fakes in tests */
  services?: Services | undefined;
  /**
   * Pre-warm a Claude subprocess for chat on box init. Set true in
   * production (`bbx serve`); leave undefined in tests so test runs don't
   * spawn a real Claude subprocess that hangs the test runner.
   */
  prewarmChat?: boolean | undefined;
}

/**
 * The construction options `createServer` actually accepts — the public
 * `ServerOptions` plus the test-only `openAccess` seam. Deliberately NOT part
 * of the public `beebox/server` export surface (exports/server.ts
 * re-exports only `ServerOptions`), so an embedder can't request an
 * unauthenticated server through the published types. `openAccess` serves the
 * box(es) WITHOUT an authentication wall (defaults to `false`); it replaced the
 * removed `BBX_ALLOW_UNAUTHENTICATED` env opt-out, is decorated onto the fastify
 * instance, and is consulted per-instance by the auth resolver. No CLI path
 * sets it, and an `openAccess` server is non-listenable (see
 * `assertOpenAccessNotListening` in server.ts) — it exists only to let
 * `.inject()`-based tests exercise routes with the wall down.
 */
export interface InternalServerOptions extends ServerOptions {
  openAccess?: boolean | undefined;
  /**
   * Enable local development-only HTTP facilities. Fail-closed: every
   * production caller omits this, and absence means the facilities are inert.
   */
  devSurfaces?: boolean | undefined;
  /**
   * Chat backend for every session this server creates. The same test-only
   * spirit as `openAccess`: no CLI path sets it, and production falls through
   * to `createChatBackend()`. It exists so a route test can exercise the
   * chat-send path — including a run start that fails — without spawning a real
   * Claude subprocess.
   */
  chatBackend?: ChatBackend | undefined;
  /**
   * Directory holding the built frontend (`index.html` and friends). Defaults
   * to `<package root>/src/frontend/dist`, which is what every production
   * caller wants and no caller passes.
   *
   * It exists for tests: that default is a gitignored build artifact, so
   * whether the server installs the SPA fallback and the static mounts at all
   * depended on whether the checkout happened to have run `build:frontend` —
   * a test asserting on a document response passed or 404'd by accident. A
   * test points this at `test/fixtures/frontend-dist` and gets the built-
   * frontend server shape deterministically.
   */
  frontendPath?: string | undefined;
}

export interface ServerContext {
  boxRoot: string;
  server: FastifyInstance;
}
