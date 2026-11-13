/**
 * The single place heading ids are assigned: the renderer (`makeHeadingNode`)
 * and `anchorsIn` both use it, so a ref checked by lint names the element a
 * reader sees. Apart from `anchors.ts` because the renderer is on the public
 * schema surface and must not bring in the Markdown parser.
 */

import type { Node } from "@markdoc/markdoc";
import { asciiSlug } from "../ascii-slug.js";

/**
 * Concatenated plain text of a heading node's inline children (text, inline
 * code, and a formula as its dollar-delimited source). A formula counts as the
 * text a parser without math sees, so the renderer and `anchorsIn` agree on
 * the slug of `# $E = mc^2$`.
 */
export function headingText(node: Node): string {
  let out = "";
  for (const child of node.walk()) {
    if (child.type === "tag" && child.tag === "math") {
      const tex: unknown = child.attributes["tex"];
      const delimiter = child.attributes["display"] === true ? "$$" : "$";
      if (typeof tex === "string") out += `${delimiter}${tex}${delimiter}`;
      continue;
    }
    if (child.type !== "text" && child.type !== "code") continue;
    const content: unknown = child.attributes["content"];
    if (typeof content === "string") out += content;
  }
  return out;
}

/**
 * Assigns heading ids in document order. An explicit id wins and is taken as
 * it stands; otherwise the id is the slug of the heading text (`section` when
 * the text has no word characters), numbered `-1`, `-2` when already taken.
 * Every assigned id, explicit or not, is taken. One instance per pass.
 */
export class HeadingIds {
  private readonly seen = new Set<string>();

  next(heading: Node): string {
    const explicit: unknown = heading.attributes["id"];
    if (typeof explicit === "string" && explicit !== "") {
      this.seen.add(explicit);
      return explicit;
    }
    const base = asciiSlug(headingText(heading));
    const slug = base === "" ? "section" : base;
    let id = slug;
    let n = 1;
    while (this.seen.has(id)) {
      id = `${slug}-${String(n)}`;
      n += 1;
    }
    this.seen.add(id);
    return id;
  }
}
