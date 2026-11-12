/**
 * `tour` card schema (`docs/plans/conversation-strip.md`, Track B): an ordered
 * walk-through. Each `## ` heading in the body opens a beat; `current` names
 * the beat the person is on. The first strip-capable card type
 * (`src/shared/strip-types.ts`).
 *
 * Beat parsing is `parseTourBeats` (`src/shared/tour-beats.ts`), shared with
 * the renderer, so the validator and the page agree on what a beat is.
 */

import { stringify as stringifyYaml } from "../lib/yaml-package.js";
import { z } from "zod";
import { body, cardSchema, type CardSchema, type LintIssue } from "../exports/cards.js";
import { parseTourBeats } from "../shared/tour-beats.js";

function issue(message: string): LintIssue {
  return { type: "validation", severity: "error", message };
}

function tourErrors(fields: Record<string, unknown>): LintIssue[] {
  const bodyText = typeof fields["body"] === "string" ? fields["body"] : "";
  const titles = parseTourBeats(bodyText).beats.map((beat) => beat.title);
  if (titles.length === 0) {
    return [issue("a tour needs at least one beat: start each beat with a `## ` heading")];
  }
  const errors: LintIssue[] = [];
  const seen = new Set<string>();
  for (const title of titles) {
    if (seen.has(title)) errors.push(issue(`two beats are titled "${title}"; beat titles must differ (beats: ${titles.join(", ")})`));
    seen.add(title);
  }
  const current = fields["current"];
  if (typeof current === "string" && !titles.includes(current.trim())) {
    errors.push(issue(`current "${current}" matches no beat title (beats: ${titles.join(", ")})`));
  }
  return errors;
}

export const TourSchema: CardSchema = cardSchema("tour", {
  brief: "An ordered walk-through",
  description: "An ordered walk-through of beats, one marked current, that the box can keep in view in the conversation strip",
  category: "authored",
  fields: {
    current: z.string().optional(),
    body: body(z.string()),
  },
  validate: ({ fields }) => tourErrors(fields),
  instructions: `# Tour Cards

A \`tour\` card is an ordered walk-through. Use it to take a person through
something one step at a time while they keep the real interface open.

## Shape

- The body holds the beats. Each \`## \` heading opens one beat, in order.
  The heading is the beat's title. Titles must differ.
- Text before the first heading is an introduction. It is not a beat.
- \`current:\` holds the title of the beat the person is on. Move it as the
  walk advances. It must match a beat title exactly, or validation fails.
- When the tour follows something the person said, use their own words in
  the beat titles.
- Under a beat, put what the person needs for that step: links to cards
  (\`[label](/_content/...card)\`) and \`control:\` pointers. Keep each beat
  short. A few lines is enough.

## Showing it

Run \`bbx chat strip set <card path>\` to keep the tour in view across the top
of the person's page. Run \`bbx chat strip clear\` to remove it.

Set the strip only when the person asked for a walk-through, a presentation
aid, or the strip. If the person closed it (the \`<chat-app>\` snapshot shows
\`strip="dismissed"\`), do not set it again until they ask.

## Not a todo list

A tour shows a path through things that exist. It does not track work. For
work to do, use todos.`,
});

export function createTourTemplate(options: { title: string; body?: string }): string {
  const bodyText = options.body ?? "## First step\n";
  const tail = bodyText.endsWith("\n") ? bodyText : `${bodyText}\n`;
  return `---\n${stringifyYaml({ title: options.title })}---\n${tail}`;
}
