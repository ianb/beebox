/**
 * Lint for a card's `symbol` group — the small mark that stands for the card in
 * a tab strip, a listing, or a tile (`src/shared/card-symbol.ts`).
 *
 * Its own module because `card-lint.ts` is at its line budget, and because this
 * is one self-contained rule over one field: it needs the parsed fields and
 * nothing about the box.
 */

import type { LintIssue } from "../cards/lint-format.js";
import { isRecord } from "../lib/is-record.js";
import { countGraphemes } from "../shared/graphemes.js";
import { isCssColour, CSS_COLOUR_FORMS } from "../shared/css-colour.js";
import { MAX_GLYPH_GRAPHEMES } from "../shared/card-symbol.js";

/**
 * A card's `symbol` group: the mark that stands for it in a listing or a tab.
 *
 * One ERROR — a glyph longer than the cap — because a mark that is a sentence
 * stretches nothing (CardMark clips it) but means the author misunderstood the
 * field, and letting it reach a commit spreads that misunderstanding. Everything
 * else is a warning: a symbol is cosmetic, and a card must stay loadable and
 * openable whatever is wrong with its mark.
 */
export function symbolIssues(fields: Record<string, unknown>): LintIssue[] {
  const symbol = fields["symbol"];
  if (!isRecord(symbol)) return [];
  const issues: LintIssue[] = [];
  const glyph = symbol["glyph"];
  const src = symbol["src"];
  const hasGlyph = typeof glyph === "string" && glyph.trim() !== "";
  const hasSrc = typeof src === "string" && src.trim() !== "";

  if (hasGlyph && countGraphemes(glyph.trim()) > MAX_GLYPH_GRAPHEMES) {
    issues.push({
      type: "validation",
      severity: "error",
      message:
        `symbol.glyph is longer than ${MAX_GLYPH_GRAPHEMES} characters — a symbol is a mark, ` +
        "not a label: an emoji, or a letter or two",
    });
  }
  if (hasGlyph && hasSrc) {
    issues.push({
      type: "validation",
      severity: "warning",
      message: "symbol carries both glyph and src — they are alternatives, and src is what renders",
    });
  }
  if (!hasGlyph && !hasSrc) {
    issues.push({
      type: "validation",
      severity: "warning",
      message: "symbol has neither glyph nor src, so nothing renders — remove it, or give it one",
    });
  }
  // A path in `glyph` is the mistake the two adjacent keys invite.
  if (hasGlyph && (glyph.includes("/") || /\.(?:png|jpe?g|gif|webp|svg|avif)$/i.test(glyph.trim()))) {
    issues.push({
      type: "validation",
      severity: "warning",
      message: "symbol.glyph looks like a file path — an image mark goes in symbol.src",
    });
  }
  for (const key of ["foreground", "background"]) {
    const value = symbol[key];
    if (typeof value !== "string" || isCssColour(value)) continue;
    issues.push({
      type: "validation",
      severity: "warning",
      message: `symbol.${key} is not a colour this box accepts (${CSS_COLOUR_FORMS}) — it is ignored`,
    });
  }
  return issues;
}
