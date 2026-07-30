/**
 * Resolution-based ref rewriting for `cb mv`.
 *
 * The old move path did a blind box-root-relative substring replace, which
 * only caught refs written as the full box-root path. Refs written *relative*
 * to the referencing card — the common form for inline markdown links and for
 * sibling/parent refs — slipped through, leaving dangling links after a move.
 *
 * This module instead *resolves* every ref it finds against the card that
 * holds it (the same way the renderer and `cb validate` resolve them), asks a
 * caller-supplied `remap` whether that resolved target is moving, and if so
 * rewrites the ref in whatever style it was written — box-root-absolute
 * (`/box/…`) stays absolute, everything else is re-expressed relative to the
 * card. The `attach/` virtual prefix is scoped to its owning card and is left
 * untouched.
 *
 * Three ref-bearing forms are covered, matching the conventions the rest of
 * the system uses:
 *  - frontmatter `ref:` scalar and `refs:` list entries (block, inline, or a
 *    one-line scalar),
 *  - body `ref="…"` attributes (Markdoc body tags like `{% source %}`, and —
 *    harmlessly, since remap gates every change — XML `ref=` attributes),
 *  - inline markdown links and images: `[text](path)`, `![alt](path)`.
 *
 * Over-matching is safe: a candidate that doesn't resolve to a remapped target
 * is returned unchanged, so scanning the whole text with loose patterns can't
 * corrupt non-ref content.
 *
 * Known safe-direction gap: the frontmatter scan is line-based, so YAML
 * inline-map forms (`- { ref: x }`, `refs: [{ ref: x }]`) are not matched — mv
 * and the canonical fixer skip them rather than corrupt them. Full YAML
 * awareness is deliberately out of scope (parse-and-reserialize would reorder
 * frontmatter keys, which is the whole reason this scan is text-surgical).
 *
 * Ref grammar (the 3-form rule, `?query`/`#fragment` splitting, fail-closed
 * containment) lives in `src/shared/ref-path.ts` — this module only maps its
 * box-relative answers to/from absolute paths and re-appends the suffix when it
 * rewrites, so a `?view=`- or `#anchor`-bearing ref both resolves and survives.
 */

import * as path from "node:path";
import { isAttachRef } from "../shared/attach-path.js";
import { formatRefSuffix, isExternalRef, parseRef, resolveRefPath } from "../shared/ref-path.js";
import { inlineLinkPattern } from "./body-refs.js";
import { rewriteFrontmatter, type RefTransform } from "./rewrite-frontmatter-refs.js";
import { invariant } from "../lib/invariant.js";

/**
 * Decide where a resolved target moves to. Receives an absolute path; returns
 * the absolute destination, or `null` if the target isn't moving.
 */
export type Remap = (resolvedAbsPath: string) => string | null;

/**
 * Resolve a ref's path part to an absolute filesystem path via the shared ref
 * algebra (`src/shared/ref-path.ts`). Returns `null` for refs that name nothing
 * in the box — the shared `isExternalRef` test (empty, any `scheme:`, a
 * protocol-relative `//host`, a bare `#anchor`), so `mailto:`/`view:`/`tel:`
 * are skipped rather than fed to the resolver — and for refs that escape the
 * box: an escaping ref can't name an in-box moved card, so it's left untouched,
 * but never silently.
 */
function resolveRefToAbs(params: {
  boxRoot: string;
  cardAbsPath: string;
  pathPart: string;
}): string | null {
  const { boxRoot, cardAbsPath, pathPart } = params;
  if (isExternalRef(pathPart)) return null;
  const fromPath = boxRelativeFrom(boxRoot, cardAbsPath);
  if (fromPath === null) {
    console.warn(`rewrite-card-refs: ${cardAbsPath} is outside ${boxRoot}; leaving its refs unchanged`);
    return null;
  }
  const resolved = resolveRefPath({ fromPath, ref: pathPart, kind: "card" });
  if (resolved === null) {
    console.warn(`rewrite-card-refs: ref "${pathPart}" in ${cardAbsPath} escapes the box; leaving unchanged`);
    return null;
  }
  return path.resolve(boxRoot, resolved);
}

/**
 * The referring card's path as the shared algebra wants it: box-relative,
 * forward slashes. `null` when the card lies outside the box.
 */
function boxRelativeFrom(boxRoot: string, cardAbsPath: string): string | null {
  const rel = path.relative(path.resolve(boxRoot), path.resolve(cardAbsPath));
  if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep)) return null;
  return rel.split(path.sep).join("/");
}

/**
 * Re-express a moved target as a ref string from `cardAbsPath`, preserving the
 * original ref's absolute-vs-relative style and its `?query`/`#fragment`.
 */
function restyleRef(params: {
  boxRoot: string;
  cardAbsPath: string;
  newAbs: string;
  wasAbsolute: boolean;
  suffix: string;
}): string {
  const { boxRoot, cardAbsPath, newAbs, wasAbsolute, suffix } = params;
  const body = wasAbsolute
    ? "/" + path.relative(boxRoot, newAbs)
    : path.relative(path.dirname(cardAbsPath), newAbs);
  return body + suffix;
}

/**
 * Build the transform used for cards *other* than the one being moved: resolve
 * each ref against this card, and if it points at a remapped target, restyle
 * it to the new location.
 */
function transformForReferrer(params: {
  boxRoot: string;
  cardAbsPath: string;
  remap: Remap;
}): RefTransform {
  const { boxRoot, cardAbsPath, remap } = params;
  return (rawRef) => {
    const parsed = parseRef(rawRef);
    const abs = resolveRefToAbs({ boxRoot, cardAbsPath, pathPart: parsed.path });
    if (abs === null) return rawRef;
    const newAbs = remap(abs);
    if (newAbs === null) return rawRef;
    return restyleRef({
      boxRoot,
      cardAbsPath,
      newAbs,
      wasAbsolute: parsed.path.startsWith("/"),
      suffix: formatRefSuffix(parsed),
    });
  };
}

/**
 * Build the transform used for the moved card itself: it has relocated, so its
 * *relative* refs to anything that stayed put must be recomputed from the new
 * location. Box-root-absolute refs are unaffected by the move; `attach/` refs
 * are scoped to the card and travel with it, so both are left alone. `remap`
 * relocates the card's own attached files (referenced by full path rather than
 * the `attach/` prefix).
 */
function transformForMovedCard(params: {
  boxRoot: string;
  oldCardAbs: string;
  newCardAbs: string;
  remap: Remap;
}): RefTransform {
  const { boxRoot, oldCardAbs, newCardAbs, remap } = params;
  return (rawRef) => {
    const parsed = parseRef(rawRef);
    if (parsed.path === "" || parsed.path.startsWith("/") || isAttachRef(parsed.path)) {
      return rawRef;
    }
    const abs = resolveRefToAbs({ boxRoot, cardAbsPath: oldCardAbs, pathPart: parsed.path });
    if (abs === null) return rawRef;
    const remapped = remap(abs);
    const target = remapped === null ? abs : remapped;
    return path.relative(path.dirname(newCardAbs), target) + formatRefSuffix(parsed);
  };
}


/**
 * Whether the body scan leaves fenced code blocks alone. The two callers want
 * opposite things, so it is never defaulted:
 *  - **`cb mv` passes `false`.** A fenced example that names a card
 *    (`[x](Sibling.card)`) should stay truthful when that card moves — a doc
 *    example pointing at a dead path is worse than one edited by the move.
 *  - **`--canonical --fix` passes `true`.** Its edits are cosmetic, and a
 *    teaching example may deliberately show the legacy relative form; silently
 *    normalizing it would erase the very thing the example demonstrates.
 *
 * The canonical fixer's collect and replay passes must agree on the flag, or
 * the replay would rewrite tokens the collect pass never priced.
 */
interface BodyScanOptions {
  skipFencedCode: boolean;
}

/** The one-line scan for ref-bearing body syntax: `[…](path)` and `ref="…"`. */
function scanBodyLine(line: string, wrap: RefTransform): string {
  // Inline markdown links and images: [text](path) / ![alt](path). The pattern
  // is shared with validate's `extractBodyLinks` so mv rewrites exactly the set
  // of links validate checks.
  const linked = line.replace(inlineLinkPattern(), (_m: string, ...g: string[]) => {
    const [prefix, refPart] = g;
    invariant(
      prefix !== undefined && refPart !== undefined,
      "inline-link regex has two mandatory capture groups",
    );
    return prefix + wrap(refPart);
  });
  // Body `ref="…"` attributes (Markdoc tags; XML attributes pass through
  // harmlessly since remap gates every change).
  return linked.replace(/(\bref=)(["'])([^"']*)\2/g, (_m: string, ...g: string[]) => {
    const [attr, quote, value] = g;
    invariant(
      attr !== undefined && quote !== undefined && value !== undefined,
      "ref= attribute regex has three mandatory capture groups",
    );
    return attr + quote + wrap(value) + quote;
  });
}

/** The line index the body starts at — past the frontmatter block, or 0. */
function bodyStartLine(lines: string[]): number {
  if (lines[0] !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") return i + 1;
  }
  return 0;
}

/**
 * Run the body scan over every line, optionally skipping fenced code. Fence
 * state is tracked only from the body's first line, so a ``` inside a
 * frontmatter block scalar can't flip it (the frontmatter has already been
 * rewritten by then, and its own lines are scanned as before).
 */
function scanBody(text: string, { wrap, skipFencedCode }: { wrap: RefTransform } & BodyScanOptions): string {
  const lines = text.split("\n");
  const bodyStart = bodyStartLine(lines);
  let fence = ""; // the open fence's marker run, or "" outside a fence
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (skipFencedCode && i >= bodyStart) {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence === "") {
        if (marker !== undefined) {
          fence = marker[0] ?? "";
          continue;
        }
      } else {
        if (marker !== undefined && marker[0] === fence) fence = "";
        continue;
      }
    }
    lines[i] = scanBodyLine(line, wrap);
  }
  return lines.join("\n");
}

/**
 * Apply a ref transform to every ref-bearing token in a card's text. Returns
 * the rewritten text and how many tokens actually changed.
 */
function applyTransform(
  text: string,
  { transform, skipFencedCode }: { transform: RefTransform } & BodyScanOptions
): { text: string; count: number } {
  let count = 0;
  const wrap: RefTransform = (raw) => {
    const out = transform(raw);
    if (out !== raw) count++;
    return out;
  };

  const updated = scanBody(rewriteFrontmatter(text, wrap), { wrap, skipFencedCode });
  return { text: updated, count };
}

/**
 * Rewrite refs in a card that *points at* moved targets. Used for every card
 * except the one being moved.
 */
export function rewriteReferrerRefs(params: {
  boxRoot: string;
  cardAbsPath: string;
  text: string;
  remap: Remap;
}): { text: string; count: number } {
  const transform = transformForReferrer({
    boxRoot: params.boxRoot,
    cardAbsPath: params.cardAbsPath,
    remap: params.remap,
  });
  return applyTransform(params.text, { transform, skipFencedCode: false });
}

/**
 * Rewrite `cardRef="…"` attributes in a box-authored view (`.tsx`) that point at
 * moved targets. Views aren't cards, so only the widget attribute is touched —
 * not frontmatter/markdown/`ref=` forms (a bare `ref=` in JSX is a React DOM
 * ref, not a card ref). Resolution-gated via `remap`, like the card rewriters.
 */
export function rewriteViewRefs(params: {
  boxRoot: string;
  viewAbsPath: string;
  text: string;
  remap: Remap;
}): { text: string; count: number } {
  const transform = transformForReferrer({
    boxRoot: params.boxRoot,
    cardAbsPath: params.viewAbsPath,
    remap: params.remap,
  });
  return applyViewTransform(params.text, transform);
}

/** Apply a ref transform to every literal `cardRef="…"` in a view's source. */
function applyViewTransform(source: string, transform: RefTransform): { text: string; count: number } {
  let count = 0;
  const text = source.replace(/(\bcardRef=)(["'])([^"']*)\2/g, (_m: string, ...g: string[]) => {
    const [attr, quote, value] = g;
    invariant(
      attr !== undefined && quote !== undefined && value !== undefined,
      "cardRef= attribute regex has three mandatory capture groups",
    );
    const out = transform(value);
    if (out !== value) count += 1;
    return attr + quote + out + quote;
  });
  return { text, count };
}

/**
 * A rewrite driven by a precomputed `raw ref token → replacement` map instead of
 * a move remap. The map form exists because deciding a replacement can be
 * *async* (the `--canonical --fix` normalizer only rewrites refs whose target
 * exists on disk) while {@link RefTransform} is deliberately sync: the caller
 * collects the tokens first, resolves them at its leisure, then replays the
 * decision through the same text-surgical scan.
 *
 * A token maps identically wherever it appears in one document — resolution
 * depends only on the ref and the document holding it — so keying on the raw
 * token is sound.
 */
export type RefReplacements = ReadonlyMap<string, string>;

const collectInto = (out: Set<string>): RefTransform => (raw) => {
  out.add(raw);
  return raw;
};

const replaceFrom = (replacements: RefReplacements): RefTransform => (raw) => {
  const next = replacements.get(raw);
  return next === undefined ? raw : next;
};

/**
 * Every raw ref token a card's text carries, across all three ref-bearing
 * forms. `skipFencedCode` must match the replay's — see {@link BodyScanOptions}.
 */
export function collectCardRefTokens(params: { text: string } & BodyScanOptions): string[] {
  const out = new Set<string>();
  applyTransform(params.text, {
    transform: collectInto(out),
    skipFencedCode: params.skipFencedCode,
  });
  return [...out];
}

/** Replay a token→replacement decision over a card's text. */
export function rewriteCardRefTokens(
  params: { text: string; replacements: RefReplacements } & BodyScanOptions
): { text: string; count: number } {
  return applyTransform(params.text, {
    transform: replaceFrom(params.replacements),
    skipFencedCode: params.skipFencedCode,
  });
}

/** Every raw `cardRef="…"` token a view's source carries. */
export function collectViewRefTokens(source: string): string[] {
  const out = new Set<string>();
  applyViewTransform(source, collectInto(out));
  return [...out];
}

/** Replay a token→replacement decision over a view's source. */
export function rewriteViewRefTokens(
  params: { text: string; replacements: RefReplacements }
): { text: string; count: number } {
  return applyViewTransform(params.text, replaceFrom(params.replacements));
}

/**
 * Rewrite a moved card's own outgoing relative refs so they still resolve from
 * its new location.
 */
export function rewriteMovedCardRefs(params: {
  boxRoot: string;
  oldCardAbs: string;
  newCardAbs: string;
  text: string;
  remap: Remap;
}): { text: string; count: number } {
  const transform = transformForMovedCard({
    boxRoot: params.boxRoot,
    oldCardAbs: params.oldCardAbs,
    newCardAbs: params.newCardAbs,
    remap: params.remap,
  });
  return applyTransform(params.text, { transform, skipFencedCode: false });
}
