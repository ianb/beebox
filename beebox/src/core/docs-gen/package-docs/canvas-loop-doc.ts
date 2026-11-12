/**
 * canvas-loop's own drawing reference (TEA.md, BRUSHES.md), shipped as box
 * docs so a box agent writing a canvas-loop figure can read the API without
 * the engine's source checkout. Read from the sibling `canvas-loop/` package
 * at build time; links are rewritten to the box-docs names, and links into
 * canvas-loop's source tree become plain text. A packed install has no
 * sibling `canvas-loop/`: there the copy built into its `box-docs/` is used.
 */
import { existsSync, readFileSync } from "node:fs";
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
