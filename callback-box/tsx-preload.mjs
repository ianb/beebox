/**
 * Preload script for tsx - sets TSX_TSCONFIG_PATH before tsx initializes.
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
