/**
 * Cache policy for the built SPA's content-hashed assets.
 *
 * Vite emits everything under `dist/assets/` with a content hash in the
 * filename (`index-a1b2c3d4.js`), so a given URL's bytes can never change —
 * a new build mints a new filename. Those are safe to cache for a year and
 * mark `immutable`, which stops the browser from even revalidating.
 *
 * Nothing else is: `index.html` is the un-hashed document that names the
 * current hashes, `sw.js` must be revalidated for a service-worker update to
 * ever land, and `icons/`/`manifest.webmanifest` are un-hashed too. Those are
 * served by separate registrations that deliberately keep the default
 * (`public, max-age=0`) policy — hence a policy scoped to `/assets/` rather
 * than to the whole frontend dist.
 *
 * Shared so the hub's fleet-wide root mount (`src/hub/hub-server.ts`, which is
 * what serves `/assets/` in production) and the standalone box server's mount
 * (`src/webapp/server.ts`, used by local/docker installs) cannot drift.
 */

/**
 * One year in milliseconds — also `@fastify/send`'s `MAX_MAXAGE` ceiling, so
 * a larger value would silently clamp to this anyway. Expressed as a number
 * rather than `"1y"`: `ms` parses a year as 365.25 days, which would emit an
 * off-by-a-half-day `max-age`.
 */
const ONE_YEAR_MS = 31_536_000_000;

/**
 * `@fastify/static` options producing
 * `cache-control: public, max-age=31536000, immutable`.
 */
export const HASHED_ASSET_CACHE_OPTIONS = {
  maxAge: ONE_YEAR_MS,
  immutable: true,
} as const;
