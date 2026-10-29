/**
 * Calendar card schema — one synced calendar.
 *
 * The card sits in `_content/calendar/` and its events are `.ics` files in the
 * card's attach folder, beside it:
 *
 *   _content/calendar/Family.calendar.card
 *   _content/calendar/Family.attach/2026-06-25_Dentist_a1b2c3d4.ics
 *
 * Events stay `.ics` (RFC 5545) rather than cards, so any calendar source can
 * fill the folder. The Google Calendar connector creates the card the first
 * time it syncs the calendar and re-stamps `title` (the calendar's Google
 * name) and `google-calendar:` on every sync; the body is the person's.
 * The card's file name is fixed when it is created, so a calendar renamed in
 * Google keeps its folder and only its `title` changes.
 */

import { z } from "zod";
import { body, cardSchema, renderFrontmatterBlock, type InferCardFields } from "../exports/cards.js";

export const CalendarSchema = cardSchema("calendar", {
  brief: "A synced calendar; its events are .ics files in its attach folder",
  description: "A synced calendar — its events are .ics files in the card's attach folder; created and re-stamped by the Google Calendar connector",
  category: "synced",
  fields: {
    "google-calendar": z.object({
      id: z.string(),
      // Google's accessRole for this account: owner, writer, reader, or
      // freeBusyReader. Only owner and writer calendars accept edits.
      access: z.string(),
      // Whether the calendar is in the sync set (Settings, or
      // `bbx calendar add/remove`). A calendar taken out keeps its card and
      // its files; they stop updating.
      syncing: z.boolean(),
    }),
    body: body(z.string()),
  },
  instructions: `# Calendar Cards

A \`.calendar.card\` is one synced calendar. Its events are \`.ics\` files in
the card's attach folder, named \`{date}_{title}_{id}.ics\`:

\`\`\`
_content/calendar/Family.calendar.card
_content/calendar/Family.attach/2026-06-25_Dentist_a1b2c3d4.ics
_content/calendar/Family.attach/stranded/      # edits Google would not take
\`\`\`

## Adding or changing an event

To add an event to a calendar, write a new \`.ics\` file in **that calendar's
attach folder**; the folder decides the calendar. Any file name works: the
sync renames it to the standard name once Google has the event. To change an
event, edit its file. Changes reach Google on the next calendar sync. Use the
\`calendar\` skill for the file format.

Only \`owner\` and \`writer\` calendars (\`google-calendar.access\`) accept
changes. A \`reader\` calendar is read-only in Google: do not edit its files.

Do not move event files between calendar folders; it is not how an event
changes calendar, and the moved file is read as a new event.

## Frontmatter

Connector-managed; do not hand-edit. \`title\` is the calendar's name in Google
and \`google-calendar:\` is re-stamped on every sync. \`syncing: false\` means
the calendar was removed from the sync set: its files stay and stop updating.

## Body

The person's own notes about the calendar. The connector never writes it.`,
  summarize: (card, base) => ({ ...base, detail: card["google-calendar"].access }),
});

export type CalendarFields = InferCardFields<typeof CalendarSchema>;

/** Build a new calendar card's file content (no body). */
export function createCalendarTemplate(options: {
  name: string;
  id: string;
  access: string;
  syncing: boolean;
}): string {
  return renderFrontmatterBlock({
    title: options.name,
    "google-calendar": { id: options.id, access: options.access, syncing: options.syncing },
  });
}
