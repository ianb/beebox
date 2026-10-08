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
 * Shared so the hub's fleet-wide root mount (`src/hub/server/core.ts`, which is
 * what serves `/assets/` in production) and the standalone box server's mount
 * (`src/webapp/server/app.ts`, used by local/docker installs) cannot drift.
 */

/**
 * One year in milliseconds — also `@fastify/send`'s `MAX_MAXAGE` ceiling, so
 * a larger value would silently clamp to this anyway. Expressed as a number
 * rather than `"1y"`: `ms` parses a year as 365.25 days, which would emit an
 * off-by-a-half-day `max-age`.
 */
const ONE_YEAR_MS = 31_536_000_000;

/**
 * `@fastify/static` options for the hashed-asset mount:
 * `cache-control: public, max-age=31536000, immutable`, and brotli bodies
 * served precompressed.
 *
 * The frontend build writes `<file>.br` at brotli's highest quality next to
 * each text asset (`src/frontend/src/dev/precompress-plugin`). Compressing at
 * request time, or at the CDN's on-the-fly level, leaves the entry script about
 * 20% larger. A client that accepts `br` gets the `.br` file; any other client,
 * or a file without one (source maps), gets the plain file. `@fastify/static`
 * does not set `Vary` for this, so the mount does: a shared cache must not hand
 * brotli bytes to a client that did not ask for them.
 */
export const HASHED_ASSET_STATIC_OPTIONS = {
  maxAge: ONE_YEAR_MS,
  immutable: true,
  preCompressed: true,
  setHeaders: (res: { setHeader: (name: string, value: string) => unknown }): void => {
    res.setHeader("Vary", "Accept-Encoding");
  },
} as const;
