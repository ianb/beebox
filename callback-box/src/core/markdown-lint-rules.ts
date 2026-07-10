/**
 * Custom markdownlint rules for callback boxes.
 */

import { fileExists } from "../lib/file-exists.js";
import { invariant } from "../lib/invariant.js";
import * as path from "node:path";
import type { Rule, RuleOnError } from "markdownlint";

// The retired `view:` scheme in any markdown link/image. Cards/files are now
// referenced by a plain box path; a `view:` prefix produces a dead link. Forms
// this catches (the ones agents and hand-edits still produce):
//   [label](view:path)   ![alt](view:path)   [view:path]
// The fix is always: drop `view:` and reference the plain path.
const LEGACY_VIEW_RE = /]\(\s*view:[^)]*\)|\[view:[^\]]*]/g;

// Matches inline links: [text](url) — captures the url part.
const INLINE_LINK_RE = /\[[^\]]*]\(([^)]+)\)/g;

export const noLegacyViewLinks: Rule = {
  names: ["CB001", "no-legacy-view-links"],
  description: "The retired `view:` scheme — drop the prefix and reference the plain box path, e.g. [label](store/x.card) or ![alt](store/x.card)",
  tags: ["links"],
  parser: "none",
  function: (params: Parameters<Rule["function"]>[0], onError: RuleOnError): void => {
    for (const [i, line] of params.lines.entries()) {
      LEGACY_VIEW_RE.lastIndex = 0;
      let match = LEGACY_VIEW_RE.exec(line);
      while (match !== null) {
        onError({
          lineNumber: i + 1,
          detail: `Drop the \`view:\` prefix — reference the plain box path instead of ${match[0]}`,
          range: [match.index + 1, match[0].length],
        });
        match = LEGACY_VIEW_RE.exec(line);
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
  // markdownlint types `config` as `boolean | any` (i.e. effectively `any`);
  // an explicitly-typed local narrows it without a cast.
  const cfg: { boxRoot?: unknown } = config ?? {};
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
  // markdownlint's own `RuleFunction` type is `(params, onError) => void`, but
  // the runtime (lib/markdownlint.mjs) checks `rule.asynchronous` and awaits
  // the returned promise when set -- the type doesn't reflect the documented
  // async-rule feature we rely on. A sync wrapper would defeat the point (it
  // would return before the async work runs, so link errors would be lost),
  // so this is a genuine type/runtime mismatch, not a wiring bug.
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- markdownlint's RuleFunction type is void-only but the runtime awaits async rule functions when `asynchronous: true` (see lib/markdownlint.mjs); a sync wrapper would silently drop the async work.
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
      invariant(match[1] !== undefined, "INLINE_LINK_RE's sole capture group always participates in a match");
      out.push({ lineNumber: i + 1, index: match.index, length: match[0].length, url: match[1].trim() });
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
  const [target] = url.split("#");
  invariant(target !== undefined, "String.split always returns at least one element");
  const resolved = target.startsWith("/") ? path.join(root, target) : path.resolve(fileDir, target);
  const inside = resolved === root || resolved.startsWith(root + path.sep);
  return { internal: true, inside, resolved };
}

/** CB001 + CB002 — the box's custom markdown link rules, registered together. */
export const customLinkRules: Rule[] = [noLegacyViewLinks, noBrokenInternalLinks];

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
    "no-legacy-view-links": true,
    "no-broken-internal-links": { boxRoot },
  };
}

function isRelativePath(url: string): boolean {
  if (url.startsWith("#")) return false;
  if (/^[A-Za-z][\d+.A-Za-z-]*:/.test(url)) return false; // any scheme (http, view, mailto, etc.)
  return true;
}

