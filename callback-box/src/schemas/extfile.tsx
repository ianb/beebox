/**
 * Extfile card schema — an in-box pointer to a live external file.
 *
 * The snapshot-less sibling of `webpage`. A webpage card captures a page into
 * its body plus a frozen copy; an extfile card carries **no body and no copy** —
 * just a pointer (`href`, a `file:` URL) plus drift-detection metadata. The
 * renderer fetches the live file on each render and defers to whatever renderer
 * the registry picks for that file's type. Commentary about the file lives in
 * the card's `.attach/` scope (bare `{% source %}` anchors target the live file).
 *
 * `version`/`size`/`mtime` are stamped by `cb extfile sync` (never hand-edited,
 * never silently auto-refreshed): the stored `version` hash compared against the
 * live file's hash is the drift signal.
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { cardSchema, type CardSchema, type LintIssue } from "../cards/index.js";

/**
 * Cross-field validation for extfile cards that Zod can't express: `href` must
 * be a parseable `file:` URL (the schema only types it as a string), and a
 * present `version` must carry a well-formed `sha256:<hex>` marker (it is
 * compared byte-for-byte against the live file's hash, so a malformed one would
 * never match). Whether the href *resolves* on this machine is deliberately not
 * checked here — that's machine-specific and the renderer/`cb extfile sync`
 * report it at use time.
 *
 * Wired onto the schema as its `validate` hook (cardworks invokes it during
 * lint); it is self-contained — it reads only this card's own parsed fields.
 */
function extfileErrors(fields: Record<string, unknown>): LintIssue[] {
  const errors: LintIssue[] = [];
  const href = fields["href"];
  // A missing href is already a schema (Zod) error from parseCardText; here we
  // only refine a present href's shape.
  if (typeof href === "string" && href !== "" && !isFileUrl(href)) {
    errors.push({
      type: "validation",
      severity: "error",
      message: `extfile href must be a file: URL (got "${href}")`,
    });
  }
  const version = fields["version"];
  if (typeof version === "string" && version !== "" && !hasSha256Marker(version)) {
    errors.push({
      type: "validation",
      severity: "error",
      message: `extfile version must contain a sha256:<hex> marker (got "${version}")`,
    });
  }
  return errors;
}

function isFileUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "file:";
  } catch (_e) {
    return false;
  }
}

/** A space-separated marker set containing at least one `sha256:<hex>` token. */
function hasSha256Marker(version: string): boolean {
  return version.split(/\s+/).some((marker) => /^sha256:[\da-f]+$/.test(marker));
}

export const ExtfileSchema: CardSchema = cardSchema("extfile", {
  description: "An in-box pointer to a live external file (file: URL, no snapshot) with drift-detection stamps; host for review commentary",
  category: "synced",
  validate: ({ fields }) => extfileErrors(fields),
  fields: {
    // Full external URL of the pointed-to file, e.g.
    // `file:/Users/me/src/project/src/foo.ts`. A `file:` URL, gated by the
    // box's `externalRoots` allowlist; untracked by `cb mv` (it's external).
    href: z.string(),
    // Drift metadata, stamped by `cb extfile sync`. `version` is the
    // `buildVersionMarkers` output (`sha256:<hex> git:<rev>`); its `sha256:`
    // part is the drift primary. `size`/`mtime` are informational, re-stamped
    // only when the content hash changes. All optional — a freshly authored
    // card is unstamped until its first sync.
    version: z.string().optional(),
    size: z.number().optional(),
    mtime: z.string().optional(),
  },
  instructions: `# Extfile Cards

An extfile card is an **in-box pointer to a live external file** — like a
\`webpage\` card stands in for a web page, but with no snapshot: no body, no
frozen copy, no extracted text. The view fetches the file fresh each render and
shows it through the renderer for its type (\`.md\` → markdown, \`.ts\`/source →
plaintext, …).

## Frontmatter

- \`href:\` — required. The full \`file:\` URL of the external file, e.g.
  \`file:/Users/you/src/project/src/foo.ts\`. The path must resolve under one of
  the box's \`externalRoots\` (\`config/box.json\`). Use a single-slash \`file:/abs\`
  form. Untracked by \`cb mv\` (it points outside the box).
- \`version:\` / \`size:\` / \`mtime:\` — **stamped metadata; do not hand-edit.**
  \`version\` is \`sha256:<hex> git:<rev>\`; its \`sha256\` is what drift detection
  compares against the live file. Stamp them with \`cb extfile sync <path>\` —
  never edit them by hand, and they are never auto-refreshed (a silent refresh
  would erase the drift signal that is the whole point).

## Body

None. An extfile card is a pointer, not a document — leave the body empty. The
live file is the content; if you want a stored copy, use a \`webpage\` card
instead.

## Commentary

Remarks about the file are **not** in this card. They live in a
\`.commentary.card\` inside this card's attach scope (\`<basename>.attach/\`), and
the extfile view surfaces them inline. A bare \`{% source %}\` anchor (no
\`ref\`/\`href\`) points at *this* card's live file — the pointer is the default
target.

## Layout on disk

\`\`\`
box/reviews/Foo_Source.extfile.card                  # the pointer + stamped metadata
box/reviews/Foo_Source.attach/Foo_Source.commentary.card   # remarks (optional)
\`\`\``,
});

export interface ExtfileFields {
  type: "extfile";
  href: string;
  title?: string;
  version?: string;
  size?: number;
  mtime?: string;
}

export function createExtfileTemplate(options: { href: string; title?: string | undefined }): string {
  const fields: Record<string, unknown> = { href: options.href };
  if (options.title !== undefined && options.title !== "") {
    fields["title"] = options.title;
  }
  return `---\n${stringifyYaml(fields)}---\n`;
}
