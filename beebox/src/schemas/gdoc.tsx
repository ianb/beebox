/**
 * Gdoc card schema — metadata for a Google Docs document synced to the box.
 *
 * Pure frontmatter. The actual document content lives in a markdown file
 * inside the card's `.attach/` scope; `content.ref` points at it.
 * Lossy upstream features (comments, footnotes, etc.) are enumerated in
 * `lossy:` so agents know what won't survive a push.
 *
 * Example file layout:
 *   _content/drive/Project_Notes.gdoc.card
 *   _content/drive/Project_Notes.attach/Project_Notes.md
 *
 * Distinct from the generic `doc` schema (`src/schemas/doc.tsx`), which
 * is a freeform document with no upstream sync — use that when an agent
 * would otherwise reach for a plain `.md` file.
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { cardSchema, type InferCardFields } from "../cards/index.js";

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

export const GdocSchema = cardSchema("gdoc", {
  description: "A Google Doc synced by the drive connector — connector-managed metadata plus the document as an attached .md (unlike the in-box doc type)",
  category: "synced",
  fields: {
    "drive-id": z.string(),
    status: z.enum(["synced", "error", "new", "conflict"]).optional(),
    title: z.string(),
    modified: z.string(),
    revision: z.string().optional(),
    link: z.string(),
    owner: z.string(),
    content: z.object({ ref: z.string() }),
    comments: z.object({ ref: z.string() }).optional(),
    lossy: z.array(LossyItem).optional(),
  },
  instructions: `# Gdoc Cards

**Location:** Anywhere in the box, commonly \`_content/drive/\`.

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
survives sync; set it freely (\`bbx contains update\`).

Edit it only to change what the document says. The \`.md\` is Google's
export, not an authored file, so never reformat it — and never edit it
to satisfy a linter. Markdown lint does not run on these files; a lint
failure on one is an engine bug to report, not a file to repair.
Whitespace is not cosmetic here: trailing spaces encode a line break
inside a nested list, and stripping them collapses checklists into
paragraphs upstream. A push that strips trailing whitespace off lines it
otherwise keeps is refused — the connector parks the upstream copy as
\`.remote.md\` instead — so leave it alone even when making a real edit.

## Conflicts
If the upstream Doc was edited in Drive between your last pull and
your push, the card \`status\` becomes \`conflict\` and the upstream
version is written next to the local \`.md\` as \`{basename}.remote.md\`
(inside the attach scope). Resolve by merging the two files, deleting
the \`.remote.md\`, and committing — the next sync will push the
resolved version.

## Comments
Collaborative feedback from the upstream Doc is captured as a sidecar
inside the attach scope (\`{basename}.comments.json\`), referenced by the
\`comments.ref:\` field when present. It holds the full comment thread:
content, author, timestamps, resolved status, the anchored text, and
replies. This is read-only context regenerated on each pull — editing or
pushing the \`.md\` does NOT write comments back upstream (a push may even
orphan the upstream anchors). Read it to understand reviewer feedback;
don't expect changes to round-trip.

## Lossy content
The \`lossy:\` field enumerates features in the upstream Doc that don't
survive markdown export (footnotes, embedded images, equations,
suggestions, complex tables). When present, pushing local edits will
replace those features with the markdown body — destroying them. If
\`lossy\` is non-empty and a push is intended, surface the loss to the
user before committing. (Comments are handled separately via
\`comments.ref:\` above, not counted here.)

An empty \`lossy:\` is not a safety check. It means none of those six
features were found — it says nothing about the structure the export
does carry, such as nested lists and checkboxes, which markdown holds
only in whitespace and indentation. Never read an empty \`lossy:\` as
permission to edit or reformat.

## Moving docs
Moving the card moves its attach scope (and the \`.md\` inside)
atomically — the \`drive-id\` field maintains the link to Google Drive.`,
});

export type GdocFields = InferCardFields<typeof GdocSchema>;

export function createGdocTemplate(options: {
  driveId: string;
  title: string;
  modified: string;
  revision?: string;
  link: string;
  owner: string;
  contentFile: string;
  commentsFile?: string | undefined;
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
  if (options.commentsFile !== undefined) {
    fields["comments"] = { ref: `attach/${options.commentsFile}` };
  }
  if (options.revision !== undefined && options.revision !== "") {
    fields["revision"] = options.revision;
  }
  if (options.lossy !== undefined && options.lossy.length > 0) {
    fields["lossy"] = options.lossy;
  }
  return `---\n${stringifyYaml(fields)}---\n`;
}
