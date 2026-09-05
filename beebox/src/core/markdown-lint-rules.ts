/**
 * Custom markdownlint rules for Bee Boxes.
 */

import { fileExists } from "../lib/file-exists.js";
import { invariant } from "../lib/invariant.js";
import { isExternalRef, parseRef, resolveRefPath } from "../shared/ref-path.js";
import { errnoCode } from "../lib/error-guards.js";
import { matchReferenceDefinitionAt } from "./body-refs.js";
import * as fs from "node:fs/promises";
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
  names: ["BBX001", "no-legacy-view-links"],
  description: "The retired `view:` scheme — drop the prefix and reference the plain box path, e.g. [label](/store/x.card) or ![alt](/store/x.card)",
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

/**
 * Whether `filePath` (as given to markdownlint — an absolute path) is itself
 * a symlink. Finding 1 (round 4 hardening, `one-root-run.ts`): a symlinked
 * `.md`/`.card` file's content belongs to its TARGET, not the link — the
 * one-root migration never opens one for rewrite, so a v2-form ref it still
 * carries is an accepted, reported staleness, not a genuine broken link. The
 * same file can land STAGED as part of that migration's own commit, where
 * `bbx validate --pre-commit`'s staged pass treats a BBX002 hit as a
 * commit-blocking error — so the rule itself must recognize a symlinked leaf
 * and skip it, the one place every caller (staged, box-wide, the migration's
 * own hard link gate) shares.
 */
async function isSymlinkPath(filePath: string): Promise<boolean> {
  try {
    return (await fs.lstat(filePath)).isSymbolicLink();
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") return false; // fail open — a stat error here is not this rule's problem to report
    return false;
  }
}

export const noBrokenInternalLinks: Rule = {
  names: ["BBX002", "no-broken-internal-links"],
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
    if (await isSymlinkPath(params.name)) return;
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

/**
 * Every inline markdown link/image target in a file, with position info —
 * PLUS reference-style link DEFINITIONS (`[id]: /path`), which carry a real
 * target the inline pattern can't see (a `[text][id]` usage has none). Both
 * forms feed BBX002's existence check and, via this shared extraction, the
 * one-root migration's hard link gate.
 */
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
    // A continuation-line destination reports on the NEXT line (`lineIndex`
    // may differ from `i`), so this is keyed off the label line but points
    // at wherever the destination text actually is.
    const refDef = matchReferenceDefinitionAt(lines, i);
    if (refDef !== null) {
      out.push({ lineNumber: refDef.lineIndex + 1, index: refDef.index, length: refDef.url.length, url: refDef.url });
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
 * Resolve an inline-link url the way BBX002 does, via the shared ref algebra
 * (`src/shared/ref-path.ts`): leading `/` against the box root, anything else
 * relative to the file's own directory, and — `kind: "markdown"` — no attach
 * scope, since a `.md` dossier owns no `<basename>.attach/` directory, so
 * `attach/x` is a literal subdirectory. Any `?query`/`#fragment` addresses a
 * location *within* the target and is dropped before the existence check. A
 * link that escapes the box root resolves to nothing and is reported as
 * outside-the-box. Shared by the rule and the `bbx relink` repair so they agree
 * on what "broken" means.
 */
export function resolveInternalLink(
  url: string,
  { fileDir, boxRoot }: { fileDir: string; boxRoot: string }
): LinkResolution {
  if (!isRelativePath(url)) return { internal: false, inside: false, resolved: "" };
  const root = path.resolve(boxRoot);
  const fromPath = boxRelativeDir(root, fileDir);
  if (fromPath === null) return { internal: true, inside: false, resolved: "" };
  const resolved = resolveRefPath({ fromPath, ref: parseRef(url).path, kind: "markdown" });
  if (resolved === null) return { internal: true, inside: false, resolved: "" };
  return { internal: true, inside: true, resolved: path.resolve(root, resolved) };
}

/**
 * The linted file's directory as the shared algebra wants its `fromPath`:
 * box-relative with forward slashes and a trailing slash (so the algebra's
 * file-name strip is a no-op). `null` when the directory lies outside the box —
 * it has no in-box links to resolve.
 */
function boxRelativeDir(root: string, fileDir: string): string | null {
  const rel = path.relative(root, path.resolve(fileDir));
  if (rel === ".." || rel.startsWith(".." + path.sep)) return null;
  return rel === "" ? "" : rel.split(path.sep).join("/") + "/";
}

/** BBX001 + BBX002 — the box's custom markdown link rules, registered together. */
export const customLinkRules: Rule[] = [noLegacyViewLinks, noBrokenInternalLinks];

/**
 * markdownlint config fragment that enables BBX001/BBX002 **by name** (not by the
 * `links` tag, which would also pull in built-in link rules) and supplies the
 * box root BBX002 requires. Spread into a larger config:
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

/** An in-box link is anything the shared ref algebra doesn't call external. */
function isRelativePath(url: string): boolean {
  return !isExternalRef(url);
}

