# Sets rule

Rules 1, 2, and 4 (set purity, registry placement/naming, record-form keys)
plus the side-effect-registration check that backs rule 4's "nothing else
constructs the list". `beebox/docs/plans/file-layout.md`.

```ts setup
import { setsRule } from "../../../../../../src/dev/layout/check/rules/sets/rule.js";
import { layout, summary } from "../fixture.js";
```

Every fixture below that expects a clean (or unrelated-finding) result gives
its registry a consumer (`src/entry.ts` importing it), since the
registry-imported guard now flags a declared registry nothing imports.

## No registries, no findings

```ts
const plainLayout = layout({ files: { "src/util.ts": {} } });
summary(setsRule.check(plainLayout)) === ""
=> true
```

## A clean list-form set: file members, one directory member, a type-only cross-member import

`entry: "command"` makes `migrate/command.ts` a directory member; `wakeup.ts`
imports the migrate member's type only, which rule 2 (member independence)
allows.

```ts
const commandsLayout = layout({
  files: {
    "src/commands.ts": {
      registry: {
        directory: "src/commands",
        entry: "command",
        ordered: false,
        form: "list",
        members: [
          { source: "src/commands/wakeup.ts" },
          { source: "src/commands/init.ts" },
          { source: "src/commands/migrate/command.ts" },
        ],
      },
    },
    "src/commands/wakeup.ts": { imports: ["type:src/commands/migrate/command.ts"] },
    "src/commands/init.ts": {},
    "src/commands/migrate/command.ts": {},
    "src/entry.ts": { imports: ["src/commands.ts"] },
  },
});
summary(setsRule.check(commandsLayout)) === ""
=> true
```

## A clean record-form set

```ts
const schemasLayout = layout({
  files: {
    "src/schemas.ts": {
      registry: {
        directory: "src/schemas",
        ordered: false,
        form: "record",
        members: [
          { source: "src/schemas/memo.ts", key: "memo" },
          { source: "src/schemas/recipe.ts", key: "recipe" },
        ],
      },
    },
    "src/schemas/memo.ts": {},
    "src/schemas/recipe.ts": {},
    "src/entry.ts": { imports: ["src/schemas.ts"] },
  },
});
summary(setsRule.check(schemasLayout)) === ""
=> true
```

## A set directory holding a data file is clean; a stray module is still a finding

Data files (a directory's `CLAUDE.md`, `AGENTS.md`, fixtures, assets) are
opaque to the rules (Ontology, "Scope of the rules"): the completeness check
counts only `module`, `test`, and `declaration` files (and subdirectories) as
candidate members, so `CLAUDE.md` is never unclaimed. `stray.ts` is a module,
so it still is.

```ts
const assetsLayout = layout({
  files: {
    "src/assets.ts": {
      registry: {
        directory: "src/assets",
        ordered: false,
        form: "list",
        members: [{ source: "src/assets/logo.ts" }],
      },
    },
    "src/assets/logo.ts": {},
    "src/assets/CLAUDE.md": "data",
    "src/assets/stray.ts": {},
    "src/entry.ts": { imports: ["src/assets.ts"] },
  },
});
summary(setsRule.check(assetsLayout))
=> set-members pkg/src/assets/stray.ts
```

## Two registries declare the same set directory

`other.ts` is also misnamed for the directory it declares (rule 2), so it
carries both findings.

```ts
const dupLayout = layout({
  files: {
    "src/dup.ts": {
      registry: { directory: "src/dup", ordered: false, form: "list", members: [] },
    },
    "src/other.ts": {
      registry: { directory: "src/dup", ordered: false, form: "list", members: [] },
    },
    "src/entry.ts": { imports: ["src/dup.ts", "src/other.ts"] },
  },
});
const dupFindings = setsRule.check(dupLayout);
summary(dupFindings)
=>
registry pkg/src/dup.ts
registry pkg/src/other.ts
registry pkg/src/other.ts

dupFindings.find((f) => f.path === "pkg/src/dup.ts")?.message
=> set directory pkg/src/dup is also declared by pkg/src/other.ts; keep exactly one defineRegistry call per set directory
```

## A registry misnamed for its set directory

`trpc/router.ts` declares `trpc/routers`: right parent, wrong stem.

```ts
const trpcLayout = layout({
  files: {
    "trpc/router.ts": {
      registry: { directory: "trpc/routers", ordered: false, form: "list", members: [] },
    },
    "src/entry.ts": { imports: ["trpc/router.ts"] },
  },
});
const trpcFindings = setsRule.check(trpcLayout);
summary(trpcFindings)
=> registry pkg/trpc/router.ts

trpcFindings[0]?.message
=> registry for set directory pkg/trpc/routers must be pkg/trpc/routers.ts (the set directory's parent, named for the set); move or rename it
```

## Completeness both ways: unclaimed children, a null-source member, a member imported from outside the set

`legacy.ts` is an unclaimed file, `migrate/` is an unclaimed subdirectory
(the registry has no `entry`, so no directory member is ever valid),
`customVerb` has no import, and `shared-helper.ts` is a member imported
from outside `src/verbs`.

```ts
const verbsLayout = layout({
  files: {
    "src/verbs.ts": {
      registry: {
        directory: "src/verbs",
        ordered: false,
        form: "list",
        members: [
          { source: "src/verbs/wakeup.ts" },
          { source: null, expression: "customVerb" },
          { source: "src/lib/shared-helper.ts" },
        ],
      },
    },
    "src/verbs/wakeup.ts": {},
    "src/verbs/legacy.ts": {},
    "src/verbs/migrate/helper.ts": {},
    "src/lib/shared-helper.ts": {},
    "src/entry.ts": { imports: ["src/verbs.ts"] },
  },
});
summary(setsRule.check(verbsLayout))
=>
set-members pkg/src/lib/shared-helper.ts
set-members pkg/src/verbs.ts
set-members pkg/src/verbs/legacy.ts
set-members pkg/src/verbs/migrate
```

## Record-form keys that do not match their member name (file member and directory member)

The key equals the member name converted from kebab-case to camelCase:
`quick-chat.ts` is correctly keyed `quickChat`, so it carries no finding.
`cards.ts` (a file member) and `legacy/handler.ts` (a directory member, via
`entry: "handler"`) are keyed wrong.

```ts
const exportsLayout = layout({
  files: {
    "src/exports.ts": {
      registry: {
        directory: "src/exports",
        entry: "handler",
        ordered: false,
        form: "record",
        members: [
          { source: "src/exports/schema.ts", key: "schema" },
          { source: "src/exports/quick-chat.ts", key: "quickChat" },
          { source: "src/exports/cards.ts", key: "wrongkey" },
          { source: "src/exports/legacy/handler.ts", key: "old" },
        ],
      },
    },
    "src/exports/schema.ts": {},
    "src/exports/quick-chat.ts": {},
    "src/exports/cards.ts": {},
    "src/exports/legacy/handler.ts": {},
    "src/entry.ts": { imports: ["src/exports.ts"] },
  },
});
const exportsFindings = setsRule.check(exportsLayout);
summary(exportsFindings)
=>
registry pkg/src/exports.ts
registry pkg/src/exports.ts

JSON.stringify(exportsFindings.map((f) => f.message))
=>
["record key \"old\" does not match expected key \"legacy\" for member \"legacy\" (pkg/src/exports/legacy/handler.ts); rename the key or the member to match","record key \"wrongkey\" does not match expected key \"cards\" for member \"cards\" (pkg/src/exports/cards.ts); rename the key or the member to match"]
```

## A value import between two members, and a member importing its own registry

`health.ts` imports `chat.ts`'s value (rule 2 / `member-imports`); `chat.ts`
imports the registry itself (rule 4's "members must not import their
registry").

```ts
const routesLayout = layout({
  files: {
    "src/routes.ts": {
      registry: {
        directory: "src/routes",
        ordered: false,
        form: "list",
        members: [{ source: "src/routes/health.ts" }, { source: "src/routes/chat.ts" }],
      },
    },
    "src/routes/health.ts": { imports: ["src/routes/chat.ts"] },
    "src/routes/chat.ts": { imports: ["src/routes.ts"] },
  },
});
const routesFindings = setsRule.check(routesLayout);
summary(routesFindings)
=>
member-imports pkg/src/routes/health.ts
registry pkg/src/routes/chat.ts

routesFindings.find((f) => f.rule === "member-imports")?.message
=> imports pkg/src/routes/chat.ts (member "chat") from member "health" of the same set; move the shared thing to infrastructure outside the set, or merge the two members
```

## Side-effect registration only fires for an internal cross-module registration import

`other.ts` calls `registerish`: the callee must be `register` followed by an
upper-case letter, so a merely `register`-prefixed lowercase name is never a
finding, regardless of imports. Of calls that do match, only one whose root
identifier is bound by an import from *another file in this package* counts
as self-registration into that file's registry — the fixture always builds
`ImportEdge.names` as `[]`, so each case below edits the returned layout's
module imports directly (as the tests-rule doctest does).

`builtins.ts` calls `registerTemplate`, imported from `./templates-registry.js`
inside this package: a finding. `serializers.ts` calls `registerSerializer`,
imported from the external package `agent-doctest/check`: no finding. `ns.ts`
calls `ns.registerThing` where `ns` is bound by an external namespace import:
no finding, since the dotted callee's root `ns` is external. `worklet.ts`
calls `registerProcessor` (the AudioWorklet global, like
`pcm-processor.worklet.js`) with no import binding it at all: no finding,
since a global is not cross-module registration. `local.ts` calls a
`register` function defined in the same file, also bound by no import: no
finding, for the same reason.

```ts
const registrationSourcesLayout = layout({
  files: {
    "src/schemas/builtins.ts": { topLevelCalls: ["registerTemplate"] },
    "src/serializers.ts": { topLevelCalls: ["registerSerializer"] },
    "src/connectors/ns.ts": { topLevelCalls: ["ns.registerThing"] },
    "src/audio/worklet.ts": { topLevelCalls: ["registerProcessor"] },
    "src/schemas/local.ts": { topLevelCalls: ["registerLocal"] },
    "src/connectors/other.ts": { topLevelCalls: ["registerish"] },
  },
});
const builtins = registrationSourcesLayout.files.get("pkg/src/schemas/builtins.ts");
if (builtins === undefined || builtins.kind !== "module") throw new Error("expected module");
builtins.imports = [
  {
    specifier: "./templates-registry.js",
    target: "pkg/src/schemas/templates-registry.ts",
    external: false,
    typeOnly: false,
    names: ["registerTemplate"],
    dynamic: false,
  },
];
const serializers = registrationSourcesLayout.files.get("pkg/src/serializers.ts");
if (serializers === undefined || serializers.kind !== "module") throw new Error("expected module");
serializers.imports = [
  { specifier: "agent-doctest/check", target: null, external: true, typeOnly: false, names: ["registerSerializer"], dynamic: false },
];
const ns = registrationSourcesLayout.files.get("pkg/src/connectors/ns.ts");
if (ns === undefined || ns.kind !== "module") throw new Error("expected module");
ns.imports = [
  { specifier: "some-external-lib", target: null, external: true, typeOnly: false, names: ["ns"], dynamic: false },
];
summary(setsRule.check(registrationSourcesLayout))
=> side-effect-registration pkg/src/schemas/builtins.ts
```

## A module reads a set directory by path instead of importing the registry

`../schemas` resolves to the set directory; `../other` resolves elsewhere
and is ignored.

```ts
const pathReadLayout = layout({
  files: {
    "src/schemas.ts": {
      registry: {
        directory: "src/schemas",
        ordered: false,
        form: "record",
        members: [{ source: "src/schemas/memo.ts", key: "memo" }],
      },
    },
    "src/schemas/memo.ts": {},
    "src/scripts/loader.ts": { relativePathLiterals: ["../schemas", "../other"] },
    "src/entry.ts": { imports: ["src/schemas.ts"] },
  },
});
summary(setsRule.check(pathReadLayout))
=> registry pkg/src/scripts/loader.ts
```

## A registry nothing imports

`commands.ts` declares completeness over `src/commands/`, but no module
value-imports the registry back — the members are used some other way (each
called directly, say), which is the second-list smell: the directory isn't
actually enumerated through this registry by anyone. A test-only importer
doesn't count, matching how tests never count as importers for the units
rule.

```ts
const unimportedLayout = layout({
  files: {
    "src/commands.ts": {
      registry: {
        directory: "src/commands",
        ordered: false,
        form: "list",
        members: [{ source: "src/commands/wakeup.ts" }],
      },
    },
    "src/commands/wakeup.ts": {},
    "src/commands.test.ts": { test: ["src/commands.ts"] },
  },
});
const unimportedFindings = setsRule.check(unimportedLayout);
summary(unimportedFindings)
=> registry pkg/src/commands.ts

unimportedFindings[0]?.message
=> pkg/src/commands.ts declares pkg/src/commands but nothing imports it; the set's consumers must enumerate it through the registry, or the directory is not a set (delete the registry)
```

## A type-only import of a registry does not count

`entry.ts` imports `commands.ts` for its type only, same as no importer at
all — a set's members are read through a value import (`.list`, `.get`), so
a type-only reference proves nothing about who actually enumerates the set.

```ts
const typeOnlyLayout = layout({
  files: {
    "src/commands.ts": {
      registry: {
        directory: "src/commands",
        ordered: false,
        form: "list",
        members: [{ source: "src/commands/wakeup.ts" }],
      },
    },
    "src/commands/wakeup.ts": {},
    "src/entry.ts": { imports: ["type:src/commands.ts"] },
  },
});
summary(setsRule.check(typeOnlyLayout))
=> registry pkg/src/commands.ts
```
