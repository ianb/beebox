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

import { body, cardSchema, type CardSchema } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

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

Plain markdown. Headings, lists, code blocks, links, etc. — anything
markdown supports. References to other cards use the standard ref
form (frontmatter \`{ref: "..."}\` or inline markdown links to card
paths).

## When NOT to use a doc card

- A synced Google Doc — use \`.gdoc.card\` (managed by the drive
  connector).
- A captured note or voice memo — use \`.memo.card\`.
- A structured record extracted from something — use \`.record.card\`.
- An ad-hoc README that lives next to code/config rather than being
  content in its own right — plain \`.md\` is fine.

## No timestamps

Doc cards intentionally have no \`created\` or \`modified\` field. Git
already tracks both authoritatively (\`git log --diff-filter=A\` for
creation, \`git log\` for any change). Don't add them.`,
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
