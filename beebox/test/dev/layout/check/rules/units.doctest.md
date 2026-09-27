# Units (rules 3 and 5)

`unitsRule` finds two things per directory in scope: an entry with helpers
reachable from no other entry becomes its own unit-directory (rule 5), and a
module reachable only from importers under one subdirectory is
shared-infrastructure that belongs there (rule 3). A set directory (declared
by a `defineRegistry` call elsewhere in the layout) is skipped entirely;
rule 1 governs its top level.

```ts setup
import { unitsRule } from "../../../../../src/dev/layout/check/rules/units.js";
import { layout, summary } from "./fixture.js";
import type { ImportEdge, LayoutFile, ModuleFile } from "../../../../../src/dev/layout/model.js";

function asModule(file: LayoutFile | undefined): ModuleFile {
  if (file === undefined || file.kind !== "module") throw new Error("expected a module file");
  return file;
}

function firstImport(file: ModuleFile): ImportEdge {
  const [edge] = file.imports;
  if (edge === undefined) throw new Error("expected an import");
  return edge;
}
```

## A flat utility directory where every file is imported from outside is clean

This is `src/lib`'s shape: every sibling is reachable from outside the
directory, so every sibling is its own entry, none is reachable from another,
and there is nothing to report.

```ts
const libLayout = layout({
  files: {
    "src/lib/a.ts": { imports: [] },
    "src/lib/b.ts": { imports: [] },
    "src/app.ts": { imports: ["src/lib/a.ts", "src/lib/b.ts"] },
  },
});
summary(unitsRule.check(libLayout)) === ""
=> true
```

## A cluster beside another entry is one unit-directory finding

`wakeup.ts` and `init.ts` are both entries (something outside `commands/`
imports each). `wakeup-steps.ts` and `wakeup-outcome.ts` are reachable only
from `wakeup.ts`, so they are `wakeup.ts`'s unit; `init.ts`'s unit is itself
alone.

```ts
const clusterLayout = layout({
  files: {
    "src/commands/wakeup.ts": { imports: ["src/commands/wakeup-steps.ts", "src/commands/wakeup-outcome.ts"] },
    "src/commands/wakeup-steps.ts": { imports: [] },
    "src/commands/wakeup-outcome.ts": { imports: [] },
    "src/commands/init.ts": { imports: [] },
    "src/cli.ts": { imports: ["src/commands/wakeup.ts", "src/commands/init.ts"] },
  },
});
const clusterFindings = unitsRule.check(clusterLayout);
summary(clusterFindings)
=> unit-directory pkg/src/commands/wakeup.ts

clusterFindings[0]?.message
=> wakeup.ts and its helpers wakeup-outcome.ts, wakeup-steps.ts are one unit beside other units in pkg/src/commands; make pkg/src/commands/wakeup/ and move them in, dropping the wakeup- prefix
```

## A helper reachable from two entries is infrastructure, not a unit

`shared.ts` is reachable from both `a.ts` and `b.ts`, so it is owned by
neither and stays put; both entries' units are themselves alone.

```ts
const infraLayout = layout({
  files: {
    "src/commands2/a.ts": { imports: ["src/commands2/shared.ts"] },
    "src/commands2/b.ts": { imports: ["src/commands2/shared.ts"] },
    "src/commands2/shared.ts": { imports: [] },
    "src/cli2.ts": { imports: ["src/commands2/a.ts", "src/commands2/b.ts"] },
  },
});
summary(unitsRule.check(infraLayout)) === ""
=> true
```

## A directory with exactly one entry is that unit, whatever its size

`main.ts` is the only entry in `single/`; `h1.ts` and `h2.ts` are its
helpers, but with one entry the directory is already the unit rule 5 asks
for, so there is nothing to report.

```ts
const singleLayout = layout({
  files: {
    "src/single/main.ts": { imports: ["src/single/h1.ts", "src/single/h2.ts"] },
    "src/single/h1.ts": { imports: [] },
    "src/single/h2.ts": { imports: [] },
    "src/entrypoint.ts": { imports: ["src/single/main.ts"] },
  },
});
summary(unitsRule.check(singleLayout)) === ""
=> true
```

## A program root with no importers is an entry

`tool.ts` and `other.ts` are each imported by nothing (a script run
directly, e.g. by `tsx`), so both count as entries by the "no module
imports it" branch, the same as an entry reached from outside. `tool.ts`
still owns `tool-helpers.ts`, which no one else reaches.

```ts
const rootLayout = layout({
  files: {
    "src/scripts/tool.ts": { imports: ["src/scripts/tool-helpers.ts"] },
    "src/scripts/tool-helpers.ts": { imports: [] },
    "src/scripts/other.ts": { imports: [] },
  },
});
summary(unitsRule.check(rootLayout))
=> unit-directory pkg/src/scripts/tool.ts
```

## A type-only internal edge still forms a unit

`main.ts` reaches `types-helper.ts` only through a type-only import;
that still counts as an internal edge for unit ownership.

```ts
const typedLayout = layout({
  files: {
    "src/typed/main.ts": { imports: ["type:src/typed/types-helper.ts"] },
    "src/typed/types-helper.ts": { imports: [] },
    "src/typed/other.ts": { imports: [] },
    "src/entry2.ts": { imports: ["src/typed/main.ts", "src/typed/other.ts"] },
  },
});
summary(unitsRule.check(typedLayout))
=> unit-directory pkg/src/typed/main.ts
```

## A dynamic import edge still forms a unit

The fixture builder always produces static edges, so this marks one edge
dynamic by hand after building the layout; the rule reads only `target`,
never `dynamic`, so the result is identical to the static case above.

```ts
const dynLayout = layout({
  files: {
    "src/dyn/main.ts": { imports: ["src/dyn/helper.ts"] },
    "src/dyn/helper.ts": { imports: [] },
    "src/dyn/other.ts": { imports: [] },
    "src/entry3.ts": { imports: ["src/dyn/main.ts", "src/dyn/other.ts"] },
  },
});
firstImport(asModule(dynLayout.files.get("pkg/src/dyn/main.ts"))).dynamic = true;
summary(unitsRule.check(dynLayout))
=> unit-directory pkg/src/dyn/main.ts
```

## A set directory is skipped; a member directory's own subdirectory is not

`registry.ts` declares `src/setdir` as a set (its `directory`), so
`setdir`'s own top level is never analysed here (rule 1 owns it). One
member, `memberA`, is itself a directory; `memberA` is not the set
directory, so it is in scope like any other, and its `entry.ts` +
`helper.ts` form a unit beside `second.ts`.

```ts
const setLayout = layout({
  files: {
    "src/registry.ts": {
      imports: ["src/setdir/memberA/entry.ts", "src/setdir/memberA/second.ts", "src/setdir/memberB.ts"],
      registry: {
        directory: "src/setdir",
        entry: "entry",
        members: [
          { source: "src/setdir/memberA/entry.ts" },
          { source: "src/setdir/memberA/second.ts" },
          { source: "src/setdir/memberB.ts" },
        ],
      },
    },
    "src/setdir/memberB.ts": { imports: [] },
    "src/setdir/memberA/entry.ts": { imports: ["src/setdir/memberA/helper.ts"] },
    "src/setdir/memberA/helper.ts": { imports: [] },
    "src/setdir/memberA/second.ts": { imports: [] },
  },
});
summary(unitsRule.check(setLayout))
=> unit-directory pkg/src/setdir/memberA/entry.ts
```

## A module used only under one subdirectory is shared-infrastructure

`util.ts` sits at `shared/`; every one of its importers is under
`shared/featureA/`, a single immediate child directory, so it belongs there
instead (rule 3's "lowest directory containing all its uses"). A module
nobody imports is not reported (`main.ts` in the flat-lib example above has
no importers and is not flagged as shared-infrastructure).

```ts
const sharedLayout = layout({
  files: {
    "src/shared/util.ts": { imports: [] },
    "src/shared/featureA/consumerA.ts": { imports: ["src/shared/util.ts"] },
    "src/shared/featureA/consumerB.ts": { imports: ["src/shared/util.ts"] },
  },
});
const sharedFindings = unitsRule.check(sharedLayout);
summary(sharedFindings)
=> shared-infrastructure pkg/src/shared/util.ts

sharedFindings[0]?.message
=> used only under pkg/src/shared/featureA; move it there
```

## A shared helper used only by set members directly is not shared-infrastructure

`registry.ts` declares `src/webapp/routes` as a set (its `directory`).
`util.ts` sits at `src/webapp/`, used only by two file members of the set,
`a.ts` and `b.ts`. The candidate target is `src/webapp/routes` itself, a set
directory, and its members are files, not a single child directory, so
descent finds no member directory and there is no finding (rule 1: a set
directory holds members only, so `util.ts` cannot move there).

```ts
const setMembersLayout = layout({
  files: {
    "src/webapp/util.ts": { imports: [] },
    "src/webapp/registry.ts": {
      imports: ["src/webapp/routes/a.ts", "src/webapp/routes/b.ts"],
      registry: {
        directory: "src/webapp/routes",
        members: [{ source: "src/webapp/routes/a.ts" }, { source: "src/webapp/routes/b.ts" }],
      },
    },
    "src/webapp/routes/a.ts": { imports: ["src/webapp/util.ts"] },
    "src/webapp/routes/b.ts": { imports: ["src/webapp/util.ts"] },
  },
});
summary(unitsRule.check(setMembersLayout)) === ""
=> true
```

## A shared helper used only inside one set member directory descends past the set

Same set, but `util.ts` is used only by files inside `routes/chat/`, a
member directory of the set. The candidate target `src/webapp/routes` is
still the set directory, but this time every importer lies inside its one
child `chat`, so descent continues and lands on `src/webapp/routes/chat`,
which is not itself a set directory: that is the finding.

```ts
const setMemberDirLayout = layout({
  files: {
    "src/webapp/util.ts": { imports: [] },
    "src/webapp/registry.ts": {
      imports: ["src/webapp/routes/chat/a.ts", "src/webapp/routes/chat/b.ts"],
      registry: {
        directory: "src/webapp/routes",
        members: [{ source: "src/webapp/routes/chat/a.ts" }, { source: "src/webapp/routes/chat/b.ts" }],
      },
    },
    "src/webapp/routes/chat/a.ts": { imports: ["src/webapp/util.ts"] },
    "src/webapp/routes/chat/b.ts": { imports: ["src/webapp/util.ts"] },
  },
});
const setMemberDirFindings = unitsRule.check(setMemberDirLayout);
summary(setMemberDirFindings)
=> shared-infrastructure pkg/src/webapp/util.ts

setMemberDirFindings[0]?.message
=> used only under pkg/src/webapp/routes/chat; move it there
```

## A test importing a helper does not make it an entry

`helper.doctest.md` imports `helper.ts` directly (tests import internals
freely), but that import does not count: `helper.ts` stays owned only by
`core.ts`. Were the test counted, `helper.ts` would itself become an entry
(imported from outside `priv/`) and the unit-directory finding below would
disappear.

```ts
const testLayout = layout({
  files: {
    "src/priv/core.ts": { imports: ["src/priv/helper.ts"] },
    "src/priv/helper.ts": { imports: [] },
    "src/priv/other.ts": { imports: [] },
    "src/entry4.ts": { imports: ["src/priv/core.ts", "src/priv/other.ts"] },
    "test/priv/helper.doctest.md": { test: ["src/priv/helper.ts"] },
  },
});
summary(unitsRule.check(testLayout))
=> unit-directory pkg/src/priv/core.ts
```

## `extraSourceRoots` directories are in scope the same as `src/`

`scripts/` is an extra source root (e.g. `beebox/scripts/` before it folds
into `src/`); `tool.ts` and `other.ts` are both entries reached from
`consumer.ts`, and `tool-helper.ts` is reachable only from `tool.ts`.

```ts
const extraLayout = layout({
  files: {
    "scripts/tool.ts": { imports: ["scripts/tool-helper.ts"] },
    "scripts/tool-helper.ts": { imports: [] },
    "scripts/other.ts": { imports: [] },
    "src/consumer.ts": { imports: ["scripts/tool.ts", "scripts/other.ts"] },
  },
  extraSourceRoots: ["scripts"],
});
summary(unitsRule.check(extraLayout))
=> unit-directory pkg/scripts/tool.ts
```
