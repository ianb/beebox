// The exhibits port, both halves of it: the buildless page the supervisor
// serves while no child owns that port, and the serialized hold that puts it
// there. Split out of workstreams-app-supervisor.ts as a pure move.

import http from "node:http";
import {
  errorMessage,
  type ExhibitsPortHold,
  type WorkstreamsAppEffects,
  type WorkstreamsAppState,
} from "./workstreams-app-contract.js";

/** A dying child's listening socket outlives the process by milliseconds, not seconds. */
const EXHIBITS_HOLD_ATTEMPTS = 4;

function escapeExhibitsHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

/**
 * The buildless page the supervisor serves on the exhibits port while no child
 * owns it. It depends on nothing in the app package, because the reason it is
 * showing is usually that the package would not start.
 */
export function renderExhibitsFallback(state: WorkstreamsAppState, logPath: string): string {
  const detail = state.phase === "failed"
    ? `<div class="err">${escapeExhibitsHtml(state.message)}</div>`
    : `<p>The exhibits surface is currently <strong>${escapeExhibitsHtml(state.phase)}</strong>.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Exhibits unavailable</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 52rem; margin: 3rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.35rem; }
  .err { margin: 1rem 0; padding: 0.8rem 1rem; background: #fff5f5; border-left: 4px solid #b43; white-space: pre-wrap; }
  code { background: #f3f3f3; padding: 0.1rem 0.3rem; }
</style>
</head>
<body>
<h1>Exhibits unavailable</h1>
${detail}
<p>Your exhibits are files in the store and are unaffected; only the app serving them is down.</p>
<p>App output is in <code>${escapeExhibitsHtml(logPath)}</code>. Reload once it reports a ready generation.</p>
</body>
</html>`;
}

export function holdExhibitsPort(options: { port: number; render: () => string }): Promise<ExhibitsPortHold> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(503, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(options.render());
    });
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      // A later listen error would otherwise be an unhandled 'error' event.
      server.on("error", () => {});
      resolve({
        release: () => new Promise<void>((released) => {
          server.closeAllConnections();
          server.close(() => released());
        }),
      });
    });
  });
}

export interface ExhibitsHoldManager {
  /**
   * Take the fallback port. `after` is the release of whatever still owns it —
   * a surviving child of a failed generation — because binding before that
   * lands is EADDRINUSE, and an EADDRINUSE here means the developer gets a
   * connection refusal on a direct exhibit URL with no child AND no fallback.
   * The retries cover the socket that outlives the process it belonged to.
   */
  acquire(after?: Promise<void>): Promise<void>;
  release(): Promise<void>;
}

export function createExhibitsHoldManager(options: {
  effects: WorkstreamsAppEffects;
  log: (message: string) => void;
  port: number;
  retryMs: number;
  render: () => string;
  isShuttingDown: () => boolean;
}): ExhibitsHoldManager {
  let hold: ExhibitsPortHold | null = null;
  // Acquire and release are serialized: a restart releases the hold to the new
  // child while the state change that took it may still be settling.
  let work: Promise<void> = Promise.resolve();

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      options.effects.setTimer(ms, resolve);
    });
  }

  return {
    acquire(after?: Promise<void>): Promise<void> {
      work = work.then(async () => {
        if (after) await after;
        for (let attempt = 1; attempt <= EXHIBITS_HOLD_ATTEMPTS; attempt++) {
          if (hold !== null || options.isShuttingDown()) return;
          try {
            hold = await options.effects.holdExhibitsPort({ port: options.port, render: options.render });
            return;
          } catch (error) {
            if (attempt === EXHIBITS_HOLD_ATTEMPTS) {
              options.log(`[workstreams-app] exhibits fallback could not bind ${String(options.port)}: ${errorMessage(error)}`);
              return;
            }
            await delay(options.retryMs);
          }
        }
      });
      return work;
    },
    release(): Promise<void> {
      work = work.then(async () => {
        const held = hold;
        hold = null;
        if (held === null) return;
        try {
          await held.release();
        } catch (error) {
          options.log(`[workstreams-app] exhibits fallback release failed: ${errorMessage(error)}`);
        }
      });
      return work;
    },
  };
}
