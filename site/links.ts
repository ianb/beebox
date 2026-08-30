// Base-path handling and internal-link resolution for the static site.
//
// The site is served at different path prefixes depending on target: the dev
// router serves it at /<worktree>/site/, GitHub Pages under /beebox/, a
// custom domain at /. Rather than emit hand-relative links (fragile across
// prefixes), every internal link is authored site-root-relative or
// page-relative and resolved against a single base at build time. External
// links (http(s):, mailto:) and pure anchors pass through untouched.

import path from "node:path";

export type HrefKind = "external" | "anchor" | "internal";

/** An internal link resolved to a site-root-relative target plus its emitted href. */
export interface ResolvedLink {
  /** Site-root-relative path of the link target, e.g. "index.html" (no base, no anchor). */
  target: string;
  /** The href to emit into the HTML, base-resolved and anchor-preserving. */
  href: string;
}

/**
 * Derive the base path from a git branch name. `worktree-<name>` → `/<name>/site/`
 * (the dev router prefix); `main` → `/main/site/`. Used when `--base` is not passed.
 */
export function baseFromBranch(branch: string): string {
  const name = branch.startsWith("worktree-") ? branch.slice("worktree-".length) : branch;
  return normalizeBase(`/${name}/site/`);
}

/** Ensure a base path both starts and ends with a slash. */
export function normalizeBase(base: string): string {
  if (!base.startsWith("/")) {
    throw new BasePathError(`base must start with "/": ${base}`);
  }
  return base.endsWith("/") ? base : `${base}/`;
}

export class BasePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BasePathError";
  }
}

const SCHEME_RE = /^[a-z][\d+.a-z-]*:/i;

export function classifyHref(href: string): HrefKind {
  if (href.startsWith("#")) return "anchor";
  if (href.startsWith("//") || SCHEME_RE.test(href)) return "external";
  return "internal";
}

/**
 * Resolve an internal link found on the page at `pageSitePath` (site-root-relative,
 * e.g. "index.html" or "sub/x.html"). Root-absolute hrefs (`/foo.md`) resolve from
 * the site root; others resolve relative to the page's directory. A `.md` target is
 * rewritten to its `.html` twin (pages are linked by their pretty HTML form; the
 * machine-facing `.md` twin is reached via llms.txt, not human page links).
 */
export function resolveInternalHref(params: { href: string; pageSitePath: string; base: string }): ResolvedLink {
  const { href, pageSitePath, base } = params;
  const hashIndex = href.indexOf("#");
  const anchor = hashIndex !== -1 ? href.slice(hashIndex) : "";
  const rawPath = hashIndex !== -1 ? href.slice(0, hashIndex) : href;

  const pageDir = path.posix.dirname(pageSitePath);
  const resolvedFromRoot = rawPath.startsWith("/")
    ? path.posix.normalize(rawPath.slice(1))
    : path.posix.normalize(path.posix.join(pageDir === "." ? "" : pageDir, rawPath));

  const target = resolvedFromRoot.endsWith(".md")
    ? `${resolvedFromRoot.slice(0, -".md".length)}.html`
    : resolvedFromRoot;

  return { target, href: `${base}${target}${anchor}` };
}
