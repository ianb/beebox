/**
 * canvas-loop's own drawing reference (TEA.md, BRUSHES.md) and its examples
 * (src/examples/), shipped as box docs so a box agent writing a canvas-loop
 * figure can read the API and whole working figures without the engine's
 * source checkout. Read from the sibling `canvas-loop/` package at build time;
 * links are rewritten to the box-docs names (an example link to its section
 * of `canvas-loop-examples.md`), and other links into canvas-loop's source
 * tree become plain text. A packed install has no sibling `canvas-loop/`:
 * there the copy built into its `box-docs/` is used.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_ROOT } from "../../../lib/package-root.js";
import { PACKAGE_DOCS_DIR_NAME } from "../shared.js";

const CANVAS_LOOP_DIR = join(PACKAGE_ROOT, "..", "canvas-loop");

const BOX_NOTE = `> **In a box:** this is canvas-loop's own reference, written for its
> development checkout. In a box, \`bbx figure run <card>\` replaces the
> \`pnpm … cli run\` commands (\`card-figure.md\`, "Checking a canvas-loop
> figure"). The import rule below is the checkout's lint: a box figure may
> also import shared box code and JSON (\`card-figure.md\`, "Sharing code and
> data between figures and views").
`;

/** Rewrite canvas-loop's relative links for box-docs. */
function boxLinks(markdown: string): string {
  return markdown
    .replaceAll("](./TEA.md", "](canvas-loop.md")
    .replaceAll("](./BRUSHES.md", "](canvas-loop-brushes.md")
    .replaceAll("](./README.md#events-file)", "](card-figure.md#checking-a-canvas-loop-figure)")
    .replace(/\]\(\.\/src\/examples\/([\w-]+)-tea(?:-events\.json|\.ts)\)/gu, "](canvas-loop-examples.md#$1)")
    .replace(/\[([^\]]+)\]\(\.\/[^)]*\)/gu, "$1");
}

function shipped(file: string, boxDoc: string): string {
  if (!existsSync(CANVAS_LOOP_DIR)) return readFileSync(join(PACKAGE_ROOT, PACKAGE_DOCS_DIR_NAME, boxDoc), "utf8");
  const text = readFileSync(join(CANVAS_LOOP_DIR, file), "utf8");
  const [title, ...rest] = text.split("\n");
  return `${title ?? ""}\n\n${BOX_NOTE}${boxLinks(rest.join("\n"))}`;
}

export function generateCanvasLoopDoc(): string {
  return shipped("TEA.md", "canvas-loop.md");
}

export function generateCanvasLoopBrushesDoc(): string {
  return shipped("BRUSHES.md", "canvas-loop-brushes.md");
}

const EXAMPLES_DIR = join(CANVAS_LOOP_DIR, "src", "examples");

const EXAMPLES_NOTE = `Whole canvas-loop figures, one per technique, from canvas-loop's
\`src/examples/\`. Each section gives what the example shows, its sketch, and
the events file its check runs (\`canvas-loop.md\`, "Events file"). In a box,
a figure's own events file runs with \`bbx figure run <card>\`
(\`card-figure.md\`, "Checking a canvas-loop figure").
`;

/** A sketch's leading \`//\` comment, as prose, and the code after it. */
function splitHeader(source: string): { header: string; code: string } {
  const lines = source.split("\n");
  const end = lines.findIndex((line) => !line.startsWith("//"));
  const header = lines.slice(0, end).map((line) => line.replace(/^\/\/ ?/u, ""));
  const prose = header.join("\n").trim().replaceAll("BRUSHES.md", "canvas-loop-brushes.md").replaceAll("TEA.md", "canvas-loop.md");
  return { header: prose, code: lines.slice(end).join("\n").trim() };
}

function exampleSection(name: string): string {
  const { header, code } = splitHeader(readFileSync(join(EXAMPLES_DIR, `${name}-tea.ts`), "utf8"));
  const events = readFileSync(join(EXAMPLES_DIR, `${name}-tea-events.json`), "utf8").trim();
  return [`## ${name}`, header, `\`${name}-tea.ts\`:`, `\`\`\`ts\n${code}\n\`\`\``, `\`${name}-tea-events.json\`:`, `\`\`\`json\n${events}\n\`\`\``].join("\n\n");
}

/** Every example's name, from its \`<name>-tea.ts\` file, sorted. */
export function canvasLoopExampleNames(): string[] {
  return readdirSync(EXAMPLES_DIR)
    .filter((file) => file.endsWith("-tea.ts"))
    .map((file) => file.slice(0, -"-tea.ts".length))
    .toSorted();
}

export function generateCanvasLoopExamplesDoc(): string {
  if (!existsSync(CANVAS_LOOP_DIR)) return readFileSync(join(PACKAGE_ROOT, PACKAGE_DOCS_DIR_NAME, "canvas-loop-examples.md"), "utf8");
  const sections = canvasLoopExampleNames().map((name) => exampleSection(name));
  return `${["# canvas-loop examples", EXAMPLES_NOTE.trim(), ...sections].join("\n\n")}\n`;
}
