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

// Filter the punycode deprecation. We can't fix it without ejecting
// grammy or patching tr46; the warning is noise for everyone running cb.
// The filter must register before any module triggers the load —
// --import on this preload runs first, so we're early enough.
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
