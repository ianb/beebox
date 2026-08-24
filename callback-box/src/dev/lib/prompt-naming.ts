/**
 * Stable kebab-case names for prompt fragments — the key affordance of the
 * prompt viewer. A human reviewing the assembled context refers to prompts by
 * these names, so they must be deterministic (same input → same name) and
 * unique across the whole system.
 *
 * - Inventory entries are named from their title: `Chat System Prompt` →
 *   `chat-system-prompt`, `Schema: memo` → `schema-memo`, `Procedure:
 *   daily-review` → `procedure-daily-review`.
 * - Assembled layers are named `<situation>/<slug>`: `reactor/system`,
 *   `chat/claude-md`, `chat/rules-inventory`.
 *
 * Pure functions, no I/O.
 */

/** Kebab-case a string: drop parentheticals, lowercase, non-alnum runs → `-`. */
export function kebab(text: string): string {
  return text
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^\da-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Name for a static inventory entry, derived from its title. */
export function inventoryName(title: string): string {
  return kebab(title);
}

/**
 * Short slug for an assembled layer, keyed off recognizable phrases in the
 * verbose layer name so the resulting `<situation>/<slug>` is terse and stable.
 */
export function layerSlug(rawLayerName: string): string {
  const name = rawLayerName.toLowerCase();
  if (name.includes("user prompt")) return "user-prompt";
  if (name.includes("system prompt")) return "system";
  if (name.includes("package claude.md")) return "claude-md-package";
  if (name.includes("claude.md")) return "claude-md";
  if (name.includes("memory index")) return "memory";
  if (name.includes("skill descriptions")) return "skill-descriptions";
  if (name.includes("rules inventory")) return "rules-inventory";
  if (name.startsWith("skill body:")) return kebab(rawLayerName);
  if (name.startsWith("schema instructions:")) return kebab(rawLayerName);
  // Fall back to a kebab of the text before any parenthetical qualifier.
  return kebab(rawLayerName);
}

/** Name for an assembled layer: `<situation>/<slug>`. */
export function layerName(situation: string, rawLayerName: string): string {
  return `${situation}/${layerSlug(rawLayerName)}`;
}

class NameCollisionError extends Error {
  constructor(name: string) {
    super(`Prompt fragment name collision: "${name}" is used by more than one fragment`);
    this.name = "NameCollisionError";
  }
}

/** Throw if any name repeats. Names must be globally unique. */
export function assertUniqueNames(names: string[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new NameCollisionError(name);
    seen.add(name);
  }
}
