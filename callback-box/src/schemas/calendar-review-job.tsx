/**
 * Calendar review job card schema - a job to review calendar changes.
 *
 * Created by the google-calendar connector when events are added,
 * updated, or deleted. Processed by the reactor agent.
 */

import { element, escapeText, escapeAttr } from "cardworks";
import { z } from "zod";

// Shared job description element, formerly in news-job.tsx.
const JobDescription = element("description", { text: z.string() });

/**
 * Child element for embedded ICS content (used for deleted events).
 */
export const IcsContent = element("ics", {
  text: z.string(),
});

/**
 * Child element representing a single calendar change.
 */
export const CalendarChange = element("change", {
  attrs: {
    action: z.enum(["new", "updated", "deleted"]),
    ref: z.string().optional(),
  },
  text: z.string().optional(),
  children: z.array(IcsContent).optional(),
});

/**
 * Calendar review job card schema.
 *
 * Example:
 * ```xml
 * <calendar-review-job status="pending" created="2026-02-21T08:00:00Z"
 *     source="google-calendar" priority="normal">
 *   <description>3 calendar changes to review</description>
 *   <change action="new" ref="store/calendar/2026-02-25_a1b2c3d4.ics">
 *     Dentist appointment, Tue Feb 25 2:00 PM
 *   </change>
 *   <change action="updated" ref="store/calendar/2026-02-22_e5f6g7h8.ics">
 *     Team standup — time changed, location added: Room 3B
 *   </change>
 *   <change action="deleted">
 *     <ics>BEGIN:VCALENDAR
 * ...full ICS content...
 * END:VCALENDAR</ics>
 *   </change>
 * </calendar-review-job>
 * ```
 */
export const CalendarReviewJobSchema = element("calendar-review-job", {
  attrs: {
    status: z.string().default("pending"),
    created: z.string().datetime({ offset: true }),
    source: z.string(),
    priority: z.enum(["normal", "low"]).default("normal"),
  },
  children: z.array(z.union([JobDescription, CalendarChange])),
  instructions: `# Processing Calendar Review Jobs

A calendar-review job means calendar events have changed and may need attention.

## Steps

1. Read this job card to find the changes
2. Check for an applicable guide — see the compiled reference in \`docs/generated/\` if available
3. For each change, follow the guide's triage rules and actions. Without a guide:
   - **New events**: Does the user need to prepare anything? Create a memo or reminder if so.
   - **Updated events**: Note what changed (time, location, etc.). Flag significant changes.
   - **Deleted events**: Note the cancellation. Usually no action needed.
4. Most changes need no action — just review and move on
5. If something needs user attention, create a question card
6. When done reviewing, commit any work and run \`cb finish {thisJobFile}\`

## Important

- Most calendar changes are informational — don't over-react
- Only create tasks/questions for changes that genuinely need preparation
- Commit your work before running \`cb finish\``,
});

export type CalendarReviewJob = z.infer<typeof CalendarReviewJobSchema>;

/**
 * A single calendar change for template building.
 */
export interface CalendarChangeInput {
  action: "new" | "updated" | "deleted";
  ref?: string;
  summary: string;
  icsContent?: string;
}

/**
 * Template for creating a calendar review job card.
 */
export function createCalendarReviewJobTemplate(options: {
  created?: string;
  source: string;
  description: string;
  changes: CalendarChangeInput[];
  priority?: "normal" | "low";
}): string {
  const created = options.created ?? new Date().toISOString();
  const priority = options.priority ?? "normal";

  const changeElements = options.changes
    .map((c) => {
      const refAttr = c.ref ? ` ref="${escapeAttr(c.ref)}"` : "";
      if (c.action === "deleted" && c.icsContent) {
        return `<change action="deleted"${refAttr}>
${escapeText(c.summary)}
<ics>${escapeText(c.icsContent)}</ics>
</change>`;
      }
      return `<change action="${c.action}"${refAttr}>${escapeText(c.summary)}</change>`;
    })
    .join("\n");

  return `<calendar-review-job status="pending" created="${created}" source="${escapeAttr(options.source)}" priority="${priority}">
<description>${escapeText(options.description)}</description>
${changeElements}
</calendar-review-job>
`;
}
