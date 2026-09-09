/**
 * Landmark card schema — a hand-curated bookmark for a directory.
 *
 * One landmark per directory; the file lives inside the directory it
 * describes (e.g. `_content/recipes/Recipes.landmark.card`). A landmark is
 * pure structured metadata (YAML frontmatter, no body) carrying one or
 * more *roles*:
 *
 *   ---
 *   symbol:                          # the card's mark
 *     glyph: 🍳
 *   navigation:                      # human-facing surface
 *     label: Recipes
 *     links:
 *       - { ref: /_content/recipes/Bread.recipe.card, label: the bread }
 *     expand:
 *       - { query: "*.recipe.card", order: modified-desc }
 *   destinations:                    # filing targets
 *     - for: [triage]
 *       rules: "Recipes — anything describing how to cook a dish."
 *       procedure:
 *         ref: /_config/procedures/archive-recipe.procedure.card
 *   ---
 *
 * At least one role should be present; a landmark with neither is inert.
 * See docs/landmarks.md and docs/triage.md.
 */

import { splitCardContent, cardSchema, renderFrontmatterBlock, type CardSchema } from "../cards/index.js";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { CardSymbol } from "../shared/card-symbol.js";
import { Prominence } from "../shared/prominence.js";
import { SystemThemeChoiceSchema } from "../shared/card-theme.js";

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
const LandmarkLink = z.object({
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
const LandmarkChatApp = z.object({
  narration: z.enum(["on", "off"]).optional(),
  prose: z.enum(["on", "off"]).optional(),
  "hq-dictation": z.enum(["on", "off"]).optional(),
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
 * handler procedure run at the handle stage. `share` advertises the directory
 * as a native share-sheet save target.
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
  "system-theme": SystemThemeChoiceSchema.optional(),
};

/**
 * Standalone object schema for the landmark frontmatter, used by
 * lightweight readers (the landmarks router, triage-instructions, etc.)
 * that parse a landmark file directly rather than through the card
 * loader. Unknown keys (most global card fields, a stray `type:`) are stripped.
 *
 * `symbol` is the exception, admitted explicitly: it is a global field
 * (`GLOBAL_CARD_FIELDS`) that these readers must see, because a landmark's mark
 * now lives there rather than under `navigation`. Stripping it is what would
 * make a migrated landmark render as no symbol at all.
 *
 * `prominence` is admitted the same way: a written value describes the
 * *place*, not the file (the file itself is background by type — see
 * `LandmarkSchema`'s `prominence: "background"` below), and these readers
 * must see it to apply the `background` cascade.
 */
const LandmarkObject = z.object({
  ...landmarkFields,
  symbol: CardSymbol.optional(),
  prominence: Prominence.optional(),
});
const LightweightLandmarkObject = LandmarkObject.extend({ "system-theme": z.unknown().optional() });
export type LandmarkFields = z.infer<typeof LandmarkObject>;

export const LandmarkSchema: CardSchema = cardSchema("landmark", {
  description: "Marks its directory as a notable spot — a curated navigation bookmark and/or a triage filing destination; one per directory",
  category: "authored",
  // A landmark is a place marker, not a visitable file: it never lists in a
  // fold, and the directory's identity is drawn from it instead
  // (docs/implemented-plans/card-prominence.md, "Type defaults"). A written `prominence`
  // still means something — see LandmarkObject above — but it describes the
  // place, not this file.
  prominence: "background",
  fields: landmarkFields,
  searchable: false,
  instructions: `# Landmark Cards

A landmark marks a directory as a notable spot in the box — a hand-curated bookmark that can also be a triage destination. One per directory; the file lives inside the directory it describes, e.g. \`_content/recipes/Recipes.landmark.card\`. Directories without a landmark are invisible to the Landmarks page and to triage.

A landmark is pure YAML frontmatter (no body) with one or more roles. At least one role should be present.

An optional top-level \`system-theme\` selects the app chrome while this landmark is active. Use only the theme and stock identifiers documented in \`node_modules/beebox/box-docs/card-themes.md\`.

## \`navigation\` (human-facing surface)

\`\`\`yaml
symbol:                     # the card's mark — every card may carry one
  glyph: 🍳                 # emoji or a letter or two; OR src: /_content/recipes/images/portrait.webp for an image
navigation:
  label: Recipes            # short bookmark name; treat like a tab name, not a sentence
  links:                    # optional curated links to other cards
    - ref: /_content/recipes/Bread.recipe.card  # box path (leading /); validated
      label: the bread        # optional; falls back to the target's filename title
  expand:                   # optional templated fan-out
    - query: "*.recipe.card"  # glob, like bbx ls
      order: modified-desc    # alphabetical (default) | modified-desc | modified-asc
    - query: "**/*.image.card"
      group: Images           # optional: render matches as a collapsible submenu titled "Images"
  chat-app:                 # optional chat-feature seed for chats opened here
    narration: "on"
    prose: "off"
\`\`\`

An older landmark may carry its mark nested as \`navigation.symbol\` (a bare string, or \`{ src }\`) — the shape before the mark became a field every card can have. That form is still read, so a card written that way is not a mistake and does not need fixing by hand; the \`landmark-symbol\` migration moves it. Write new marks at the top level, as above.

\`ref\` and \`symbol.src\` are **box paths — write them with a leading \`/\`, from the box root**. A path relative to the landmark's directory still resolves (older landmarks are written that way), but new ones use the box path. \`expand\` \`query\` globs are the exception: they are queries, not refs, and always run relative to the landmark's directory.

In an \`expand\`, \`template-ref\` / \`template-label\` are placeholder strings substituted per match: \`\${path}\` is the matched card's path relative to the landmark's directory, any other \`\${field}\` reads that field from the matched card's frontmatter. When omitted, \`template-ref\` defaults to the match's box path. (\`template-ref\` is a \`\${…}\` substitution *pattern*, not a card ref — it is not stored under a \`ref\` key.)

Add \`group: <title>\` to an \`expand\` to keep its matches grouped as a **collapsible submenu** instead of flattening them into the flat link list. Collapsed, the group shows its title and a child count; expanded, it reveals the matched links. Use this for "all the X" globs (e.g. \`group: Images\` over \`**/*.image.card\`) that would otherwise flood the flat list. An expand without \`group\` flattens inline as before. Group children dedup within the group only — they are independent of the flat list and of other groups.

**Don't add a description or purpose field.** A bookmark seen many times shouldn't carry a paragraph explaining itself. If a landmark genuinely needs prose, write a doc card and link to it.

## \`destinations\` (agent-facing filing targets)

\`\`\`yaml
destinations:
  - for: [triage]           # kinds: triage, commentary, and/or share
    rules: "Recipes — anything describing how to cook a dish."  # read by the triage agent
    procedure:                # handler run at the handle stage; a card ref ({ ref: <box path> })
      ref: /_config/procedures/archive-recipe.procedure.card
  - for: [commentary]       # a commentary-only spot needs neither rules nor procedure
  - for: [share]            # appears under "Save in" in the native iOS share sheet
\`\`\`

A pure routing target (an archive humans don't browse) can have only \`destinations\`; a pure bookmark can have only \`navigation\`.

**Dedup**: a card appearing in both a hand-listed \`links\` entry and an \`expand\` result shows once — hand-listed links come first.

## Derived links, and \`prominence\`

Most of a landmark's list is **derived**, not listed: every card under its directory carrying \`prominence: entry-point\` or \`prominence: primary\` appears automatically (entry points first, then primary cards, then nested landmarks, then \`expand\` results), and the walk stops at any subdirectory with its own landmark. So the way to surface a card in its own place is to mark the card, not to edit the landmark. \`links:\` is for what a card cannot say about itself: a target outside this directory, a contextual label, or a fixed position. A \`links:\` entry that duplicates a marked in-directory card is harmless (it shows once, listed first) and \`bbx validate\` notes it as a trim candidate.

A landmark card is a place marker, not a visitable file — it is \`background\` by type and never needs \`prominence\` written to be on the Landmarks page. The one value that means something on a landmark is \`prominence: background\`: the place is housekeeping (logs, imports, machinery), it leaves the Landmarks page and the place menu, and everything under it folds in Browse. \`entry-point\` or \`primary\` on a landmark is a lint warning; the place's entry point is a visitable card inside it.`,
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
  const parsed = LightweightLandmarkObject.safeParse(fm ?? {});
  if (!parsed.success) return null;
  const theme = SystemThemeChoiceSchema.safeParse(parsed.data["system-theme"]);
  const { "system-theme": _untrustedTheme, ...roles } = parsed.data;
  void _untrustedTheme;
  return theme.success ? { ...roles, "system-theme": theme.data } : roles;
}

/**
 * Template for `bbx create` — produces a starter landmark with a `navigation`
 * role for the label and the card's own `symbol` group for the mark.
 *
 * A new landmark is never born in the legacy shape: `navigation.symbol` is
 * read for boxes that predate the `landmark-symbol` migration, and written by
 * nothing (docs/plans/card-symbol.md).
 *
 * Pass `symbol` for an emoji/text mark, or `symbolSrc` for an image box path
 * (leading `/`; a landmark-dir-relative path also resolves).
 */
export function createLandmarkTemplate(options: {
  label: string;
  symbol?: string;
  symbolSrc?: string;
}): string {
  const navigation: Record<string, unknown> = { label: options.label };
  const fields: Record<string, unknown> = { navigation };
  if (typeof options.symbolSrc === "string" && options.symbolSrc !== "") {
    fields["symbol"] = { src: options.symbolSrc };
  } else if (typeof options.symbol === "string" && options.symbol !== "") {
    fields["symbol"] = { glyph: options.symbol };
  }
  return renderFrontmatterBlock(fields);
}
