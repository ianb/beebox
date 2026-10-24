/**
 * Assembles the `bbx` program.
 *
 * Separated from `index.ts` so the program exists as a value a test can
 * inspect. The entry point runs `loadEnv` and the state migrations at module
 * top level and then parses `process.argv`, so importing it from a test parses
 * the test runner's own arguments and exits — `test/cli/entry.surface.test.ts`
 * needs the assembled command tree without any of that.
 */

import { Command } from "commander";
import { buildSurface } from "./surface-build.js";
import type { LoadedCommands } from "./load-commands.js";

/** The `bbx` command tree for the loaded commands, assembled but not parsed. */
export function buildProgram(commands: LoadedCommands): Command {
  const program = new Command();

  program
    .name("bbx")
    .description(
      "Bee Box — the box agent's command surface.\n" +
        "Operator and machine commands live under `bbx engine`.",
    )
    .version("0.1.0");

  buildSurface(program, commands);

  return program;
}
