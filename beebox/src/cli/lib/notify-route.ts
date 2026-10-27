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
import { boxClient } from "./box-client.js";
import { refusalFor } from "./credentialed-verb.js";
import type { AppRouter } from "../../webapp/trpc/routers.js";
import {
  inProcessSender,
  notifyChannels,
  type ChannelFlags,
  type NotifySender,
  type NotifyServices,
} from "../../core/notify-boxholder.js";
import { formatTarget } from "../../core/notification/target.js";

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

/**
 * Which channels can reach the person, as the delivering process sees it: the
 * box server from a box-spawned shell, else this one. `bbx notify --check`
 * prints it; `bbx remind` refuses a reminder no channel would carry.
 */
export async function channelReach(boxRoot: string, opts: { route: NotifyRoute; services: NotifyServices | undefined }): Promise<ChannelFlags> {
  const { route, services } = opts;
  return route.kind === "server"
    ? (await onServer(() => route.client.notifications.channels.query())).reach
    : notifyChannels(boxRoot, { services });
}

/**
 * A sender for the sweeps `bbx finalize` runs (question nudges and alerts):
 * the box server when this process has the box environment, else this
 * process. As with `bbx notify`, a named server that does not answer throws;
 * the caller leaves its latch unset and tries again at the next finalize.
 */
export function routedSender(boxRoot: string, services?: NotifyServices): NotifySender {
  const route = notifyRoute();
  if (route.kind === "local") return inProcessSender(boxRoot, services);
  const { client } = route;
  return {
    send: ({ intent, channel }) => {
      const { title, body, loudness, source, tag } = intent;
      return onServer(() =>
        client.notifications.send.mutate({
          intent: { title, body, target: formatTarget(intent.target), loudness, source, ...(tag === undefined ? {} : { tag }) },
          channel,
        }),
      );
    },
    reach: async () => (await onServer(() => client.notifications.channels.query())).reach,
  };
}
