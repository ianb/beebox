/**
 * Assembles the `bbx` program.
 *
 * Separated from `index.ts` so the program exists as a value a test can
 * inspect. The entry point runs `loadEnv` and the state migrations at module
 * top level and then parses `process.argv`, so importing it from a test parses
 * the test runner's own arguments and exits — `test/cli/surface.doctest.md`
 * needs the assembled command tree without any of that.
 */

import { Command } from "commander";
import { buildSurface } from "./surface-build.js";

/** The `bbx` command tree, assembled but not parsed. */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("bbx")
    .description(
      "Bee Box — the box agent's command surface.\n" +
        "Operator and machine commands live under `bbx engine`.",
    )
    .version("0.1.0");

  buildSurface(program);

  return program;
}
