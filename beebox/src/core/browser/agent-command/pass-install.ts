/**
 * Keep a live box browser pass in the box browser (docs/plans/agent-self-view.md,
 * Track B). Before the engine sends the agent's command to the browser, it makes
 * sure the browser holds a pass for the box's app URL with at least
 * `REFRESH_BELOW_MS` left. The agent never handles the pass.
 *
 * The cookie is set through the host's command socket, not the agent's exec
 * route, so the refused-flag list does not apply and the agent cannot set it
 * itself. The engine logs no command arguments, so the value reaches no box log.
 */

import type { ExecReply } from "../command-socket.js";
import { appBasePath, resolveAppUrl } from "../app-url.js";
import { BROWSER_PASS_COOKIE, BROWSER_PASS_TTL_MS, signBrowserPass } from "../pass.js";

/** Refresh when less than this is left, so no command meets an expired pass. */
export const REFRESH_BELOW_MS = 30 * 60 * 1000;

/** Sends one agent-browser command through the host's command socket. */
export type BrowserSend = (args: readonly string[]) => Promise<ExecReply>;

/** Each running host's installed pass expiry, keyed by its handle: a new host installs anew. */
const installedExp = new WeakMap<object, number>();

/**
 * `installed` and `current` mean the browser holds a live pass. `no-app-url`:
 * the deployment names no address for its app, so box pages cannot be opened
 * (`bbx view look` reports it; ordinary commands stay quiet). `failed`: the
 * browser refused the cookie.
 */
export type PassInstall =
  | { status: "installed" | "current" }
  | { status: "no-app-url" | "failed"; reason: string };

/** The `cookies set` arguments for a pass at an app URL. Pure, for the test. */
export function passCookieArgs(base: URL, pass: { value: string; exp: number }): string[] {
  return [
    "cookies", "set", BROWSER_PASS_COOKIE, pass.value,
    "--url", `${base.origin}${appBasePath(base)}`,
    "--path", appBasePath(base),
    "--httpOnly",
    "--sameSite", "Strict",
    "--expires", String(Math.floor(pass.exp / 1000)),
    ...(base.protocol === "https:" ? ["--secure"] : []),
  ];
}

/**
 * Make sure the host's browser holds a pass with time left. Never throws for an
 * expected failure: a box with no app URL, or a browser that refused the cookie,
 * comes back with its reason for the caller to report.
 */
export async function ensureBrowserPass(input: {
  host: object;
  boxRoot: string;
  send: BrowserSend;
  env: NodeJS.ProcessEnv;
  now: number;
}): Promise<PassInstall> {
  const exp = installedExp.get(input.host);
  if (exp !== undefined && exp - input.now >= REFRESH_BELOW_MS) return { status: "current" };
  const app = resolveAppUrl(input.env);
  if (!app.ok) return { status: "no-app-url", reason: app.reason };
  const pass = signBrowserPass(input.boxRoot, { ttlMs: BROWSER_PASS_TTL_MS, now: input.now });
  const reply = await input.send(passCookieArgs(app.base, pass));
  if (reply.exitCode !== 0) {
    return { status: "failed", reason: `the browser refused the box's pass: ${reply.stderr.trim() || `exit code ${String(reply.exitCode)}`}` };
  }
  installedExp.set(input.host, pass.exp);
  return { status: "installed" };
}
