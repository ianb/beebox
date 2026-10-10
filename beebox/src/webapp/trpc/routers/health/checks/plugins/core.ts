/**
 * Plugin health (`docs/plugins.md`, "Health"): every check derives from the
 * effective schema map and the active list together, never from the active
 * list alone, so deactivation, a missing stub, and engine-side removal all
 * surface (`docs/implemented-plans/plugins.md`, Track 3).
 *
 * - `plugin-config` (error): one row per invalid `plugins` entry in
 *   `_config/box.json`, worded as `bbx status` words it
 *   (`describeInvalidPluginEntries`).
 * - `plugin-type-unprovided` (error): cards on disk of a type with no
 *   effective schema that some plugin, active or not, declares.
 * - `plugin-declared-missing` (error): an active plugin declares a type with
 *   no effective schema (no stub file, or a stub file that defines no schema
 *   of that type) or a view with no stub file.
 * - `plugin-stub-inactive`, `plugin-stub-missing`: `stubs.ts`.
 * - `skill-name-conflict` (warning): the box owns an unmarked
 *   `.claude/skills/<name>/SKILL.md` under a managed skill's name, so the
 *   engine did not write its skill there (`skillConflicts` in
 *   `core/box/guidance-sync/skills/core.ts`; a plugin's skill is managed while it is active).
 * - `legacy-exposition-rules`: `legacy-exposition-rules.ts`.
 * - `<plugin>/...`: each active plugin's own `healthChecks`, prefixed; a throw
 *   is one failing `<plugin>/checks` row.
 */

import type { PluginDefinition } from "../../../../../../cards/plugin-definition.js";
import { skillConflicts } from "../../../../../../core/box/guidance-sync/skills/core.js";
import { listBoxCardFiles } from "../../../../../../core/list-cards.js";
import { listPlugins } from "../../../../../../core/plugins/active.js";
import { pluginTypeCoverage, type PluginTypeCoverage } from "../../../../../../core/plugins/coverage.js";
import { plugins as pluginRegistry } from "../../../../../../plugins.js";
import { listSchemaLoadFailures } from "../../../../../../schema-load-status.js";
import { createCardSchemaMap } from "../../../../../../schemas.js";
import { cardTypeFromName } from "../../../../../../shared/card-name.js";
import { errorMessage } from "../../../../../../shared/error-guards.js";
import type { HealthCheck } from "../../router.js";
import { legacyExpositionRulesChecks } from "./legacy-exposition-rules.js";
import { scanStubImports, stubImportChecks } from "./stubs.js";

export interface PluginHealthOptions {
  /** The installed plugins; defaults to the registry. A doctest seam for fixture plugins. */
  readonly plugins?: ReadonlyArray<PluginDefinition> | undefined;
}

export async function pluginHealthChecks(boxRoot: string, options?: PluginHealthOptions): Promise<HealthCheck[]> {
  const installed = options?.plugins ?? pluginRegistry.list;
  const installedNames = new Set(installed.map((p) => p.name));
  const { plugins: listing, problems } = await listPlugins(boxRoot);
  const active = new Set(listing.filter((p) => p.active && installedNames.has(p.name)).map((p) => p.name));
  const activePlugins = installed.filter((p) => active.has(p.name));
  const presentStubs = listing.flatMap((p) => p.stubs.filter((s) => s.present));

  const coverage = pluginTypeCoverage({
    typesOnDisk: await countCardTypes(boxRoot),
    effectiveSchemaTypes: new Set((await createCardSchemaMap(boxRoot)).keys()),
    plugins: installed.map((p) => ({
      name: p.name,
      schemaTypes: Object.keys(p.schemas ?? {}),
      viewNames: (p.views ?? []).map((v) => v.name),
    })),
    active,
    stubs: {
      schemaTypes: new Set(presentStubs.filter((s) => s.kind === "schema").map((s) => s.name)),
      viewNames: new Set(presentStubs.filter((s) => s.kind === "view").map((s) => s.name)),
    },
  });

  return [
    ...configChecks(problems),
    ...coverageChecks(coverage),
    ...stubImportChecks({
      imports: await scanStubImports(boxRoot),
      installed: installedNames,
      active,
      failures: listSchemaLoadFailures(boxRoot),
    }),
    ...skillNameConflictChecks(await skillConflicts(boxRoot)),
    ...(await legacyExpositionRulesChecks(boxRoot)),
    ...(await pluginOwnChecks(boxRoot, activePlugins)),
  ];
}

/** Card type → count over every card file in the box. */
async function countCardTypes(boxRoot: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const file of await listBoxCardFiles(boxRoot)) {
    const type = cardTypeFromName(file);
    if (type !== undefined) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return counts;
}

/** `plugin-config`: the invalid `plugins` entries `listPlugins` already worded; one ok row when none. */
function configChecks(problems: ReadonlyArray<string>): HealthCheck[] {
  if (problems.length === 0) {
    return [{ name: "plugin-config", ok: true, message: "Every plugins entry in _config/box.json names an installed plugin", severity: "error" }];
  }
  return problems.map((message) => ({ name: "plugin-config", ok: false, message, severity: "error" }));
}

function coverageChecks(coverage: PluginTypeCoverage): HealthCheck[] {
  const checks: HealthCheck[] = [];
  for (const { plugin, type, cards } of coverage.unprovided) {
    const noun = cards === 1 ? "card" : "cards";
    const verb = cards === 1 ? "has" : "have";
    checks.push({
      name: "plugin-type-unprovided",
      ok: false,
      message: `${String(cards)} ${noun} of type ${type} ${verb} no schema. The ${plugin} plugin provides it: \`bbx plugins list\`, then its README.`,
      severity: "error",
    });
  }
  if (coverage.unprovided.length === 0) {
    checks.push({ name: "plugin-type-unprovided", ok: true, message: "Every card type a plugin declares has a schema", severity: "error" });
  }
  for (const { plugin, kind, name, reason } of coverage.declaredMissing) {
    const stub = kind === "schema" ? `src/schemas/${name}.ts` : `src/views/${name}.tsx`;
    const problem = reason === "no-file"
      ? `its ${kind} ${name} has no stub at ${stub}`
      : `its stub ${stub} is present and defines no schema named ${name}`;
    checks.push({
      name: "plugin-declared-missing",
      ok: false,
      message: `The ${plugin} plugin is active but ${problem}. Write it from node_modules/beebox/src/plugins/${plugin}/README.md, Setup.`,
      severity: "error",
    });
  }
  if (coverage.declaredMissing.length === 0) {
    checks.push({ name: "plugin-declared-missing", ok: true, message: "Every active plugin's declared types and views have stubs", severity: "error" });
  }
  return checks;
}

function skillNameConflictChecks(conflicts: ReadonlyArray<{ name: string; path: string }>): HealthCheck[] {
  const checks: HealthCheck[] = conflicts.map(({ name, path }) => ({
    name: "skill-name-conflict",
    ok: false,
    message: `${path} is a box skill the engine did not write, so the managed ${name} skill is not installed. Rename or remove the box skill to receive it.`,
    severity: "warning",
  }));
  if (checks.length === 0) {
    checks.push({ name: "skill-name-conflict", ok: true, message: "No managed skill name collides with a box skill", severity: "warning" });
  }
  return checks;
}

async function pluginOwnChecks(boxRoot: string, activePlugins: ReadonlyArray<PluginDefinition>): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];
  for (const plugin of activePlugins) {
    if (plugin.healthChecks === undefined) continue;
    try {
      for (const check of await plugin.healthChecks(boxRoot)) {
        checks.push({ ...check, name: `${plugin.name}/${check.name}` });
      }
    } catch (e) {
      checks.push({
        name: `${plugin.name}/checks`,
        ok: false,
        message: `The ${plugin.name} plugin's health checks threw: ${errorMessage(e)}`,
        severity: "error",
      });
    }
  }
  return checks;
}
