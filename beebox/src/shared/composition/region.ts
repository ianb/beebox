/**
 * Where a doc card's `{% composition %}` region is, and how to replace its
 * text. The server and the editor both use these, so they agree on the
 * region (`docs/implemented-plans/composition-editor.md`, Track 1).
 *
 * The composition text is the source strictly between the line that holds
 * `{% composition %}` and the line that holds `{% /composition %}`.
 */
import type { Node } from "@markdoc/markdoc";
import { parseMarkdown } from "../markdoc-config/parse/core.js";
import { invariant } from "../invariant.js";

/**
 * A found region. `textStart`..`textEnd` covers whole lines of the body,
 * including the newline before the closing tag line. `text` is that slice
 * without its final newline, which is the form the editor edits.
 */
export interface CompositionRegion {
  textStart: number;
  textEnd: number;
  text: string;
}

export interface CompositionProblem {
  problem: "none" | "multiple" | "inline" | "unclosed";
}

/** A `{% /composition %}` with no opener parses as its own node; it is not a second composition. */
function isStrayCloser(node: Node): boolean {
  return node.errors.some((error) => error.id === "missing-opening");
}

/** Offset of the start of each line; one extra entry for the end of the body. */
function lineStarts(body: string): number[] {
  const starts = [0];
  for (let i = body.indexOf("\n"); i !== -1; i = body.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

export function findComposition(body: string): CompositionRegion | CompositionProblem {
  const nodes = [...parseMarkdown(body).walk()]
    .filter((node) => node.type === "tag" && node.tag === "composition" && !isStrayCloser(node));
  const [node, ...rest] = nodes;
  if (node === undefined) return { problem: "none" };
  if (rest.length > 0) return { problem: "multiple" };
  if (node.inline) return { problem: "inline" };
  // A closed block tag's `lines` are [open start, open end, close start, close end].
  const [, openEnd, closeStart] = node.lines;
  if (node.lines.length !== 4 || openEnd === undefined || closeStart === undefined) return { problem: "unclosed" };
  const starts = lineStarts(body);
  const textStart = starts[openEnd];
  const textEnd = starts[closeStart];
  invariant(textStart !== undefined && textEnd !== undefined, "Markdoc tag lines lie outside the body");
  return { textStart, textEnd, text: body.slice(textStart, textEnd).replace(/\n$/, "") };
}

/**
 * Replace the region's text, keeping every byte outside it. A non-empty text
 * gets the newline that keeps `{% /composition %}` on its own line.
 */
export function spliceComposition(body: string, { region, text }: { region: CompositionRegion; text: string }): string {
  const lines = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return body.slice(0, region.textStart) + lines + body.slice(region.textEnd);
}
