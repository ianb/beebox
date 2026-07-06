/**
 * Shared outbound-delivery loop for `box/output/*.card` cards: scan for
 * pending cards of one type, hand each to a caller-supplied `send` step, and
 * delete (on success) or stamp `failed` and leave in place (on failure) —
 * the lifecycle documented on telegram-message.ts and web-push.ts. One
 * card's failure never stops the rest.
 *
 * Extracted from telegram-output-cards.ts and push.ts (Track L item 7 of
 * docs/plans/architectural-review.md), which differed only in the send
 * step, the schema/suffix being scanned, and some wording.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { cardFields, parseCardText, serializeCardText } from "../core/card-io.js";
import type { CardSchema } from "../cards/index.js";
import { createCardSchemaMap } from "../schemas/registry.js";
import { stageFiles, commit } from "../cli/lib/git.js";

const OUTPUT_DIR = "box/output";

/** The minimal shape `deliverPendingOutputCards` needs to read and stamp a card. */
export interface DeliverableCardFields {
  status: string;
  error?: string | undefined;
}

export interface DeliverPendingOutputCardsOptions<TFields extends DeliverableCardFields> {
  boxRoot: string;
  triggeredBy: string | undefined;
  /** File suffix identifying this card type, e.g. `.telegram-message.card`. */
  cardSuffix: string;
  /** Schema to validate/parse matching cards against. */
  schema: CardSchema;
  /**
   * Attempt delivery for one pending card's fields. Return `null` on success
   * (the card is deleted), or a failure message on failure (the card is
   * stamped `status: failed` with that message as `error` and left in place).
   */
  send: (fields: TFields) => Promise<string | null>;
  /** Verb used in the per-failure log line: `Failed to ${failureVerb} ${path}: ...`. */
  failureVerb: string;
  /** Commit message prefix, e.g. `Telegram outbox` (combined as `${outboxLabel}: ${summary}`). */
  outboxLabel: string;
  /** `Pushed-By` commit trailer value, e.g. `telegram-connector`. */
  pushedBy: string;
  /** Renders the successful-delivery clause of the commit summary, e.g. `send 2 telegram messages`. */
  describeSent: (count: number) => string;
}

/**
 * Deliver all pending cards of one type in box/output/. Returns the relative
 * paths of cards that were delivered (and deleted).
 */
export async function deliverPendingOutputCards<TFields extends DeliverableCardFields>(
  options: DeliverPendingOutputCardsOptions<TFields>,
): Promise<string[]> {
  const { boxRoot, triggeredBy, cardSuffix, schema, send, failureVerb, outboxLabel, pushedBy, describeSent } =
    options;
  const outputDir = path.join(boxRoot, OUTPUT_DIR);
  let files: string[];
  try {
    files = (await fs.readdir(outputDir)).filter((f) => f.endsWith(cardSuffix));
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
      // Sound: the generic delivery loop can only promise the caller-declared
      // TFields shape, not the schema's own precise fields type — the single
      // centralized cast here replaces one per call site (cardFields already
      // validated `card.fields` against `schema` at runtime).
      const fields = cardFields(card, schema) as unknown as TFields;
      if (fields.status !== "pending") continue;

      const failure = await send(fields);
      if (failure === null) {
        await fs.unlink(absPath);
        sent.push(relPath);
      } else {
        fields.status = "failed";
        fields.error = failure;
        await fs.writeFile(
          absPath,
          serializeCardText({ schema: card.schema, fields: { ...fields } as Record<string, unknown> }),
        );
        failed.push(relPath);
        console.error(`Failed to ${failureVerb} ${relPath}: ${failure}`);
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
      ...(sent.length > 0 ? [describeSent(sent.length)] : []),
      ...(failed.length > 0 ? [`${failed.length} failed`] : []),
    ].join(", ");
    await commit(boxRoot, {
      message: `${outboxLabel}: ${summary}`,
      trailers: {
        "Pushed-By": pushedBy,
        ...(triggeredBy ? { "Triggered-By": triggeredBy } : {}),
      },
    });
  }
  return sent;
}
