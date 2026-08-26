/**
 * Glink card schema — a pointer to a Google Drive item the box does not copy.
 *
 * The Drive sibling of `extfile`: frontmatter says what the item is and where
 * it lives; nothing is mirrored. Two ways one appears — emitted by a
 * `.gfolder.card` mirror for a child with no sync handler (`origin: mirror`),
 * or created deliberately with `cb drive link` (`origin: manual`).
 *
 * Unlike every other connector-managed card, this one has a body the connector
 * never writes or reads: the boxholder's (or agent's) notes on what the item
 * is for.
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { body, cardSchema, type InferCardFields } from "../cards/index.js";

const GlinkOrigin = z.enum(["mirror", "manual"]);

export type GlinkOriginType = z.infer<typeof GlinkOrigin>;

export const GlinkSchema = cardSchema("glink", {
  description: "A pointer to a Google Drive item that is not copied into the box — Drive metadata plus the boxholder's purpose notes",
  category: "synced",
  fields: {
    "drive-id": z.string(),
    link: z.string(),
    name: z.string(),
    mime: z.string(),
    origin: GlinkOrigin,
    body: body(z.string()),
  },
  instructions: `# Glink Cards

A \`.glink.card\` says **"this Drive item exists, here is where it lives, here
is what it is for."** Nothing is copied into the box — no attach scope, no
export. To read the item, open \`link:\` or run \`cb drive inspect <drive-id>\`.

Two ways one shows up:

- \`origin: mirror\` — a \`.gfolder.card\` mirror found a child it cannot sync
  (a PDF, a Slides deck, an image) and left a pointer instead. It sits beside
  the folder's synced children.
- \`origin: manual\` — someone ran \`cb drive link <url> <path>\`, usually
  because a single Drive item is worth remembering without mirroring anything.

## Frontmatter is the connector's; the body is yours

\`drive-id\`, \`link\`, \`name\`, and \`mime\` are stamped from Drive on every
sync — hand-edit them and the next sync writes them back. Do not.

The **body is purpose notes**, written by the boxholder or by an agent on their
behalf, and the connector never touches it: what the item is for, what is in
it, who asked for it, what to do with it. A mirror emits a pointer with an
empty body; filling it in is how the box learns why the item matters. Write
plain prose:

\`\`\`markdown
The signed lease. Renewal decision is due each February — check the
escalation clause in section 7 before renewing.
\`\`\`

## Not a synced file

A pointer is not a \`.gdoc.card\` / \`.gsheet.card\`. There is no local copy to
edit and nothing pushes back to Drive. If the item is a Doc or a Sheet and you
want it synced, mount it with \`cb drive add\` instead — a pointer to a
syncable type usually means someone chose not to copy it.`,
});

export type GlinkFields = InferCardFields<typeof GlinkSchema>;

export function createGlinkTemplate(options: {
  driveId: string;
  link: string;
  name: string;
  mime: string;
  origin: GlinkOriginType;
  notes: string;
}): string {
  const fields: Record<string, unknown> = {
    "drive-id": options.driveId,
    link: options.link,
    name: options.name,
    mime: options.mime,
    origin: options.origin,
  };
  return `---\n${stringifyYaml(fields)}---\n${options.notes}`;
}
