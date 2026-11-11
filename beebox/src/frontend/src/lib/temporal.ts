/**
 * Makes `globalThis.Temporal` available before the app renders.
 *
 * Chrome and Firefox ship Temporal; Safari 18 does not, so a browser without
 * it loads `temporal-polyfill` (which also wraps `Intl.DateTimeFormat` so it
 * formats Temporal values). A browser with native Temporal downloads nothing.
 * `boot()` (`main/app.tsx`) awaits this before the first render, so code may
 * use `Temporal` inside functions that run after boot, never at module load.
 */
export function ensureTemporal(): Promise<void> {
  return ensureTemporalWith(() => import("temporal-polyfill/global"));
}

/** {@link ensureTemporal} with the polyfill import passed in, so a test can stand in for it. */
export async function ensureTemporalWith(load: () => Promise<unknown>): Promise<void> {
  if ("Temporal" in globalThis) return;
  await load();
}
