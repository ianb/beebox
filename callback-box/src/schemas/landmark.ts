/**
 * Landmark card schema — a hand-curated bookmark for a directory.
 *
 * One landmark per directory; the file lives inside the directory it
 * describes (e.g. `store/recipes/Recipes.landmark.card`). The Landmarks
 * page collects all `**\/*.landmark.card` and presents them as a flat list
 * of tiles. See docs/landmarks.md.
 */

import { element, escapeAttr, escapeText } from "cardworks";
import { z } from "zod";
import { type FileLoader, titleFromFilename } from "../core/file-summary.js";

/**
 * Short bookmark name. Treat like a tab name — not a sentence.
 */
export const LandmarkLabel = element("label", {
  text: z.string(),
});

/**
 * The iconic mark for the landmark. Two forms:
 *
 *   <symbol>🍳</symbol>                            — emoji or short text
 *   <symbol src="images/Marisol.webp"/>            — image (path relative
 *                                                    to the landmark's
 *                                                    directory)
 *
 * One or the other; if `src` is set the renderer shows the image,
 * otherwise it shows the text.
 */
export const LandmarkSymbol = element("symbol", {
  attrs: {
    src: z.string().optional(),
  },
  text: z.string().optional(),
});

/**
 * A pinned reference to another card.
 *
 * Hand-listed links use `ref` — a literal path relative to the
 * landmark's directory, validated like any other ref.
 *
 * Templates inside `<expand>` use `template-ref` — a string with
 * `${path}` / `${xpath}` placeholders that get substituted per match.
 * The two attributes are separate so the validator never tries to
 * resolve a placeholder as a real path.
 *
 * Inner text is an optional contextual label. In hand-listed links
 * it's a literal label; in template links it's a placeholder string
 * (e.g. `${title}`) that's substituted per match.
 */
export const LandmarkLink = element("link", {
  attrs: {
    ref: z.string().optional(),
    "template-ref": z.string().optional(),
  },
  text: z.string().optional(),
});

/**
 * Templated fan-out. Runs `query` (a glob) against the landmark's
 * directory and emits a `<link>` per match.
 *
 * The element's children are the template; if omitted, the default
 * template is `<link template-ref="${path}"/>`. Template placeholders
 * use `${...}` — `${path}` is special-cased to the matched card's path
 * (relative to the landmark's directory); other expressions are
 * evaluated as XPath against the matched card's root.
 *
 * Template links must use `template-ref`, not `ref` — `ref` is for
 * literal paths and gets validated by cardworks; `template-ref`
 * carries placeholders that are substituted at render time.
 *
 * Dedup: if a card appears in both a hand-listed `<link>` and an
 * `<expand>` result, the first occurrence wins (source order).
 */
export const LandmarkExpand = element("expand", {
  attrs: {
    query: z.string(),
    order: z
      .enum(["alphabetical", "modified-desc", "modified-asc"])
      .optional(),
  },
  children: z.array(LandmarkLink).optional(),
});

/**
 * Landmark card schema.
 *
 * ```xml
 * <landmark>
 * <label>Recipes</label>
 * <symbol>🍳</symbol>
 * <link ref="Bread.recipe.card">the bread</link>
 * <expand query="*.recipe.card" order="modified-desc">
 *   <link template-ref="${path}">${title}</link>
 * </expand>
 * </landmark>
 * ```
 */
export const LandmarkSchema = element("landmark", {
  children: z.array(
    z.union([LandmarkLabel, LandmarkSymbol, LandmarkLink, LandmarkExpand])
  ),
  instructions: `# Landmark Cards

A landmark marks a directory as a notable spot in the box. It's a hand-curated bookmark, not a museum plaque — most appearances are tiles in the Landmarks page, and the iconic form (symbol + label) is the entire content most of the time.

**One per directory.** The file lives inside the directory it describes, e.g. \`store/recipes/Recipes.landmark.card\`. Directories without a landmark are invisible to the Landmarks page; that's the point.

**Structure:**
- \`<label>\` — short bookmark name. Treat like a tab name, not a sentence.
- \`<symbol>\` — the iconic mark. Either an emoji / short text (\`<symbol>🍳</symbol>\`) or an image (\`<symbol src="images/Marisol.webp"/>\`). Image \`src\` is a path relative to the landmark's directory; cross-directory paths are allowed. For character-driven landmarks the portrait makes a stronger bookmark than an emoji.
- \`<link ref="...">\` — optional curated references to other cards. Inner text is a per-landmark label; falls back to the target's title if omitted. The \`ref\` is a literal path relative to the landmark's directory; cross-directory refs are allowed. \`ref\` is validated like any other ref — it must point at a real file.
- \`<expand query="..." order="...">\` — optional templated fan-out. \`query\` is a glob (like \`cb ls\`). The element's children form the template; inside that template, links use \`template-ref="..."\` (NOT \`ref=""\`) so the validator doesn't try to resolve placeholders. Placeholders are \`\${path}\` (matched card's path) and \`\${xpath-expr}\` (XPath against the matched card's root). \`order\` is one of \`alphabetical\` (default), \`modified-desc\`, \`modified-asc\`.

**Don't add a description or purpose field.** A bookmark seen many times shouldn't carry a paragraph explaining itself. If a landmark genuinely needs prose, write a doc card and \`<link>\` to it.

**Dedup**: a card appearing in both a hand-listed \`<link>\` and an \`<expand>\` result shows once — first occurrence in source order wins.`,
});

export type Landmark = z.infer<typeof LandmarkSchema>;

/**
 * Landmark loader — title is the `<label>` text, falling back to the filename.
 */
export const landmarkLoader: FileLoader<Record<string, never>> = (raw) => {
  const fallback = titleFromFilename(raw.path);
  const el = raw.element;
  if (!el) {
    return { path: raw.path, tagName: "landmark", title: fallback, attrs: {} };
  }

  let title = "";
  for (const child of el.children) {
    if (child.tagName === "label" && typeof child.text === "string" && child.text.trim()) {
      title = child.text.trim();
      break;
    }
  }
  if (!title) title = fallback;

  return { path: raw.path, tagName: "landmark", title, attrs: {} };
};

/**
 * Template for `cb create` — produces a starter landmark with placeholders.
 *
 * Pass `symbol` for an emoji/text symbol, or `symbolSrc` for an image
 * path (relative to the landmark's directory).
 */
export function createLandmarkTemplate(options: {
  label: string;
  symbol?: string;
  symbolSrc?: string;
}): string {
  const symbol = options.symbolSrc
    ? `<symbol src="${escapeAttr(options.symbolSrc)}"/>`
    : `<symbol>${escapeText(options.symbol ?? "")}</symbol>`;
  return `<landmark>
<label>${escapeText(options.label)}</label>
${symbol}
</landmark>
`;
}

/**
 * Helper for building a `<link>` element string with optional label text.
 * Exported for use by anything constructing landmark XML programmatically.
 */
export function renderLandmarkLink(options: { ref: string; label?: string }): string {
  const labelText = options.label;
  if (typeof labelText === "string" && labelText.length > 0) {
    return `<link ref="${escapeAttr(options.ref)}">${escapeText(labelText)}</link>`;
  }
  return `<link ref="${escapeAttr(options.ref)}"/>`;
}
