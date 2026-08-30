/**
 * Web Push connector — delivers `box/output/*.web-push.card` notifications to
 * the box's subscribed devices during `bbx finalize`.
 *
 * Mirrors the telegram output-card path (telegram-output-cards.ts): a pending
 * card is delivered and deleted on success (at least one device), or stamped
 * `failed` and left in place when nothing could be delivered — so a failed
 * push is a durable, inspectable artifact (resolves the silent-latch risk,
 * docs/plans/web-push-notifications.md codex #3). Endpoints reported gone
 * (404/410) are pruned inside sendPush.
 */

import { registerConnector, type Connector, type SyncResult } from "./index.js";
import { WebPushSchema, type WebPushFields } from "../schemas/web-push.js";
import { sendPush, VapidNotConfiguredError } from "../core/send-push.js";
import type { PushService } from "../services/push.js";
import { deliverPendingOutputCards } from "./output-cards.js";
import { errorMessage } from "../lib/error-guards.js";

const CARD_SUFFIX = ".web-push.card";

class PushConnector implements Connector {
  name = "push";
  produces: string[] = [];
  inboxPaths: string[] = [];
  triggeredBy?: string;

  private boxRoot: string;
  private push: PushService | undefined;

  constructor(boxRoot: string, push?: PushService) {
    this.boxRoot = boxRoot;
    this.push = push;
  }

  async sync(): Promise<SyncResult> {
    const sent = await sendOutputPushCards({
      boxRoot: this.boxRoot,
      triggeredBy: this.triggeredBy,
      push: this.push,
    });
    return { success: true, created: [], updated: [], pushed: sent };
  }
}

/**
 * Deliver all pending web-push cards in box/output/. Returns the relative
 * paths of cards that were delivered (and deleted). One card's failure doesn't
 * stop the rest.
 */
export async function sendOutputPushCards(ctx: {
  boxRoot: string;
  triggeredBy: string | undefined;
  push: PushService | undefined;
}): Promise<string[]> {
  const { boxRoot, triggeredBy, push } = ctx;
  return deliverPendingOutputCards<WebPushFields>({
    boxRoot,
    triggeredBy,
    cardSuffix: CARD_SUFFIX,
    schema: WebPushSchema,
    failureVerb: "deliver",
    outboxLabel: "Web push outbox",
    pushedBy: "push-connector",
    describeSent: (count) => `deliver ${count} push${count === 1 ? "" : "es"}`,
    send: async (fields) => {
      try {
        const result = await sendPush(boxRoot, {
          payload: { title: fields.title, body: fields.body, url: fields.url, tag: fields.tag },
          push,
        });
        if (result.sent === 0) {
          return `no devices received the push (sent 0, pruned ${result.pruned}, failed ${result.failed})`;
        }
        return null;
      } catch (sendErr) {
        return sendErr instanceof VapidNotConfiguredError ? sendErr.message : errorMessage(sendErr);
      }
    },
  });
}

export function createPushConnector(boxRoot: string, push?: PushService): Connector {
  const connector = new PushConnector(boxRoot, push);
  registerConnector(connector);
  return connector;
}
