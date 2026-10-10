/**
 * A type's scoped Markdoc tags merged over the core table. Lint and the
 * Markdown widget both build their config here so they cannot disagree.
 */

import type { Config, Node, Schema } from "@markdoc/markdoc";
import { isRecord } from "../is-record.js";
import { markdocConfig } from "./tags/core.js";

export function withScopedTags(scoped?: Readonly<Record<string, Schema>>): Config {
  if (scoped === undefined || Object.keys(scoped).length === 0) return markdocConfig;
  return { ...markdocConfig, tags: { ...markdocConfig.tags, ...scoped } };
}

function isMdType(value: unknown, type: string): value is Record<string, unknown> {
  return isRecord(value) && value["$$mdtype"] === type;
}

/** Attributes as the author wrote them: ` key="text" count=2 ref=$a.b`. */
export function authoredAttributes(attrs: Record<string, unknown>): string {
  return Object.entries(attrs).map(([key, value]) => {
    if (typeof value === "string") return ` ${key}=${JSON.stringify(value)}`;
    if (typeof value === "number" || typeof value === "boolean") return ` ${key}=${String(value)}`;
    if (isMdType(value, "Variable") && Array.isArray(value["path"])) return ` ${key}=$${value["path"].map(String).join(".")}`;
    if (isMdType(value, "Function")) return ` ${key}=${typeof value["name"] === "string" ? `${value["name"]}(...)` : "..."}`;
    return ` ${key}=${JSON.stringify(value)}`;
  }).join("");
}

/**
 * Rewrite every tag the config does not know into a core `unknown-tag` node
 * that keeps the authored name and attributes (`attrs` is their authored text), the
 * children, and the `inline` flag. Render-time only: validation still reports
 * the authored tag as undefined.
 */
export function rewriteUnknownTags(ast: Node, config: Config): void {
  const known = config.tags ?? {};
  for (const node of ast.walk()) {
    if (node.type !== "tag" || node.tag === undefined || Object.hasOwn(known, node.tag)) continue;
    node.attributes = { name: node.tag, attrs: authoredAttributes(node.attributes) };
    node.tag = "unknown-tag";
  }
}
