// # The `bbx` surface is classified, and the classification is total
//
// `bbx` carries the box agent's surface; verbs an agent can never call live under
// `bbx engine` (`src/cli/surface-data.ts`). A classification is only worth having
// if it cannot silently rot, and the way it rots is a new verb registered without
// being classified — which is exactly how operator commands kept landing on the
// agent's surface in the first place. These tests are that gate.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { Command } from "commander";
import { buildProgram } from "../../src/cli/entry/program.js";
import { loadCommands } from "../../src/cli/entry/load-commands.js";
import { verbRegistryKey } from "../../src/cli/entry/select-verb.js";
import { SURFACE } from "../../src/cli/entry/surface-data.js";
import { VERB_COMMANDS } from "../../src/cli/commands.js";
import { bbxCommandsScheduling } from "../../src/core/docs-gen/package-docs/bbx-commands-scheduling.js";
import { bbxCommandsConnectors } from "../../src/core/docs-gen/package-docs/bbx-commands-connectors.js";

const loaded = await loadCommands({ kind: "all" });
const program = buildProgram(loaded);
const subNames = (command: Command | undefined) =>
  (command?.commands ?? []).map((c) => c.name()).filter((n) => n !== "help").toSorted();

const topLevel = subNames(program);
const engineParent = program.commands.find((c) => c.name() === "engine");
const engineVerbs = subNames(engineParent);

const classified = new Set(SURFACE.map((e) => e.name));
const registered = new Set(loaded.byVerb.keys());
const unclassified = [...registered].filter((name) => !classified.has(name));
const unregistered = [...classified].filter((name) => !registered.has(name));

const agentNames = [...new Set(SURFACE.filter((e) => e.audience === "agent").map((e) => e.name))].toSorted();
const engineNames = [...new Set(SURFACE.filter((e) => e.audience === "engine").map((e) => e.name))].toSorted();
// A split family's name lives on both sides, so "engine-only" is the set that
// genuinely left the top level.
const engineOnly = engineNames.filter((name) => !agentNames.includes(name));
const leaked = engineOnly.filter((name) => topLevel.includes(name));

// A split family contributes two entries under one name; no subcommand may
// appear on both sides of it.
const splitEntries = SURFACE.filter((e) => e.subcommands !== undefined);
const splitNames = [...new Set(splitEntries.map((e) => e.name))].toSorted();
const overlapping = splitNames.flatMap((name) => {
  const owned = splitEntries.filter((e) => e.name === name).flatMap((e) => [...(e.subcommands ?? [])]);
  return owned.filter((sub, i) => owned.indexOf(sub) !== i);
});

const reasonless = SURFACE.filter((e) => e.audience === "engine" && e.reason.trim() === "").map((e) => e.name);
const emptySmoke = SURFACE.filter((e) => e.audience === "agent")
  .filter((e) => ("skip" in e.smoke ? e.smoke.skip.trim() === "" : e.smoke.run.length === 0))
  .map((e) => e.name);
// A copy-pasted smoke argv that kept another verb's name would test the wrong command.
const misaimedSmoke = SURFACE.filter((e) => e.audience === "agent")
  .filter((e) => "run" in e.smoke && e.smoke.run[0] !== e.name)
  .map((e) => e.name);

// Section headings in the generated box reference name the command they document.
const reference = [...bbxCommandsScheduling(), ...bbxCommandsConnectors()].join("\n");
const documented = [...reference.matchAll(/^## bbx (\S+)/gm)].map((m) => m[1] ?? "");
const taughtButEvicted = documented.filter((verb) => engineOnly.includes(verb));

// ## Every registered command is classified, and every classified verb exists
//
// `buildSurface` registers only what the table names, so an unclassified command
// would vanish from the CLI rather than announce itself.
void test("buildSurface registers only what the table names, so an unclassified command...", async (t) => {
  t.check(unclassified, []);

  t.check(unregistered, []);
});

// ## Each loader is keyed by its verb
//
// The registry keys loaders by module file name (layout rule 4), and a run
// finds a verb's loader by `verbRegistryKey(verb)`. So every module must be
// named for the verb its command declares.
void test("Every registry key is its loaded command's verb in camelCase", async (t) => {
  t.check([...loaded.byVerb.keys()].map(verbRegistryKey).toSorted(), VERB_COMMANDS.keys().toSorted());
});

// ## The two surfaces partition the verbs
//
// `engine` is itself a top-level command, so it belongs in the first comparison.
void test("engine is itself a top-level command, so it belongs in the first comparison.", async (t) => {
  t.check(topLevel.filter((n) => n !== "engine"), agentNames);

  t.check(engineVerbs, engineNames);
});

// Nothing that left the agent's surface is still reachable at the top level. This
// is the property that makes `bbx --help` the surface rather than a filtered view
// of a longer list.
void test("Nothing that left the agent's surface is still reachable at the top level.", async (t) => {
  t.check(leaked, []);
});

// ## A split family keeps its name on both sides and divides its subcommands
//
// `scheduler`, `pub`, and `secrets` each have a read half an agent uses and an
// operate half it does not.
void test("scheduler, pub, and secrets each have a read half an agent uses and an operat...", async (t) => {
  t.check(splitNames, ["pub", "scheduler", "secrets"]);

  t.check(overlapping, []);
});

// Every subcommand a split family registers is in the table, so none vanishes
// from the CLI. The only subcommands the table may omit are the ones their own
// description marks `[deprecated]` — that is how `bbx scheduler add|remove|list`
// left the surface. The registered set is read off the loaded family, not listed
// here, so a new `.command(...)` that nobody classified fails this test.
const registeredSubcommands = (family: string) => subNames(loaded.byVerb.get(family));
const ownedSubcommands = (family: string, audience: "agent" | "engine") =>
  SURFACE.filter((e) => e.name === family && e.audience === audience).flatMap((e) => [...(e.subcommands ?? [])]);
const unclassifiedSubcommands = splitNames.flatMap((family) => {
  const owned = new Set([...ownedSubcommands(family, "agent"), ...ownedSubcommands(family, "engine")]);
  const deprecated = (loaded.byVerb.get(family)?.commands ?? [])
    .filter((c) => c.description().startsWith("[deprecated]"))
    .map((c) => c.name());
  return registeredSubcommands(family)
    .filter((name) => !owned.has(name) && !deprecated.includes(name))
    .map((name) => `${family} ${name}`);
});
const phantomSubcommands = splitNames.flatMap((family) =>
  [...ownedSubcommands(family, "agent"), ...ownedSubcommands(family, "engine")]
    .filter((name) => !registeredSubcommands(family).includes(name))
    .map((name) => `${family} ${name}`),
);
// The built program offers each audience exactly the subcommands the table gives it.
const builtDivergence = splitNames.flatMap((family) =>
  (["agent", "engine"] as const).flatMap((audience) => {
    const parent = audience === "agent" ? program : engineParent;
    const built = subNames(parent?.commands.find((c) => c.name() === family));
    const expected = ownedSubcommands(family, audience).toSorted();
    return JSON.stringify(built) === JSON.stringify(expected) ? [] : [`${audience} ${family}: built ${built.join(",")} vs table ${expected.join(",")}`];
  }),
);

void test("Every subcommand a split family registers is in the table, so none vanishes from...", async (t) => {
  t.check(unclassifiedSubcommands, []);

  t.check(phantomSubcommands, []);

  t.check(builtDivergence, []);
});

// ## Every eviction gives a reason, and every agent verb a smoke decision
//
// The reason is what a later reader needs in order to argue with the
// classification. `Smoke` is a union, so an entry cannot have neither a run nor a
// stated skip — but it can still have an empty one.
void test("The reason is what a later reader needs in order to argue with the classifica...", async (t) => {
  t.check(reasonless, []);

  t.check(emptySmoke, []);

  t.check(misaimedSmoke, []);
});

// ## The generated box reference describes only the agent's surface
//
// `docs-gen/bbx-commands*.ts` is hand-written prose shipped into every box for the
// agent to read. Before this split it described `bbx scheduler install` and a dead
// `bbx scenario` — operator and vestigial surface, delivered as agent guidance.
// This checks the direction that goes unnoticed: an evicted verb still being
// taught.
void test("docs-gen/bbx-commands.ts is hand-written prose shipped into every box for the...", async (t) => {
  t.check(taughtButEvicted, []);
});
