/**
 * The colour syntaxes a card's symbol may use.
 *
 * Six forms and nothing else: `#rgb`, `#rrggbb`, `hsl()`, `hsla()`, `rgb()`,
 * `rgba()`. No named colours, no `color-mix()`, `lab()`, `oklch()`.
 *
 * This is far narrower than CSS on purpose. The only complete validator is
 * `CSS.supports("color", value)`, which does not exist in Node, so a
 * server-side check that claimed completeness would be lying — and the values
 * are authored by hand or by an agent, where a small vocabulary is easier to
 * get right than a large one (boxholder, 2026-09-05: "anything else is weird").
 *
 * The check is deliberately syntactic, not semantic: it does not verify that a
 * hue is under 360 or that a percentage is under 100. A browser clamps those;
 * the point here is to catch a value that is not a colour at all.
 */

/** `#rgb` or `#rrggbb` — no 4- or 8-digit (alpha) hex, which the six forms exclude. */
const HEX = /^#[\da-f]{3}$|^#[\da-f]{6}$/i;

/**
 * `hsl(…)` / `hsla(…)` / `rgb(…)` / `rgba(…)` with any argument list that
 * holds only the characters those functions take: digits, signs, decimal
 * points, percent, degrees/turns/radians units, separators, and the `/` of the
 * modern alpha syntax. A nested function call cannot pass, because parentheses
 * are not in the set.
 */
const FUNCTIONAL = /^(?:hsla?|rgba?)\(\s*[\d\s%+,./a-z-]*\)$/i;

export function isCssColour(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  return HEX.test(trimmed) || FUNCTIONAL.test(trimmed);
}

/** What the lint message tells an author who wrote something else. */
export const CSS_COLOUR_FORMS = "#rgb, #rrggbb, hsl(), hsla(), rgb(), or rgba()";
