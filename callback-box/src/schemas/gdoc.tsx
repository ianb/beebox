/**
 * Gdoc card schema — metadata for a Google Docs document synced to the box.
 *
 * Pure frontmatter. The actual document content lives in a markdown file
 * inside the card's `.attach/` scope; `content.ref` points at it.
 * Lossy upstream features (comments, footnotes, etc.) are enumerated in
 * `lossy:` so agents know what won't survive a push.
 *
 * Example file layout:
 *   store/drive/Project_Notes.gdoc.card
 *   store/drive/Project_Notes.attach/Project_Notes.md
 *
 * Distinct from the generic `doc` schema (`src/schemas/doc.tsx`), which
 * is a freeform document with no upstream sync — use that when an agent
 * would otherwise reach for a plain `.md` file.
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { cardSchema, type CardSchema } from "../cards/index.js";

const LossyType = z.enum([
  "comments",
  "footnotes",
  "images",
  "equations",
  "suggestions",
  "tables",
]);

export type GdocLossyType = z.infer<typeof LossyType>;

const LossyItem = z.object({
  type: LossyType,
  count: z.coerce.number(),
});

export const GdocSchema: CardSchema = cardSchema("gdoc", {
  fields: {
    "drive-id": z.string(),
    status: z.enum(["synced", "error", "new", "conflict"]).optional(),
    title: z.string(),
    modified: z.string(),
    revision: z.string().optional(),
    link: z.string(),
    owner: z.string(),
    content: z.object({ ref: z.string() }),
    lossy: z.array(LossyItem).optional(),
  },
  instructions: `# Gdoc Cards

**Location:** Anywhere in the box, commonly \`store/drive/\`.

Each synced Google Doc has a \`.gdoc.card\` plus a markdown file inside
the card's \`.attach/\` scope (e.g.
\`Project_Notes.attach/Project_Notes.md\`). The \`content.ref:\` field
points at it.

Not to be confused with \`.doc.card\` — that's the generic in-box
document type with no upstream sync.

## Editing
Edit the \`.md\` file and commit. On the next sync the change pushes
back to Google Drive (markdown is converted to Doc format on the
server). Do not modify the card frontmatter — it is managed by the
connector — with one exception: \`contains:\` is agent-owned and
survives sync; set it freely (\`cb contains update\`).

## Conflicts
If the upstream Doc was edited in Drive between your last pull and
your push, the card \`status\` becomes \`conflict\` and the upstream
version is written next to the local \`.md\` as \`{basename}.remote.md\`
(inside the attach scope). Resolve by merging the two files, deleting
the \`.remote.md\`, and committing — the next sync will push the
resolved version.

## Lossy content
The \`lossy:\` field enumerates features in the upstream Doc that don't
survive markdown export (comments, footnotes, embedded images,
equations, suggestions, complex tables). When present,
pushing local edits will replace those features with the markdown
body — destroying them. If \`lossy\` is non-empty and a push is
intended, surface the loss to the user before committing.

## Moving docs
Moving the card moves its attach scope (and the \`.md\` inside)
atomically — the \`drive-id\` field maintains the link to Google Drive.`,
});

export interface GdocFields {
  type: "gdoc";
  "drive-id": string;
  status?: "synced" | "error" | "new" | "conflict";
  title: string;
  modified: string;
  revision?: string;
  link: string;
  owner: string;
  content: { ref: string };
  lossy?: Array<{ type: GdocLossyType; count: number }>;
}

export function createGdocTemplate(options: {
  driveId: string;
  title: string;
  modified: string;
  revision?: string;
  link: string;
  owner: string;
  contentFile: string;
  lossy?: Array<{ type: GdocLossyType; count: number }>;
  status?: "synced" | "error" | "new" | "conflict";
}): string {
  const fields: Record<string, unknown> = {
    "drive-id": options.driveId,
    status: options.status === undefined ? "synced" : options.status,
    title: options.title,
    modified: options.modified,
    link: options.link,
    owner: options.owner,
    content: { ref: `attach/${options.contentFile}` },
  };
  if (options.revision !== undefined && options.revision !== "") {
    fields["revision"] = options.revision;
  }
  if (options.lossy !== undefined && options.lossy.length > 0) {
    fields["lossy"] = options.lossy;
  }
  return `---\n${stringifyYaml(fields)}---\n`;
}
