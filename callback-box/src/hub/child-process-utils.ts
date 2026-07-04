/**
 * Small process-supervision primitives shared by `src/hub/supervisor.ts`,
 * adapted from the monorepo dev router (`../../../bin/router.ts`'s
 * `waitForHttp`/`killGroup`/`sleep`) — see that file's module doc for the
 * original rationale. Kept here as plain functions (no router-specific
 * state) so the hub doesn't depend on the monorepo-only router script.
 */

import http from "node:http";

/**
 * HTTP-level readiness probe: TCP-accepting isn't enough, a process can
 * accept connections before its request handlers are wired up. Any HTTP
 * response (even a 401/503) counts as "ready" — the hub doesn't assume
 * `CB_DIAG_API_KEY` is configured, so a box's `/healthz` may legitimately
 * answer "unconfigured" or "unauthorized" while still being a live server.
 */
export interface WaitForHttpOptions {
  port: number;
  reqPath: string;
  timeoutMs: number;
  label: string;
}

export async function waitForHttp({ port, reqPath, timeoutMs, label }: WaitForHttpOptions): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: reqPath, method: "GET", timeout: 1000 },
        (res) => {
          res.resume();
          resolve(true);
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
    if (ok) return;
    await sleep(150);
  }
  throw new HttpReadinessTimeoutError({ label, reqPath, timeoutMs });
}

export class HttpReadinessTimeoutError extends Error {
  constructor({ label, reqPath, timeoutMs }: { label: string; reqPath: string; timeoutMs: number }) {
    super(`${label} did not respond to HTTP GET ${reqPath} within ${timeoutMs}ms`);
    this.name = "HttpReadinessTimeoutError";
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Signal a process group (falls back to the bare pid if it isn't a group leader). */
export function killGroup(pid: number | undefined, signal?: NodeJS.Signals): void {
  if (!pid) return;
  const sig = signal ?? "SIGTERM";
  try {
    process.kill(-pid, sig);
  } catch (_e) {
    try {
      process.kill(pid, sig);
    } catch (_e2) {
      /* already gone */
    }
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
