/**
 * Preload script for tsx - sets TSX_TSCONFIG_PATH before tsx initializes.
 *
 * Usage: node --import ./tsx-preload.mjs --import tsx ...
 *
 * THIS FILE CANNOT BE TYPESCRIPT, and that is not an oversight. Its entire job
 * is to run BEFORE tsx installs itself, in the window where TypeScript loading
 * does not yet exist — a `.ts` version could not be imported by the very
 * `--import` that has to run first. It is the loader carve-out the repo's
 * "all logic in .ts" rule explicitly allows (root CLAUDE.md), and it should
 * stay `.mjs`. Confirmed during the 2026-08-25 .mjs → .ts sweep; every other
 * non-generated `.mjs` in the repo was converted.
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
