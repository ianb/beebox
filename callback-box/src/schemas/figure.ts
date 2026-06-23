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

import { body, cardSchema, type CardSchema } from "../cards/index.js";
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

export const FigureSchema: CardSchema = cardSchema("figure", {
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
thing — a p5.js sketch, a three.js scene, or a D3/SVG graphic.

The card's **markdown body describes what the figure demonstrates** (its
intent). The **runnable code does not live in the body** — it lives in a
\`.ts\` file inside the card's attach scope, and the \`entry\` field points to
it.

## Frontmatter

- \`runtime:\` — one of \`p5js\`, \`three\`, \`d3\`. Selects the mount harness.
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
**default-exports \`(lib, mount, figure) => teardown\`**:

- \`lib\` — the runtime library (\`p5\` / \`three\` / \`d3\`), provided by the
  harness. **Do not import it** — it arrives as this argument.
- \`mount\` — the DOM element to render into.
- \`figure\` — \`{ params, data, meta, file }\`: the coerced embed \`params\`,
  the card's \`data\`, the validated frontmatter \`meta\`, and \`file\` helpers
  for loading box files.
- **Return a teardown function** (or nothing). It is required for runtimes
  that hold resources: p5 needs \`instance.remove()\`, three needs animation-
  frame cancellation + disposal, D3 needs listener/DOM cleanup.

\`\`\`ts
// attach/sketch.ts  (p5js)
export default function (p5, mount, figure) {
  const instance = new p5((p) => {
    p.setup = () => p.createCanvas(figure.params.size ?? 300, 300);
    p.draw = () => { /* read figure.params / figure.data */ };
  }, mount);
  return () => instance.remove();
}
\`\`\`

## Embedding

Embed a figure inline with a \`view:\` link, passing parameters in the query
string:

    [caffeine](view:store/figures/Molecule.figure.card?molecule=H2O2)

The sketch reads those values from \`figure.params\`.`,
});

export interface FigureFields {
  type: "figure";
  runtime: FigureRuntimeType;
  entry: string;
  data?: Record<string, unknown>;
  params?: Array<{
    name: string;
    type: "string" | "number" | "boolean";
    description?: string;
    default?: string | number | boolean;
  }>;
  width?: number;
  height?: number;
  body: string;
}
