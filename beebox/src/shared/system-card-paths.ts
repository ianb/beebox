/** Canonical interface instruments. These paths are identity, not authorization. */
import { resolveRefPath } from "./ref-path.js";

export const SYSTEM_CARD_PATHS = {
  dashboard: "_config/interface/dashboard.card",
  settings: "_config/interface/settings.card",
  browse: "_config/interface/browse.card",
  questions: "_config/interface/questions.card",
  landmarks: "_config/interface/landmarks.card",
  history: "_config/interface/history.card",
  inventory: "_config/interface/inventory.card",
  admin: "_config/interface/admin.card",
} as const;

export type SystemCardType = keyof typeof SYSTEM_CARD_PATHS;
export const SYSTEM_CARD_MIGRATION = "canonical-interface-cards";
export const REMAINING_SYSTEM_CARD_MIGRATION = "remaining-interface-cards";
export type SystemCardMigration = typeof SYSTEM_CARD_MIGRATION | typeof REMAINING_SYSTEM_CARD_MIGRATION;

export const SYSTEM_CARD_COHORTS: Record<SystemCardMigration, readonly SystemCardType[]> = {
  [SYSTEM_CARD_MIGRATION]: ["dashboard", "settings", "browse"],
  [REMAINING_SYSTEM_CARD_MIGRATION]: ["dashboard", "settings", "browse", "questions", "landmarks", "history", "inventory", "admin"],
};

export function isSystemCardType(type: string): type is SystemCardType {
  return Object.hasOwn(SYSTEM_CARD_PATHS, type);
}

export function isSystemCardMigration(name: string): name is SystemCardMigration {
  return name === SYSTEM_CARD_MIGRATION || name === REMAINING_SYSTEM_CARD_MIGRATION;
}

export function systemCardLocationError(type: SystemCardType, path: string): string | null {
  const normalized = resolveRefPath({ ref: path, fromPath: "", kind: "write-target" });
  const expected = SYSTEM_CARD_PATHS[type];
  return normalized === expected ? null : `The ${type} card at ${path} must be at ${expected}. Open or restore the canonical card; do not create another instance.`;
}
