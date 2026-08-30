/**
 * Bootstrap for CLI - sets up environment before main imports.
 *
 * This file MUST be imported first, before any other imports,
 * to ensure TSX_TSCONFIG_PATH is set before tsx compiles any JSX.
 */

import * as path from "node:path";
import { PACKAGE_ROOT } from "../lib/package-root.js";

// Set TSX_TSCONFIG_PATH so tsx finds the correct tsconfig.json regardless of
// working directory (the CLI may run from a box dir like ~/my-box) AND
// regardless of source layout. Resolve it via PACKAGE_ROOT, never a hardcoded
// `../..` off import.meta.dirname: under tsx this module lives at `src/cli/`
// (two up = repo root) but in the esbuild bundle it lives at `dist/` (two up =
// one level ABOVE the package root — a tsconfig that doesn't exist), which made
// every tsx subprocess the CLI spawned (e.g. `bbx migrate`'s per-migration
// scripts) inherit a broken TSX_TSCONFIG_PATH and crash. PACKAGE_ROOT walks up
// to the beebox package.json, landing correctly in both layouts.
// (package-root.ts is JSX-free, so importing it here — before the JSX guard
// below — is safe.)
//
// NOTE: This must happen BEFORE any JSX-using modules are imported.
// Once tsx compiles a module, changing this env var won't help.
process.env.TSX_TSCONFIG_PATH = path.join(PACKAGE_ROOT, "tsconfig.json");

// Force Claude (CLI and SDK) to use subscription auth, never an API key.
// Stripping it here means downstream code, the SDK, and any spawned
// subprocesses inheriting from this process all see no key. Subscription
// credentials in ~/.claude/ are unaffected.
delete process.env.ANTHROPIC_API_KEY;

// Install strict fetch mode for scenario runs — must happen before any
// connector or library code calls fetch(). When BBX_STRICT_FETCH is set,
// all fetch() calls must match a stub or throw.
if (process.env.BBX_STRICT_FETCH) {
  const { installStrictFetch } = await import("./lib/fetch.js");
  installStrictFetch();
}
