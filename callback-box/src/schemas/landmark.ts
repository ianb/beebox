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
 * The iconic mark for the landmark. Emoji is the v1 form; image and
 * styling extensions can be added later as new attributes/children
 * without breaking existing cards.
 */
export const LandmarkSymbol = element("symbol", {
  text: z.string(),
});

/**
 * A pinned reference to another card.
 *
 * `ref` is the path to the target, relative to the landmark's directory.
 * Inner text is an optional per-landmark contextual label; if omitted,
 * the renderer falls back to the target's own title.
 */
export const LandmarkLink = element("link", {
  attrs: {
    ref: z.string(),
  },
  text: z.string().optional(),
});

/**
 * Templated fan-out. Runs `query` (a glob) against the landmark's
 * directory and emits a `<link>` per match.
 *
 * The element's children are the template; if omitted, the default
 * template is `<link ref="${path}"/>`. Template placeholders use
 * `${...}` — `${path}` is special-cased to the matched card's
 * box-relative path; other expressions are evaluated as XPath against
 * the matched card's root.
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
 *   <link ref="${path}">${title}</link>
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
- \`<symbol>\` — the iconic mark. Emoji for now.
- \`<link ref="...">\` — optional curated references to other cards. Inner text is a per-landmark label; falls back to the target's title if omitted. The \`ref\` is a path relative to the landmark's directory; cross-directory refs are allowed.
- \`<expand query="..." order="...">\` — optional templated fan-out. \`query\` is a glob (like \`cb ls\`). The element's children form the template; placeholders \`\${path}\` and \`\${xpath}\` are interpolated per match. \`order\` is one of \`alphabetical\` (default), \`modified-desc\`, \`modified-asc\`.

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
 */
export function createLandmarkTemplate(options: { label: string; symbol: string }): string {
  return `<landmark>
<label>${escapeText(options.label)}</label>
<symbol>${escapeText(options.symbol)}</symbol>
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
