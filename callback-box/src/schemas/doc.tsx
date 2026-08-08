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
import { body, cardSchema, type InferCardFields } from "../cards/index.js";

export const DocSchema = cardSchema("doc", {
  description: "A generic typed document (title + markdown body) — the default for agent-authored prose instead of a plain .md",
  category: "authored",
  fields: {
    title: z.string(),
    /** Stable id supplied by an external share operation for retry deduplication. */
    "share-id": z.string().uuid().optional(),
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
in the card's attach scope (\`<basename>.attach/\`), referenced from the
body as \`attach/<filename>\` — see the agent guide's ABOUT_CARDS.
Never a top-level or shared \`images/\` directory.

## When NOT to use a doc card

- A synced Google Doc — use \`.gdoc.card\` (managed by the drive
  connector).
- A captured note or voice memo — use \`.memo.card\`.
- A structured record extracted from something — use \`.record.card\`.
- An ad-hoc README that lives next to code/config rather than being
  content in its own right — plain \`.md\` is fine.`,
});

export type DocFields = InferCardFields<typeof DocSchema>;

export function createDocTemplate(options: { title: string; body?: string; shareId?: string }): string {
  const fields: Record<string, unknown> = {
    title: options.title,
  };
  if (options.shareId !== undefined && options.shareId !== "") {
    fields["share-id"] = options.shareId;
  }
  const bodyText = options.body ?? "";
  const bodyTail = bodyText === "" ? "" : `${bodyText}${bodyText.endsWith("\n") ? "" : "\n"}`;
  return `---\n${stringifyYaml(fields)}---\n${bodyTail}`;
}
