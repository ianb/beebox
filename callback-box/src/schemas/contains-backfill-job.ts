/**
 * Contains-backfill job card schema — a job to write missing `contains:`
 * fields for a batch of cards.
 *
 * Created by `cb wakeup` (see wakeup-steps.ts `createContainsBackfillJob`)
 * one batch at a time; the next wakeup queues the next batch until
 * `cb contains list --missing` is empty. Processed by the reactor agent.
 */

import { cardSchema, type CardSchema } from "../cards/index.js";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const ContainsBackfillJobSchema: CardSchema = cardSchema("contains-backfill-job", {
  searchable: false,
  fields: {
    status: z.string().default("pending"),
    created: z.string().datetime({ offset: true }),
    source: z.string().default("contains-backfill"),
    priority: z.enum(["normal", "low"]).default("low"),
    description: z.string(),
    items: z.array(z.object({ ref: z.string() })),
  },
  instructions: `# Processing Contains-Backfill Jobs

Some cards are missing their \`contains:\` field. This job lists a batch of
them; write a one-line \`contains:\` for each.

## Steps

1. Read this job card to find the referenced cards (each entry in
   \`items:\` has a \`ref\` pointing to a card missing \`contains:\`)
2. For each item, read the card, then set its \`contains:\` field with:
   \`cb contains update "<path>" --text "..."\`
3. Write one sentence stating what can be found inside the card. When the
   information is concise, the sentence carries the information itself
   ("Dentist moved to June 17; confirmation in this email"), not a pointer
   at it ("contains scheduling information"); when it isn't concise, say
   what's learnable there. Never a list of parts; under 200 characters.
4. Commit your work
5. Run \`cb finish {thisJobFile}\` to complete the job`,
});

export function createContainsBackfillJobTemplate(options: {
  created?: string;
  items: string[];
  remaining: number;
}): string {
  const count = options.items.length;
  const remainingNote =
    options.remaining > 0
      ? ` ${String(options.remaining)} more cards remain; the next wakeup queues another batch.`
      : "";
  const fields: Record<string, unknown> = {
    status: "pending",
    created: options.created ?? new Date().toISOString(),
    source: "contains-backfill",
    priority: "low",
    description: `Write the contains: field for ${String(count)} cards missing it.${remainingNote}`,
    items: options.items.map((ref) => ({ ref })),
  };
  return `---\n${stringifyYaml(fields)}---\n`;
}
