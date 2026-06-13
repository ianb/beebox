/**
 * Landmark card schema — a hand-curated bookmark for a directory.
 *
 * One landmark per directory; the file lives inside the directory it
 * describes (e.g. `store/recipes/Recipes.landmark.card`). A landmark
 * carries one or more *roles* as child elements:
 *
 *   <landmark>
 *     <navigation>…label/symbol/links…</navigation>     (human-facing surface)
 *     <destination for="triage commentary">…</destination>  (filing target)
 *   </landmark>
 *
 * At least one role must be present; any combination is allowed. The legacy
 * `<triage-destination>` element is still accepted and means
 * `<destination for="triage">` (see docs/plans/web-page-commentary.md, Track 1).
 * See docs/landmarks.md and docs/plans/triage-design.md.
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
 *   <symbol src="images/character.webp"/>          — image (path relative
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
 * Optional chat-feature seed for chats opened from this landmark.
 * Each attribute is a feature name (from the chat-features registry)
 * and its initial value. Only applied at session open — the user can
 * still toggle features afterward.
 *
 * Mirrors the `<chat-app>` envelope tag used in chat itself, so the
 * same vocabulary covers both the landmark seed and the agent-emitted
 * delta. See `docs/implemented-plans/narration-mode-design.md`.
 *
 * ```xml
 * <chat-app narration="on" prose="off"/>
 * ```
 */
export const LandmarkChatApp = element("chat-app", {
  attrs: {
    narration: z.enum(["on", "off"]).optional(),
    prose: z.enum(["on", "off"]).optional(),
  },
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
 * Human-facing role: the navigation surface for this spot. Carries
 * the label, symbol, and curated links shown on the Landmarks page.
 *
 * Everything that used to sit directly under `<landmark>` lives here.
 */
export const LandmarkNavigation = element("navigation", {
  children: z.array(
    z.union([LandmarkLabel, LandmarkSymbol, LandmarkLink, LandmarkExpand, LandmarkChatApp])
  ),
});

/**
 * Triage rules — prose describing what kinds of items belong in this
 * destination. The triage agent reads this when deciding category.
 */
export const TriageRules = element("rules", {
  text: z.string(),
});

/**
 * Inline handler procedure step. A `<procedure>` element with no
 * children and a `ref` attribute references a procedure card living
 * elsewhere; with children, it's an inline procedure.
 *
 * Procedure-step internals are intentionally loose at this layer —
 * the procedure engine validates them.
 */
export const TriageProcedure = element("procedure", {
  attrs: {
    ref: z.string().optional(),
  },
  children: z.array(z.unknown()).optional(),
});

/**
 * Agent-facing role: a triage destination. The triage stage reads
 * `<rules>` to decide what routes here; the handle stage runs
 * `<procedure>` against the items collected in the holding spot.
 */
export const LandmarkTriageDestination = element("triage-destination", {
  children: z.array(z.union([TriageRules, TriageProcedure])),
});

/**
 * Filing-target role: marks the landmark's directory as a destination for one
 * or more *kinds* of content. `for` is a space-separated set of kinds:
 *
 *   <destination for="triage">…rules/procedure…</destination>  inbox-triage target
 *   <destination for="commentary"/>                             commentary filing spot
 *   <destination for="triage commentary">…</destination>        both
 *
 * `<rules>`/`<procedure>` are only meaningful when `for` includes `triage`
 * (the triage stage reads them); a `commentary`-only destination needs
 * neither. Unknown kinds are tolerated (forward-compat) — see
 * `roleDestinationKinds` in `core/landmark/destination.ts`. This supersedes
 * `<triage-destination>`, which remains a back-compat alias for
 * `for="triage"`.
 */
export const LandmarkDestination = element("destination", {
  attrs: {
    for: z.string(),
  },
  children: z.array(z.union([TriageRules, TriageProcedure])),
});

/**
 * Landmark card schema.
 *
 * ```xml
 * <landmark>
 * <navigation>
 *   <label>Recipes</label>
 *   <symbol>🍳</symbol>
 *   <link ref="Bread.recipe.card">the bread</link>
 *   <expand query="*.recipe.card" order="modified-desc">
 *     <link template-ref="${path}">${title}</link>
 *   </expand>
 * </navigation>
 * <destination for="triage">
 *   <rules>Recipes — anything describing how to cook a dish.</rules>
 *   <procedure ref="archive-recipe.procedure.card"/>
 * </destination>
 * </landmark>
 * ```
 */
export const LandmarkSchema = element("landmark", {
  children: z.array(
    z.union([LandmarkNavigation, LandmarkDestination, LandmarkTriageDestination]),
  ),
  instructions: `# Landmark Cards

A landmark marks a directory as a notable spot in the box. It's a hand-curated bookmark that can also be a triage destination — anywhere the system needs a named spot with metadata.

**One per directory.** The file lives inside the directory it describes, e.g. \`store/recipes/Recipes.landmark.card\`. Directories without a landmark are invisible to the Landmarks page and to triage.

**Roles.** A landmark carries one or more role child elements:
- \`<navigation>\` — human-facing: appears on the Landmarks page, carries the bookmark fields.
- \`<destination for="…">\` — agent-facing: marks this directory as a filing target. \`for\` is a space-separated set of kinds: \`triage\` (a routing target for the inbox→triage pipeline) and/or \`commentary\` (a place web-page commentary documents are filed). A \`triage\` destination carries \`<rules>\`/\`<procedure>\`; a \`commentary\`-only destination needs neither.

A landmark must have at least one role; many will have both. A pure routing target (an archive humans don't browse) can have only \`<destination>\`; a pure bookmark (a Recipes tile) can have only \`<navigation>\`.

> Back-compat: \`<triage-destination>…</triage-destination>\` is still accepted and means \`<destination for="triage">…</destination>\`. Prefer \`<destination>\` in new cards.

**\`<navigation>\` fields:**
- \`<label>\` — short bookmark name. Treat like a tab name, not a sentence.
- \`<symbol>\` — the iconic mark. Either an emoji / short text (\`<symbol>🍳</symbol>\`) or an image (\`<symbol src="images/portrait.webp"/>\`). Image \`src\` is a path relative to the landmark's directory; cross-directory paths are allowed.
- \`<link ref="...">\` — optional curated references to other cards. Inner text is a per-landmark label; falls back to the target's title if omitted. The \`ref\` is a literal path relative to the landmark's directory; cross-directory refs are allowed. \`ref\` is validated like any other ref — it must point at a real file.
- \`<expand query="..." order="...">\` — optional templated fan-out. \`query\` is a glob (like \`cb ls\`). The element's children form the template; inside that template, links use \`template-ref="..."\` (NOT \`ref=""\`) so the validator doesn't try to resolve placeholders. Placeholders are \`\${path}\` (matched card's path) and \`\${xpath-expr}\` (XPath against the matched card's root). \`order\` is one of \`alphabetical\` (default), \`modified-desc\`, \`modified-asc\`.
- \`<chat-app>\` — optional chat-feature seed for chats opened from this landmark.

**Don't add a description or purpose field.** A bookmark seen many times shouldn't carry a paragraph explaining itself. If a landmark genuinely needs prose, write a doc card and \`<link>\` to it.

**\`<destination for="triage">\` fields:**
- \`<rules>\` — prose describing what kinds of items belong here. Read by the triage agent. Aim for general rules over enumerated examples.
- \`<procedure>\` — the handler procedure run at the *handle* stage. Either inline (children are procedure steps) or by reference (\`<procedure ref="path/to/proc.procedure.card"/>\`).

**Dedup**: a card appearing in both a hand-listed \`<link>\` and an \`<expand>\` result shows once — first occurrence in source order wins.`,
});

export type Landmark = z.infer<typeof LandmarkSchema>;

/**
 * Landmark loader — title is the `<label>` text inside `<navigation>`,
 * falling back to the filename.
 */
export const landmarkLoader: FileLoader<Record<string, never>> = (raw) => {
  const fallback = titleFromFilename(raw.path);
  const el = raw.element;
  if (!el) {
    return { path: raw.path, tagName: "landmark", title: fallback, attrs: {} };
  }

  let title = "";
  for (const role of el.children) {
    if (role.tagName !== "navigation") continue;
    for (const child of role.children) {
      if (child.tagName === "label" && typeof child.text === "string" && child.text.trim()) {
        title = child.text.trim();
        break;
      }
    }
    if (title) break;
  }
  if (!title) title = fallback;

  return { path: raw.path, tagName: "landmark", title, attrs: {} };
};

/**
 * Template for `cb create` — produces a starter landmark with a
 * `<navigation>` role containing label + symbol.
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
<navigation>
<label>${escapeText(options.label)}</label>
${symbol}
</navigation>
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
