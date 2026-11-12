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

import { body, cardSchema, renderFrontmatterBlock, type InferCardFields } from "../exports/cards.js";
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
  brief: "A small interactive graphic",
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
- **Respect reduced motion.** When \`matchMedia("(prefers-reduced-motion: reduce)").matches\`, draw one still frame and do not start an animation loop (p5: \`p.noLoop()\` in setup; three: render once and skip \`requestAnimationFrame\`; canvas-loop: \`autoplay: false\`). The starter sketches already do this.
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

    ![caffeine](/_content/figures/Molecule.figure.card?molecule=H2O2)

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
  The figure scales down to fit a narrow column, keeping its aspect ratio.
- **The drawing API** (\`View\`, styles, text, scopes, input, sound) is in
  \`canvas-loop.md\`; brushes, paper, sprites and caches in
  \`canvas-loop-brushes.md\` (both beside this file).

### The factory's arguments

The default export is called as \`(cl, { mount, figure })\`:

- \`cl\` — canvas-loop's browser API: \`cl.mountSketch(mount, options)\` with
  \`module\`, \`initialParams\`, \`autoplay\`, \`seed\`, \`panel\`, \`transport\`,
  \`onParamsChange\`, \`onEvent\`, \`onError\`.
- \`mount\` — the element to mount into.
- \`figure.params\` (embed values), \`figure.data\` (the card's \`data:\`),
  \`figure.meta\` (frontmatter), \`figure.file\` (the views file helpers:
  \`readFile\`, \`fileUrl\`, \`writeFile\`, \`appendFile\`, …).

What the learner does in a figure open beside the chat reaches you as
\`explored\` activity, as a view's does: param changes (\`set speed = 2\`) and
inputs the sketch acknowledged with \`u.handled(name)\` (\`pressed tray-sugar\`).
Name what \`update\` handles with \`u.handled\`, and that is what you hear.

### Checking a canvas-loop figure

Render it headlessly; no browser needed:

\`\`\`sh
bbx figure run <card path>          # or no path: every canvas-loop figure in the box
\`\`\`

- It compiles the entry, runs it with canvas-loop's own headless runner and
  writes \`_tmp/figure-run/…/out/transcript.md\` (the command prints the path) plus frame PNGs
  (frame 0, the last frame, every 30th, and any frame that logged or ran an
  event). Read the transcript and look at the frames.
- The transcript lists \`v.log\` lines, warnings (a style that draws nothing,
  text that overlaps other text, a character the font cannot draw), errors, and
  each scripted input with what it did: \`mousedown (200,150) → pressed\`
  (names from \`u.handled\`), \`Δmodel\` when the model changed, \`(unhandled)\`
  when nothing happened. The command prints the warnings and errors and exits
  non-zero on an error.
- Script input with an events file beside the entry,
  \`<entry stem>-events.json\`; it is used automatically and is the figure's
  standing check. \`--events <file>\` picks another; \`--frames N\` runs N
  frames (default: through the last event plus 60); \`--params name=value\`
  starts a param elsewhere (the card's \`params:\` defaults apply first).
- Code outside the default export runs in Node: keep \`window\`, \`document\`
  and \`matchMedia\` inside the factory.

The events file is a JSON array; all events for frame N run, in file order,
before frame N's draw (canvas coordinates, 60 frames a second):

\`\`\`json
[
  { "frame": 6, "type": "mousedown", "x": 200, "y": 150 },
  { "frame": 8, "type": "mouseup", "x": 200, "y": 150 },
  { "frame": 30, "type": "param", "name": "speed", "value": 2.5 },
  { "frame": 40, "type": "keydown", "key": "r" },
  { "frame": 50, "type": "trigger", "name": "reset" },
  { "frame": 55, "type": "snapshot", "label": "after reset" }
]
\`\`\`

Input types are \`mousedown\`, \`mouseup\`, \`mousemove\`, \`keydown\`, \`keyup\`;
\`param\` and \`trigger\` names must be declared in the module's \`params\`;
\`snapshot\` captures that frame.

### Sharing code and data between figures and views

Put code that more than one figure or view uses in \`src/lib/\` at the box
root, and data in a card's attach scope or a JSON file. A figure entry and a
view both import them by relative path
(\`import { atomColor } from "../../../src/lib/chem.ts"\`,
\`import elements from "../../Elements.attach/elements.json"\`); each is
bundled into the importer, so a change reaches every figure and view that
imports it. Code a canvas-loop figure imports must stay pure: no module-level
\`let\` (state belongs in the model), and no \`Math.random\` or \`Date\`
(calling either during a \`bbx figure run\` stops it with an error). React components cannot be drawn on a canvas, so a view that should
show a figure's picture embeds the figure card with
\`<CardRef cardRef="…" />\` from \`beebox/view-widgets\`.`,
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
