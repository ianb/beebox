/** A stable box card reference to a server-managed publication. */

import { body, cardSchema, renderFrontmatterBlock, type CardSchema, type InferCardFields } from "../exports/cards.js";
import { BOX_PACKAGE_DOCS } from "../core/docs-gen/shared.js";
import { pubIdSchema } from "../publish/manifest.js";
import { z } from "zod";

export const PublicationSchema: CardSchema = cardSchema("publication", {
  brief: "Controls for one publication",
  description: "A card that opens the review and serving controls for one server-managed publication",
  category: "authored",
  fields: {
    pubId: pubIdSchema,
    body: body(z.string()),
  },
  instructions: `# Publication cards

A publication card is a stable link to one server-managed publication. Its
\`pubId\` is the lookup identity; the card's filename, title, and body are for
navigation and notes only.

Do not put publication permissions, approval status, candidate revisions,
audience, hostname, connection, or serving settings in this card. Those values
are controlled by the signed-in member through the publication review surface
and are validated by the server. To prepare or update published files, follow
\`${BOX_PACKAGE_DOCS}/publishing.md\`.
`,
});

export type PublicationFields = InferCardFields<typeof PublicationSchema>;

/** Build the reference card installed when a publication is first prepared. */
export function createPublicationCardTemplate(input: { pubId: string; title: string; body?: string }): string {
  return renderFrontmatterBlock({ title: input.title, pubId: input.pubId }, input.body ?? "");
}
