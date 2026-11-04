/**
 * Anchors: the ids a ref's `#fragment` can name in a card body.
 *
 * A heading has one (an explicit `{% #id %}` annotation, else the slug of its
 * text, numbered when repeated); a paragraph has one only when annotated.
 */

import { HeadingIds } from "./heading-ids.js";
import { parseMarkdown } from "./parse/core.js";

export interface Anchor {
  id: string;
  kind: "heading" | "paragraph";
}

/** Every id a ref can name in a body, in document order. */
export function anchorsIn(body: string): Anchor[] {
  const ids = new HeadingIds();
  const out: Anchor[] = [];
  for (const node of parseMarkdown(body).walk()) {
    if (node.type === "heading") out.push({ id: ids.next(node), kind: "heading" });
    else if (node.type === "paragraph") {
      const id: unknown = node.attributes["id"];
      if (typeof id === "string" && id !== "") out.push({ id, kind: "paragraph" });
    }
  }
  return out;
}
