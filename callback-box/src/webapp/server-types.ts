/**
 * Shared types for the web app server and its sibling helper modules.
 * A leaf module (no value imports) so siblings can share these without
 * forming an import cycle with server.ts.
 */

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
   * production (`cb serve`); leave undefined in tests so test runs don't
   * spawn a real Claude subprocess that hangs the test runner.
   */
  prewarmChat?: boolean | undefined;
}

/**
 * The construction options `createServer` actually accepts — the public
 * `ServerOptions` plus the test-only `openAccess` seam. Deliberately NOT part
 * of the public `callback-box/server` export surface (exports/server.ts
 * re-exports only `ServerOptions`), so an embedder can't request an
 * unauthenticated server through the published types. `openAccess` serves the
 * box(es) WITHOUT an authentication wall (defaults to `false`); it replaced the
 * removed `CB_ALLOW_UNAUTHENTICATED` env opt-out, is decorated onto the fastify
 * instance, and is consulted per-instance by the auth resolver. No CLI path
 * sets it, and an `openAccess` server is non-listenable (see
 * `assertOpenAccessNotListening` in server.ts) — it exists only to let
 * `.inject()`-based tests exercise routes with the wall down.
 */
export interface InternalServerOptions extends ServerOptions {
  openAccess?: boolean | undefined;
}

export interface ServerContext {
  boxRoot: string;
  server: FastifyInstance;
}
