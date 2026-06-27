/**
 * Custom markdownlint rules for callback boxes.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Rule, RuleOnError } from "markdownlint";

// Matches [view:...] used as a reference link label (not as a URL in parentheses).
// The invalid form agents write: [view:path/to/file]
// The correct form:             [label](view:path/to/file)
const VIEW_LABEL_RE = /\[view:[^\]]*](?!\()/g;

// Matches inline links: [text](url) — captures the url part.
const INLINE_LINK_RE = /\[[^\]]*]\(([^)]+)\)/g;

const noViewLabelLinks: Rule = {
  names: ["CB001", "no-view-label-links"],
  description: "view: belongs in the URL, not the link label — use [label](view:path) not [view:path]",
  tags: ["links"],
  parser: "none",
  function: (params: Parameters<Rule["function"]>[0], onError: RuleOnError): void => {
    for (let i = 0; i < params.lines.length; i++) {
      const line = params.lines[i]!;
      VIEW_LABEL_RE.lastIndex = 0;
      let match = VIEW_LABEL_RE.exec(line);
      while (match !== null) {
        onError({
          lineNumber: i + 1,
          detail: `Use [label](view:path) instead of ${match[0]}`,
          range: [match.index + 1, match[0].length],
        });
        match = VIEW_LABEL_RE.exec(line);
      }
    }
  },
};

/**
 * Thrown when `no-broken-internal-links` is enabled without a `boxRoot` in its
 * config. This is a caller (programming) error: the markdownlint config must
 * supply it, so we fail loud rather than silently skip — a rule that pretends to
 * check while not checking is worse than one that errors.
 */
class MissingBoxRootError extends Error {
  constructor() {
    super("no-broken-internal-links requires a boxRoot in its config — the caller must supply { boxRoot } when enabling the rule");
    this.name = "MissingBoxRootError";
  }
}

/**
 * Read the required `boxRoot` from the rule's markdownlint config. Callers enable
 * the rule with `{ "no-broken-internal-links": { boxRoot } }`, which markdownlint
 * passes through as `params.config`. boxRoot is mandatory: without it we cannot
 * resolve box-root-absolute (`/store/...`) links, and resolving them against the
 * OS filesystem root would false-positive every valid link.
 */
function readBoxRoot(config: Parameters<Rule["function"]>[0]["config"]): string {
  // markdownlint types `config` as `boolean | any`; narrow at this parse boundary.
  const cfg = (config ?? {}) as { boxRoot?: unknown };
  if (typeof cfg.boxRoot !== "string" || cfg.boxRoot === "") {
    throw new MissingBoxRootError();
  }
  return cfg.boxRoot;
}

export const noBrokenInternalLinks: Rule = {
  names: ["CB002", "no-broken-internal-links"],
  description: "Internal links (relative, or box-root absolute) must point to an existing file or directory inside the box",
  tags: ["links"],
  parser: "none",
  asynchronous: true,
  function: async (params: Parameters<Rule["function"]>[0], onError: RuleOnError): Promise<void> => {
    const boxRoot = readBoxRoot(params.config);
    const fileDir = path.dirname(params.name);

    for (const link of extractInlineLinks(params.lines)) {
      const res = resolveInternalLink(link.url, { fileDir, boxRoot });
      if (!res.internal) continue;
      if (!res.inside) {
        // A genuine out-of-box reference uses a different syntax; an internal
        // link that escapes the box (via `..`) is an error even if the target
        // happens to exist on disk.
        onError({
          lineNumber: link.lineNumber,
          detail: `Link points outside the box: ${link.url}`,
          range: [link.index + 1, link.length],
        });
      } else if (!(await fileExists(res.resolved))) {
        onError({
          lineNumber: link.lineNumber,
          detail: `Broken link: ${link.url}`,
          range: [link.index + 1, link.length],
        });
      }
    }
  },
};

export interface InlineLink {
  lineNumber: number;
  index: number;
  length: number;
  url: string;
}

/** Every inline markdown link/image target in a file, with position info. */
export function extractInlineLinks(lines: readonly string[]): InlineLink[] {
  const out: InlineLink[] = [];
  for (const [i, line] of lines.entries()) {
    INLINE_LINK_RE.lastIndex = 0;
    let match = INLINE_LINK_RE.exec(line);
    while (match !== null) {
      out.push({ lineNumber: i + 1, index: match.index, length: match[0].length, url: match[1]!.trim() });
      match = INLINE_LINK_RE.exec(line);
    }
  }
  return out;
}

export interface LinkResolution {
  /** True if the url is an internal file/dir link (not http/view/mailto/anchor). */
  internal: boolean;
  /** True if the resolved target lies inside the box (only meaningful when internal). */
  inside: boolean;
  /** Absolute resolved path (empty when not internal). */
  resolved: string;
}

/**
 * Resolve an inline-link url the way CB002 does: leading `/` against the box
 * root, anything else relative to the file's own directory. Shared by the rule
 * and the `cb relink` repair so they agree on what "broken" means.
 */
export function resolveInternalLink(
  url: string,
  { fileDir, boxRoot }: { fileDir: string; boxRoot: string }
): LinkResolution {
  if (!isRelativePath(url)) return { internal: false, inside: false, resolved: "" };
  const root = path.resolve(boxRoot);
  const target = url.split("#")[0]!;
  const resolved = target.startsWith("/") ? path.join(root, target) : path.resolve(fileDir, target);
  const inside = resolved === root || resolved.startsWith(root + path.sep);
  return { internal: true, inside, resolved };
}

/** CB001 + CB002 — the box's custom markdown link rules, registered together. */
export const customLinkRules: Rule[] = [noViewLabelLinks, noBrokenInternalLinks];

/**
 * markdownlint config fragment that enables CB001/CB002 **by name** (not by the
 * `links` tag, which would also pull in built-in link rules) and supplies the
 * box root CB002 requires. Spread into a larger config:
 *
 *   { default: false, MD009: true, ...linkRuleConfig(boxRoot) }   // validity + links
 *   { default: false, ...linkRuleConfig(boxRoot) }                // links only
 */
export function linkRuleConfig(boxRoot: string): Record<string, unknown> {
  return {
    "no-view-label-links": true,
    "no-broken-internal-links": { boxRoot },
  };
}

function isRelativePath(url: string): boolean {
  if (url.startsWith("#")) return false;
  if (/^[A-Za-z][\d+.A-Za-z-]*:/.test(url)) return false; // any scheme (http, view, mailto, etc.)
  return true;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (_e) {
    // access() throwing IS the answer here: the file is absent/unreadable.
    return false;
  }
}
