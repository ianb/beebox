# The `bbx` surface is classified, and the classification is total

`bbx` carries the box agent's surface; verbs an agent can never call live under
`bbx engine` (`src/cli/surface-data.ts`). A classification is only worth having
if it cannot silently rot, and the way it rots is a new verb registered without
being classified — which is exactly how operator commands kept landing on the
agent's surface in the first place. These tests are that gate.

```ts setup
import { buildProgram } from "../../src/cli/program.js";
import { SURFACE } from "../../src/cli/surface-data.js";
import { VERB_COMMANDS } from "../../src/cli/surface-commands.js";
import { bbxCommandsScheduling } from "../../src/core/docs-gen/bbx-commands-scheduling.js";
import { bbxCommandsConnectors } from "../../src/core/docs-gen/bbx-commands-connectors.js";

const program = buildProgram();
const subNames = (command) =>
  (command?.commands ?? []).map((c) => c.name()).filter((n) => n !== "help").sort();

const topLevel = subNames(program);
const engineParent = program.commands.find((c) => c.name() === "engine");
const engineVerbs = subNames(engineParent);

const classified = new Set(SURFACE.map((e) => e.name));
const registered = new Set(Object.keys(VERB_COMMANDS));
const unclassified = [...registered].filter((name) => !classified.has(name));
const unregistered = [...classified].filter((name) => !registered.has(name));

const agentNames = [...new Set(SURFACE.filter((e) => e.audience === "agent").map((e) => e.name))].sort();
const engineNames = [...new Set(SURFACE.filter((e) => e.audience === "engine").map((e) => e.name))].sort();
// A split family's name lives on both sides, so "engine-only" is the set that
// genuinely left the top level.
const engineOnly = engineNames.filter((name) => !agentNames.includes(name));
const leaked = engineOnly.filter((name) => topLevel.includes(name));

// A split family contributes two entries under one name; no subcommand may
// appear on both sides of it.
const splitEntries = SURFACE.filter((e) => e.subcommands !== undefined);
const splitNames = [...new Set(splitEntries.map((e) => e.name))].sort();
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
const documented = [...reference.matchAll(/^## bbx (\S+)/gm)].map((m) => m[1]);
const taughtButEvicted = documented.filter((verb) => engineOnly.includes(verb));
```

## Every registered command is classified, and every classified verb exists

`buildSurface` registers only what the table names, so an unclassified command
would vanish from the CLI rather than announce itself.

```ts
unclassified
=> []

unregistered
=> []
```

## The two surfaces partition the verbs

`engine` is itself a top-level command, so it belongs in the first comparison.

```ts
topLevel.filter((n) => n !== "engine").join(",") === agentNames.join(",")
=> true

engineVerbs.join(",") === engineNames.join(",")
=> true
```

Nothing that left the agent's surface is still reachable at the top level. This
is the property that makes `bbx --help` the surface rather than a filtered view
of a longer list.

```ts
leaked
=> []
```

## A split family keeps its name on both sides and divides its subcommands

`scheduler`, `pub`, and `secrets` each have a read half an agent uses and an
operate half it does not.

```ts
splitNames.join(",")
=> pub,scheduler,secrets

overlapping
=> []
```

The agent's `scheduler` offers the reads; the operator's offers the daemon
lifecycle. A subcommand named by neither entry is deliberately dropped — that is
how the deprecated `bbx scheduler add|remove|list` aliases left the CLI.

```ts
subNames(program.commands.find((c) => c.name() === "scheduler")).join(",")
=> log,status

subNames(engineParent.commands.find((c) => c.name() === "scheduler")).join(",")
=> install,start,uninstall
```

## Every eviction gives a reason, and every agent verb a smoke decision

The reason is what a later reader needs in order to argue with the
classification. `Smoke` is a union, so an entry cannot have neither a run nor a
stated skip — but it can still have an empty one.

```ts
reasonless
=> []

emptySmoke
=> []

misaimedSmoke
=> []
```

## The generated box reference describes only the agent's surface

`docs-gen/bbx-commands*.ts` is hand-written prose shipped into every box for the
agent to read. Before this split it described `bbx scheduler install` and a dead
`bbx scenario` — operator and vestigial surface, delivered as agent guidance.
This checks the direction that goes unnoticed: an evicted verb still being
taught.

```ts
taughtButEvicted
=> []
```
