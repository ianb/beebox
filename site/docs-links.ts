// Link resolution between agent-docs (plan: "Links between docs"). A new
// pipeline from the site's existing link-check: these are raw markdown files
// with relative links, not rendered HTML, so it owns its own resolver.
//
// Promoted docs (repo files): a link into the published set rewrites to a
// relative published URL; a link under an excluded root (plans/, issues/,
// research/, ...) flattens to its text; any other tracked repo file rewrites
// to a GitHub blob URL; a nonexistent target fails the build.
//
// Authored docs (site/docs/**): links are already published-relative
// (`../concepts/cards.md`); this only validates they resolve within the
// published set, failing the build if they don't.

import fs from "node:fs";
import path from "node:path";
import { classifyHref } from "./links.js";

export class DocsLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocsLinkError";
  }
}

const EXCLUDED_ROOTS = new Set([
  "plans",
  "implemented-plans",
  "unimplemented-plans",
  "reports",
  "issues",
  "research",
  "private-issues",
]);

const LINK_RE = /\[([^\]]*)]\(([^\s)]+)\)/g;
const IMAGE_RE = /!\[[^\]]*]\(([^\s)]+)\)/g;

function splitAnchor(href: string): { target: string; anchor: string } {
  const i = href.indexOf("#");
  return i === -1 ? { target: href, anchor: "" } : { target: href.slice(0, i), anchor: href.slice(i) };
}

function isExcludedRoot(repoPath: string): boolean {
  return repoPath.split("/").some((segment) => EXCLUDED_ROOTS.has(segment));
}

/** Relative href from one published doc to another, in the published tree. */
function relativePublishHref(fromPublishPath: string, toPublishPath: string): string {
  const fromDir = path.posix.dirname(fromPublishPath);
  const rel = path.posix.relative(fromDir === "." ? "" : fromDir, toPublishPath);
  return rel === "" ? path.posix.basename(toPublishPath) : rel;
}

interface FoundLink {
  match: string;
  linkText: string;
  href: string;
}

/**
 * Apply `fn` to every non-image `[text](href)` link outside fenced code
 * blocks, rebuilding the string manually (rather than `String#replace`, whose
 * callback arity the codebase's `max-params` rule disallows).
 */
function mapNonImageLinks(text: string, fn: (link: FoundLink) => string): string {
  return text
    .split(/(```[\S\s]*?```)/g)
    .map((part, i) => {
      if (i % 2 === 1) return part; // inside a code fence: literal content
      let out = "";
      let last = 0;
      for (const m of part.matchAll(LINK_RE)) {
        const offset = m.index;
        const match = m[0];
        const linkText = m[1] ?? "";
        const href = m[2] ?? "";
        out += part.slice(last, offset);
        out += part[offset - 1] === "!" ? match : fn({ match, linkText, href });
        last = offset + match.length;
      }
      return out + part.slice(last);
    })
    .join("");
}

export interface PromotedLinkContext {
  repoRoot: string;
  /** This doc's own path, repo-relative posix (e.g. "beebox/docs/security-overview.md"). */
  repoDocPath: string;
  /** repo-relative posix source path -> published path, for every promoted doc. */
  manifestByRepoPath: ReadonlyMap<string, string>;
  publishPath: string;
}

/** Rewrite every internal link in a promoted doc's body per the four link cases. */
export function rewritePromotedLinks(body: string, ctx: PromotedLinkContext): string {
  const repoDir = path.posix.dirname(ctx.repoDocPath);
  return mapNonImageLinks(body, ({ match, linkText, href }) => {
    if (classifyHref(href) !== "internal") return match;
    const { target, anchor } = splitAnchor(href);
    const resolved = path.posix.normalize(path.posix.join(repoDir, target));
    const publish = ctx.manifestByRepoPath.get(resolved);
    if (publish !== undefined) {
      return `[${linkText}](${relativePublishHref(ctx.publishPath, publish)}${anchor})`;
    }
    if (isExcludedRoot(resolved)) return linkText;
    if (!fs.existsSync(path.join(ctx.repoRoot, resolved))) {
      throw new DocsLinkError(`${ctx.repoDocPath} links to a nonexistent file: ${href}`);
    }
    return `[${linkText}](https://github.com/ianb/beebox/blob/main/${resolved}${anchor})`;
  });
}

/**
 * Rewrite every internal image reference in a promoted doc to the copy GitHub
 * serves. The corpus is read by models, and the narrative chapters' PNGs run to
 * tens of megabytes, so the bytes stay in the repo; a missing image still fails.
 */
export function rewritePromotedImages(body: string, ctx: { repoRoot: string; repoDocPath: string }): string {
  const repoDir = path.posix.dirname(ctx.repoDocPath);
  let out = "";
  let last = 0;
  for (const m of body.matchAll(IMAGE_RE)) {
    const href = m[1] ?? "";
    out += body.slice(last, m.index);
    last = m.index + m[0].length;
    if (classifyHref(href) !== "internal") {
      out += m[0];
      continue;
    }
    const { target } = splitAnchor(href);
    const resolved = path.posix.normalize(path.posix.join(repoDir, target));
    if (!fs.existsSync(path.join(ctx.repoRoot, resolved))) {
      throw new DocsLinkError(`${ctx.repoDocPath} references a missing image: ${href}`);
    }
    out += m[0].replace(href, `https://github.com/ianb/beebox/blob/main/${resolved}?raw=true`);
  }
  return out + body.slice(last);
}

/** Validate every internal link in an authored doc resolves within the published set. */
export function validateAuthoredLinks(
  body: string,
  ctx: { publishPath: string; sourceLabel: string; publishedPaths: ReadonlySet<string> },
): void {
  const dir = path.posix.dirname(ctx.publishPath);
  mapNonImageLinks(body, ({ match, href }) => {
    if (classifyHref(href) !== "internal") return match;
    const { target } = splitAnchor(href);
    const resolved = path.posix.normalize(path.posix.join(dir === "." ? "" : dir, target));
    if (!ctx.publishedPaths.has(resolved)) {
      throw new DocsLinkError(`${ctx.sourceLabel} links to "${href}", which is not in the published doc set`);
    }
    return match;
  });
}
