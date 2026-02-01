/**
 * Preload script for tsx - sets TSX_TSCONFIG_PATH before tsx initializes.
 *
 * Usage: node --import ./tsx-preload.mjs --import tsx ...
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.TSX_TSCONFIG_PATH = path.resolve(__dirname, "tsconfig.json");
