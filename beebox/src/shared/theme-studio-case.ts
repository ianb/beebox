import { THEME_CATALOG, systemCardThemes } from "./card-theme/core.js";

/** What the theme studio shows: a system theme and stock, and a card theme and stock. */
export interface StudioCase {
  system: string;
  systemStock: string;
  card: string;
  cardStock: string;
}

/** A theme's default stock; a name outside the catalog (a draft or study) takes `neutral`. */
export function defaultStockOf(name: string): string {
  return THEME_CATALOG.find((theme) => theme.name === name)?.defaultStock ?? "neutral";
}

/**
 * The card theme the studio pairs with a system theme: the system theme's
 * default card theme (itself, for a theme that styles cards), on the same
 * stock when it is the same theme. A name outside the catalog pairs with
 * itself, so a draft or study styles both.
 */
export function pairedCard({ system, systemStock }: Pick<StudioCase, "system" | "systemStock">): Pick<StudioCase, "card" | "cardStock"> {
  if (!THEME_CATALOG.some((theme) => theme.name === system)) return { card: system, cardStock: systemStock };
  const card = systemCardThemes(system)[0] ?? "plain";
  return { card, cardStock: card === system ? systemStock : defaultStockOf(card) };
}
