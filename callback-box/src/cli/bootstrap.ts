/**
 * Bootstrap for CLI - sets up environment before main imports.
 *
 * This file MUST be imported first, before any other imports,
 * to ensure TSX_TSCONFIG_PATH is set before tsx compiles any JSX.
 */

import * as path from "node:path";

// Set TSX_TSCONFIG_PATH so tsx finds the correct tsconfig.json
// regardless of working directory. This is needed because tsx uses
// cwd to find tsconfig by default, but the CLI may be run from a
// callback-box directory (e.g., ~/my-box) rather than the source directory.
//
// NOTE: This must happen BEFORE any JSX-using modules are imported.
// Once tsx compiles a module, changing this env var won't help.
const __dirname = import.meta.dirname;
process.env.TSX_TSCONFIG_PATH = path.resolve(__dirname, "../../tsconfig.json");

// Force Claude (CLI and SDK) to use subscription auth, never an API key.
// Stripping it here means downstream code, the SDK, and any spawned
// subprocesses inheriting from this process all see no key. Subscription
// credentials in ~/.claude/ are unaffected.
delete process.env.ANTHROPIC_API_KEY;

// Install strict fetch mode for scenario runs — must happen before any
// connector or library code calls fetch(). When CB_STRICT_FETCH is set,
// all fetch() calls must match a stub or throw.
if (process.env.CB_STRICT_FETCH) {
  const { installStrictFetch } = await import("./lib/fetch.js");
  installStrictFetch();
}
