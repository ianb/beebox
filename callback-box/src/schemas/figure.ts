/**
 * Figure card schema — small, embeddable, parameterized interactives.
 *
 * A figure is an interactive graphic (a p5.js sketch, three.js scene, or
 * D3/SVG graphic) embedded to demonstrate one thing. The card's markdown body
 * describes what the figure demonstrates; the runnable source is a `.ts` file
 * in the card's attach scope, pointed to by the `entry` field. The frontend
 * compiles that source with the existing esbuild view compiler and mounts it
 * through a per-runtime harness (p5 instance mode into a `<div>`, etc.).
 *
 * See docs/plans/figure-card-type.md for the full design.
 */

import { body, cardSchema, renderFrontmatterBlock, type InferCardFields } from "../cards/index.js";
import { z } from "zod";

export const FigureRuntime = z.enum(["p5js", "three", "d3"]);
export type FigureRuntimeType = z.infer<typeof FigureRuntime>;

/** A declared embed parameter: supplied via the embed link's query string. */
const FigureParam = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const FigureSchema = cardSchema("figure", {
  description: "A small embeddable interactive graphic (p5.js/three.js/D3) demonstrating one thing; source lives in the attach scope",
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
thing — a p5.js sketch, a three.js scene, or a D3/SVG graphic.

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

- \`runtime:\` — one of \`p5js\`, \`three\`, \`d3\`. Selects the mount harness. (p5js for canvas sketches & animation, three for 3D scenes, d3 for data-driven SVG — including node-link graphs.)
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
shows beneath the figure.`,
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
// mount element. Size from the container, not a fixed pixel width, so the
// figure fits at phone width too.
export default function (p5, { mount, figure }) {
  const width = () => Math.min(mount.clientWidth || 360, 640);
  let angle = 0;
  const instance = new p5((p) => {
    p.setup = () => {
      p.createCanvas(width(), width());
    };
    p.draw = () => {
      // Derive ALL layout from p.width / p.height, not captured constants —
      // resizeCanvas below changes them without re-running setup.
      p.background(28);
      p.translate(p.width / 2, p.height / 2);
      p.rotate(angle);
      angle += 0.02;
      p.noStroke();
      p.fill(120, 200, 255);
      p.rectMode(p.CENTER);
      p.rect(0, 0, p.width * 0.4, p.height * 0.4);
    };
  }, mount);
  // The width-compare guard breaks the observer feedback loop (resizeCanvas
  // changes the mount's height, which would otherwise refire the observer).
  const ro = new ResizeObserver(() => {
    if (instance.width !== width()) instance.resizeCanvas(width(), width());
  });
  ro.observe(mount);
  return () => {
    ro.disconnect();
    instance.remove();
  };
}
`,
  three: `// three.js figure. The harness provides the three namespace as \`lib\`; mount a
// WebGL canvas into \`mount\` and return a teardown that cancels the animation
// frame and disposes GPU resources. Size from the container so the figure
// fits at phone width too.
export default function (THREE, { mount, figure }) {
  const width = () => Math.min(mount.clientWidth || 360, 640);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  camera.position.z = 2.5;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  mount.appendChild(renderer.domElement);

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshNormalMaterial();
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  function resize(): void {
    const w = width();
    renderer.setSize(w, w);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
  }
  resize();

  let raf = 0;
  const loop = () => {
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.013;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  loop();

  const ro = new ResizeObserver(() => {
    if (renderer.domElement.width !== width()) resize();
  });
  ro.observe(mount);

  return () => {
    ro.disconnect();
    cancelAnimationFrame(raf);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
`,
  d3: `// D3 figure. The harness provides the d3 namespace as \`lib\`; append an <svg>
// with a viewBox so it scales to the container — no resize handling needed,
// since d3.pointer() maps events into the viewBox's own coordinate system.
// Keep the internal width modest and text >= 12px: viewBox scaling shrinks
// text and strokes uniformly, so labels must stay legible even scaled down
// to phone width.
export default function (d3, { mount, figure }) {
  const W = 600;
  const H = 400;
  const data = [4, 8, 15, 16, 23, 42];

  const svg = d3
    .select(mount)
    .append("svg")
    .attr("viewBox", \`0 0 \${W} \${H}\`)
    .style("width", "100%")
    .style("height", "auto");

  const x = d3
    .scaleBand()
    .domain(data.map((_, i) => String(i)))
    .range([0, W])
    .padding(0.1);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(data) ?? 0])
    .range([H, 0]);

  svg
    .selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", (_, i) => x(String(i)) ?? 0)
    .attr("y", (d) => y(d))
    .attr("width", x.bandwidth())
    .attr("height", (d) => H - y(d))
    .attr("fill", "#4ea3ff");

  return () => {
    svg.remove();
  };
}
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
};

/**
 * Generate a starter figure card. The body is a short description; the runnable
 * code is scaffolded separately into the attach scope (see
 * {@link figureStarterSketch}). No `params` are scaffolded — the starter sizes
 * itself from the container, so `params` stays reserved for domain parameters
 * an author declares deliberately.
 */
export function createFigureTemplate(input: { runtime: FigureRuntimeType; title?: string }): string {
  const fields: Record<string, unknown> = {
    runtime: input.runtime,
    entry: "attach/sketch.ts",
  };
  if (input.title !== undefined && input.title !== "") {
    fields["title"] = input.title;
  }
  const description = `A ${RUNTIME_LABEL[input.runtime]} figure. Describe what it demonstrates here; the runnable code lives in \`attach/sketch.ts\`.\n`;
  return renderFrontmatterBlock(fields, description);
}
