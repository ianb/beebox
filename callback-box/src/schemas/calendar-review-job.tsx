/**
 * Calendar review job card schema — a job to review calendar changes.
 *
 * Created by the google-calendar connector when events are added,
 * updated, or deleted. Processed by the reactor agent.
 */

import { cardSchema, type CardSchema } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

const Change = z.object({
  action: z.enum(["new", "updated", "deleted"]),
  ref: z.string().optional(),
  summary: z.string(),
  ics: z.string().optional(),
});

export const CalendarReviewJobSchema: CardSchema = cardSchema("calendar-review-job", {
  searchable: false,
  fields: {
    status: z.string().default("pending"),
    created: z.string().datetime({ offset: true }),
    source: z.string(),
    priority: z.enum(["normal", "low"]).default("normal"),
    description: z.string(),
    changes: z.array(Change),
  },
  instructions: `# Processing Calendar Review Jobs

A calendar-review job means calendar events have changed and may need
attention.

## Steps

1. Read this job card to find the changes (\`changes:\` array)
2. Check for an applicable guide — see the compiled reference in
   \`docs/generated/\` if available
3. For each change, follow the guide's triage rules and actions.
   Without a guide:
   - **New events**: Does the user need to prepare anything? Create a
     memo or reminder if so.
   - **Updated events**: Note what changed (time, location, etc.).
     Flag significant changes.
   - **Deleted events**: Note the cancellation. Usually no action
     needed.
4. Most changes need no action — just review and move on
5. If something needs user attention, create a question card
6. When done reviewing, commit any work and run
   \`cb finish {thisJobFile}\`

## Important

- Most calendar changes are informational — don't over-react
- Only create tasks/questions for changes that genuinely need
  preparation
- Commit your work before running \`cb finish\``,
});

export interface CalendarChangeInput {
  action: "new" | "updated" | "deleted";
  ref?: string;
  summary: string;
  icsContent?: string;
}

export interface CalendarReviewJobFields {
  type: "calendar-review-job";
  status: string;
  created: string;
  source: string;
  priority: "normal" | "low";
  description: string;
  changes: Array<{
    action: "new" | "updated" | "deleted";
    ref?: string;
    summary: string;
    ics?: string;
  }>;
}

export function createCalendarReviewJobTemplate(options: {
  created?: string;
  source: string;
  description: string;
  changes: CalendarChangeInput[];
  priority?: "normal" | "low";
}): string {
  const fields: Record<string, unknown> = {
    status: "pending",
    created: options.created ?? new Date().toISOString(),
    source: options.source,
    priority: options.priority ?? "normal",
    description: options.description,
    changes: options.changes.map((c) => {
      const entry: Record<string, unknown> = {
        action: c.action,
        summary: c.summary,
      };
      if (c.ref !== undefined) entry["ref"] = c.ref;
      if (c.icsContent !== undefined) entry["ics"] = c.icsContent;
      return entry;
    }),
  };
  return `---\n${stringifyYaml(fields)}---\n`;
}
