/**
 * Commentary card schema — review-and-comment over one or more *external*
 * files (repo docs/source, across worktrees, or a web page) from inside a box.
 * See `docs/plans/box-commentary-surface.md`.
 *
 * Body-bearing (like `doc`/`briefing`): the body is markdown commentary whose
 * `{% source %}` anchors point into the wrapped target(s). Frontmatter declares
 * the render canvas — a default target (`defaultHref` xor `defaultRef`) plus an
 * optional `targets` list for side-by-side compare.
 *
 * Validation that cardworks/Zod can't express (the defaultHref-xor-defaultRef
 * rule, and Markdoc validation of the body's `{% source %}` tags) lives in
 * `card-lint.ts`, scoped to this card type.
 */

import { body, cardSchema, type CardSchema } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const CommentarySchema: CardSchema = cardSchema("commentary", {
  fields: {
    title: z.string().optional(),
    // The default target the body's anchors point at. Exactly one of these is
    // required (enforced in card-lint). `defaultHref` is an external full URL
    // (file:, http(s):) — untracked by `cb mv`; `defaultRef` is an in-box,
    // box-relative path.
    defaultHref: z.string().optional(),
    defaultRef: z.string().optional(),
    // Additional external targets to render side-by-side for compare (each a
    // full URL). The default target is always rendered; these are extras.
    targets: z.array(z.string()).optional(),
    body: body(z.string()),
  },
  instructions: `# Commentary Cards

A commentary card lets the boxholder review and comment on files that live
**outside** the box — repo docs and source (including the same file across git
worktrees) and web pages. The wrapped file is rendered live; you turn the
boxholder's selections into durable, anchored commentary.

## Frontmatter

- \`defaultHref\` **xor** \`defaultRef\` — the default target every body anchor
  points at unless it says otherwise. \`defaultHref\` is an external full URL
  (\`file:/abs/path\`, or \`http(s):\`); \`defaultRef\` is an in-box path. Exactly
  one; not both.
- \`targets\` — optional list of additional external URLs to render alongside
  the default (for comparing the same file across worktrees, say).
- \`title\` — optional human label.

## Body — quote-then-remark

Each comment is a \`{% source %}\` anchor (the span being commented on) followed
by your remark as ordinary prose:

\`\`\`
{% source pos="body; heading: Track A (#track-a); ~line 210"
          version="sha256:9f3a1c2b git:7ffeae4" %}
{% quote %}the exact span the user selected{% /quote %}
{% /source %}

This overstates it — placement is composer-only, so it isn't a clean superset.
\`\`\`

The \`{% source %}\` (with inner \`{% quote %}\`) holds the **selected span,
verbatim**. Your comment is the prose *after* it, outside the tag.

## Turning a \`<user-selection>\` into an anchor

When the boxholder selects text in a rendered target and sends it (a
\`<user-selection ref|href="…" pos="…">…</user-selection>\` in their message),
append a \`{% source %}\` block:

- **Body** = the selected span, **escaped to valid Markdown/Markdoc** —
  code-wrap \`<…>\`, escape a stray \` \`\` \`, \`{%\`, or \`%}\` so a span that
  contains markup neither breaks the tag nor renders wrong. This is faithful
  rendering of what was shown, not paraphrase.
- Write an **explicit** target and \`version\` on *every* anchor (never rely on
  inheritance): the card's default target unless the selection was against a
  different one, and the \`version\` markers measured from the file
  (\`sha256:\` content hash, plus \`git:\` when tracked).
- Copy \`pos\` (and \`placement\`, if present) from the selection.
- A source carries \`href\` (external) **xor** \`ref\` (in-box), never both.

Your own framing stays *outside* the tag, as prose. One commentary card per
coherent set of targets.`,
});

/**
 * Build a commentary card that wraps an *in-box* target (`defaultRef`) — the
 * shape produced by the web-page-commentary capture flow, where the readable
 * rendering is stored in the card's `.attach/` and the frozen page sits beside
 * it. The body is seeded with a link to the original source; the boxholder
 * (and chat agent) add `{% source %}` commentary afterward.
 *
 * `sourceUrl` is the live page the capture came from; it becomes the
 * "link to original" line in the body (commentary has no source frontmatter
 * field — see docs/plans/web-page-commentary.md Q2).
 */
export function createCommentaryTemplate(options: {
  title: string;
  defaultRef: string;
  sourceUrl: string;
  capturedAt: string;
}): string {
  const fields: Record<string, unknown> = {
    title: options.title,
    defaultRef: options.defaultRef,
  };
  const yamlText = stringifyYaml(fields);
  const body = `[Original page](${options.sourceUrl}) · captured ${options.capturedAt}\n`;
  return `---\n${yamlText}---\n${body}`;
}
