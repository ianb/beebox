/** Canonical interface instruments. These paths are identity, not authorization. */
import { resolveRefPath } from "./ref-path.js";

export const SYSTEM_CARD_PATHS = {
  dashboard: "_config/interface/dashboard.card",
  settings: "_config/interface/settings.card",
  browse: "_config/interface/browse.card",
} as const;

export type SystemCardType = keyof typeof SYSTEM_CARD_PATHS;
export const SYSTEM_CARD_MIGRATION = "canonical-interface-cards";

export function isSystemCardType(type: string): type is SystemCardType {
  return type === "dashboard" || type === "settings" || type === "browse";
}

export function systemCardLocationError(type: SystemCardType, path: string): string | null {
  const normalized = resolveRefPath({ ref: path, fromPath: "", kind: "write-target" });
  const expected = SYSTEM_CARD_PATHS[type];
  return normalized === expected ? null : `The ${type} card at ${path} must be at ${expected}. Open or restore the canonical card; do not create another instance.`;
}
