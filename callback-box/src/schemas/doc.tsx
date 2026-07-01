/**
 * Doc card schema — a generic in-box document.
 *
 * The minimal "I have a document with a title and a body" card. Use this
 * whenever an agent would otherwise reach for a plain `.md` file: design
 * notes, plans, reference material, scratch documents, README-style
 * pages. Distinct from `gdoc`, which is the synced Google Doc type.
 *
 * Body is markdown. No timestamps — git history is the source of truth
 * for creation/modification.
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { body, cardSchema, type CardSchema } from "../cards/index.js";

export const DocSchema: CardSchema = cardSchema("doc", {
  fields: {
    title: z.string(),
    body: body(z.string()),
  },
  instructions: `# Doc Cards

A doc card is a generic typed document with a title and a markdown body.

**Use \`.doc.card\` instead of \`.md\` by default.** Plain markdown files
are still allowed for things like READMEs, generated docs, or
attachments, but a fresh document an agent creates for design notes,
plans, reference material, scratch work, or any prose worth keeping
should be a doc card. The card form gives the document a title field
separate from the filename, lets it participate in card-wide tooling
(\`cb validate\`, the file browser, refs), and keeps the box's content
typed.

## Frontmatter

- \`title:\` — required, free-form. The display title; can differ from
  the filename.

## Body

The doc's body lives **inline in the .doc.card file itself**, after
the closing \`---\` of the frontmatter. Plain markdown. Headings,
lists, code blocks, links, etc. — anything markdown supports. Don't
put the body in a separate \`.md\` file beside the card; the card *is*
the document.

A minimal doc card on disk:

\`\`\`
---
title: Trip Report
---
# Trip Report

We drove down on Friday...
\`\`\`

References to other cards use the standard ref form (frontmatter
\`{ref: "..."}\` or inline markdown links to card paths).

## Embedding images and other files

Files the doc references — images, attachments, supporting media — go
inside the doc's own **attach scope**: a sibling directory named
\`<basename>.attach/\` (where \`<basename>\` is the card's filename
without the \`.doc.card\` suffix). Refer to them from the body using
the scoped form \`attach/<filename>\`.

Layout for a doc with an embedded image:

\`\`\`
store/notes/Trip_Report.doc.card
store/notes/Trip_Report.attach/photo.jpg
\`\`\`

And the doc's body:

\`\`\`markdown
# Trip Report

![A view from the cabin](attach/photo.jpg)

We drove down on Friday...
\`\`\`

The image lives inside \`Trip_Report.attach/\` (the card's scope), not
at the top level or in a shared \`images/\` directory. Moving or
renaming the card moves the whole scope atomically.

## When NOT to use a doc card

- A synced Google Doc — use \`.gdoc.card\` (managed by the drive
  connector).
- A captured note or voice memo — use \`.memo.card\`.
- A structured record extracted from something — use \`.record.card\`.
- An ad-hoc README that lives next to code/config rather than being
  content in its own right — plain \`.md\` is fine.

## No timestamps

No \`created\` / \`modified\` field — Git tracks both. This is the
general no-Git-metadata rule in ABOUT_CARDS, not doc-specific.`,
});

export interface DocFields {
  type: "doc";
  title: string;
  body: string;
}

export function createDocTemplate(options: { title: string; body?: string }): string {
  const fields: Record<string, unknown> = {
    title: options.title,
  };
  const bodyText = options.body ?? "";
  const bodyTail = bodyText === "" ? "" : `${bodyText}${bodyText.endsWith("\n") ? "" : "\n"}`;
  return `---\n${stringifyYaml(fields)}---\n${bodyTail}`;
}
