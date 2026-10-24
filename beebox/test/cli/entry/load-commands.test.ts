// # A run that loads one command assembles the same tree for it
//
// `bbx <verb>` loads only that verb's module (`src/cli/entry/load-commands.ts`)
// and `buildSurface` registers only the loaded entries. Each case here builds a
// program from one verb and checks it places that verb where the full program
// does: an agent verb at the top level, an engine verb under `engine`, and a
// split family's halves on both sides with the same subcommands
// (`test/cli/entry.surface.test.ts` checks the full program).
//
// Each case loads a different module: splitting a family moves its
// subcommands onto new parents, so one family is assembled once per process.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { Command } from "commander";
import { buildProgram } from "../../../src/cli/entry/program.js";
import { loadCommands } from "../../../src/cli/entry/load-commands.js";

const names = (command: Command | undefined): string[] =>
  (command?.commands ?? []).map((c) => c.name()).filter((n) => n !== "help").toSorted();

async function programFor(key: string): Promise<Command> {
  return buildProgram(await loadCommands({ kind: "verb", key }));
}

// A hyphenated agent verb sits at the top level; `engine` is always present.
void test("A hyphenated agent verb loads alone at the top level", async (t) => {
  const program = await programFor("agentContext");
  t.check(names(program), ["agent-context", "engine"]);
});

// An engine verb sits under `engine` and nowhere else.
void test("An engine verb loads alone under engine", async (t) => {
  const program = await programFor("serve");
  t.check([names(program), names(program.commands.find((c) => c.name() === "engine"))], [["engine"], ["serve"]]);
});

// A split family keeps its agent half at the top level and its operator half
// under `engine`, with the subcommands the surface table gives each.
void test("A split family loaded alone keeps both halves", async (t) => {
  const program = await programFor("scheduler");
  const engine = program.commands.find((c) => c.name() === "engine");
  t.check(
    [names(program.commands.find((c) => c.name() === "scheduler")), names(engine?.commands.find((c) => c.name() === "scheduler"))],
    [["log", "status"], ["install", "start", "uninstall"]],
  );
});

// `--version` loads no command module.
void test("A version run loads no command", async (t) => {
  const loaded = await loadCommands({ kind: "none" });
  t.check([loaded.byVerb.size, loaded.complete], [0, false]);
});
