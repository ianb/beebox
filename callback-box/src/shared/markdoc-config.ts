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
 *    came from and (optionally) how it was derived. Required `ref`
 *    (which feeds Track 4's body ref-tracking automatically). Optional
 *    `as` — natural-language description of the derivation
 *    ("verbatim", "summary", "inferred from the address", …). Inline/
 *    block split same as `quote`.
 *  - `purpose` / `key-person` / `correction` / `property` /
 *    `project-phase` — briefing vocabulary. Each replaces a YAML
 *    frontmatter field that briefings used to carry as structured
 *    data; now they're authored as body tags. Each rendered both by
 *    the frontend React renderer (per-tag component) and by the
 *    backend `compileBriefing` emitter that produces the markdown
 *    embedded in CLAUDE.md.
 *  - `ingredient` / `step` / `yield` / `substitution` / `subrecipe` /
 *    `recipe-section` — recipe vocabulary. Replaces the old XML
 *    `<ing>`, `<step>`, etc. shape with body Markdoc tags. The
 *    `ingredient` tag works inline (within a step's prose) or block
 *    (as a list item) — the recipe view's scaling logic reads the
 *    `amount` attribute.
 *  - `task` — internal: GFM task-list checkbox. Not authored directly;
 *    the `item` node transform below detects leading `[ ]` / `[x]` in a
 *    list item's first text run and rewrites it to a `Task` tag, since
 *    Markdoc's CommonMark base doesn't handle GFM task lists itself and
 *    has no plugin surface for adding them.
 *
 * Add new tags here. Use Markdoc's `attributes` schema for typed/validated
 * attributes — `Markdoc.validate(ast, config)` then catches misuse at parse
 * time, which is what `cb validate` calls into.
 */

import { Tag, nodes as baseNodes, type Config, type RenderableTreeNode, type Schema } from "@markdoc/markdoc";

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
    ref: { type: String, required: true },
    as: { type: String },
  },
  transform(node, config) {
    // Markdoc-side attribute is `ref` (which is also what Track 4's body
    // ref-tracking walks for and what the cardworks frontmatter convention
    // uses). React reserves `ref` as a special prop on components, so we
    // rename to `sourceRef` in the renderable tree — the React component
    // only ever sees the non-reserved name.
    const { ref, ...rest } = node.transformAttributes(config) as { ref?: string };
    const renamed = ref === undefined ? rest : { ...rest, sourceRef: ref };
    const children = node.transformChildren(config);
    return new Tag(node.inline ? "SourceInline" : "SourceBlock", renamed, children);
  },
};

/**
 * Briefing vocabulary. Each tag replaces a former YAML frontmatter
 * field; all are block-shaped (paragraph-or-larger constructs; inline
 * variants aren't meaningful for them). The backend `compileBriefing`
 * emitter walks the parsed body and emits a "**Label:** …" markdown
 * shape — the same shape the old structured compiler produced.
 */

const purpose: Schema = {
  transform(node, config) {
    return new Tag("Purpose", node.transformAttributes(config), node.transformChildren(config));
  },
};

const keyPerson: Schema = {
  attributes: {
    ref: { type: String },
    called: { type: String },
    role: { type: String },
  },
  transform(node, config) {
    // `ref` → `sourceRef` rename for React's reserved-prop rule (same
    // pattern as `source`).
    const { ref, ...rest } = node.transformAttributes(config) as { ref?: string };
    const renamed = ref === undefined ? rest : { ...rest, sourceRef: ref };
    return new Tag("KeyPerson", renamed, node.transformChildren(config));
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

const property: Schema = {
  attributes: {
    name: { type: String },
    address: { type: String },
    "address-uncertain": { type: Boolean, default: false },
  },
  transform(node, config) {
    // dash-case attribute → camelCase for React.
    const { "address-uncertain": addressUncertain, ...rest } =
      node.transformAttributes(config) as { "address-uncertain"?: boolean };
    const renamed = addressUncertain === undefined
      ? rest
      : { ...rest, addressUncertain };
    return new Tag("Property", renamed, node.transformChildren(config));
  },
};

const projectPhase: Schema = {
  attributes: {
    date: { type: String },
  },
  transform(node, config) {
    return new Tag("ProjectPhase", node.transformAttributes(config), node.transformChildren(config));
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
    const { for: forAttr, ...rest } = node.transformAttributes(config) as { for?: string };
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
    const { ref, ...rest } = node.transformAttributes(config) as { ref?: string };
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

const task: Schema = {
  selfClosing: true,
  attributes: {
    done: { type: Boolean, default: false },
  },
  transform(node, config) {
    return new Tag("Task", node.transformAttributes(config), []);
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
    "key-person": keyPerson,
    correction,
    property,
    "project-phase": projectPhase,
    ingredient,
    step,
    yield: recipeYield,
    substitution,
    subrecipe,
    "recipe-section": recipeSection,
    task,
  },
  nodes: { item },
};
