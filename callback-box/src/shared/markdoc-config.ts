/**
 * Markdoc parser config shared between the frontend React renderer and
 * any backend Markdoc consumer (currently `body-refs.ts`'s body walker;
 * eventually Track 2's `compileBriefing` AST → markdown emitter).
 *
 * **Pure TypeScript only.** No React, no `fs`/Node-only APIs, no DOM
 * imports. Both tsconfigs (`tsconfig.json` for backend, `src/frontend/
 * tsconfig.json` for frontend) include this directory. The
 * frontend imports via the `@shared/*` path alias; backend uses
 * relative paths.
 *
 * Markdoc replaces the previous react-markdown + remark/rehype stack. All
 * markdown bodies in the box render through this config: doc cards, memos,
 * chat narration, recipe notes, commit bodies — everything that previously
 * went through react-markdown.
 *
 * Tag library so far:
 *  - `quote` — direct quote from a person (verbatim words). Inline if the
 *    tag body has no newlines, block otherwise. The tag transforms into
 *    either `QuoteInline` or `QuoteBlock` based on `node.inline`, so the
 *    React component for each shape can be specialized.
 *  - `source` — universal provenance tag: where the wrapped content
 *    came from and (optionally) how it was derived. At most one of
 *    `ref` (in-box, feeds body ref-tracking automatically) / `href`
 *    (external URL); neither means the containing document. Optional
 *    `usage` — natural-language description of the derivation
 *    ("verbatim", "summary", "inferred from the address", …). Inline/
 *    block split same as `quote`.
 *  - `purpose` / `correction` — briefing vocabulary. Each replaces a
 *    YAML frontmatter field that briefings used to carry as structured
 *    data; now they're authored as body tags. Each rendered both by
 *    the frontend React renderer (per-tag component) and by the
 *    backend `compileBriefing` emitter that produces the markdown
 *    embedded in CLAUDE.md. (`key-people` and `properties` stayed
 *    frontmatter — there are no tags for them.)
 *  - `image` / `silence` — capture-session timeline vocabulary, emitted
 *    by the capture preparation worker into a session card's generated
 *    body: `image` refs a child image card in the session's attach
 *    scope, `silence` marks a gap of 10+ seconds.
 *  - `ingredient` / `step` / `yield` / `substitution` / `subrecipe` /
 *    `recipe-section` — recipe vocabulary. Replaces the old XML
 *    `<ing>`, `<step>`, etc. shape with body Markdoc tags. The
 *    `ingredient` tag works inline (within a step's prose) or block
 *    (as a list item) — the recipe view's scaling logic reads the
 *    `amount` attribute.
 *  - `redacted` — agent-authored spoiler/reveal. Inline or block (same
 *    `node.inline` split as `quote`). Rendered as blurred text behind an
 *    animated noise overlay; click/tap reveals. Agent-only — there's no
 *    boxholder affordance for typing it.
 *  - `task` — internal: GFM task-list checkbox. Not authored directly;
 *    the `item` node transform below detects leading `[ ]` / `[x]` in a
 *    list item's first text run and rewrites it to a `Task` tag, since
 *    Markdoc's CommonMark base doesn't handle GFM task lists itself and
 *    has no plugin surface for adding them.
 *  - `todo` — universal capture-in-place annotation (`docs/plans/
 *    todo-annotation.md`). Wrapper, inline or block via the `quote`
 *    precedent. All attributes optional; `status` is the closed
 *    `TODO_STATUSES` enum from `todo-model.ts` (absence = `open`). The
 *    `validate()` rule enforces date shape (`created`/`due`/`start`),
 *    the relative-`start`-requires-`due` and `start`-after-`due` rules,
 *    and `created` required when `by="agent"` — all delegated to the
 *    shared `todo-model.ts` so the rules live in one place.
 *  - `see-also` — nests inside `todo`, points at supporting context.
 *    Exactly one of `ref` / `href` is required (stricter than `source`'s
 *    at-most-one — a target-less see-also is meaningless). Same
 *    `ref` → `sourceRef` rename as `source`. Renders footnote-style
 *    regardless of inline/block, so the transform emits a single
 *    `SeeAlso` tag rather than an Inline/Block split.
 *
 * Add new tags here. Use Markdoc's `attributes` schema for typed/validated
 * attributes — `Markdoc.validate(ast, config)` then catches misuse at parse
 * time, which is what `cb validate` calls into.
 */

import Markdoc from "@markdoc/markdoc";
import type { Config, Node, RenderableTreeNode, Schema } from "@markdoc/markdoc";
import { validateSourceAttributes } from "./source-model.js";
import { TODO_STATUSES, validateTodoAttributes } from "./todo-model.js";

// Value named imports (`{ Tag, nodes }`) don't resolve from this CommonJS
// module under Node's ESM loader (used by the doctest runner); the frontend
// bundler tolerates them but the backend/test path does not. Destructure off
// the default import instead — same pattern, and same lint exception, as
// `body-refs.ts` / `markdoc/emit.ts`.
// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { Tag, nodes: baseNodes } = Markdoc;

/**
 * Slug for a heading's `id` anchor: lowercase, runs of non-alphanumerics
 * collapsed to a single `-`, leading/trailing `-` trimmed. Empty input (a
 * heading with no word characters — e.g. just an emoji) yields `""`; the
 * caller substitutes a fallback.
 */
function slugifyHeading(text: string): string {
  return text.toLowerCase().replace(/[^\da-z]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Concatenated plain text of a heading node's inline children (text + inline code). */
function headingText(node: Node): string {
  let out = "";
  for (const child of node.walk()) {
    if (child.type !== "text" && child.type !== "code") continue;
    const content: unknown = child.attributes["content"];
    if (typeof content === "string") out += content;
  }
  return out;
}

/**
 * Heading node with a stable `id` anchor (slug of the heading text) and a
 * `data-line` carrying the 1-indexed source line from `node.lines`. The id
 * gives rendered Markdown headings anchors (none by default) and is the most
 * stable signal the selection-commentary position locator anchors to.
 *
 * Returns a fresh schema per call so the duplicate-slug `seen` set is scoped
 * to a single transform pass — call it once per render config, not once
 * globally. Lives here (shared, pure) so it's testable via Markdoc's own
 * `renderers.html`; the React render config (`Markdown.tsx`) installs it.
 */
export function makeHeadingNode(): Schema {
  const seen = new Set<string>();
  return {
    children: ["inline"],
    attributes: { level: { type: Number, required: true, render: false } },
    transform(node, config) {
      const level = node.attributes["level"];
      const base = slugifyHeading(headingText(node));
      const slug = base === "" ? "section" : base;
      let id = slug;
      let n = 1;
      while (seen.has(id)) {
        id = `${slug}-${n}`;
        n += 1;
      }
      seen.add(id);
      const lines = node.lines;
      const startLine = Array.isArray(lines) && typeof lines[0] === "number" ? lines[0] : null;
      const children = node.transformChildren(config);
      if (startLine === null) {
        return new Tag(`h${level}`, { id }, children);
      }
      return new Tag(`h${level}`, { id, "data-line": String(startLine + 1) }, children);
    },
  };
}

const quote: Schema = {
  attributes: {
    from: { type: String },
  },
  transform(node, config) {
    const attributes = node.transformAttributes(config);
    const children = node.transformChildren(config);
    return new Tag(node.inline ? "QuoteInline" : "QuoteBlock", attributes, children);
  },
};

const source: Schema = {
  attributes: {
    // In-box target (a ref path — leading `/` from the box root, or
    // `attach/…` for this card's own attach scope; `cb mv`-tracked) or
    // external target (`href`, a full URL — untracked). At most one; the
    // `validate` below
    // enforces it. Neither is allowed: a bare `{% source %}` targets the
    // **containing document** (the card that owns this body's attach scope) —
    // the ref-free default for commentary attached to the page it annotates.
    ref: { type: String },
    href: { type: String },
    // Date an external href was checked, in ISO date-only form. Optional so
    // existing source tags remain valid; meaningful for external sources whose
    // contents can change after the citation is written.
    retrieved: { type: String },
    // `usage` — free-form: the way the source material was used to produce the
    // wrapped content ("verbatim", "summary of the third section", "inferred
    // from her email signature", …).
    usage: { type: String },
    // Anchoring metadata for commentary use: where in the target (`pos`, the
    // freeform locator from selection-position.ts), which file state it was
    // anchored against (`version`, space-separated `kind:value` markers — a
    // sha256 content hash as the drift primary, optionally a git rev for
    // diffing), and whether `pos` was estimated (`placement`).
    pos: { type: String },
    version: { type: String },
    placement: { type: String },
  },
  validate(node) {
    return validateSourceAttributes(node.attributes);
  },
  transform(node, config) {
    // Markdoc-side attribute is `ref` (which is also what Track 4's body
    // ref-tracking walks for and what the cardworks frontmatter convention
    // uses). React reserves `ref` as a special prop on components, so we
    // rename to `sourceRef` in the renderable tree — the React component
    // only ever sees the non-reserved name.
    const { ref, ...rest }: { ref?: string; [key: string]: unknown } = node.transformAttributes(config);
    const renamed = ref === undefined ? rest : { ...rest, sourceRef: ref };
    const children = node.transformChildren(config);
    return new Tag(node.inline ? "SourceInline" : "SourceBlock", renamed, children);
  },
};

/**
 * Briefing body vocabulary: `purpose` and `correction` — the free-text
 * material. Both are block-shaped (paragraph-or-larger; inline variants
 * aren't meaningful). The structured records (key-people, properties) live
 * in briefing frontmatter, not as body tags. The backend `compileBriefing`
 * emitter walks the parsed body and emits a "**Label:** …" markdown shape.
 */

const purpose: Schema = {
  transform(node, config) {
    return new Tag("Purpose", node.transformAttributes(config), node.transformChildren(config));
  },
};

const correction: Schema = {
  attributes: {
    test: { type: String },
  },
  transform(node, config) {
    return new Tag("Correction", node.transformAttributes(config), node.transformChildren(config));
  },
};

/**
 * Recipe vocabulary. Replaces the legacy XML recipe schema's
 * `<ing>`, `<step>`, etc. — recipes are now frontmatter+body cards
 * whose body is Markdoc-annotated prose.
 */

const ingredient: Schema = {
  attributes: {
    amount: { type: String },
    unit: { type: String },
  },
  transform(node, config) {
    const attrs = node.transformAttributes(config);
    return new Tag(
      node.inline ? "IngredientInline" : "IngredientBlock",
      attrs,
      node.transformChildren(config),
    );
  },
};

const step: Schema = {
  transform(node, config) {
    return new Tag("Step", node.transformAttributes(config), node.transformChildren(config));
  },
};

const recipeYield: Schema = {
  attributes: {
    amount: { type: String },
  },
  transform(node, config) {
    return new Tag("RecipeYield", node.transformAttributes(config), node.transformChildren(config));
  },
};

const substitution: Schema = {
  attributes: {
    for: { type: String },
  },
  transform(node, config) {
    // `for` is also a reserved-ish prop in some React contexts (label's
    // `htmlFor`); rename to `forIngredient` to keep the React side clean.
    const { for: forAttr, ...rest }: { for?: string; [key: string]: unknown } = node.transformAttributes(config);
    const renamed = forAttr === undefined ? rest : { ...rest, forIngredient: forAttr };
    return new Tag("Substitution", renamed, node.transformChildren(config));
  },
};

const subrecipe: Schema = {
  attributes: {
    ref: { type: String, required: true },
  },
  transform(node, config) {
    // Same `ref` → `sourceRef` rename as `source` / `key-person`.
    const { ref, ...rest }: { ref?: string; [key: string]: unknown } = node.transformAttributes(config);
    const renamed = ref === undefined ? rest : { ...rest, sourceRef: ref };
    return new Tag("Subrecipe", renamed, node.transformChildren(config));
  },
};

const recipeSection: Schema = {
  attributes: {
    name: { type: String },
  },
  transform(node, config) {
    return new Tag("RecipeSection", node.transformAttributes(config), node.transformChildren(config));
  },
};

const redacted: Schema = {
  transform(node, config) {
    return new Tag(
      node.inline ? "RedactedInline" : "RedactedBlock",
      node.transformAttributes(config),
      node.transformChildren(config),
    );
  },
};

const task: Schema = {
  selfClosing: true,
  attributes: {
    done: { type: Boolean, default: false },
  },
  transform(node, config) {
    return new Tag("Task", node.transformAttributes(config), []);
  },
};

// Capture-session transcript markers. `{% image %}` points at a child image
// card (description/filename come from that card); `{% silence %}` marks a gap.
const captureImage: Schema = {
  selfClosing: true,
  attributes: {
    ref: { type: String, required: true },
  },
  transform(node, config) {
    // `ref` → `sourceRef` rename (React reserves `ref`), as with `source`.
    const { ref, ...rest }: { ref?: string; [key: string]: unknown } = node.transformAttributes(config);
    const renamed = ref === undefined ? rest : { ...rest, sourceRef: ref };
    return new Tag("CaptureImage", renamed, []);
  },
};

const silence: Schema = {
  selfClosing: true,
  attributes: {
    duration: { type: String, required: true },
  },
  transform(node, config) {
    return new Tag("Silence", node.transformAttributes(config), []);
  },
};

/** Narrow a raw Markdoc attribute value to `string | undefined` (never `""`-vs-absent ambiguity beyond what Markdoc itself gives us). */
function stringAttr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const todo: Schema = {
  attributes: {
    // Short human-scale slug for cross-reference (`see-also` elsewhere, an
    // agent naming it in chat). Uniqueness is enforced box-wide by the
    // collector (Track 3), not here — that's a cross-file property.
    id: { type: String },
    // Absence = "open" (the common case costs zero typing).
    status: { type: String, matches: [...TODO_STATUSES] },
    // Plain string; absence = the boxholder. `"agent"` marks agent work.
    assigned: { type: String },
    // Provenance; absence = boxholder-authored, `"agent"` = agent-authored.
    by: { type: String },
    created: { type: String },
    due: { type: String },
    start: { type: String },
  },
  validate(node) {
    const attrs = {
      by: stringAttr(node.attributes["by"]),
      created: stringAttr(node.attributes["created"]),
      due: stringAttr(node.attributes["due"]),
      start: stringAttr(node.attributes["start"]),
    };
    return validateTodoAttributes(attrs).map(({ id, message }) => ({
      id,
      level: "error" as const,
      message,
    }));
  },
  transform(node, config) {
    const attributes = node.transformAttributes(config);
    const children = node.transformChildren(config);
    return new Tag(node.inline ? "TodoInline" : "TodoBlock", attributes, children);
  },
};

const seeAlso: Schema = {
  attributes: {
    ref: { type: String },
    href: { type: String },
  },
  validate(node) {
    const ref = stringAttr(node.attributes["ref"]);
    const href = stringAttr(node.attributes["href"]);
    const hasRef = ref !== undefined && ref !== "";
    const hasHref = href !== undefined && href !== "";
    if (hasRef && hasHref) {
      return [
        {
          id: "see-also-ambiguous-target",
          level: "error",
          message: "{% see-also %} takes exactly one of `ref` or `href`, not both",
        },
      ];
    }
    if (!hasRef && !hasHref) {
      return [
        {
          id: "see-also-missing-target",
          level: "error",
          message: "{% see-also %} requires exactly one of `ref` or `href`",
        },
      ];
    }
    return [];
  },
  transform(node, config) {
    // `ref` → `sourceRef` rename, same as `source` (React reserves `ref`).
    // Always a single `SeeAlso` tag — the footnote-style rendering doesn't
    // depend on `node.inline`, unlike the `quote`/`source` inline/block split.
    const { ref, ...rest }: { ref?: string; [key: string]: unknown } = node.transformAttributes(config);
    const renamed = ref === undefined ? rest : { ...rest, sourceRef: ref };
    return new Tag("SeeAlso", renamed, node.transformChildren(config));
  },
};

/**
 * `item` node override that recognises GFM task-list markers. If the first
 * rendered child is a string starting with `[ ] ` / `[x] ` / `[X] `, that
 * prefix is stripped and a `Task` tag is prepended in its place. Runs after
 * the markdown-it tokenizer, so code-fence content is never mistaken for a
 * task item.
 */
const item: Schema = {
  ...baseNodes.item,
  transform(node, config) {
    const children = node.transformChildren(config);
    const rewritten = rewriteTaskPrefix(children);
    return new Tag("li", {}, rewritten);
  },
};

const TASK_PREFIX_RE = /^\[([ Xx])]\s+/;

function rewriteTaskPrefix(children: RenderableTreeNode[]): RenderableTreeNode[] {
  if (children.length === 0) return children;
  const first = children[0];
  if (typeof first !== "string") return children;
  const match = TASK_PREFIX_RE.exec(first);
  if (match === null) return children;
  const done = match[1] !== " ";
  const remainder = first.slice(match[0].length);
  const taskTag = new Tag("Task", { done }, []);
  const rest = children.slice(1);
  return remainder === "" ? [taskTag, ...rest] : [taskTag, remainder, ...rest];
}

export const markdocConfig: Config = {
  tags: {
    quote,
    source,
    purpose,
    correction,
    ingredient,
    step,
    yield: recipeYield,
    substitution,
    subrecipe,
    "recipe-section": recipeSection,
    redacted,
    task,
    image: captureImage,
    silence,
    todo,
    "see-also": seeAlso,
  },
  nodes: { item },
};
