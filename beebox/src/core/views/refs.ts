/**
 * Card refs inside box-authored views (`views/*.tsx`).
 *
 * The card-aware view widgets (`beebox/view-widgets`) point at cards with
 * a `cardRef="…"` attribute (`ref` is React-reserved). Those refs must be
 * tracked like any card ref: `bbx validate` flags a broken one, and `bbx mv`
 * rewrites it when the target moves (the rewrite half lives in
 * rewrite-card-refs.ts). This is the JSX-view analogue of `extractBodyRefs`
 * (core/body-refs.ts) for Markdoc bodies — a different surface, same `{path, ref}`
 * shape feeding the same existence check.
 *
 * Only literal quoted attributes are tracked; an expression form
 * (`cardRef={expr}`) is unresolvable statically and is skipped, not flagged.
 * Targeting the specific `cardRef` attribute (not a bare `ref=`) avoids matching
 * ordinary JSX DOM refs. A view has no document-relative base inside the box,
 * so its refs resolve from the box root. Authors should write box-absolute refs
 * (`/store/…`).
 */

import { promises as fs } from "node:fs";
import { relative } from "node:path";
import { resolveRefExists } from "../ref-exists.js";
import { invariant } from "../../lib/invariant.js";

/** Matches `cardRef="…"` / `cardRef='…'` with a literal string value. */
const CARD_REF_ATTR = /\bcardRef\s*=\s*(["'])([^"']*)\1/g;

export interface ViewRef {
  /** Locator token `view:<line>:<index>`, parallel to body `body:<line>:<tag>.<attr>`. */
  path: string;
  /** The raw ref string as written. */
  ref: string;
}

/** Extract every literal `cardRef="…"` from a view's source. */
export function extractViewRefs(source: string): ViewRef[] {
  const out: ViewRef[] = [];
  let match: RegExpExecArray | null;
  CARD_REF_ATTR.lastIndex = 0;
  let index = 0;
  while ((match = CARD_REF_ATTR.exec(source)) !== null) {
    invariant(match[2] !== undefined, "CARD_REF_ATTR's value capture group always participates in a match");
    const line = source.slice(0, match.index).split("\n").length;
    out.push({ path: `view:${line}:${index}`, ref: match[2] });
    index += 1;
  }
  return out;
}

/**
 * Broken-cardRef warning messages for one view file (absolute path). Mirrors the
 * card broken-ref walk in card-lint.ts: existence-only, warning-style. A `?view=`
 * query is stripped before the existence check (only the path addresses a file).
 *
 * A symlinked view is skipped outright, same as `markdown-lint-rules.ts`'s
 * `noBrokenInternalLinks` does for a symlinked `.md`/`.card` (finding 3, round
 * 5 hardening on top of finding 1): the one-root migration's `rewriteViewRefs`
 * never opens a symlinked leaf for rewrite (its content belongs to its
 * target), so a v2-form `cardRef` it still carries after the move is accepted
 * staleness, not a broken link the hard link gate should fail the commit
 * over.
 */
export async function lintViewRefs(viewAbsPath: string, boxRoot: string): Promise<string[]> {
  const lst = await fs.lstat(viewAbsPath).catch(() => null);
  if (lst?.isSymbolicLink() === true) return [];
  let source: string;
  try {
    source = await fs.readFile(viewAbsPath, "utf-8");
  } catch (_e) {
    // An unreadable view is the compile-check's concern, not this walk's.
    return [];
  }
  const warnings: string[] = [];
  for (const { path: refPath, ref } of extractViewRefs(source)) {
    const qIdx = ref.indexOf("?");
    const refPathOnly = qIdx === -1 ? ref : ref.slice(0, qIdx);
    const exists = await resolveRefExists({ ref: refPathOnly, fromPath: "", boxRoot });
    if (!exists) {
      warnings.push(`Broken reference at ${refPath}: ${ref} does not exist`);
    }
  }
  return warnings;
}

/**
 * Broken-`cardRef` warnings across a set of view files (absolute paths), each
 * prefixed with the view's box-relative path so the message names the file.
 */
export async function collectViewRefWarnings(viewPaths: string[], boxRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const viewPath of viewPaths) {
    const rel = relative(boxRoot, viewPath);
    for (const warning of await lintViewRefs(viewPath, boxRoot)) {
      out.push(`${rel}: ${warning}`);
    }
  }
  return out;
}
