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
import { cardSchema, body, type CardSchema, type LintIssue } from "../cards/index.js";
import { NAMED_VIEW_NAMES, NAMED_VIEWS, namedViewFor } from "../shared/named-views.js";

const nameList = NAMED_VIEW_NAMES.join(", ");
const validNames = new Set(NAMED_VIEW_NAMES);

const viewFields = {
  view: z.string().refine((v) => validNames.has(v), {
    message: `view must be one of: ${nameList}`,
  }),
  params: z.record(z.string(), z.unknown()).optional(),
  body: body(z.string()),
};

/**
 * Cross-field check Zod can't express per-field: `params` must match the
 * named view's declared param schema (src/shared/named-views.ts), and a
 * paramless view must not be given params. Skipped when `view` itself is
 * invalid — the field error already covers that.
 */
function validateViewParams({ fields }: { fields: Record<string, unknown> }): LintIssue[] {
  const params = fields["params"];
  if (params === undefined) return [];
  const view = typeof fields["view"] === "string" ? fields["view"] : "";
  const entry = namedViewFor(view);
  if (entry === undefined) return [];
  if (entry.params === undefined) {
    return [
      {
        type: "validation",
        severity: "error",
        message: `view "${view}" takes no params`,
      },
    ];
  }
  const parsed = entry.params.safeParse(params);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => ({
    type: "validation" as const,
    severity: "error" as const,
    message: `params${i.path.length > 0 ? `.${i.path.join(".")}` : ""}: ${i.message}`,
  }));
}

export const ViewSchema: CardSchema = cardSchema("view", {
  fields: viewFields,
  searchable: false,
  validate: validateViewParams,
  instructions: `# View Cards

A view card makes an interface surface addressable: a card whose \`view\` field names a builtin view, rendered in place of the card. Link it, embed it, or pin it into \`nav.card\` with a \`ref\` entry like any other card. Give it a \`title\` — that's the label refs fall back to.

\`\`\`yaml
title: Feedback commits
view: history
params:
  feedback: true
\`\`\`

Available views:
${NAMED_VIEWS.map((v) => `- \`${v.name}\` — ${v.description}`).join("\n")}

\`params\` configures the view (only \`history\` takes params today: \`connectors\`/\`workflows\` string lists, \`touchpoint\`/\`feedback\` booleans, \`session\` string). A history card with params IS a saved filter — a stable, linkable slice of the timeline.

The markdown body is a notes margin (rationale, observations, ideas about this surface) — it shows in source view, not in the rendered surface.`,
});
