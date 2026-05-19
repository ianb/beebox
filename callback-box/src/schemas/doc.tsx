/** @jsxImportSource cardworks/jsx */
/**
 * Doc card schema — metadata for a Google Docs document synced to the box.
 *
 * Each Google Doc gets a `.doc.card` plus a markdown file inside the card's
 * attach scope. Lossy content (comments, footnotes, embedded images, etc.)
 * is enumerated in `<lossy>` so agents know what won't survive a push.
 *
 * Example layout:
 *   store/drive/Project_Notes.doc.card
 *   store/drive/Project_Notes.attach/Project_Notes.md
 */

import { element, serialize } from "cardworks";
import { z } from "zod";

export const DocTitle = element("title", {
  text: z.string(),
});

export const DocModified = element("modified", {
  text: z.string(),
});

export const DocRevision = element("revision", {
  text: z.string(),
});

export const DocLink = element("link", {
  text: z.string(),
});

export const DocOwner = element("owner", {
  text: z.string(),
});

export const DocContent = element("content", {
  attrs: {
    ref: z.string(),
  },
});

/**
 * One entry in the <lossy> block. `count` is how many of this kind of
 * feature exist in the upstream Doc (e.g. 3 comments).
 */
export const DocLossyItem = element("item", {
  attrs: {
    type: z.enum([
      "comments",
      "footnotes",
      "images",
      "drawings",
      "equations",
      "suggestions",
      "tables",
    ]),
    count: z.string(),
  },
});

export const DocLossy = element("lossy", {
  children: z.array(DocLossyItem),
});

/**
 * Doc card schema.
 *
 * `status` values:
 * - `synced` — local and remote match
 * - `new` — just created, first sync pending
 * - `error` — last sync failed
 * - `conflict` — local edit and remote edit both happened since last sync;
 *               see the sibling `.remote.md` file for the upstream version
 */
export const DocSchema = element("doc", {
  attrs: {
    "drive-id": z.string(),
    status: z.enum(["synced", "error", "new", "conflict"]).optional(),
  },
  children: z.array(
    z.union([
      DocTitle,
      DocModified,
      DocRevision,
      DocLink,
      DocOwner,
      DocContent,
      DocLossy,
    ])
  ),
  instructions: `# Doc Cards

**Location:** Anywhere in the box, commonly \`store/drive/\`.

Each synced Google Doc has a \`.doc.card\` plus a markdown file inside the
card's attach scope (e.g. \`Project_Notes.attach/Project_Notes.md\`).
The \`<content ref="attach/…">\` element points at it.

## Editing
Edit the \`.md\` file and commit. On the next sync the change pushes back
to Google Drive (markdown is converted to Doc format on the server).
Do not modify the card XML — it is managed by the connector.

## Conflicts
If the upstream Doc was edited in Drive between your last pull and your
push, the card status becomes \`conflict\` and the upstream version is
written next to the local \`.md\` as \`{basename}.remote.md\` (inside the
attach scope). Resolve by merging the two files, deleting the \`.remote.md\`,
and committing — the next sync will push the resolved version.

## Lossy content
The \`<lossy>\` block enumerates features in the upstream Doc that don't
survive markdown export (comments, footnotes, embedded images, drawings,
equations, suggestions, complex tables). When present, pushing local edits
will replace those features with the markdown body — destroying them.
If \`<lossy>\` is non-empty and a push is intended, surface the loss to
the user before committing.

## Moving docs
Moving the card moves its attach scope (and the \`.md\` inside) atomically —
the \`drive-id\` attribute maintains the link to Google Drive.`,
});

export type Doc = z.infer<typeof DocSchema>;

export type DocLossyType =
  | "comments"
  | "footnotes"
  | "images"
  | "drawings"
  | "equations"
  | "suggestions"
  | "tables";

/**
 * Create a doc card from metadata.
 *
 * `contentFile` is the bare filename of the markdown body (e.g.
 * `Project_Notes.md`). The template emits it with the `attach/` prefix.
 */
export function createDocTemplate(options: {
  driveId: string;
  title: string;
  modified: string;
  revision: string;
  link: string;
  owner: string;
  contentFile: string;
  lossy?: Array<{ type: DocLossyType; count: number }>;
  status?: "synced" | "error" | "new" | "conflict";
}): string {
  const lossy = options.lossy ?? [];
  const card = (
    <doc drive-id={options.driveId} status={options.status ?? "synced"}>
      <title>{options.title}</title>
      <modified>{options.modified}</modified>
      <revision>{options.revision}</revision>
      <link>{options.link}</link>
      <owner>{options.owner}</owner>
      <content ref={`attach/${options.contentFile}`} />
      {lossy.length > 0 ? (
        <lossy>
          {lossy.map((item) => (
            <item type={item.type} count={String(item.count)} />
          ))}
        </lossy>
      ) : null}
    </doc>
  );

  return serialize(card) + "\n";
}
