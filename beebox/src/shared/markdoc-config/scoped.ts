/**
 * A type's scoped Markdoc tags merged over the core table. Lint and the
 * Markdown widget both build their config here so they cannot disagree.
 */

import type { Config, Node, Schema } from "@markdoc/markdoc";
import { markdocConfig } from "./tags/core.js";

export function withScopedTags(scoped?: Readonly<Record<string, Schema>>): Config {
  if (scoped === undefined || Object.keys(scoped).length === 0) return markdocConfig;
  return { ...markdocConfig, tags: { ...markdocConfig.tags, ...scoped } };
}

/**
 * Rewrite every tag the config does not know into a core `unknown-tag` node
 * that keeps the authored name and attributes (`attrs` is their JSON), the
 * children, and the `inline` flag. Render-time only: validation still reports
 * the authored tag as undefined.
 */
export function rewriteUnknownTags(ast: Node, config: Config): void {
  const known = config.tags ?? {};
  for (const node of ast.walk()) {
    if (node.type !== "tag" || node.tag === undefined || node.tag in known) continue;
    node.attributes = { name: node.tag, attrs: JSON.stringify(node.attributes) };
    node.tag = "unknown-tag";
  }
}
