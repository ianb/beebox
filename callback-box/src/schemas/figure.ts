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
 * See docs/plans/figure-card-type.md and docs/plans/canvas-loop-figure.md for
 * the full design.
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
    width: z.number().optional(),
    height: z.number().optional(),
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
- **Legible and unclipped.** Readable text, enough contrast, no overlapping or garbled labels; lay it out so nothing is clipped at the figure's declared size. Match the box's quiet visual style — no decorative noise.
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
  const instance = new p5((p) => {
    p.setup = () => p.createCanvas(figure.params.size ?? 300, 300);
    p.draw = () => { /* read figure.params / figure.data */ };
  }, mount);
  return () => instance.remove();
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
  cl.mountSketch(mount, { module: { params, canvas, init, update, draw }, initialParams: figure.params });
\`\`\`

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
- **\`export const canvas = { width, height }\` is authoritative for the drawing
  size** — the card's \`width\`/\`height\` fields do not apply to canvas-loop
  figures.
- **Verify headlessly** (write → render → read the frame-tagged transcript;
  the canvas-loop authoring loop) rather than opening a browser to screenshot.`,
});

export type FigureFields = InferCardFields<typeof FigureSchema>;

/**
 * Runnable starter sketches per runtime. Each one is a complete, working
 * `entry` module: it default-exports `(lib, { mount, figure }) => teardown`,
 * reads `figure.params.size`, and cleans up on teardown. Scaffolded into
 * `attach/sketch.ts` by the figure template so a freshly created figure renders
 * immediately and is ready to edit.
 */
const FIGURE_STARTERS: Record<FigureRuntimeType, string> = {
  p5js: `// p5.js figure. The harness provides p5 as \`lib\` (do not import it) and a
// mount element; read parameters from figure.params.
export default function (p5, { mount, figure }) {
  const instance = new p5((p) => {
    let angle = 0;
    const size = Number(figure.params.size) || 300;
    p.setup = () => {
      p.createCanvas(size, size);
    };
    p.draw = () => {
      p.background(28);
      p.translate(p.width / 2, p.height / 2);
      p.rotate(angle);
      angle += 0.02;
      p.noStroke();
      p.fill(120, 200, 255);
      p.rectMode(p.CENTER);
      p.rect(0, 0, size * 0.4, size * 0.4);
    };
  }, mount);
  return () => instance.remove();
}
`,
  three: `// three.js figure. The harness provides the three namespace as \`lib\`; mount a
// WebGL canvas into \`mount\` and return a teardown that cancels the animation
// frame and disposes GPU resources.
export default function (THREE, { mount, figure }) {
  const size = Number(figure.params.size) || 300;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  camera.position.z = 2.5;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(size, size);
  mount.appendChild(renderer.domElement);

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshNormalMaterial();
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  let raf = 0;
  const loop = () => {
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.013;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  loop();

  return () => {
    cancelAnimationFrame(raf);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
`,
  d3: `// D3 figure. The harness provides the d3 namespace as \`lib\`; append an <svg>
// to \`mount\` and return a teardown that removes it.
export default function (d3, { mount, figure }) {
  const size = Number(figure.params.size) || 300;
  const data = [4, 8, 15, 16, 23, 42];

  const svg = d3
    .select(mount)
    .append("svg")
    .attr("width", size)
    .attr("height", size);

  const x = d3
    .scaleBand()
    .domain(data.map((_, i) => String(i)))
    .range([0, size])
    .padding(0.1);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(data) ?? 0])
    .range([size, 0]);

  svg
    .selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", (_, i) => x(String(i)) ?? 0)
    .attr("y", (d) => y(d))
    .attr("width", x.bandwidth())
    .attr("height", (d) => size - y(d))
    .attr("fill", "#4ea3ff");

  return () => {
    svg.remove();
  };
}
`,
  "canvas-loop": `// canvas-loop figure: a TEA sketch (named exports) plus the figure factory
// (default export). The named exports run headlessly through the canvas-loop
// CLI — verify with that loop, not screenshots. Import canvas-loop TYPES only;
// the browser API arrives as the factory's \`cl\` argument.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Util, View } from "@ianbicking/canvas-loop";

export const params = {
  speed: { type: "number", min: 0, max: 5, default: 1 },
  "show-ring": { type: "boolean", default: true },
  tone: { type: "select", options: ["sky", "ember", "moss"], default: "sky" },
  reset: { type: "trigger" },
} as const satisfies ParamsDecl;

export const canvas = { width: 400, height: 300 };

const TONES: Record<string, string> = { sky: "#7dd3fc", ember: "#fb923c", moss: "#86efac" };

export type Model = { angle: number };

export function init(): Model {
  return { angle: 0 };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick":
      return { angle: model.angle + 0.03 * u.params.speed };
    case "trigger":
      return msg.name === "reset" ? init() : model;
    case "param":
    case "mousedown":
    case "mouseup":
    case "mousemove":
    case "keydown":
    case "keyup":
      return model;
  }
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  v.background("#0b0e17");
  const cx = v.width / 2;
  const cy = v.height / 2;
  const orbit = 90;
  if (p["show-ring"]) {
    v.noFill();
    v.stroke("#334155");
    v.circle(cx, cy, orbit * 2);
  }
  v.noStroke();
  v.fill(TONES[p.tone] ?? "#7dd3fc");
  v.circle(cx + orbit * Math.cos(model.angle), cy + orbit * Math.sin(model.angle), 24);
}

export default (cl, { mount, figure }) =>
  cl.mountSketch(mount, { module: { params, canvas, init, update, draw }, initialParams: figure.params });
`,
};

/** The runnable starter sketch source for a runtime (for the \`entry\` file). */
export function figureStarterSketch(runtime: FigureRuntimeType): string {
  return FIGURE_STARTERS[runtime];
}

const RUNTIME_LABEL: Record<FigureRuntimeType, string> = {
  p5js: "p5.js sketch",
  three: "three.js scene",
  d3: "D3/SVG graphic",
  "canvas-loop": "canvas-loop TEA sketch",
};

/**
 * Generate a starter figure card. The body is a short description; the runnable
 * code is scaffolded separately into the attach scope (see
 * {@link figureStarterSketch}). A `size` param is declared so the starter is
 * parameterizable out of the box.
 */
export function createFigureTemplate(input: { runtime: FigureRuntimeType; title?: string }): string {
  const fields: Record<string, unknown> = {
    runtime: input.runtime,
    entry: "attach/sketch.ts",
    params: [{ name: "size", type: "number", default: 300 }],
  };
  if (input.title !== undefined && input.title !== "") {
    fields["title"] = input.title;
  }
  const description = `A ${RUNTIME_LABEL[input.runtime]} figure. Describe what it demonstrates here; the runnable code lives in \`attach/sketch.ts\`.\n`;
  return renderFrontmatterBlock(fields, description);
}
