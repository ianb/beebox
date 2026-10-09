import { THEME_CATALOG, type ThemeOrigin } from "@shared/card-theme/core";

export function themeOriginLabel(origin: ThemeOrigin): string {
  switch (origin.kind) {
    case "card": return "Set on this card";
    case "rule": return `Box rule ${origin.index + 1}`;
    case "type-override": return "Box preference for this card type";
    case "schema": return "Card type's default";
    case "box-default": return "Box default";
    case "system": return `Follows the ${themeLabel(origin.theme)} system theme`;
    case "engine": return "Default appearance";
  }
}

export function themeLabel(name: string): string {
  return THEME_CATALOG.find((item) => item.name === name)?.label ?? name;
}
