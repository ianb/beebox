/**
 * Bootstrap for CLI - sets up environment before main imports.
 *
 * This file MUST be imported first, before any other imports,
 * to ensure TSX_TSCONFIG_PATH is set before tsx compiles any JSX.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Set TSX_TSCONFIG_PATH so tsx finds the correct tsconfig.json
// regardless of working directory. This is needed because tsx uses
// cwd to find tsconfig by default, but the CLI may be run from a
// callback-box directory (e.g., ~/my-box) rather than the source directory.
//
// NOTE: This must happen BEFORE any JSX-using modules are imported.
// Once tsx compiles a module, changing this env var won't help.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.TSX_TSCONFIG_PATH = path.resolve(__dirname, "../tsconfig.json");
