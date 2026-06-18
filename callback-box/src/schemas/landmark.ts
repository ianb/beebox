/**
 * Landmark card schema — a hand-curated bookmark for a directory.
 *
 * One landmark per directory; the file lives inside the directory it
 * describes (e.g. `store/recipes/Recipes.landmark.card`). A landmark is
 * pure structured metadata (YAML frontmatter, no body) carrying one or
 * more *roles*:
 *
 *   ---
 *   navigation:                      # human-facing surface
 *     label: Recipes
 *     symbol: 🍳
 *     links:
 *       - { ref: Bread.recipe.card, label: the bread }
 *     expand:
 *       - { query: "*.recipe.card", order: modified-desc }
 *   destinations:                    # filing targets
 *     - for: [triage]
 *       rules: "Recipes — anything describing how to cook a dish."
 *       procedure-ref: archive-recipe.procedure.card
 *   ---
 *
 * At least one role should be present; a landmark with neither is inert.
 * See docs/landmarks.md and docs/plans/triage-design.md.
 */

import { splitCardContent, cardSchema, type CardSchema } from "cardworks";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

/** Sort order for `expand` fan-out results. */
export const LandmarkOrder = z.enum(["alphabetical", "modified-desc", "modified-asc"]);
export type LandmarkOrderType = z.infer<typeof LandmarkOrder>;

/**
 * The iconic mark for a landmark. Either an emoji / short text, or an
 * image (`{ src }`, a path relative to the landmark's directory).
 */
export const LandmarkSymbol = z.union([z.string(), z.object({ src: z.string() })]);
export type LandmarkSymbolData = z.infer<typeof LandmarkSymbol>;

/**
 * A pinned reference to another card. `ref` is a literal path relative to
 * the landmark's directory, validated like any other ref. `label` is an
 * optional display label (falls back to the target's filename title).
 */
export const LandmarkLink = z.object({
  ref: z.string(),
  label: z.string().optional(),
});
export type LandmarkLinkData = z.infer<typeof LandmarkLink>;

/**
 * Templated fan-out. Runs `query` (a glob, relative to the landmark's
 * directory) and emits one link per match.
 *
 * `template-ref` / `template-label` are placeholder strings substituted
 * per match: `${path}` is the matched card's path (relative to the
 * landmark dir); any other `${field}` reads that field from the matched
 * card's frontmatter (dotted paths allowed, e.g. `${exif.camera}`).
 * When omitted, `template-ref` defaults to `${path}`.
 */
export const LandmarkExpand = z.object({
  query: z.string(),
  order: LandmarkOrder.optional(),
  "template-ref": z.string().optional(),
  "template-label": z.string().optional(),
});
export type LandmarkExpandData = z.infer<typeof LandmarkExpand>;

/**
 * Chat-feature seed for chats opened from this landmark. Each key is a
 * feature name; only applied at session open.
 */
export const LandmarkChatApp = z.object({
  narration: z.enum(["on", "off"]).optional(),
  prose: z.enum(["on", "off"]).optional(),
});
export type LandmarkChatAppData = z.infer<typeof LandmarkChatApp>;

/**
 * Human-facing navigation role: the bookmark surface shown on the
 * Landmarks page.
 */
export const LandmarkNavigation = z.object({
  label: z.string().optional(),
  symbol: LandmarkSymbol.optional(),
  links: z.array(LandmarkLink).optional(),
  expand: z.array(LandmarkExpand).optional(),
  "chat-app": LandmarkChatApp.optional(),
});
export type LandmarkNavigationData = z.infer<typeof LandmarkNavigation>;

/**
 * Filing-target role: marks the landmark's directory as a destination for
 * one or more *kinds* of content. `for` lists the kinds (e.g. `triage`,
 * `commentary`). `rules`/`procedure-ref` are only meaningful when `for`
 * includes `triage`.
 */
export const LandmarkDestination = z.object({
  for: z.array(z.string()),
  rules: z.string().optional(),
  "procedure-ref": z.string().optional(),
});
export type LandmarkDestinationData = z.infer<typeof LandmarkDestination>;

const landmarkFields = {
  navigation: LandmarkNavigation.optional(),
  destinations: z.array(LandmarkDestination).optional(),
};

/**
 * Standalone object schema for the landmark frontmatter, used by
 * lightweight readers (the landmarks router, triage-instructions, etc.)
 * that parse a landmark file directly rather than through the card
 * loader. Unknown keys (global card fields, a stray `type:`) are stripped.
 */
const LandmarkObject = z.object(landmarkFields);
export type LandmarkFields = z.infer<typeof LandmarkObject>;

export const LandmarkSchema: CardSchema = cardSchema("landmark", {
  fields: landmarkFields,
  searchable: false,
  instructions: `# Landmark Cards

A landmark marks a directory as a notable spot in the box — a hand-curated bookmark that can also be a triage destination. One per directory; the file lives inside the directory it describes, e.g. \`store/recipes/Recipes.landmark.card\`. Directories without a landmark are invisible to the Landmarks page and to triage.

A landmark is pure YAML frontmatter (no body) with one or more roles. At least one role should be present.

## \`navigation\` (human-facing surface)

\`\`\`yaml
navigation:
  label: Recipes            # short bookmark name; treat like a tab name, not a sentence
  symbol: 🍳                # emoji/short text, OR { src: images/portrait.webp } for an image
  links:                    # optional curated links to other cards
    - ref: Bread.recipe.card  # literal path relative to the landmark's directory; validated
      label: the bread        # optional; falls back to the target's filename title
  expand:                   # optional templated fan-out
    - query: "*.recipe.card"  # glob, like cb ls
      order: modified-desc    # alphabetical (default) | modified-desc | modified-asc
  chat-app:                 # optional chat-feature seed for chats opened here
    narration: "on"
    prose: "off"
\`\`\`

In an \`expand\`, \`template-ref\` / \`template-label\` are placeholder strings substituted per match: \`\${path}\` is the matched card's path, any other \`\${field}\` reads that field from the matched card's frontmatter. When omitted, \`template-ref\` defaults to \`\${path}\`.

**Don't add a description or purpose field.** A bookmark seen many times shouldn't carry a paragraph explaining itself. If a landmark genuinely needs prose, write a doc card and link to it.

## \`destinations\` (agent-facing filing targets)

\`\`\`yaml
destinations:
  - for: [triage]           # kinds: triage (inbox→triage routing target) and/or commentary
    rules: "Recipes — anything describing how to cook a dish."  # read by the triage agent
    procedure-ref: archive-recipe.procedure.card                # handler run at the handle stage
  - for: [commentary]       # a commentary-only spot needs neither rules nor procedure-ref
\`\`\`

A pure routing target (an archive humans don't browse) can have only \`destinations\`; a pure bookmark can have only \`navigation\`.

**Dedup**: a card appearing in both a hand-listed \`links\` entry and an \`expand\` result shows once — hand-listed links come first.`,
});

export type Landmark = LandmarkFields;

/**
 * Parse a landmark card's raw text into its typed frontmatter, or null if
 * it has no frontmatter or fails validation. Used by readers that scan
 * landmark files directly (the landmarks router, triage-instructions,
 * list-destinations, feature seeds) instead of going through the card
 * loader.
 */
export function parseLandmarkFields(content: string): LandmarkFields | null {
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return null;
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (_e) {
    return null;
  }
  const parsed = LandmarkObject.safeParse(fm ?? {});
  if (!parsed.success) return null;
  return parsed.data;
}

/**
 * Template for `cb create` — produces a starter landmark with a
 * `navigation` role containing label + symbol.
 *
 * Pass `symbol` for an emoji/text symbol, or `symbolSrc` for an image
 * path (relative to the landmark's directory).
 */
export function createLandmarkTemplate(options: {
  label: string;
  symbol?: string;
  symbolSrc?: string;
}): string {
  const navigation: Record<string, unknown> = { label: options.label };
  if (typeof options.symbolSrc === "string" && options.symbolSrc !== "") {
    navigation.symbol = { src: options.symbolSrc };
  } else if (typeof options.symbol === "string" && options.symbol !== "") {
    navigation.symbol = options.symbol;
  }
  const yamlText = stringifyYaml({ navigation });
  return `---\n${yamlText}---\n`;
}
