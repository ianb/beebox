/**
 * box/output/ telegram-message card delivery — the documented contract
 * in src/schemas/telegram-message.ts: agents (and the scheduler's
 * health alerter) drop a card with `status: pending`; the telegram
 * connector sends it during sync, deletes it on success, and stamps it
 * `failed` (with the error) on failure. Failed cards are left in place
 * for inspection and are not retried.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { cardFields, parseCardText, serializeCardText } from "../core/card-io.js";
import { createCardSchemaMap } from "../schemas/registry.js";
import { TelegramMessageSchema } from "../schemas/telegram-message.js";
import { stageFiles, commit } from "../cli/lib/git.js";
import type { TelegramService } from "../services/telegram.js";

const OUTPUT_DIR = "box/output";
const CARD_SUFFIX = ".telegram-message.card";

interface OutputCardsContext {
  boxRoot: string;
  triggeredBy: string | undefined;
  tg: TelegramService;
}

/**
 * Send all pending telegram-message cards in box/output/. Returns the
 * relative paths of cards that were sent (and deleted). One card's
 * failure doesn't stop the rest.
 */
export async function sendOutputCards(ctx: OutputCardsContext): Promise<string[]> {
  const { boxRoot, triggeredBy, tg } = ctx;
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
  for (const file of files.toSorted()) {
    const relPath = path.join(OUTPUT_DIR, file);
    const absPath = path.join(outputDir, file);
    try {
      const content = await fs.readFile(absPath, "utf-8");
      const card = parseCardText(content, { source: relPath, schemas: await createCardSchemaMap(boxRoot) });
      const fields = cardFields(card, TelegramMessageSchema);
      if (fields.status !== "pending") continue;
      try {
        await tg.sendMessage(fields["chat-id"], fields.text);
        await fs.unlink(absPath);
        sent.push(relPath);
      } catch (sendErr) {
        fields.status = "failed";
        fields.error = (sendErr as Error).message;
        await fs.writeFile(
          absPath,
          serializeCardText({ schema: card.schema, fields: { ...fields } }),
        );
        failed.push(relPath);
        console.error(`Failed to send ${relPath}: ${(sendErr as Error).message}`);
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
      ...(sent.length > 0 ? [`send ${sent.length} telegram message${sent.length === 1 ? "" : "s"}`] : []),
      ...(failed.length > 0 ? [`${failed.length} failed`] : []),
    ].join(", ");
    await commit(boxRoot, {
      message: `Telegram outbox: ${summary}`,
      trailers: {
        "Pushed-By": "telegram-connector",
        ...(triggeredBy ? { "Triggered-By": triggeredBy } : {}),
      },
    });
  }
  return sent;
}
