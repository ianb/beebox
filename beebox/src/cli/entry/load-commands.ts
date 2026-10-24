/**
 * Load the command modules a selection names (`select-verb.ts`).
 *
 * Each loaded command is checked against its registry key, so a module whose
 * verb drifted from its file name fails here, at the run that loads it, rather
 * than registering under a name nobody typed.
 */

import type { Command } from "commander";
import { VERB_COMMANDS } from "../commands.js";
import { invariant } from "../../shared/invariant.js";
import { verbRegistryKey, type VerbSelection } from "./select-verb.js";

export interface LoadedCommands {
  /** Verb name (`command.name()`) to its command. */
  readonly byVerb: ReadonlyMap<string, Command>;
  /** True when every registered command is loaded (help, an unknown verb). */
  readonly complete: boolean;
}

async function loadOne(key: string): Promise<Command> {
  const load = VERB_COMMANDS.get(key);
  invariant(load !== undefined, `no command registered under "${key}"`);
  const command = await load();
  invariant(verbRegistryKey(command.name()) === key, `command "${command.name()}" is registered under "${key}"; name its module for its verb`);
  return command;
}

export async function loadCommands(selection: VerbSelection): Promise<LoadedCommands> {
  const keys = selection.kind === "all" ? VERB_COMMANDS.keys() : selection.kind === "verb" ? [selection.key] : [];
  const commands = await Promise.all(keys.map(loadOne));
  return { byVerb: new Map(commands.map((command) => [command.name(), command])), complete: selection.kind === "all" };
}
