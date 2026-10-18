// # Plugin registry
//
// `src/plugins.ts` is the closed set of in-repo plugins (`docs/implemented-plans/plugins.md`):
// each `src/plugins/<name>/plugin.ts` default-exports a `PluginDefinition`, and
// the registry lists them by name. `pluginNames` and `pluginByName` are the
// engine's two reads.

import { test } from "tap";
import "agent-doctest/tap";
import { is } from "agent-doctest/check";
import { pluginByName, pluginNames, plugins } from "../src/plugins.js";
import { definePlugin } from "../src/cards/plugin-definition.js";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { PACKAGE_ROOT } from "../src/lib/package-root.js";
import { markdocConfig } from "../src/shared/markdoc-config/tags/core.js";
import { isRecord } from "../src/shared/is-record.js";
import { bbx, readmeStubs, readmeText, stubbedBox } from "./helpers/plugin-readme.js";
import { buildPluginBundlesIntoDist } from "./helpers/plugin-bundles.js";

// ## Every plugin follows the mechanical conventions
//
// `docs/plugins.md` (Conventions) names the rules. This loop checks each
// registered plugin against the ones a machine can check; a failure names the
// plugin and the rule.
const KEBAB = /^[a-z][\da-z]*(-[\da-z]+)*$/;
const SECTIONS = ["## What it is", "## Setup", "## Conventions", "## Migration", "## Uninstall"];
const exists = (path: string) => access(join(PACKAGE_ROOT, path)).then(() => true, () => false);

type Plugin = NonNullable<ReturnType<typeof pluginByName>>;
type Problem = (rule: string, detail: string) => void;

await buildPluginBundlesIntoDist();

async function identityProblems({ name, def, fail }: { name: string; def: Plugin; fail: Problem }) {
  if (def.name !== name) fail("name-is-directory", `name "${def.name}" differs from registry key "${name}"`);
  if (!(await exists(`src/plugins/${name}/plugin.ts`))) fail("name-is-directory", `src/plugins/${name}/plugin.ts is missing`);
  if (!KEBAB.test(def.name)) fail("name-kebab-case", `"${def.name}"`);
  if (def.description.includes("\n")) fail("description-single-line", JSON.stringify(def.description));
  if (def.docs !== `src/plugins/${name}/README.md`) fail("docs-names-readme", `docs is "${def.docs}"`);
}

async function declarationProblems({ name, def, fail, coreTags }: { name: string; def: Plugin; fail: Problem; coreTags: Set<string> }) {
  const readme = await readmeText(name);
  const headings = new Set(readme.split("\n"));
  for (const section of SECTIONS) if (!headings.has(section)) fail("readme-sections", `missing "${section}"`);
  const stubs = await readmeStubs(name);
  for (const [key, base] of Object.entries(def.schemas ?? {})) {
    if (!stubs.has(`src/schemas/${key}.ts`)) fail("schema-stub", `README has no stub src/schemas/${key}.ts`);
    for (const tag of Object.keys(base.markdocTags ?? {})) {
      if (!KEBAB.test(tag)) fail("tag-kebab-case", `${key}: "${tag}"`);
      if (coreTags.has(tag)) fail("tag-not-in-core", `${key}: "${tag}" is a core tag`);
    }
  }
  for (const view of def.views ?? []) {
    if (!stubs.has(`src/views/${view.name}.tsx`)) fail("view-stub", `README has no stub src/views/${view.name}.tsx`);
    if (!(await exists(`src/plugins/${name}/view.tsx`))) fail("view-entry", `src/plugins/${name}/view.tsx is missing`);
  }
}

// The stubs written into an empty box must compile and load. A stub that
// fails to load is only a stderr warning under `bbx validate` (exit 0), so
// `bbx plugins list --json` is the load check: every declared stub must be
// effective (present and defining its type), and the config must have no
// problems.
async function loadProblems({ name, fail }: { name: string; fail: Problem }) {
  const box = await stubbedBox(name);
  try {
    const result = await bbx(box, ["validate"]);
    const errors = result.report.filter((line) => /error|fail|✗/i.test(line));
    if (result.code !== 0 || errors.length > 0) fail("stubs-validate", `exit ${result.code}: ${result.report.join(" | ")}`);
    const listing: unknown = JSON.parse((await bbx(box, ["plugins", "list", "--json"])).stdout);
    const entry = isRecord(listing) && Array.isArray(listing["plugins"])
      ? listing["plugins"].find((p: unknown) => isRecord(p) && p["name"] === name)
      : undefined;
    const stubsListed = isRecord(entry) && Array.isArray(entry["stubs"]) ? entry["stubs"] : [];
    if (!isRecord(entry) || entry["active"] !== true) fail("stubs-load", "plugins list does not show the plugin active");
    for (const stub of stubsListed) {
      if (isRecord(stub) && stub["effective"] !== true) fail("stubs-load", `${String(stub["kind"])} ${String(stub["name"])} at ${String(stub["path"])} is ${stub["present"] === true ? "present but not effective" : "missing"}`);
    }
    if (isRecord(listing) && Array.isArray(listing["problems"]) && listing["problems"].length > 0) fail("stubs-load", JSON.stringify(listing["problems"]));
  } finally {
    await box.cleanup();
  }
}

async function conventionProblems(): Promise<string[]> {
  const problems: string[] = [];
  const coreTags = new Set(Object.keys(markdocConfig.tags ?? {}));
  for (const name of pluginNames()) {
    const def = pluginByName(name);
    if (def === undefined) { problems.push(`${name}: registry lists it but pluginByName is undefined`); continue; }
    const fail: Problem = (rule, detail) => problems.push(`${name}: ${rule}: ${detail}`);
    await identityProblems({ name, def, fail });
    if (!(await exists(`src/plugins/${name}/README.md`))) { fail("docs-names-readme", "README.md does not exist"); continue; }
    await declarationProblems({ name, def, fail, coreTags });
    await loadProblems({ name, fail });
  }
  return problems;
}

// Every name the registry lists resolves to a definition carrying that name;
// an unknown name is `undefined`, never a throw.
void test("Every name the registry lists resolves to a definition carrying that name; an...", async (t) => {
  // doctest:L17
  t.check(plugins.directory, "./plugins");

  // doctest:L20
  t.check(pluginNames().map((name) => pluginByName(name)?.name), pluginNames());

  // doctest:L23
  t.check(pluginByName("no-such-plugin"), undefined);
});

// `definePlugin` is an identity with a type check: a plugin module's
// `export default definePlugin({...})` is what the registry imports.
void test("definePlugin is an identity with a type check:", async (t) => {
  // doctest:L31
  const input = { name: "example", description: "An example plugin", docs: "src/plugins/example/README.md", schemas: undefined };
  t.check(definePlugin(input), is(input));
});

void test("Every plugin follows the mechanical conventions", async (t) => {
  // doctest:L114
  const problems = await conventionProblems();
  t.check(problems, []);
});
