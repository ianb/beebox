/** The publication card: one box card is one publication and holds its request. */

import { z } from "zod";
import { body, cardSchema, renderFrontmatterBlock, type CardSchema, type InferCardFields } from "../exports/cards.js";
import { BOX_PACKAGE_DOCS } from "../core/docs-gen/shared.js";
import { pubIdSchema } from "../publish/manifest.js";
import {
  publicationConnectionSchema,
  publicationEmailsSchema,
  publicationSlugSchema,
  publicationTierSchema,
  publicationTitleSchema,
} from "../publish/publication-definition.js";

type PublicationTier = z.infer<typeof publicationTierSchema>;

/** Cross-field rules: `slug` only on `public`; `emails` exactly on `accounts`. */
function refineTierFields(fields: Record<string, unknown>, ctx: z.core.$RefinementCtx): void {
  const tier = fields["tier"];
  if (fields["slug"] !== undefined && tier !== "public") {
    ctx.addIssue({ code: "custom", path: ["slug"], message: "slug is allowed only when tier is public" });
  }
  if (tier === "accounts" && fields["emails"] === undefined) {
    ctx.addIssue({ code: "custom", path: ["emails"], message: "tier accounts requires a non-empty emails list" });
  }
  if (tier !== "accounts" && fields["emails"] !== undefined) {
    ctx.addIssue({ code: "custom", path: ["emails"], message: "emails is allowed only when tier is accounts" });
  }
}

export const PublicationSchema: CardSchema = cardSchema("publication", {
  brief: "One published site and its request",
  description: "A card that is one publication: it holds the requested connection, audience, and address, plus private notes",
  category: "authored",
  fields: {
    title: publicationTitleSchema,
    pubId: pubIdSchema,
    connection: publicationConnectionSchema,
    tier: publicationTierSchema,
    slug: publicationSlugSchema.optional(),
    emails: publicationEmailsSchema.optional(),
    body: body(z.string()),
  },
  superRefine: refineTierFields,
  instructions: `# Publication cards

A publication card is one publication. Its fields request how the site is
published. The server decides what is actually served.

Fields:

- \`title\`: the site title.
- \`pubId\`: the identity of the publication. Generate it one time with
  \`bbx pub id\`. Never change it.
- \`connection\`: the connection that the site deploys through.
- \`tier\`: the requested audience. Use \`public\`, \`secret\`, \`accounts\`, or
  \`any-account\`.
- \`slug\`: the requested path on the box's shared hostname. The site is
  served at \`/<slug>/\`. Use it only with tier \`public\`.
- \`emails\`: the reader emails. Use it only with tier \`accounts\`, and there
  it is required.

The body is for private notes. It is never published.

Put the site files in the card's attach folder. Use exactly one of these:

- \`<Name>.attach/static/\`: finished files. Markdown files are rendered.
- \`<Name>.attach/project/\`: a project with \`package.json\`. Its \`dist/\`
  folder is published.

Do not copy a publication card. Two cards with one \`pubId\` is an error. To move or
rename it, use \`bbx mv\`.

To see what is published, run \`bbx pub files <card-path>\` or
\`bbx pub cat <card-path> <file>\`. Add \`--pending\` to read the candidate.

Do not put approval, the audience that is actually served, the hostname, or
status in this card. The server owns them. A change to \`tier\`, \`slug\`, or
\`emails\` is a request. It waits until a signed-in member approves it.

For the full procedure, read \`${BOX_PACKAGE_DOCS}/publishing.md\`.
`,
});

export type PublicationFields = InferCardFields<typeof PublicationSchema>;

/** Render a new publication card from its request fields and optional notes. */
export function createPublicationCardTemplate(input: {
  pubId: string;
  title: string;
  connection: string;
  tier: PublicationTier;
  slug?: string;
  emails?: readonly string[];
  body?: string;
}): string {
  const fields: Record<string, unknown> = {
    title: input.title,
    pubId: input.pubId,
    connection: input.connection,
    tier: input.tier,
  };
  if (input.slug !== undefined) fields["slug"] = input.slug;
  if (input.emails !== undefined) fields["emails"] = [...input.emails];
  return renderFrontmatterBlock(fields, input.body ?? "");
}
