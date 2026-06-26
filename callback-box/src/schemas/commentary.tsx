/**
 * Commentary card schema — review-and-comment on a host card from inside a box.
 * See `docs/plans/box-commentary-surface.md` and `docs/plans/extfile-card.md`.
 *
 * **Attach-only:** a commentary card lives in a host card's `.attach/` scope and
 * its bare `{% source %}` anchors target the containing card — an `extfile`
 * (live external file), a `webpage` (captured page), or an in-box `doc`. It
 * carries no target of its own (no `defaultHref`/`defaultRef`/`targets`).
 *
 * Body-bearing (like `doc`/`briefing`): the body is markdown commentary whose
 * `{% source %}` anchors quote the spans being commented on. Markdoc validation
 * of those tags is the schema's `validate` hook (see `commentaryErrors` below),
 * scoped to this card type.
 */

import Markdoc, { type Node as MarkdocNode } from "@markdoc/markdoc";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { body, cardSchema, type CardSchema, type LintIssue } from "../cards/index.js";
import { markdocConfig } from "../shared/markdoc-config.js";

// Value named imports (`{ parse, validate }`) don't resolve from this CommonJS
// module under Node's ESM loader (used by tsx / the doctest runner). Destructure
// off the default import — same pattern as `markdoc-config.ts` / `card-lint.ts`.
const { parse: markdocParse, validate: markdocValidate } = Markdoc;

/**
 * Validation Zod can't express for commentary cards: Markdoc validation of the
 * body's tags (which fires the `{% source %}` ref-xor-href rule — nothing else
 * runs `Markdoc.validate`, so this is where it lands).
 *
 * Wired onto the schema as its `validate` hook (the host's lint dispatch in
 * card-lint.ts invokes it); it is self-contained — it reads only this card's
 * own body.
 *
 * Commentary is attach-only — it carries no target field of its own. A leftover
 * `defaultHref`/`defaultRef`/`targets` from the pre-attach era is caught by the
 * generic unknown-key warning (the fields are no longer in the schema).
 */
function commentaryErrors(body: string): LintIssue[] {
  const errors: LintIssue[] = [];
  for (const message of validateMarkdocBody(body)) {
    errors.push({ type: "validation", severity: "error", message });
  }
  return errors;
}

function validateMarkdocBody(body: string): string[] {
  if (body === "") return [];
  let ast: MarkdocNode;
  try {
    ast = markdocParse(body);
  } catch (_e) {
    return ["commentary body is not parseable Markdoc"];
  }
  return markdocValidate(ast, markdocConfig)
    .filter((entry) => entry.error.level === "error" || entry.error.level === "critical")
    .map((entry) => entry.error.message);
}

export const CommentarySchema: CardSchema = cardSchema("commentary", {
  validate: ({ fields }) => {
    const body = fields["body"];
    return commentaryErrors(typeof body === "string" ? body : "");
  },
  fields: {
    title: z.string().optional(),
    // Captured-web-page metadata (set by the clerk capture flow): the original
    // page URL, the capture date (YYYY-MM-DD), and an in-box ref to the frozen
    // snapshot. Rendered as a header; all optional. `frozen` is a card ref —
    // stored under a `ref` key like every other card reference.
    source: z.string().optional(),
    captured: z.string().optional(),
    frozen: z.object({ ref: z.string() }).optional(),
    body: body(z.string()),
  },
  instructions: `# Commentary Cards

A commentary card holds the boxholder's anchored remarks about a **host card**.
It is **attach-only**: it lives in the host's \`.attach/\` scope
(\`<host-basename>.attach/<name>.commentary.card\`) and the host's view surfaces
the remarks inline. The host is whatever the commentary annotates:

- an **\`extfile\`** card — to comment on a live external file (repo docs/source,
  across worktrees). This is the way to review an out-of-box file: make an
  \`extfile\` pointer, then attach the commentary to it.
- a **\`webpage\`** card — to comment on a captured page.
- an in-box **\`doc\`** — to comment on a box document.

A commentary card carries **no target of its own** — no \`defaultHref\`,
\`defaultRef\`, or \`targets\`. The containing host card *is* the target, and bare
\`{% source %}\` anchors point at it.

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
- Target: leave the anchor **ref-free** — a bare \`{% source %}\` points at the
  containing host card (the \`extfile\`/\`webpage\`/\`doc\` this commentary is
  attached to). Add an explicit \`ref\`/\`href\` only in the rare case the
  selection was against a *different* card. Always write \`version\` markers
  measured from the file (\`sha256:\` content hash, plus \`git:\` when tracked).
- Copy \`pos\` (and \`placement\`, if present) from the selection.

Your own framing stays *outside* the tag, as prose. One commentary card per
host.`,
});

/**
 * Build an empty commentary card to live inside a host document's attach scope
 * (e.g. a `.webpage.card`'s `<basename>.attach/`). It carries no default target
 * — the *containing* document is the default, so bare `{% source %}` anchors
 * point at it. The body starts empty; the boxholder (and chat agent) add
 * `{% source %}` commentary afterward. Capture provenance lives on the host
 * webpage card, not here.
 */
export function createCommentaryTemplate(options: { title?: string | undefined }): string {
  const hasTitle = options.title !== undefined && options.title !== "";
  const yamlText = hasTitle ? stringifyYaml({ title: options.title }) : "";
  return `---\n${yamlText}---\n`;
}
