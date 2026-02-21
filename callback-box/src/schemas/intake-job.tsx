/**
 * Intake job card schema - a job to triage new inbox items.
 *
 * Created by connectors (capture, dropbox, raindrop) when new items arrive,
 * or by `cb wakeup` for UI-created memos and other unjobbed inbox items.
 * Processed by the reactor agent, which triages each item.
 */

import { element, escapeText, escapeAttr } from "cardworks";
import { z } from "zod";
import { JobDescription, JobItem } from "./news-job.js";

/**
 * Intake job card schema.
 *
 * Example:
 * ```xml
 * <intake-job status="pending" created="2026-02-21T12:00:00Z"
 *     source="capture-connector" priority="low">
 *   <description>Triage 2 new capture sessions</description>
 *   <item ref="box/inbox/capture-20260221T1430-abc12345/session.capture-session.card" />
 *   <item ref="box/inbox/capture-20260221T1500-def67890/session.capture-session.card" />
 * </intake-job>
 * ```
 */
export const IntakeJobSchema = element("intake-job", {
  attrs: {
    status: z.string().default("pending"),
    created: z.string().datetime({ offset: true }),
    source: z.string(),
    priority: z.enum(["normal", "low"]).default("normal"),
  },
  children: z.array(z.union([JobDescription, JobItem])),
  instructions: `# Processing Intake Jobs

An intake job means new items have arrived in the inbox and need triage.

## Steps

1. Read this job card to find the referenced items (each \`<item ref="...">\` points to an inbox card)
2. Check for an applicable guide — see the compiled reference in \`docs/generated/\` if available
3. Read each referenced item to understand what it is
4. For each item, follow the guide's triage rules and actions. Without a guide:
   - **Move** to a permanent location (e.g., \`store/\` or \`box/pool/\`) if it's worth keeping
   - **Trash** with \`cb trash <path>\` if it's not useful
   - **Ask** the user a question if you need guidance (create a question card)
5. When all items are triaged, commit your work
6. Run \`cb finish <this-job-file>\` to complete the job

## Important

- Commit your work as you go
- The \`cb finish\` command only deletes the job file — make sure your actual work is committed first
- Read items before deciding — don't judge by filename alone`,
});

export type IntakeJob = z.infer<typeof IntakeJobSchema>;

/**
 * Template for creating an intake job card.
 */
export function createIntakeJobTemplate(options: {
  created?: string;
  source: string;
  description: string;
  items: string[];
  priority?: "normal" | "low";
}): string {
  const created = options.created ?? new Date().toISOString();
  const priority = options.priority ?? "normal";
  const itemElements = options.items
    .map((ref) => `  <item ref="${escapeAttr(ref)}" />`)
    .join("\n");

  return `<intake-job status="pending" created="${created}" source="${escapeAttr(options.source)}" priority="${priority}">
  <description>${escapeText(options.description)}</description>
${itemElements}
</intake-job>
`;
}
