// # health: plugin coverage, skill conflicts, and plugin-owned checks
//
// `pluginHealthChecks` (`src/webapp/trpc/routers/health/checks/plugins/core.ts`) is
// what `runHealthChecks` appends after `template-updates`. Every row derives from
// the effective schema map (`createCardSchemaMap`) and the box's active list
// together, so an inactive plugin with cards on disk and an active plugin with
// no stub are both visible (`docs/plugins.md`, "Health").

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { symlink } from "node:fs/promises";
import * as path from "node:path";
import { pluginHealthChecks } from "../../../../../../../src/webapp/trpc/routers/health/checks/plugins/core.js";
import { withDocId } from "../../../../../../../src/core/docs-gen/shared.js";
import type { HealthCheck, PluginDefinition } from "../../../../../../../src/cards/plugin-definition.js";
import { makeTmpBox } from "../../../../../../helpers/test-helpers.js";

/** Only the failing rows, as `{ name, severity, message }`. */
function failing(checks: HealthCheck[]) {
  return checks.filter((c) => !c.ok).map(({ name, severity, message }) => ({ name, severity, message }));
}

async function boxWithPlugins(plugins: unknown) {
  const box = await makeTmpBox();
  await box.write("_config/box.json", JSON.stringify({ plugins }));
  return box;
}

const fixturePlugin = (healthChecks: NonNullable<PluginDefinition["healthChecks"]>): PluginDefinition => ({
  name: "courseware",
  description: "Fixture standing in for courseware",
  docs: "src/plugins/courseware/README.md",
  schemas: undefined,
  healthChecks,
});

// ## A box with no plugin involvement passes every row
//
// The quiet case enumerates each check as ok, so `bbx health`'s pass count is
// stable.
void test("The quiet case enumerates each check as ok, so bbx health's pass count is sta...", async (t) => {
  t.teardown(async () => {
    try {
      await quiet.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const quiet = await makeTmpBox();
  const checks = await pluginHealthChecks(quiet.root);
  t.check(checks, [
    { name: "plugin-config", ok: true, message: "Every plugins entry in _config/box.json names an installed plugin", severity: "error" },
    { name: "plugin-type-unprovided", ok: true, message: "Every card type a plugin declares has a schema", severity: "error" },
    { name: "plugin-declared-missing", ok: true, message: "Every active plugin's declared types and views have stubs", severity: "error" },
    { name: "plugin-stub-inactive", ok: true, message: "Every plugin a stub imports is active", severity: "warning" },
    { name: "plugin-stub-missing", ok: true, message: "Every plugin stub names an installed plugin and loads", severity: "error" },
    { name: "skill-name-conflict", ok: true, message: "No managed skill name collides with a box skill", severity: "warning" },
    { name: "legacy-exposition-rules", ok: true, message: "No exposition-plan card carries a legacy `rules` field", severity: "warning" },
  ]);
});

// ## Cards of a plugin's type with the plugin inactive
//
// Two course cards and no `courseware` in `_config/box.json`: the cards have no
// schema, and the message names the plugin that provides one. Nothing is
// "declared missing" because the plugin is not active.
void test("Two course cards and no courseware in config/box.json:", async (t) => {
  t.teardown(async () => {
    try {
      await inactive.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const inactive = await makeTmpBox();
  await inactive.write("content/Acids.course.card", "---\n---\nAcids.\n");
  await inactive.write("content/Bases.course.card", "---\n---\nBases.\n");
  t.check(failing(await pluginHealthChecks(inactive.root)), [
    {
      name: "plugin-type-unprovided",
      severity: "error",
      message: "2 cards of type course have no schema. The courseware plugin provides it: `bbx plugins list`, then its README.",
    },
  ]);
});

// ## Active plugin with no stubs
//
// The plugin is listed but no stub completes it: one card is unprovided, and
// every declared type and view is reported with the stub path to write.
void test("The plugin is listed but no stub completes it:", async (t) => {
  t.teardown(async () => {
    try {
      await bare.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const bare = await boxWithPlugins(["courseware"]);
  await bare.write("content/Acids.course.card", "---\n---\nAcids.\n");
  t.check(failing(await pluginHealthChecks(bare.root)), [
    {
      name: "plugin-type-unprovided",
      severity: "error",
      message: "1 card of type course has no schema. The courseware plugin provides it: `bbx plugins list`, then its README.",
    },
    {
      name: "plugin-declared-missing",
      severity: "error",
      message: "The courseware plugin is active but its schema course has no stub at src/schemas/course.ts. Write it from node_modules/beebox/src/plugins/courseware/README.md, Setup.",
    },
    {
      name: "plugin-declared-missing",
      severity: "error",
      message: "The courseware plugin is active but its schema lesson-plan has no stub at src/schemas/lesson-plan.ts. Write it from node_modules/beebox/src/plugins/courseware/README.md, Setup.",
    },
    {
      name: "plugin-declared-missing",
      severity: "error",
      message: "The courseware plugin is active but its schema exposition-plan has no stub at src/schemas/exposition-plan.ts. Write it from node_modules/beebox/src/plugins/courseware/README.md, Setup.",
    },
    {
      name: "plugin-declared-missing",
      severity: "error",
      message: "The courseware plugin is active but its schema progress has no stub at src/schemas/progress.ts. Write it from node_modules/beebox/src/plugins/courseware/README.md, Setup.",
    },
    {
      name: "plugin-declared-missing",
      severity: "error",
      message: "The courseware plugin is active but its schema concept-map has no stub at src/schemas/concept-map.ts. Write it from node_modules/beebox/src/plugins/courseware/README.md, Setup.",
    },
    {
      name: "plugin-declared-missing",
      severity: "error",
      message: "The courseware plugin is active but its view concept-map has no stub at src/views/concept-map.tsx. Write it from node_modules/beebox/src/plugins/courseware/README.md, Setup.",
    },
  ]);
});

// ## A present stub that defines no schema of the declared type
//
// The box has `src/schemas/progress.ts`, but it registers `other`, so the
// effective map has no `progress` schema. File presence is not completion: the
// row fires with a message that says the file exists and what it lacks, unlike
// the "no stub" wording above. The stub needs `beebox/cards`, which
// `makeTmpBox({ deps: true })` resolves.
void test("The box has src/schemas/progress.ts, but it registers other, so the effective...", async (t) => {
  t.teardown(async () => {
    try {
      await wrongType.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const wrongType = await makeTmpBox({ deps: true });
  await wrongType.write("_config/box.json", JSON.stringify({ plugins: ["courseware"] }));
  await wrongType.write("src/schemas/progress.ts", 'import { cardSchema } from "beebox/cards";\nimport { z } from "beebox/schema";\n\nexport default cardSchema("other", { fields: { size: z.number() } });\n');
  t.check(failing(await pluginHealthChecks(wrongType.root)).filter((c) => c.name === "plugin-declared-missing" && c.message.includes("progress")), [
    {
      name: "plugin-declared-missing",
      severity: "error",
      message: "The courseware plugin is active but its stub src/schemas/progress.ts is present and defines no schema named progress. Write it from node_modules/beebox/src/plugins/courseware/README.md, Setup.",
    },
  ]);
});

// ## Invalid `plugins` entries are `plugin-config` rows
//
// Each problem `activePluginNames` reports is one failing row, worded as `bbx
// status` and `bbx plugins list` word it. An unknown name leaves the known ones
// active; a malformed field activates nothing and is one row.
void test("Each problem activePluginNames reports is one failing row, worded as bbx stat...", async (t) => {
  t.teardown(async () => {
    try {
      await typo.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const typo = await boxWithPlugins(["coursware"]);
  t.check(failing(await pluginHealthChecks(typo.root)).filter((c) => c.name === "plugin-config"), [
    {
      name: "plugin-config",
      severity: "error",
      message: "box.json names an unknown plugin: coursware",
    },
  ]);

  await typo.write("_config/box.json", JSON.stringify({ plugins: "courseware" }));
  t.check(failing(await pluginHealthChecks(typo.root)).filter((c) => c.name === "plugin-config"), [
    {
      name: "plugin-config",
      severity: "error",
      message: "box.json \"plugins\" must be an array of plugin names; found \"courseware\"",
    },
  ]);
});

// ## A box skill under the plugin's name
//
// The engine marks every skill file it writes (`guidance-sync/skills.ts`), and a
// plugin's skill is managed while the plugin is active. An unmarked
// `.claude/skills/courseware/SKILL.md` is the box's own, so the plugin's skill was
// not written over it; `skillConflicts` reports it and the check says so.
void test("The engine marks every skill file it writes (guidance-sync/skills.ts), and a...", async (t) => {
  t.teardown(async () => {
    try {
      await owned.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const owned = await boxWithPlugins(["courseware"]);
  await owned.write(".claude/skills/courseware/SKILL.md", "---\nname: courseware\n---\nMy own notes.\n");
  t.check(failing(await pluginHealthChecks(owned.root)).filter((c) => c.name === "skill-name-conflict"), [
    {
      name: "skill-name-conflict",
      severity: "warning",
      message: ".claude/skills/courseware/SKILL.md is a box skill the engine did not write, so the managed courseware skill is not installed. Rename or remove the box skill to receive it.",
    },
  ]);

  // The engine's own marked file is not a conflict:

  const relativePath = ".claude/skills/courseware/SKILL.md";
  await owned.write(relativePath, withDocId({ relativePath, content: "---\nname: courseware\n---\nMirrored.\n" }));
  t.check(failing(await pluginHealthChecks(owned.root)).filter((c) => c.name === "skill-name-conflict"), []);
});

// ## A plugin's own checks are prefixed; a throw is one failing row
//
// Each active plugin's `healthChecks(boxRoot)` runs with its rows renamed
// `<plugin>/<name>`. The `plugins` option stands in for the registry so a fixture
// can misbehave; `runHealthChecks` passes the same option through.
void test("Each active plugin's healthChecks(boxRoot) runs with its rows renamed <plugin...", async (t) => {
  t.teardown(async () => {
    try {
      await hooked.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const hooked = await boxWithPlugins(["courseware"]);
  const own = fixturePlugin(async () => [{ name: "maps-current", ok: true, message: "All maps rebuilt", severity: "warning" }]);
  t.check((await pluginHealthChecks(hooked.root, { plugins: [own] })).filter((c) => c.name.startsWith("courseware/")), [
    {
      name: "courseware/maps-current",
      ok: true,
      message: "All maps rebuilt",
      severity: "warning",
    },
  ]);

  // A hook that throws does not take the rest of health down with it:

  const broken = fixturePlugin(async () => { throw new Error("concept map index unreadable"); });
  t.check(failing(await pluginHealthChecks(hooked.root, { plugins: [broken] })).filter((c) => c.name.startsWith("courseware/")), [
    {
      name: "courseware/checks",
      severity: "error",
      message: "The courseware plugin's health checks threw: concept map index unreadable",
    },
  ]);
});

// ## An unreadable file does not stop the health run
//
// A dangling `*.exposition-plan.card` symlink is skipped, so every row still
// reports (`stubs.test.ts` covers a dangling stub file). Any other throw in these checks becomes one failing
// `plugin-checks` row, so `/api/health` and `bbx health` still answer.
void test("A dangling card symlink leaves every row reporting", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("content/Course.attach/.keep", "");
  await symlink(path.join(box.root, "content/missing.card"), path.join(box.root, "content/Course.attach/Course.exposition-plan.card"));
  const checks = await pluginHealthChecks(box.root);
  // The card counts by its name; this row does not read it.
  t.check(failing(checks), [
    {
      name: "plugin-type-unprovided",
      severity: "error",
      message: "1 card of type exposition-plan has no schema. The courseware plugin provides it: `bbx plugins list`, then its README.",
    },
  ]);
  // The unreadable card reads as no rules.
  t.check(
    checks.find((c) => c.name === "legacy-exposition-rules"),
    { name: "legacy-exposition-rules", ok: true, message: "No exposition-plan card carries a legacy `rules` field", severity: "warning" },
  );
});

void test("A throw inside the plugin checks is one failing plugin-checks row", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const broken: PluginDefinition = {
    get name(): string {
      throw new Error("boom");
    },
    description: "Fixture whose name throws",
    docs: "src/plugins/courseware/README.md",
    schemas: undefined,
  };
  // The health run still returns rows.
  t.check(await pluginHealthChecks(box.root, { plugins: [broken] }), [
    { name: "plugin-checks", ok: false, message: "The plugin health checks threw: boom", severity: "error" },
  ]);
});
