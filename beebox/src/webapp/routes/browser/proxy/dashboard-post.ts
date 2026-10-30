/**
 * The dashboard's own POST endpoints, checked before they reach it
 * (docs/plans/shared-browser.md, Track C).
 *
 * The person drives the box browser through the proxied dashboard, and the
 * dashboard can also start and stop other sessions: "New session" posts
 * `{ args: ["--session", <name>, "--provider" | "--engine", ...] }` to
 * `/api/exec`, `/api/sessions` opens `about:blank` in a named session, and
 * `/api/kill` kills a named session's daemon by its pid file
 * (agent-browser 0.39.2, `cli/src/native/stream/dashboard.rs`). The box has
 * one session, so each is held to it: exec arguments go through
 * `checkDashboardExecArgs`, and a session name must be `box`. `/api/chat`
 * runs its own model-written commands with `--session` and `--engine`
 * allowed; the fixed environment carries no gateway key so it is off
 * already, and it is refused here so a key added later does not open it.
 *
 * Upstream compares the whole request path, query included; here the query
 * is dropped first, which can only check more requests.
 */

import { z } from "zod";
import { checkDashboardExecArgs, ONE_SESSION_MESSAGE } from "../../../../core/browser/exec-args.js";
import { BOX_BROWSER_SESSION } from "../../../../core/browser/paths.js";

/** The largest body read from a checked POST; the dashboard's own are a few hundred bytes. */
export const DASHBOARD_POST_CAP_BYTES = 64 * 1024;

const CHECKED_PATHS: ReadonlySet<string> = new Set(["/api/exec", "/api/sessions", "/api/kill", "/api/chat"]);

const EXEC_POST = z.object({ args: z.array(z.string()) });
const SESSION_POST = z.object({ session: z.string() });

export type DashboardPostCheck = { readonly ok: true } | { readonly ok: false; readonly status: number; readonly error: string };

/** True when a request to the dashboard at `path` must have its body checked. */
export function isCheckedDashboardPost(request: { readonly method: string; readonly path: string }): boolean {
  return request.method === "POST" && CHECKED_PATHS.has(request.path.split("?")[0] ?? "");
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch (_e) {
    return undefined;
  }
}

/** Check the body of a POST for which `isCheckedDashboardPost` is true. */
export function checkDashboardPost(path: string, body: Buffer): DashboardPostCheck {
  const endpoint = path.split("?")[0];
  if (endpoint === "/api/chat") return { ok: false, status: 403, error: "the box browser's dashboard chat is not available" };
  const json = parseJson(body);
  if (endpoint === "/api/exec") {
    const exec = EXEC_POST.safeParse(json);
    if (!exec.success) return { ok: false, status: 400, error: "the request body must be { args: string[] }" };
    const check = checkDashboardExecArgs(exec.data.args);
    return check.ok ? { ok: true } : { ok: false, status: 403, error: check.message };
  }
  const session = SESSION_POST.safeParse(json);
  if (!session.success) return { ok: false, status: 400, error: "the request body must be { session: string }" };
  if (session.data.session !== BOX_BROWSER_SESSION) return { ok: false, status: 403, error: ONE_SESSION_MESSAGE };
  return { ok: true };
}
