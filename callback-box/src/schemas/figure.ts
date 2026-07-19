/**
 * Figure card schema — small, embeddable, parameterized interactives.
 *
 * A figure is an interactive graphic (a p5.js sketch, three.js scene, D3/SVG
 * graphic, or canvas-loop TEA sketch) embedded to demonstrate one thing. The
 * card's markdown body describes what the figure demonstrates; the runnable
 * source is a `.ts` file in the card's attach scope, pointed to by the
 * `entry` field. The frontend compiles that source with the existing esbuild
 * view compiler and mounts it through a per-runtime harness (p5 instance mode
 * into a `<div>`, canvas-loop's `mountSketch`, etc.).
 *
 * See docs/implemented-plans/figure-card-type.md and
 * docs/implemented-plans/canvas-loop-figure.md for the full design.
 */

import { body, cardSchema, renderFrontmatterBlock, type InferCardFields } from "../cards/index.js";
import { z } from "zod";

export const FigureRuntime = z.enum(["p5js", "three", "d3", "canvas-loop"]);
export type FigureRuntimeType = z.infer<typeof FigureRuntime>;

/** A declared embed parameter: supplied via the embed link's query string. */
const FigureParam = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const FigureSchema = cardSchema("figure", {
  description: "A small embeddable interactive graphic (p5.js/three.js/D3/canvas-loop) demonstrating one thing; source lives in the attach scope",
  category: "authored",
  fields: {
    runtime: FigureRuntime,
    entry: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
    params: z.array(FigureParam).optional(),
    body: body(z.string()),
  },
  instructions: `# Figure Cards

A figure is a small, embeddable interactive graphic that demonstrates one
thing — a p5.js sketch, a three.js scene, a D3/SVG graphic, or a canvas-loop
TEA sketch.

The card's **markdown body describes what the figure demonstrates** (its
intent). The **runnable code does not live in the body** — it lives in a
\`.ts\` file inside the card's attach scope, and the \`entry\` field points to
it.

## Making a good figure usable

Whatever a figure is for, these make it usable and clear:

- **One clear focus.** Show one thing; resist cramming. Clarity beats completeness.
- **Signal the affordances.** What's interactive should *look* interactive — a draggable part, a slider, a button should read as such (visible handles, hover cues), not blend into the scene.
- **Tell the viewer what to do.** A short on-figure instruction ("drag the H⁺ to the base", "click a category") removes the guesswork; don't rely on the viewer discovering the interaction.
- **Key what isn't self-evident.** If colours, symbols, or marks carry meaning, include a small legend; if it responds to the keyboard, name the keys.
- **Legible and unclipped.** Readable text, enough contrast, no overlapping or garbled labels; lay it out so nothing is clipped. Match the box's quiet visual style — no decorative noise.
- **Fit the container.** Size from \`mount.clientWidth\` (fall back if 0, e.g. \`|| 360\`), watch it with a \`ResizeObserver\` (disconnect in teardown), and derive layout from the current canvas size — never a fixed pixel width or a \`size\` param. Give DOM controls \`width: 100%\`. A figure must work at phone width (~390px).
- **Verify it renders before you call it done.** Open it and screenshot it: confirm it renders, the controls and instructions are visible, and nothing is clipped.

## Frontmatter

- \`runtime:\` — one of \`p5js\`, \`three\`, \`d3\`, \`canvas-loop\`. Selects the mount harness. (p5js for canvas sketches & animation, three for 3D scenes, d3 for data-driven SVG — including node-link graphs, canvas-loop for deterministic TEA sketches with auto-generated controls and a headless verify loop.)
- \`entry:\` — **required.** Path to the source, e.g. \`attach/sketch.ts\`
  (resolved in the card's \`<basename>.attach/\` scope, like any \`attach/\`
  ref).
- \`data:\` — optional free-form object of author config the sketch can read.
  Custom top-level frontmatter keys are stripped on load, so script config
  must live under \`data\`, not as loose keys.
- \`params:\` — optional declared embed parameters, each
  \`{name, type, description?, default?}\`. Values are supplied by the embed
  link's query string, not by the card itself.

## The source (\`entry\`)

The \`entry\` module is authored in the runtime's own style (not React) and
**default-exports \`(lib, { mount, figure }) => teardown\`**:

- \`lib\` — the runtime library (\`p5\` / \`three\` / \`d3\`), provided by the
  harness. **Do not import it** — it arrives as this argument.
- \`mount\` — the DOM element to render into.
- \`figure\` — \`{ params, data, meta, file }\`: the coerced embed \`params\`,
  the card's \`data\`, the validated frontmatter \`meta\`, and \`file\` helpers
  for loading box files.
- **Return a teardown function** (or nothing). It is required for runtimes
  that hold resources: p5 needs \`instance.remove()\`, three needs animation-
  frame cancellation + disposal, D3 needs listener/DOM cleanup.

(The mount element and \`figure\` context travel together in the second
argument because positional params are capped at two.)

\`\`\`ts
// attach/sketch.ts  (p5js)
export default function (p5, { mount, figure }) {
  const width = () => Math.min(mount.clientWidth || 360, 640);
  const instance = new p5((p) => {
    p.setup = () => p.createCanvas(width(), Math.round(width() * 0.75));
    p.draw = () => { /* derive layout from p.width / p.height, not a constant */ };
  }, mount);
  const ro = new ResizeObserver(() => {
    if (instance.width !== width()) instance.resizeCanvas(width(), Math.round(width() * 0.75));
  });
  ro.observe(mount);
  return () => { ro.disconnect(); instance.remove(); };
}
\`\`\`

## Embedding

Embed a figure inline in a card or document body with the **image/embed
syntax** — \`![caption](…figure.card)\` (a plain box path, like an image) —
passing parameters in the query string. It renders frameless (just the figure)
in place. A plain \`[label](…figure.card)\` link (no \`!\`) stays a navigable
link, not an embed.

    ![caffeine](/store/figures/Molecule.figure.card?molecule=H2O2)

The sketch reads those values from \`figure.params\`; the caption (alt text)
shows beneath the figure.

## canvas-loop figures (deterministic TEA sketches)

For \`runtime: canvas-loop\` the entry is a **TEA sketch module** — canvas-loop's
Elm-style contract: named exports \`params\`/\`init\`/\`update\`/\`draw\` (+ optional
\`canvas\`) — plus a one-line default figure factory beneath them:

\`\`\`ts
export default (cl, { mount, figure }) =>
  cl.mountSketch(mount, { module: { params, init, update, draw }, initialParams: figure.params });
\`\`\`

- **The module literal lists only the exports you declared.** \`params\` and
  \`canvas\` are both optional (\`mountSketch\` defaults: no controls, 400×300) —
  a sketch with both uses \`{ params, canvas, init, update, draw }\`; one with
  neither uses \`{ init, update, draw }\`. Referencing an undeclared identifier
  in the literal ships a \`ReferenceError\` figure (esbuild won't flag it), and
  \`initialParams\` only applies to params the module declares.

- **\`import type\` ONLY** from \`@ianbicking/canvas-loop\` — the package is not
  resolvable inside a box, so a value import fails the compile (type-only
  imports are erased). The runtime API arrives as the factory's \`cl\` argument.
- **Interactive controls come from the module's \`export const params\`**
  (canvas-loop's declaration: number/boolean/select/trigger) — sliders,
  checkboxes, selects, and trigger buttons render automatically.
- The card-level \`params:\` field keeps its usual meaning — embed-query
  declarations — and maps onto module params **by identical name**. A param
  exposed both ways is declared in both vocabularies:

  \`\`\`yaml
  # card frontmatter: the embed-query declaration
  params:
    - { name: speed, type: number, default: 1 }
  \`\`\`

  \`\`\`ts
  // module: the control declaration the boxholder sees
  export const params = { speed: { type: "number", min: 0, max: 5, default: 1 } } as const satisfies ParamsDecl;
  \`\`\`

  An embed link's \`?speed=2\` then starts that slider at 2.
- **The two vocabularies differ — map deliberately.** The card \`params:\` type
  is one of \`string\`/\`number\`/\`boolean\` only (the card schema enforces this);
  the module \`params\` type is \`number\`/\`boolean\`/\`select\`/\`trigger\`. Bridge
  them by this table (a mismatch warns in the browser console and falls back
  to the declared default, so get it right):

  | module param | card \`type:\` | note |
  |---|---|---|
  | \`number\`  | \`number\`  | direct |
  | \`boolean\` | \`boolean\` | direct |
  | \`select\`  | \`string\`  | the embed value must be **one of the select's \`options\`** |
  | \`trigger\` | — | **not embed-controllable** (a trigger carries no value); omit it from card \`params:\` |

  A card param matching no module param (or declared for a \`trigger\`) is dropped — its query value does nothing.
- **\`export const canvas = { width, height }\` is authoritative for the drawing
  size** — the card's \`width\`/\`height\` fields don't apply to canvas-loop figures.
- **Verify headlessly** (write → render → read the frame-tagged transcript;
  the canvas-loop authoring loop) rather than opening a browser to screenshot.`,
});

export type FigureFields = InferCardFields<typeof FigureSchema>;

const RUNTIME_LABEL: Record<FigureRuntimeType, string> = {
  p5js: "p5.js sketch",
  three: "three.js scene",
  d3: "D3/SVG graphic",
  "canvas-loop": "canvas-loop TEA sketch",
};

/**
 * Starter embed `params`, declared only for runtimes whose starter has real
 * domain parameters to expose. The p5/three/d3 starters size themselves from
 * the container (no `size` param — see the schema instructions' "Fit the
 * container" guidance), so they scaffold no `params`; `params` stays reserved
 * for domain parameters an author declares deliberately. The canvas-loop
 * starter's value-bearing module params are `speed` (number), `show-ring`
 * (boolean), and `tone` (select → card `string`, its default among the
 * select's options) — every one maps onto a real module param (an unmatched
 * card param warns on every mount — see the schema instructions' vocabulary
 * table). Its `reset` trigger is not embed-controllable, so it is omitted.
 */
const FIGURE_TEMPLATE_PARAMS: Partial<Record<FigureRuntimeType, Array<Record<string, unknown>>>> = {
  "canvas-loop": [
    { name: "speed", type: "number", default: 1 },
    { name: "show-ring", type: "boolean", default: true },
    { name: "tone", type: "string", default: "sky" },
  ],
};

/**
 * Generate a starter figure card. The body is a short description; the runnable
 * code is scaffolded separately into the attach scope (see
 * {@link figureStarterSketch}). Embed `params` are declared only for runtimes
 * with real domain parameters to expose (see {@link FIGURE_TEMPLATE_PARAMS}).
 */
export function createFigureTemplate(input: { runtime: FigureRuntimeType; title?: string }): string {
  const templateParams = FIGURE_TEMPLATE_PARAMS[input.runtime];
  const fields: Record<string, unknown> = {
    runtime: input.runtime,
    entry: "attach/sketch.ts",
    ...(templateParams !== undefined ? { params: templateParams } : {}),
  };
  if (input.title !== undefined && input.title !== "") {
    fields["title"] = input.title;
  }
  const description = `A ${RUNTIME_LABEL[input.runtime]} figure. Describe what it demonstrates here; the runnable code lives in \`attach/sketch.ts\`.\n`;
  return renderFrontmatterBlock(fields, description);
}
