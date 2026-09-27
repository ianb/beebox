# Sets rule

Rules 1, 2, and 4 (set purity, registry placement/naming, record-form keys)
plus the side-effect-registration check that backs rule 4's "nothing else
constructs the list". `beebox/docs/plans/file-layout.md`.

```ts setup
import { setsRule } from "../../../../../src/dev/layout/check/rules/sets.js";
import { layout, summary } from "./fixture.js";
```

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
  },
});
summary(setsRule.check(schemasLayout)) === ""
=> true
```

## A set directory holding a data file

A data file is never a valid member location, so it is always unclaimed.

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
    "src/assets/palette.json": "data",
  },
});
summary(setsRule.check(assetsLayout))
=> set-members pkg/src/assets/palette.json
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
          { source: "src/exports/cards.ts", key: "wrongkey" },
          { source: "src/exports/legacy/handler.ts", key: "old" },
        ],
      },
    },
    "src/exports/schema.ts": {},
    "src/exports/cards.ts": {},
    "src/exports/legacy/handler.ts": {},
  },
});
summary(setsRule.check(exportsLayout))
=>
registry pkg/src/exports.ts
registry pkg/src/exports.ts
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
  },
});
summary(setsRule.check(pathReadLayout))
=> registry pkg/src/scripts/loader.ts
```
