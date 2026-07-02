/**
 * View card schema — an interface surface as an addressable card.
 *
 * An "instrument card" (docs/plans/interface-as-cards.md): the named view
 * is self-sufficient code that loads its own data; the card *situates* it —
 * gives the surface a path (linkable, embeddable, pinnable in nav.card via
 * `ref`), frontmatter as its configuration surface, and a markdown body as
 * the margin for notes.
 *
 *   ---
 *   title: Chats
 *   view: chat-picker
 *   ---
 *   Notes about this surface live here.
 */

import { z } from "zod";
import { cardSchema, body, type CardSchema } from "../cards/index.js";
import { NAMED_VIEW_NAMES, NAMED_VIEWS } from "../shared/named-views.js";

const nameList = NAMED_VIEW_NAMES.join(", ");
const validNames = new Set(NAMED_VIEW_NAMES);

const viewFields = {
  view: z.string().refine((v) => validNames.has(v), {
    message: `view must be one of: ${nameList}`,
  }),
  body: body(z.string()),
};

export const ViewSchema: CardSchema = cardSchema("view", {
  fields: viewFields,
  searchable: false,
  instructions: `# View Cards

A view card makes an interface surface addressable: a card whose \`view\` field names a builtin view, rendered in place of the card. Link it, embed it, or pin it into \`nav.card\` with a \`ref\` entry like any other card. Give it a \`title\` — that's the label refs fall back to.

\`\`\`yaml
title: Chats
view: chat-picker
\`\`\`

Available views:
${NAMED_VIEWS.map((v) => `- \`${v.name}\` — ${v.description}`).join("\n")}

The markdown body is a notes margin (rationale, observations, ideas about this surface) — it shows in source view, not in the rendered surface.`,
});
