/**
 * Where `bbx notify` delivers from. A box-spawned shell (an agent, a tick's
 * script) holds `BBX_SERVER_URL`, `BBX_BOX_NAME`, and `BBX_AGENT_TOKEN` but
 * none of the APNs or VAPID keys (`core/script-env-allowlist.ts` keeps them
 * out on purpose), so there the command asks the box server, which has them,
 * through `notifications.send` and `notifications.channels`. With no box
 * environment (a test, an ad hoc run) it delivers in this process.
 *
 * A server that is named but does not answer is an error, not a reason to
 * deliver in process: that would quietly lose the channels whose keys only the
 * server holds.
 */

import type { TRPCClient } from "@trpc/client";
import { boxClient } from "../../lib/box-client.js";
import { refusalFor } from "../../lib/credentialed-verb.js";
import type { AppRouter } from "../../../webapp/trpc/router.js";

export type NotifyRoute =
  | { kind: "server"; client: TRPCClient<AppRouter> }
  | { kind: "local"; reason: string };

export function notifyRoute(): NotifyRoute {
  const client = boxClient();
  if (client.ok) return { kind: "server", client: client.value };
  return { kind: "local", reason: `${client.error.missing} is not set` };
}

/** The one `--verbose` line: which path delivered. Routine runs print nothing about it. */
export function describeRoute(route: NotifyRoute): string {
  return route.kind === "server"
    ? `[notify] via the box server (${process.env.BBX_SERVER_URL ?? ""})`
    : `[notify] in this process (${route.reason})`;
}

/** A server call that failed, as the message a person or agent can act on. */
class NotifyServerError extends Error {
  constructor(cause: unknown) {
    super(refusalFor(cause, { remote: true }).message, { cause });
    this.name = "NotifyServerError";
  }
}

/** Run one call against the box server, turning any failure into a {@link NotifyServerError}. */
export async function onServer<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    throw new NotifyServerError(e);
  }
}
