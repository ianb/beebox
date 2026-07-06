/**
 * Web Push connector — delivers `box/output/*.web-push.card` notifications to
 * the box's subscribed devices during `cb finalize`.
 *
 * Mirrors the telegram output-card path (telegram-output-cards.ts): a pending
 * card is delivered and deleted on success (at least one device), or stamped
 * `failed` and left in place when nothing could be delivered — so a failed
 * push is a durable, inspectable artifact (resolves the silent-latch risk,
 * docs/plans/web-push-notifications.md codex #3). Endpoints reported gone
 * (404/410) are pruned inside sendPush.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { registerConnector, type Connector, type SyncResult } from "./index.js";
import { cardFields, parseCardText, serializeCardText } from "../core/card-io.js";
import { createCardSchemaMap } from "../schemas/registry.js";
import { WebPushSchema } from "../schemas/web-push.js";
import { sendPush, VapidNotConfiguredError } from "../core/send-push.js";
import type { PushService } from "../services/push.js";
import { stageFiles, commit } from "../cli/lib/git.js";

const OUTPUT_DIR = "box/output";
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
  const outputDir = path.join(boxRoot, OUTPUT_DIR);
  let files: string[];
  try {
    files = (await fs.readdir(outputDir)).filter((f) => f.endsWith(CARD_SUFFIX));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read output directory ${outputDir}:`, e);
    }
    return [];
  }

  const sent: string[] = [];
  const failed: string[] = [];
  const schemas = await createCardSchemaMap(boxRoot);
  for (const file of files.toSorted()) {
    const relPath = path.join(OUTPUT_DIR, file);
    const absPath = path.join(outputDir, file);
    try {
      const content = await fs.readFile(absPath, "utf-8");
      const card = parseCardText(content, { source: relPath, schemas });
      const fields = cardFields(card, WebPushSchema);
      if (fields.status !== "pending") continue;

      let failure: string | null = null;
      try {
        const result = await sendPush(boxRoot, {
          payload: { title: fields.title, body: fields.body, url: fields.url, tag: fields.tag },
          push,
        });
        if (result.sent === 0) {
          failure = `no devices received the push (sent 0, pruned ${result.pruned}, failed ${result.failed})`;
        }
      } catch (sendErr) {
        failure = sendErr instanceof VapidNotConfiguredError
          ? sendErr.message
          : (sendErr as Error).message;
      }

      if (failure === null) {
        await fs.unlink(absPath);
        sent.push(relPath);
      } else {
        fields.status = "failed";
        fields.error = failure;
        await fs.writeFile(absPath, serializeCardText({ schema: card.schema, fields: { ...fields } }));
        failed.push(relPath);
        console.error(`Failed to deliver ${relPath}: ${failure}`);
      }
    } catch (err) {
      // Unreadable/unparseable card: leave it for `cb validate` to flag.
      console.error(`Skipping ${relPath}: ${(err as Error).message}`);
    }
  }

  const changed = [...sent, ...failed];
  if (changed.length > 0) {
    await stageFiles(boxRoot, changed);
    const summary = [
      ...(sent.length > 0 ? [`deliver ${sent.length} push${sent.length === 1 ? "" : "es"}`] : []),
      ...(failed.length > 0 ? [`${failed.length} failed`] : []),
    ].join(", ");
    await commit(boxRoot, {
      message: `Web push outbox: ${summary}`,
      trailers: {
        "Pushed-By": "push-connector",
        ...(triggeredBy ? { "Triggered-By": triggeredBy } : {}),
      },
    });
  }
  return sent;
}

export function createPushConnector(boxRoot: string, push?: PushService): Connector {
  const connector = new PushConnector(boxRoot, push);
  registerConnector(connector);
  return connector;
}
