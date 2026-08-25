/**
 * Registers the doctest loader hooks.
 *
 * Loaded via --import in .taprc. Registers doctest-hooks.ts as a
 * Node.js module loader so .doctest.md files are transformed into
 * tap test modules at load time.
 */

import { register } from "node:module";

register(new URL("./doctest-hooks.ts", import.meta.url));
