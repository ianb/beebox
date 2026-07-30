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
 * Ref grammar (the 3-form rule, `?query`/`#fragment` splitting, fail-closed
 * containment) lives in `src/shared/ref-path.ts` — this module only maps its
 * box-relative answers to/from absolute paths and re-appends the suffix when it
 * rewrites, so a `?view=`- or `#anchor`-bearing ref both resolves and survives.
 */

import * as path from "node:path";
import { isAttachRef } from "../shared/attach-path.js";
import { formatRefSuffix, parseRef, resolveRefPath } from "../shared/ref-path.js";
import { inlineLinkPattern } from "./body-refs.js";
import { invariant } from "../lib/invariant.js";

/**
 * Decide where a resolved target moves to. Receives an absolute path; returns
 * the absolute destination, or `null` if the target isn't moving.
 */
export type Remap = (resolvedAbsPath: string) => string | null;

/**
 * Resolve a ref's path part to an absolute filesystem path via the shared ref
 * algebra (`src/shared/ref-path.ts`). Returns `null` for refs we don't resolve
 * (empty, protocol URLs) and for refs that escape the box — an escaping ref
 * can't name an in-box moved card, so it's left untouched, but never silently.
 */
function resolveRefToAbs(params: {
  boxRoot: string;
  cardAbsPath: string;
  pathPart: string;
}): string | null {
  const { boxRoot, cardAbsPath, pathPart } = params;
  if (pathPart === "") return null;
  if (pathPart.includes("://")) return null;
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

/** A per-ref transform: given a raw ref token, return it unchanged or rewritten. */
type RefTransform = (rawRef: string) => string;

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

/** Quote-aware unwrap of a YAML scalar value. Returns the inner value + quote char. */
function unquote(value: string): { inner: string; quote: string } {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value[value.length - 1] === first) {
      return { inner: value.slice(1, -1), quote: first };
    }
  }
  return { inner: value, quote: "" };
}

/**
 * Rewrite refs inside the frontmatter block (between the leading `---` and the
 * next `---`). It rewrites any `ref:` scalar or `refs:` list at *any* nesting,
 * not just at the top level — a card reference is always stored under a key
 * named exactly `ref` (or `refs`), so a nested `procedure:\n  ref: <path>`,
 * `frozen:\n  ref: <path>`, etc. are rewritten the same as a top-level
 * `ref:`. Returns the text with that region rewritten.
 */
function rewriteFrontmatter(text: string, wrap: RefTransform): string {
  if (!text.startsWith("---\n")) return text;
  const lines = text.split("\n");
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return text;

  const apply = (value: string): string => {
    const { inner, quote } = unquote(value);
    return quote + wrap(inner) + quote;
  };

  let refsIndent = -1; // indentation of an open `refs:` block, or -1
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // `ref:` as a plain key OR as the first key of a block-list item
    // (`  - ref: <path>` — the dominant shape for `messages:`/`items:` lists).
    // Missing the list-item form left `cb mv` silently not rewriting the most
    // common nested ref there is.
    const scalar = /^(\s*(?:-\s+)?ref:\s+)(\S.*?)\s*$/.exec(line);
    if (scalar !== null) {
      const [, prefix, value] = scalar;
      invariant(
        prefix !== undefined && value !== undefined,
        "ref: scalar regex has two mandatory capture groups",
      );
      lines[i] = prefix + apply(value);
      refsIndent = -1;
      continue;
    }

    const inlineList = /^(\s*refs:\s*\[)(.*)(]\s*)$/.exec(line);
    if (inlineList !== null) {
      const [, prefix, itemsRaw, suffix] = inlineList;
      invariant(
        prefix !== undefined && itemsRaw !== undefined && suffix !== undefined,
        "refs: [...] regex has three mandatory capture groups",
      );
      const items = itemsRaw
        .split(",")
        .map((item) => {
          const m = /^(\s*)(\S.*?)(\s*)$/.exec(item);
          if (m === null) return item;
          const [, lead, core, trail] = m;
          invariant(
            lead !== undefined && core !== undefined && trail !== undefined,
            "inline-list item regex has three mandatory capture groups",
          );
          return lead + apply(core) + trail;
        })
        .join(",");
      lines[i] = prefix + items + suffix;
      refsIndent = -1;
      continue;
    }

    const blockOpen = /^(\s*)refs:\s*$/.exec(line);
    if (blockOpen !== null) {
      const [, indent] = blockOpen;
      invariant(indent !== undefined, "refs: block-open regex has one mandatory capture group");
      refsIndent = indent.length;
      continue;
    }

    if (refsIndent !== -1) {
      const item = /^(\s+-\s+)(\S.*?)\s*$/.exec(line);
      if (item !== null && line.search(/\S/) > refsIndent) {
        const [, prefix, value] = item;
        invariant(
          prefix !== undefined && value !== undefined,
          "refs list-item regex has two mandatory capture groups",
        );
        lines[i] = prefix + apply(value);
        continue;
      }
      // A line that isn't a deeper list item closes the refs block.
      if (line.trim() !== "") refsIndent = -1;
    }
  }

  return lines.join("\n");
}

/**
 * Apply a ref transform to every ref-bearing token in a card's text. Returns
 * the rewritten text and how many tokens actually changed.
 */
function applyTransform(text: string, transform: RefTransform): { text: string; count: number } {
  let count = 0;
  const wrap: RefTransform = (raw) => {
    const out = transform(raw);
    if (out !== raw) count++;
    return out;
  };

  let updated = rewriteFrontmatter(text, wrap);

  // Inline markdown links and images: [text](path) / ![alt](path). The pattern
  // is shared with validate's `extractBodyLinks` so mv rewrites exactly the set
  // of links validate checks.
  updated = updated.replace(inlineLinkPattern(), (_m: string, ...g: string[]) => {
    const [prefix, refPart] = g;
    invariant(
      prefix !== undefined && refPart !== undefined,
      "inline-link regex has two mandatory capture groups",
    );
    return prefix + wrap(refPart);
  });

  // Body `ref="…"` attributes (Markdoc tags; XML attributes pass through
  // harmlessly since remap gates every change).
  updated = updated.replace(/(\bref=)(["'])([^"']*)\2/g, (_m: string, ...g: string[]) => {
    const [attr, quote, value] = g;
    invariant(
      attr !== undefined && quote !== undefined && value !== undefined,
      "ref= attribute regex has three mandatory capture groups",
    );
    return attr + quote + wrap(value) + quote;
  });

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
  return applyTransform(params.text, transform);
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

/** Every raw ref token a card's text carries, across all three ref-bearing forms. */
export function collectCardRefTokens(text: string): string[] {
  const out = new Set<string>();
  applyTransform(text, collectInto(out));
  return [...out];
}

/** Replay a token→replacement decision over a card's text. */
export function rewriteCardRefTokens(
  params: { text: string; replacements: RefReplacements }
): { text: string; count: number } {
  return applyTransform(params.text, replaceFrom(params.replacements));
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
  return applyTransform(params.text, transform);
}
