/**
 * Rehype plugin that strips `ref` attributes from raw-HTML elements parsed
 * into the hast tree. React treats a `ref` prop specially: a string `ref`
 * triggers the legacy string-ref path and throws React error #290
 * ("Element ref was specified as a string but no owner was set"), which
 * crashes the whole render. Card schemas use `ref="..."` as a link target
 * convention, and assistant messages occasionally embed those tags as
 * literal HTML — so we rename the attribute to `data-ref` before React
 * sees it.
 */

import type { Plugin } from "unified";
import type { Root, Element } from "hast";

const rehypeStripRef: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree);
  };
};

function visit(node: Root | Element): void {
  if (node.type === "element") {
    const props = node.properties;
    if (props && "ref" in props) {
      const value = props.ref;
      delete props.ref;
      if (!("data-ref" in props)) {
        props["data-ref"] = value as string;
      }
    }
  }
  const children = (node as { children?: unknown[] }).children;
  if (!Array.isArray(children)) return;
  for (const child of children) {
    if (child && typeof child === "object" && "type" in child) {
      const t = (child as { type: string }).type;
      if (t === "element" || t === "root") visit(child as Element | Root);
    }
  }
}

export { rehypeStripRef };
