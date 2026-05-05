/**
 * Preload script for tsx - sets TSX_TSCONFIG_PATH before tsx initializes,
 * and silences the punycode DEP0040 deprecation warning emitted by an
 * old transitive dep chain (grammy → node-fetch@2 → whatwg-url@5 → tr46@0).
 *
 * Usage: node --import ./tsx-preload.mjs --import tsx ...
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.TSX_TSCONFIG_PATH = path.resolve(__dirname, "tsconfig.json");

// Force Claude to use subscription auth, never an API key. Removing this
// here means it can't leak into any code path that runs after preload —
// the SDK, spawned subprocesses, or stray reads of process.env all see
// no key.
delete process.env.ANTHROPIC_API_KEY;

// Filter the punycode DEP0040 deprecation. The offending require lives
// in grammy → node-fetch@2 → whatwg-url@5 → tr46@0; we can't patch any
// of those without ejecting grammy.
//
// Note: the standard fix (`npm install punycode` so the userland package
// shadows the built-in) does NOT work on Node 22+ — built-ins now win
// over same-named npm packages. Hence this runtime emit-filter instead.
//
// The filter must be registered before any module triggers the punycode
// load. `bin/cb` runs this preload via Node's `--import`, so we are
// guaranteed to be earlier than any user or tsx-loaded code.
const originalEmit = process.emit;
process.emit = function patchedEmit(event, ...args) {
  if (event === "warning") {
    const warning = args[0];
    if (
      warning
      && warning.name === "DeprecationWarning"
      && warning.code === "DEP0040"
    ) {
      return false;
    }
  }
  return originalEmit.apply(process, [event, ...args]);
};
