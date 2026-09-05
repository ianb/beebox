/**
 * Shared name lookup for the server-owned secret registries (format and probe).
 *
 * Store names are flat identifiers, and per-box instances use `name/<box-slug>`
 * (`docs/secrets.md`). A registry entry therefore matches either EXACTLY
 * (`mistral`) or by PREFIX for the per-box family (`telegram-bot/`, `publish/`)
 * — the same lookup both registries need, kept in one place so they can never
 * disagree about which entry a name belongs to.
 *
 * Exact wins over prefix: a name is allowed to have its own entry even inside a
 * family, and a longer prefix wins over a shorter one, so adding a narrower
 * family later never silently reroutes an existing name.
 */

/** Look one store name up in a registry keyed by exact name or `family/` prefix. */
export function lookupByName<T>(registry: Record<string, T>, name: string): { key: string; entry: T } | null {
  const exact = registry[name];
  if (exact !== undefined) return { key: name, entry: exact };
  let best: { key: string; entry: T } | null = null;
  for (const [key, entry] of Object.entries(registry)) {
    if (!key.endsWith("/")) continue;
    if (!name.startsWith(key)) continue;
    if (best === null || key.length > best.key.length) best = { key, entry };
  }
  return best;
}
