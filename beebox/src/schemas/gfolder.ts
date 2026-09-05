/**
 * Gfolder card schema — a mirrored Google Drive folder.
 *
 * Landmark-shaped: the card lives *inside* the directory it describes
 * (`_content/drive/recipes/Recipes.gfolder.card`), the same convention as
 * `.landmark.card`. That is deliberate — the card's directory IS the mount, so
 * moving the card is how the mount is re-homed, and trashing it is how the
 * folder is unmounted.
 *
 * Pure frontmatter, all of it connector-stamped. Membership is one-way
 * (Drive → box): Docs and Sheets in the Drive folder become synced cards in
 * this directory, subfolders become subdirectories with their own
 * `.gfolder.card`, and everything else becomes a `.glink.card` pointer.
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { cardSchema, type InferCardFields } from "../cards/index.js";

export const GfolderSchema = cardSchema("gfolder", {
  description: "A Google Drive folder mirrored by the drive connector — the directory the card sits in is the mount",
  category: "synced",
  fields: {
    "drive-id": z.string(),
    // Stamped on the first successful sync; a hand-authored mount card may
    // carry only `drive-id` until then.
    name: z.string().optional(),
    link: z.string().optional(),
    status: z.enum(["ok", "error"]).optional(),
    "last-sync": z.string().optional(),
    error: z.string().optional(),
    // Children the last pass could not account for. Omitted when zero, so a
    // healthy mount carries neither.
    "not-in-folder": z.number().optional(),
    unknown: z.number().optional(),
  },
  instructions: `# Gfolder Cards

A \`.gfolder.card\` **mirrors a Google Drive folder into the directory the
card sits in**. It lives inside that directory, like a landmark:

\`\`\`
_content/drive/recipes/Recipes.gfolder.card     # the mount
_content/drive/recipes/Sourdough.gdoc.card      # a Doc child, synced
_content/drive/recipes/Scan_2024.glink.card     # a PDF child, pointed at
_content/drive/recipes/desserts/Desserts.gfolder.card   # a subfolder, mirrored
\`\`\`

## The directory is the mount

There is no config file and no mount table — the card's own location is the
configuration. Move the card into another directory with \`bbx mv\` and the next
sync mirrors the Drive folder **there**; the children left behind stay on disk
as ordinary synced cards and pointers. Move the whole *directory* and the mount
travels with its children, which is usually what you want.

## Unmounting

\`bbx rm <dir>/<name>.gfolder.card\` unmounts: discovery stops, and every child
**stays exactly where it is** — synced files keep syncing on their own cards,
pointers keep pointing. Nothing is deleted. (The trashed card also acts as a
tombstone, so a parent mirror will not re-create the mount.)

## What the mirror promises

Membership follows Drive one-way, on each sync:

- A Google Doc or Sheet child becomes a \`.gdoc.card\` / \`.gsheet.card\` here,
  content synced two-way as usual.
- A subfolder becomes a subdirectory with its own \`.gfolder.card\`, mirrored
  the same way (bounded: 8 levels deep, 500 folders per sync).
- Anything else — a PDF, a Slides deck, an image — becomes a
  \`.glink.card\` pointer. Nothing is copied; read the pointer for what it is
  and where.
- A shortcut is followed: the card describes the shortcut's target.
- A child **trashed on Drive** has its card moved to \`_bookkeeping/trash/\`.
- A child **moved out** of the Drive folder (or one this box lost access to)
  is left alone and keeps syncing; the sync reports it as \`not-in-folder\`
  rather than guessing.

## Frontmatter

Connector-managed — do not hand-edit. \`name\` and \`link\` are re-stamped from
Drive on every sync, and \`status\` / \`last-sync\` / \`error\` record the last
outcome (\`error\` is present only when \`status: error\`). \`not-in-folder\` and
\`unknown\` count children still on disk that the last pass could not account
for — the two cases described above — and are absent when there are none. The one field worth
setting yourself is \`drive-id\`, when you are creating a mount by hand;
prefer \`bbx drive mount <folder-url> <dir>\`.

## Body

None. Purpose notes about a *pointer* go in that \`.glink.card\`'s body;
notes about the directory itself go in a \`.landmark.card\` beside this one.`,
});

export type GfolderFields = InferCardFields<typeof GfolderSchema>;

export function createGfolderTemplate(options: {
  driveId: string;
  name?: string | undefined;
  link?: string | undefined;
  status?: "ok" | "error" | undefined;
  lastSync?: string | undefined;
  error?: string | undefined;
}): string {
  const fields: Record<string, unknown> = { "drive-id": options.driveId };
  if (options.name !== undefined) fields["name"] = options.name;
  if (options.link !== undefined) fields["link"] = options.link;
  if (options.status !== undefined) fields["status"] = options.status;
  if (options.lastSync !== undefined) fields["last-sync"] = options.lastSync;
  if (options.error !== undefined) fields["error"] = options.error;
  return `---\n${stringifyYaml(fields)}---\n`;
}
