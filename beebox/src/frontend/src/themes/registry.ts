import type { ThemeOrigin } from "@shared/card-theme";

export function themeOriginLabel(origin: ThemeOrigin): string {
  switch (origin.kind) {
    case "card": return "Set on this card";
    case "rule": return `Box rule ${origin.index + 1}`;
    case "type-override": return "Box preference for this card type";
    case "schema": return "Card type's default";
    case "box-default": return "Box default";
    case "engine": return "Default appearance";
  }
}
