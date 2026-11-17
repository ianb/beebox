/**
 * `build.watch`: the frontend build identity this server would serve
 * (`shared/frontend-build.ts`). It yields one frame when the subscription
 * starts and then stays open, so the client hears it on every WebSocket
 * connect and reconnect — after a deploy restarts the server, the reconnect
 * delivers the new identity. The client compares it with its own and reloads
 * or shows a banner (`frontend/src/lib/build-skew/`). Public: the identity is
 * a hash of public asset names.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { frontendBuildFromHtml } from "../../../shared/frontend-build.js";
import { router, publicProcedure } from "../procedures.js";

/**
 * The identity in `<frontendPath>/index.html`; null when there is no built
 * frontend or no identity in it. The box scope reads it once at registration
 * into `ctx.frontendBuild`: a deploy restarts the server, so a running process
 * never serves a newer `index.html` than the one it started with.
 */
export function readFrontendBuild(frontendPath: string): string | null {
  let html: string;
  try {
    html = fs.readFileSync(path.join(frontendPath, "index.html"), "utf-8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  return frontendBuildFromHtml(html);
}

export interface BuildFrame {
  /** The served frontend's identity, or null when this server has no built frontend. */
  frontend: string | null;
}

export const buildRouter = router({
  watch: publicProcedure.subscription(async function* (opts): AsyncGenerator<BuildFrame> {
    yield { frontend: opts.ctx.frontendBuild };
    const signal = opts.signal;
    if (signal === undefined || signal.aborted) return;
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }),
});
