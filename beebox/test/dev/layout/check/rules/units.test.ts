// # Units (rules 3 and 5)
//
// `unitsRule` finds two things per directory in scope: an entry with helpers
// reachable from no other entry becomes its own unit-directory (rule 5), and a
// module reachable only from importers under one subdirectory is
// shared-infrastructure that belongs there (rule 3). A set directory (declared
// by a `defineRegistry` call elsewhere in the layout) is skipped entirely;
// rule 1 governs its top level.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { explainDirectory, unitsRule } from "../../../../../src/dev/layout/check/rules/units.js";
import { layout } from "./fixture.js";

// ## A flat utility directory where every file is imported from outside is clean
//
// This is `src/lib`'s shape: every sibling is reachable from outside the
// directory, so every sibling is its own entry, none is reachable from another,
// and there is nothing to report.
void test("This is src/lib's shape:", async (t) => {
  const libLayout = layout({
    files: {
      "src/lib/a.ts": { imports: [] },
      "src/lib/b.ts": { imports: [] },
      "src/app.ts": { imports: ["src/lib/a.ts", "src/lib/b.ts"] },
    },
  });
  t.check(unitsRule.check(libLayout), []);
});

// ## A cluster beside another entry is one unit-directory finding
//
// `wakeup.ts` and `init.ts` are both entries (something outside `commands/`
// imports each). `wakeup-steps.ts` and `wakeup-outcome.ts` are reachable only
// from `wakeup.ts`, so they are `wakeup.ts`'s unit; `init.ts`'s unit is itself
// alone.
void test("wakeup.ts and init.ts are both entries (something outside commands/ imports e...", async (t) => {
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
  t.check(clusterFindings, [
    {
      rule: "unit-directory",
      path: "pkg/src/commands/wakeup.ts",
      message: "wakeup.ts and its helpers wakeup-outcome.ts, wakeup-steps.ts are one unit beside other units in pkg/src/commands; make pkg/src/commands/wakeup/ and move them in, dropping the wakeup- prefix, and rename their mirrored tests to match. If a new import of one of these helpers made this a unit, importing through wakeup.ts instead may be the smaller fix (beebox/docs/implemented-plans/file-layout.md, rule 5). Unit imports: wakeup.ts -> wakeup-outcome.ts, wakeup.ts -> wakeup-steps.ts. Other entries: init.ts (imported by pkg/src/cli.ts)",
    },
  ]);
});

// ## A helper reachable from two entries is infrastructure, not a unit
//
// `shared.ts` is reachable from both `a.ts` and `b.ts`, so it is owned by
// neither and stays put; both entries' units are themselves alone.
void test("shared.ts is reachable from both a.ts and b.ts, so it is owned by neither and...", async (t) => {
  const infraLayout = layout({
    files: {
      "src/commands2/a.ts": { imports: ["src/commands2/shared.ts"] },
      "src/commands2/b.ts": { imports: ["src/commands2/shared.ts"] },
      "src/commands2/shared.ts": { imports: [] },
      "src/cli2.ts": { imports: ["src/commands2/a.ts", "src/commands2/b.ts"] },
    },
  });
  t.check(unitsRule.check(infraLayout), []);
});

// ## A directory with exactly one entry is that unit, whatever its size
//
// `main.ts` is the only entry in `single/`; `h1.ts` and `h2.ts` are its
// helpers, but with one entry the directory is already the unit rule 5 asks
// for, so there is nothing to report.
void test("main.ts is the only entry in single/; h1.ts and h2.ts are its helpers, but wi...", async (t) => {
  const singleLayout = layout({
    files: {
      "src/single/main.ts": { imports: ["src/single/h1.ts", "src/single/h2.ts"] },
      "src/single/h1.ts": { imports: [] },
      "src/single/h2.ts": { imports: [] },
      "src/entrypoint.ts": { imports: ["src/single/main.ts"] },
    },
  });
  t.check(unitsRule.check(singleLayout), []);
});

// ## A program root with no importers is an entry
//
// `tool.ts` and `other.ts` are each imported by nothing (a script run
// directly, e.g. by `tsx`), so both count as entries by the "no module
// imports it" branch, the same as an entry reached from outside. `tool.ts`
// still owns `tool-helpers.ts`, which no one else reaches.
void test("tool.ts and other.ts are each imported by nothing (a script run directly, e.g.", async (t) => {
  const rootLayout = layout({
    files: {
      "src/scripts/tool.ts": { imports: ["src/scripts/tool-helpers.ts"] },
      "src/scripts/tool-helpers.ts": { imports: [] },
      "src/scripts/other.ts": { imports: [] },
    },
  });
  t.check(unitsRule.check(rootLayout), [
    {
      rule: "unit-directory",
      path: "pkg/src/scripts/tool.ts",
      message: "tool.ts and its helpers tool-helpers.ts are one unit beside other units in pkg/src/scripts; make pkg/src/scripts/tool/ and move them in, dropping the tool- prefix, and rename their mirrored tests to match. If a new import of one of these helpers made this a unit, importing through tool.ts instead may be the smaller fix (beebox/docs/implemented-plans/file-layout.md, rule 5). Unit imports: tool.ts -> tool-helpers.ts. Other entries: other.ts (no importers)",
    },
  ]);
});

// ## A type-only internal edge still forms a unit
//
// `main.ts` reaches `types-helper.ts` only through a type-only import;
// that still counts as an internal edge for unit ownership.
void test("main.ts reaches types-helper.ts only through a type-only import; that still c...", async (t) => {
  const typedLayout = layout({
    files: {
      "src/typed/main.ts": { imports: ["type:src/typed/types-helper.ts"] },
      "src/typed/types-helper.ts": { imports: [] },
      "src/typed/other.ts": { imports: [] },
      "src/entry2.ts": { imports: ["src/typed/main.ts", "src/typed/other.ts"] },
    },
  });
  t.check(unitsRule.check(typedLayout), [
    {
      rule: "unit-directory",
      path: "pkg/src/typed/main.ts",
      message: "main.ts and its helpers types-helper.ts are one unit beside other units in pkg/src/typed; make pkg/src/typed/main/ and move them in, dropping the main- prefix, and rename their mirrored tests to match. If a new import of one of these helpers made this a unit, importing through main.ts instead may be the smaller fix (beebox/docs/implemented-plans/file-layout.md, rule 5). Unit imports: main.ts -> types-helper.ts. Other entries: other.ts (imported by pkg/src/entry2.ts)",
    },
  ]);
});

// ## A set directory is skipped; a member directory's own subdirectory is not, but its entry is fixed
//
// `registry.ts` declares `src/setdir` as a set (its `directory`), so
// `setdir`'s own top level is never analysed here (rule 1 owns it). One
// member, `memberA`, is itself a directory; `memberA` is not the set
// directory, so it is in scope like any other. `entry.ts` is the directory
// member's source (`<dir>/<name>/<entry>.ts`), so its location is fixed the
// same as a registry-declaring module: it stays an entry regardless of its
// exclusive helper `helper.ts`, and produces no unit-directory finding.
// `second.ts` is a plain export `registry.ts` imports directly (not a set
// member), so it is an ordinary entry; its own exclusive helper
// `second-helper.ts` still gets a finding.
void test("registry.ts declares src/setdir as a set (its directory), so setdir's own top...", async (t) => {
  const setLayout = layout({
    files: {
      "src/registry.ts": {
        imports: ["src/setdir/memberA/entry.ts", "src/setdir/memberA/second.ts", "src/setdir/memberB.ts"],
        registry: {
          directory: "src/setdir",
          entry: "entry",
          members: [{ source: "src/setdir/memberA/entry.ts" }, { source: "src/setdir/memberB.ts" }],
        },
      },
      "src/setdir/memberB.ts": { imports: [] },
      "src/setdir/memberA/entry.ts": { imports: ["src/setdir/memberA/helper.ts"] },
      "src/setdir/memberA/helper.ts": { imports: [] },
      "src/setdir/memberA/second.ts": { imports: ["src/setdir/memberA/second-helper.ts"] },
      "src/setdir/memberA/second-helper.ts": { imports: [] },
    },
  });
  const setFindings = unitsRule.check(setLayout);
  t.check(setFindings, [
    {
      rule: "unit-directory",
      path: "pkg/src/setdir/memberA/second.ts",
      message: "second.ts and its helpers second-helper.ts are one unit beside other units in pkg/src/setdir/memberA; make pkg/src/setdir/memberA/second/ and move them in, dropping the second- prefix, and rename their mirrored tests to match. If a new import of one of these helpers made this a unit, importing through second.ts instead may be the smaller fix (beebox/docs/implemented-plans/file-layout.md, rule 5). Unit imports: second.ts -> second-helper.ts. Other entries: entry.ts (registry-fixed)",
    },
  ]);
});

// ## A module used only under one subdirectory is shared-infrastructure
//
// `util.ts` sits at `shared/`; every one of its importers is under
// `shared/featureA/`, a single immediate child directory, so it belongs there
// instead (rule 3's "lowest directory containing all its uses"). A module
// nobody imports is not reported (`main.ts` in the flat-lib example above has
// no importers and is not flagged as shared-infrastructure).
void test("util.ts sits at shared/; every one of its importers is under shared/featureA/...", async (t) => {
  const sharedLayout = layout({
    files: {
      "src/shared/util.ts": { imports: [] },
      "src/shared/featureA/consumerA.ts": { imports: ["src/shared/util.ts"] },
      "src/shared/featureA/consumerB.ts": { imports: ["src/shared/util.ts"] },
    },
  });
  const sharedFindings = unitsRule.check(sharedLayout);
  t.check(sharedFindings, [
    {
      rule: "shared-infrastructure",
      path: "pkg/src/shared/util.ts",
      message: "used only under pkg/src/shared/featureA; move it there",
    },
  ]);
});

// ## A shared helper used only by set members directly is not shared-infrastructure
//
// `registry.ts` declares `src/webapp/routes` as a set (its `directory`).
// `util.ts` sits at `src/webapp/`, used only by two file members of the set,
// `a.ts` and `b.ts`. The candidate target is `src/webapp/routes` itself, a set
// directory, and its members are files, not a single child directory, so
// descent finds no member directory and there is no finding (rule 1: a set
// directory holds members only, so `util.ts` cannot move there).
void test("registry.ts declares src/webapp/routes as a set (its directory).", async (t) => {
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
  t.check(unitsRule.check(setMembersLayout), []);
});

// ## A shared helper used only inside one set member directory descends past the set
//
// Same set, but `util.ts` is used only by files inside `routes/chat/`, a
// member directory of the set. The candidate target `src/webapp/routes` is
// still the set directory, but this time every importer lies inside its one
// child `chat`, so descent continues and lands on `src/webapp/routes/chat/register`,
// which is not itself a set directory: that is the finding.
void test("Same set, but util.ts is used only by files inside routes/chat/, a member dir...", async (t) => {
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
  t.check(setMemberDirFindings, [
    {
      rule: "shared-infrastructure",
      path: "pkg/src/webapp/util.ts",
      message: "used only under pkg/src/webapp/routes/chat; move it there",
    },
  ]);
});

// ## A test importing a helper does not make it an entry
//
// `helper.test.ts` imports `helper.ts` directly (tests import internals
// freely), but that import does not count: `helper.ts` stays owned only by
// `core.ts`. Were the test counted, `helper.ts` would itself become an entry
// (imported from outside `priv/`) and the unit-directory finding below would
// disappear.
void test("helper.test.ts imports helper.ts directly (tests import internals freely),...", async (t) => {
  const testLayout = layout({
    files: {
      "src/priv/core.ts": { imports: ["src/priv/helper.ts"] },
      "src/priv/helper.ts": { imports: [] },
      "src/priv/other.ts": { imports: [] },
      "src/entry4.ts": { imports: ["src/priv/core.ts", "src/priv/other.ts"] },
      "test/priv/helper.test.ts": { test: ["src/priv/helper.ts"] },
    },
  });
  t.check(unitsRule.check(testLayout), [
    {
      rule: "unit-directory",
      path: "pkg/src/priv/core.ts",
      message: "core.ts and its helpers helper.ts are one unit beside other units in pkg/src/priv; make pkg/src/priv/core/ and move them in, dropping the core- prefix, and rename their mirrored tests to match. If a new import of one of these helpers made this a unit, importing through core.ts instead may be the smaller fix (beebox/docs/implemented-plans/file-layout.md, rule 5). Unit imports: core.ts -> helper.ts. Other entries: other.ts (imported by pkg/src/entry4.ts)",
    },
  ]);
});

// ## A registry-declaring module is always its directory's entry
//
// `reg.ts` declares `src/mod/schemas` as a set. Its only importer is
// `user.ts`, a sibling in the same directory — ordinarily that would make
// `reg.ts` a helper reachable only from `user.ts`, sweeping it into
// `user.ts`'s unit-directory finding alongside `user-helper.ts`. But rule 4
// already fixes `reg.ts`'s location (the parent of the set it declares), so
// declaring a registry makes it an entry regardless of who imports it: the
// finding below names only `user-helper.ts`, not `reg.ts`.
void test("reg.ts declares src/mod/schemas as a set.", async (t) => {
  const registryEntryLayout = layout({
    files: {
      "src/mod/user.ts": { imports: ["src/mod/reg.ts", "src/mod/user-helper.ts"] },
      "src/mod/user-helper.ts": { imports: [] },
      "src/mod/reg.ts": {
        registry: {
          directory: "src/mod/schemas",
          entry: "schema",
          members: [{ source: null }],
        },
      },
      "src/entry5.ts": { imports: ["src/mod/user.ts"] },
    },
  });
  const registryEntryFindings = unitsRule.check(registryEntryLayout);
  t.check(registryEntryFindings, [
    {
      rule: "unit-directory",
      path: "pkg/src/mod/user.ts",
      message: "user.ts and its helpers user-helper.ts are one unit beside other units in pkg/src/mod; make pkg/src/mod/user/ and move them in, dropping the user- prefix, and rename their mirrored tests to match. If a new import of one of these helpers made this a unit, importing through user.ts instead may be the smaller fix (beebox/docs/implemented-plans/file-layout.md, rule 5). Unit imports: user.ts -> user-helper.ts. Other entries: reg.ts (registry-fixed)",
    },
  ]);
});

// ## A registry-declaring module is never shared-infrastructure
//
// `registry.ts` declares `src/area/schemas` as a set. Its only importer,
// `consumer.ts`, sits under the strict subdirectory `src/area/child`, which
// would ordinarily make `registry.ts` shared-infrastructure that belongs
// there (as `util.ts` does above). Rule 4 already fixes where a
// registry-declaring module lives, so it is exempt.
void test("registry.ts declares src/area/schemas as a set.", async (t) => {
  const registryFixedLayout = layout({
    files: {
      "src/area/registry.ts": {
        registry: {
          directory: "src/area/schemas",
          entry: "schema",
          members: [{ source: null }],
        },
      },
      "src/area/child/consumer.ts": { imports: ["src/area/registry.ts"] },
    },
  });
  t.check(unitsRule.check(registryFixedLayout), []);
});

// ## `extraSourceRoots` directories are in scope the same as `src/`
//
// `scripts/` is an extra source root (e.g. `beebox/scripts/` before it folds
// into `src/`); `tool.ts` and `other.ts` are both entries reached from
// `consumer.ts`, and `tool-helper.ts` is reachable only from `tool.ts`.
void test("scripts/ is an extra source root (e.g.", async (t) => {
  const extraLayout = layout({
    files: {
      "scripts/tool.ts": { imports: ["scripts/tool-helper.ts"] },
      "scripts/tool-helper.ts": { imports: [] },
      "scripts/other.ts": { imports: [] },
      "src/consumer.ts": { imports: ["scripts/tool.ts", "scripts/other.ts"] },
    },
    extraSourceRoots: ["scripts"],
  });
  t.check(unitsRule.check(extraLayout), [
    {
      rule: "unit-directory",
      path: "pkg/scripts/tool.ts",
      message: "tool.ts and its helpers tool-helper.ts are one unit beside other units in pkg/scripts; make pkg/scripts/tool/ and move them in, dropping the tool- prefix, and rename their mirrored tests to match. If a new import of one of these helpers made this a unit, importing through tool.ts instead may be the smaller fix (beebox/docs/implemented-plans/file-layout.md, rule 5). Unit imports: tool.ts -> tool-helper.ts. Other entries: other.ts (imported by pkg/src/consumer.ts)",
    },
  ]);
});

// ## The finding names the import chain and why each other entry is one
//
// The retrospective case: a support module nothing imports (`fixtures.ts`)
// imports a sibling (`seed.ts`), which imports another (`seed-data.ts`). The
// support module is an entry because nothing imports it, so its chain is a
// unit beside `api.ts`. The finding lists both hops; `--explain` prints the
// same graph for the directory, plus a helper both entries reach.
void test("the retrospective case: a support module nothing imports", async (t) => {
  const chainLayout = layout({
    files: {
      "src/store/api.ts": { imports: ["src/store/shared.ts"] },
      "src/store/fixtures.ts": { imports: ["src/store/seed.ts", "src/store/shared.ts"] },
      "src/store/seed.ts": { imports: ["src/store/seed-data.ts"] },
      "src/store/seed-data.ts": { imports: [] },
      "src/store/shared.ts": { imports: [] },
      "src/app.ts": { imports: ["src/store/api.ts"] },
    },
  });
  t.check(
    unitsRule.check(chainLayout).map((finding) => finding.message.split("rule 5). ")[1]),
    ["Unit imports: fixtures.ts -> seed.ts, seed.ts -> seed-data.ts. Other entries: api.ts (imported by pkg/src/app.ts)"],
  );
  t.check(explainDirectory(chainLayout, "pkg/src/store"), [
    "pkg/src/store: 2 entries",
    "  api.ts (imported by pkg/src/app.ts)",
    "  fixtures.ts (no importers)",
    "    helpers: seed-data.ts, seed.ts",
    "    imports: fixtures.ts -> seed.ts, seed.ts -> seed-data.ts",
    "shared helpers:",
    "  shared.ts (reached from api.ts, fixtures.ts)",
  ]);
});
