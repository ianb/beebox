/**
 * Site docs links into the generated reference pages.
 *
 * `site/docs/` links are relative to the published tree, and only the site
 * build checks them, so doc-check skips that directory. That leaves one break
 * nothing sees at commit time: `reference/cards/<type>.md` and the other
 * `reference/` pages are generated from the engine's docs at build time. Moving
 * a card type into a plugin deletes its page, and every site doc that links to
 * it breaks on main until the next finish runs the site build and blocks on a
 * file that workstream never touched
 * (issues/closed/bugs/2026-10-10-site-link-breaks-land-unseen-and-block-later-finishes.md).
 *
 * Lexical, like the site's own resolver (`site/docs-links.ts`): links in code
 * spans and fenced blocks are examples, and images are not links.
 */

import * as path from "node:path";

export const SITE_DOCS_PREFIX = "site/docs/";

const LINK_RE = /\[[^\]]*]\(([^\s)]+)\)/g;

/** The published path of an engine reference doc; mirrors `publishPathFor` in `site/docs-generated.ts`. */
export function referencePublishPath(filename: string): string {
  const card = /^card-(.+)\.md$/.exec(filename);
  return card ? `reference/cards/${card[1]}.md` : `reference/${filename}`;
}

export interface SiteReferenceLinkProblem {
  line: number;
  href: string;
  /** The published path the link resolves to. */
  resolved: string;
}

/**
 * Links in one `site/docs/` file that resolve under `reference/` to a page
 * outside `referencePaths` (generated pages plus authored ones on disk).
 */
export function findSiteReferenceLinkProblems(input: {
  rel: string;
  content: string;
  referencePaths: ReadonlySet<string>;
}): SiteReferenceLinkProblem[] {
  const publishPath = input.rel.slice(SITE_DOCS_PREFIX.length);
  const dir = path.posix.dirname(publishPath);
  const problems: SiteReferenceLinkProblem[] = [];
  let inFence = false;
  for (const [index, line] of input.content.split("\n").entries()) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const prose = line.replace(/`[^`]*`/g, "");
    for (const match of prose.matchAll(LINK_RE)) {
      if (prose[match.index - 1] === "!") continue;
      const href = match[1] ?? "";
      if (/^[a-z][\d+.a-z-]*:/i.test(href) || href.startsWith("/") || href.startsWith("#")) continue;
      const target = href.split("#")[0] ?? "";
      const resolved = path.posix.normalize(path.posix.join(dir === "." ? "" : dir, target));
      if (!resolved.startsWith("reference/") || input.referencePaths.has(resolved)) continue;
      problems.push({ line: index + 1, href, resolved });
    }
  }
  return problems;
}
