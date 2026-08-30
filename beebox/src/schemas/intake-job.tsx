/**
 * Intake job card schema — a job to triage new inbox items.
 *
 * Created by connectors (gmail, raindrop, etc.) when new items arrive,
 * or by `bbx wakeup` for UI-created memos and other unjobbed inbox items.
 * Processed by the reactor agent, which triages each item.
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { cardSchema, cardRef, type InferCardFields } from "../cards/index.js";

export const IntakeJobSchema = cardSchema("intake-job", {
  description: "A system job to triage newly arrived inbox items; created by connectors and bbx wakeup",
  category: "system",
  searchable: false,
  fields: {
    status: z.string().default("pending"),
    source: z.string(),
    priority: z.enum(["normal", "low"]).default("normal"),
    description: z.string(),
    items: z.array(cardRef()),
  },
  instructions: `# Processing Intake Jobs

An intake job means new items have arrived in the inbox and need triage.

## Steps

1. Read this job card to find the referenced items (each entry in
   \`items:\` has a \`ref\` pointing to an inbox card)
2. Check for an applicable guide — see the compiled reference in
   \`docs/generated/\` if available
3. Read each referenced item to understand what it is
4. For each item, follow the guide's triage rules and actions. Without
   a guide:
   - **Move** to a permanent location under \`store/\` if it's worth
     keeping
   - **Trash** with \`bbx rm <path>\` if it's not useful
   - **Ask** the user a question if you need guidance (create a
     question card)
5. When all items are triaged, commit your work
6. Run \`bbx finish {thisJobFile}\` to complete the job

## Important

- Commit your work as you go
- The \`bbx finish\` command only deletes the job file — make sure your
  actual work is committed first
- Read items before deciding — don't judge by filename alone`,
});

export type IntakeJobFields = InferCardFields<typeof IntakeJobSchema>;

export function createIntakeJobTemplate(options: {
  source: string;
  description: string;
  items: string[];
  priority?: "normal" | "low";
}): string {
  const fields: Record<string, unknown> = {
    status: "pending",
    source: options.source,
    priority: options.priority ?? "normal",
    description: options.description,
    items: options.items.map((ref) => ({ ref })),
  };
  return `---\n${stringifyYaml(fields)}---\n`;
}
