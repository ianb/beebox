// Machine-facing Markdown links point to Markdown twins, not authoring paths.
import { classifyHref, resolveInternalHref } from "./links.js";

export function twinCardLinks(markdown: string, params: { id: string; base: string }): string {
  return markdown.split(/(```[\S\s]*?```)/g).map((part, index) => {
    if (index % 2 === 1) return part;
    return part.replace(/]\(([^\s)]+\.card)(#[^\s)]+)?\)/g, (_match, ...parts: string[]) => {
      const [card = "", anchor = ""] = parts;
      if (classifyHref(card) !== "internal") return _match;
      const resolved = resolveInternalHref({ href: card, pageSitePath: params.id, base: params.base });
      const target = resolved.target.replace(/\.doc\.card\/index\.html$/, ".md").replace(/\.html$/, ".md");
      return `](${params.base}${target}${anchor})`;
    });
  }).join("");
}
