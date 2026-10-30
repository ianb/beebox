/**
 * Maps the surface table onto real commands.
 *
 * The only module that knows both a verb's name and its `Command`. Agent verbs
 * register at the top level; engine verbs register under `bbx engine`, which
 * appears in `bbx --help` as a single line rather than as sixteen.
 *
 * A family that splits across audiences (`scheduler`, `pub`, `secrets`)
 * contributes two entries under one name, each naming the subcommands it owns.
 * The split is done by PARTITIONING the family's assembled parent rather than
 * by restructuring its module: `scheduler` and `secrets` attach subcommands
 * with `parent.command(...)`, so the subcommands are not separately
 * addressable, but they are readable off `parent.commands`. A subcommand named
 * by neither entry is dropped — that is how the deprecated `bbx scheduler
 * add|remove|list` aliases leave the surface.
 */

import { Command } from "commander";
import { SURFACE, type SurfaceEntry } from "./surface-data.js";
import { invariant } from "../../shared/invariant.js";
import type { LoadedCommands } from "./load-commands.js";

/** The one-line summary `bbx --help` gives the engine namespace. */
const ENGINE_DESCRIPTION =
  "Operator and engine commands — not the box agent's surface (bbx engine --help)";

/** A parent holding only `names`, taken off the family's assembled command. */
function splitParent({ entry, family, names }: { entry: SurfaceEntry; family: Command; names: readonly string[] }): Command {
  const parent = new Command(entry.name).description(family.description());

  for (const name of names) {
    const subcommand = family.commands.find((candidate) => candidate.name() === name);
    invariant(subcommand !== undefined, `"bbx ${entry.name}" has no subcommand "${name}"`);
    parent.addCommand(subcommand);
  }
  return parent;
}

/** The `Command` one table entry contributes. */
function commandFor(entry: SurfaceEntry, command: Command): Command {
  if (entry.subcommands !== undefined) return splitParent({ entry, family: command, names: entry.subcommands });
  return command;
}

/**
 * Register each loaded, classified verb onto `program`. With every command
 * loaded, a table entry with no command is a hard failure naming the gap; a
 * run that loaded one verb registers only the entries for that verb.
 */
export function buildSurface(program: Command, commands: LoadedCommands): void {
  const engine = new Command("engine").description(ENGINE_DESCRIPTION);

  for (const entry of SURFACE) {
    const command = commands.byVerb.get(entry.name);
    if (command === undefined) {
      invariant(!commands.complete, `surface table names "${entry.name}", which no module registers`);
      continue;
    }
    const target = entry.audience === "agent" ? program : engine;
    target.addCommand(commandFor(entry, command));
  }

  program.addCommand(engine);
}
