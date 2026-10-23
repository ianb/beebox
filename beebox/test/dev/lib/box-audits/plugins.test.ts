// # Plugin activation for knowledge audits
//
// An audit that declares `plugins` gets them activated the way the plugin
// README tells a boxholder to: the names join `_config/box.json` `plugins`
// beside the box's other settings, and each default type gets a schema stub.
// A stub the box already has is left alone; if it does not define the type,
// the readiness check names its path instead of letting the audit run on a
// half-activated box.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { activateAuditPlugins, assertAuditPluginsReady } from "../../../../src/dev/lib/box-audits/plugins.js";
import { auditTestSchema } from "../../../../src/dev/lib/test-suite-schema.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

void test("Activation keeps other settings, writes stubs, and passes readiness", async (t) => {
  const box = await makeTmpBox({ deps: true });
  t.teardown(() => box.cleanup());
  await mkdir(box.path("_config"), { recursive: true });
  await writeFile(box.path("_config/box.json"), JSON.stringify({ timezone: "America/Chicago", plugins: ["recipe"] }));

  await activateAuditPlugins(box.root, ["courseware"]);
  await assertAuditPluginsReady(box.root, ["courseware"]);

  const config: unknown = JSON.parse(await readFile(box.path("_config/box.json"), "utf-8"));
  t.check(config, { timezone: "America/Chicago", plugins: ["recipe", "courseware"] });
  t.check(await readFile(box.path("src/schemas/course.ts"), "utf-8"), `import { cardSchema } from "beebox/cards";
import plugin from "beebox/plugins/courseware";

export default cardSchema("course", plugin.schemas["course"]);
`);
});

void test("An existing stub that defines no schema of its type fails readiness by path", async (t) => {
  const box = await makeTmpBox({ deps: true });
  t.teardown(() => box.cleanup());
  await mkdir(box.path("src/schemas"), { recursive: true });
  await writeFile(box.path("src/schemas/course.ts"), "export const note = 'not a schema';\n");

  await activateAuditPlugins(box.root, ["courseware"]);

  t.check(await readFile(box.path("src/schemas/course.ts"), "utf-8"), "export const note = 'not a schema';\n");
  await t.checkThrows(
    () => assertAuditPluginsReady(box.root, ["courseware"]),
    "AuditPluginNotReadyError: Audit plugins are not ready: src/schemas/course.ts does not define course",
  );
});

// A misspelled plugin name fails when the audits file loads, not mid-run.
void test("A misspelled plugin name fails when the audits file loads", async (t) => {
  const entry = { id: "x", prompt: "p", expected_level: "knows_about", watch_for: "w" };
  t.check({
    known: auditTestSchema.safeParse({ ...entry, plugins: ["courseware"] }).success,
    misspelled: auditTestSchema.safeParse({ ...entry, plugins: ["coursework"] }).success,
  }, { known: true, misspelled: false });
});
