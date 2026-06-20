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
 */

import * as path from "node:path";
import { isAttachRef, resolveAttachRef } from "../shared/attach-path.js";

/**
 * Decide where a resolved target moves to. Receives an absolute path; returns
 * the absolute destination, or `null` if the target isn't moving.
 */
export type Remap = (resolvedAbsPath: string) => string | null;

/** Split a ref's path from a trailing `#fragment` (anchor / message id). */
function splitFragment(ref: string): { pathPart: string; fragment: string } {
  const fragmentStart = ref.indexOf("#");
  if (fragmentStart === -1) return { pathPart: ref, fragment: "" };
  return { pathPart: ref.slice(0, fragmentStart), fragment: ref.slice(fragmentStart) };
}

/**
 * Resolve a ref's path part to an absolute filesystem path, using the same
 * rules as the renderer: leading `/` is box-root-absolute, `attach/` resolves
 * into the card's own attach scope, everything else is relative to the card.
 * Returns `null` for refs we don't resolve (empty, protocol URLs).
 */
function resolveRefToAbs(params: {
  boxRoot: string;
  cardAbsPath: string;
  pathPart: string;
}): string | null {
  const { boxRoot, cardAbsPath, pathPart } = params;
  if (pathPart === "") return null;
  if (pathPart.includes("://")) return null;
  if (pathPart.startsWith("/")) {
    return path.normalize(path.join(boxRoot, pathPart));
  }
  if (isAttachRef(pathPart)) {
    const resolved = resolveAttachRef(cardAbsPath, pathPart);
    return resolved === null ? null : path.normalize(resolved);
  }
  return path.resolve(path.dirname(cardAbsPath), pathPart);
}

/**
 * Re-express a moved target as a ref string from `cardAbsPath`, preserving the
 * original ref's absolute-vs-relative style and trailing fragment.
 */
function restyleRef(params: {
  boxRoot: string;
  cardAbsPath: string;
  newAbs: string;
  wasAbsolute: boolean;
  fragment: string;
}): string {
  const { boxRoot, cardAbsPath, newAbs, wasAbsolute, fragment } = params;
  const body = wasAbsolute
    ? "/" + path.relative(boxRoot, newAbs)
    : path.relative(path.dirname(cardAbsPath), newAbs);
  return body + fragment;
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
    const { pathPart, fragment } = splitFragment(rawRef);
    const abs = resolveRefToAbs({ boxRoot, cardAbsPath, pathPart });
    if (abs === null) return rawRef;
    const newAbs = remap(abs);
    if (newAbs === null) return rawRef;
    return restyleRef({
      boxRoot,
      cardAbsPath,
      newAbs,
      wasAbsolute: pathPart.startsWith("/"),
      fragment,
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
    const { pathPart, fragment } = splitFragment(rawRef);
    if (pathPart === "" || pathPart.startsWith("/") || isAttachRef(pathPart)) {
      return rawRef;
    }
    const abs = resolveRefToAbs({ boxRoot, cardAbsPath: oldCardAbs, pathPart });
    if (abs === null) return rawRef;
    const remapped = remap(abs);
    const target = remapped === null ? abs : remapped;
    return path.relative(path.dirname(newCardAbs), target) + fragment;
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
 * next `---`). Only the `ref:` and `refs:` keys carry refs, matching the
 * frontmatter ref convention. Returns the text with that region rewritten.
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

    const scalar = /^(\s*ref:\s+)(\S.*?)\s*$/.exec(line);
    if (scalar !== null) {
      lines[i] = scalar[1]! + apply(scalar[2]!);
      refsIndent = -1;
      continue;
    }

    const inlineList = /^(\s*refs:\s*\[)(.*)(]\s*)$/.exec(line);
    if (inlineList !== null) {
      const items = inlineList[2]!
        .split(",")
        .map((item) => {
          const m = /^(\s*)(\S.*?)(\s*)$/.exec(item);
          if (m === null) return item;
          return m[1]! + apply(m[2]!) + m[3]!;
        })
        .join(",");
      lines[i] = inlineList[1]! + items + inlineList[3]!;
      refsIndent = -1;
      continue;
    }

    const blockOpen = /^(\s*)refs:\s*$/.exec(line);
    if (blockOpen !== null) {
      refsIndent = blockOpen[1]!.length;
      continue;
    }

    if (refsIndent !== -1) {
      const item = /^(\s+-\s+)(\S.*?)\s*$/.exec(line);
      if (item !== null && line.search(/\S/) > refsIndent) {
        lines[i] = item[1]! + apply(item[2]!);
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

  // Inline markdown links and images: [text](path) / ![alt](path).
  updated = updated.replace(
    /(!?\[[^\]]*]\(\s*)([^\s()]+)/g,
    (_m: string, ...g: string[]) => g[0]! + wrap(g[1]!),
  );

  // Body `ref="…"` attributes (Markdoc tags; XML attributes pass through
  // harmlessly since remap gates every change).
  updated = updated.replace(
    /(\bref=)(["'])([^"']*)\2/g,
    (_m: string, ...g: string[]) => g[0]! + g[1]! + wrap(g[2]!) + g[1]!,
  );

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
