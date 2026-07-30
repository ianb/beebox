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
 *       - { ref: /store/recipes/Bread.recipe.card, label: the bread }
 *     expand:
 *       - { query: "*.recipe.card", order: modified-desc }
 *   destinations:                    # filing targets
 *     - for: [triage]
 *       rules: "Recipes — anything describing how to cook a dish."
 *       procedure:
 *         ref: /config/procedures/archive-recipe.procedure.card
 *   ---
 *
 * At least one role should be present; a landmark with neither is inert.
 * See docs/landmarks.md and docs/triage.md.
 */

import { splitCardContent, cardSchema, renderFrontmatterBlock, type CardSchema } from "../cards/index.js";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/** Sort order for `expand` fan-out results. */
export const LandmarkOrder = z.enum(["alphabetical", "modified-desc", "modified-asc"]);
export type LandmarkOrderType = z.infer<typeof LandmarkOrder>;

/**
 * The iconic mark for a landmark. Either an emoji / short text, or an
 * image (`{ src }`, a box path with a leading `/`; a path relative to the
 * landmark's directory still resolves).
 */
export const LandmarkSymbol = z.union([z.string(), z.object({ src: z.string() })]);
export type LandmarkSymbolData = z.infer<typeof LandmarkSymbol>;

/**
 * A pinned reference to another card. `ref` is a box path with a leading `/`
 * (a path relative to the landmark's directory still resolves), validated
 * like any other ref. `label` is an optional display label (falls back to
 * the target's filename title).
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
 * When omitted, `template-ref` defaults to the match's box path (leading
 * `/`) — see `core/landmark/resolve.ts`.
 *
 * `group` is the title of a collapsible submenu. When present, this
 * expand's matches stay grouped under that title (collapsed shows the
 * title + a child count) instead of flattening into the landmark's flat
 * link list. When omitted, results flatten inline as before.
 */
export const LandmarkExpand = z.object({
  query: z.string(),
  group: z.string().optional(),
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
 * `commentary`). `rules`/`procedure` are only meaningful when `for`
 * includes `triage`. `procedure` is a card ref — `{ ref: <box path> }`,
 * leading `/` (a landmark-dir-relative path still resolves) — to the
 * handler procedure run at the handle stage.
 */
export const LandmarkDestination = z.object({
  for: z.array(z.string()),
  rules: z.string().optional(),
  procedure: z.object({ ref: z.string() }).optional(),
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
  description: "Marks its directory as a notable spot — a curated navigation bookmark and/or a triage filing destination; one per directory",
  category: "authored",
  fields: landmarkFields,
  searchable: false,
  instructions: `# Landmark Cards

A landmark marks a directory as a notable spot in the box — a hand-curated bookmark that can also be a triage destination. One per directory; the file lives inside the directory it describes, e.g. \`store/recipes/Recipes.landmark.card\`. Directories without a landmark are invisible to the Landmarks page and to triage.

A landmark is pure YAML frontmatter (no body) with one or more roles. At least one role should be present.

## \`navigation\` (human-facing surface)

\`\`\`yaml
navigation:
  label: Recipes            # short bookmark name; treat like a tab name, not a sentence
  symbol: 🍳                # emoji/short text, OR { src: /store/recipes/images/portrait.webp } for an image
  links:                    # optional curated links to other cards
    - ref: /store/recipes/Bread.recipe.card  # box path (leading /); validated
      label: the bread        # optional; falls back to the target's filename title
  expand:                   # optional templated fan-out
    - query: "*.recipe.card"  # glob, like cb ls
      order: modified-desc    # alphabetical (default) | modified-desc | modified-asc
    - query: "**/*.image.card"
      group: Images           # optional: render matches as a collapsible submenu titled "Images"
  chat-app:                 # optional chat-feature seed for chats opened here
    narration: "on"
    prose: "off"
\`\`\`

\`ref\` and \`symbol.src\` are **box paths — write them with a leading \`/\`, from the box root**. A path relative to the landmark's directory still resolves (older landmarks are written that way), but new ones use the box path. \`expand\` \`query\` globs are the exception: they are queries, not refs, and always run relative to the landmark's directory.

In an \`expand\`, \`template-ref\` / \`template-label\` are placeholder strings substituted per match: \`\${path}\` is the matched card's path relative to the landmark's directory, any other \`\${field}\` reads that field from the matched card's frontmatter. When omitted, \`template-ref\` defaults to the match's box path. (\`template-ref\` is a \`\${…}\` substitution *pattern*, not a card ref — it is not stored under a \`ref\` key.)

Add \`group: <title>\` to an \`expand\` to keep its matches grouped as a **collapsible submenu** instead of flattening them into the flat link list. Collapsed, the group shows its title and a child count; expanded, it reveals the matched links. Use this for "all the X" globs (e.g. \`group: Images\` over \`**/*.image.card\`) that would otherwise flood the flat list. An expand without \`group\` flattens inline as before. Group children dedup within the group only — they are independent of the flat list and of other groups.

**Don't add a description or purpose field.** A bookmark seen many times shouldn't carry a paragraph explaining itself. If a landmark genuinely needs prose, write a doc card and link to it.

## \`destinations\` (agent-facing filing targets)

\`\`\`yaml
destinations:
  - for: [triage]           # kinds: triage (inbox→triage routing target) and/or commentary
    rules: "Recipes — anything describing how to cook a dish."  # read by the triage agent
    procedure:                # handler run at the handle stage; a card ref ({ ref: <box path> })
      ref: /config/procedures/archive-recipe.procedure.card
  - for: [commentary]       # a commentary-only spot needs neither rules nor procedure
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
 * Pass `symbol` for an emoji/text symbol, or `symbolSrc` for an image box
 * path (leading `/`; a landmark-dir-relative path also resolves).
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
  return renderFrontmatterBlock({ navigation });
}
