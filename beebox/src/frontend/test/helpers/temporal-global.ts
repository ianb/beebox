/**
 * Side-effect module: installs `temporal-polyfill` on `globalThis`, as
 * `ensureTemporal()` (`src/lib/temporal.ts`) does in a browser without
 * Temporal. Node 24 has none, and a test imports a module directly rather than
 * through `boot()`, so a test of code that uses Temporal imports this first.
 * `dom-globals.ts` imports it, so DOM tests have it already.
 */
import "temporal-polyfill/global";
