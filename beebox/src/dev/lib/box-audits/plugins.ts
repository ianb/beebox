/**
 * Plugin activation for a knowledge audit that declares `plugins`.
 *
 * Writes what the plugin README's Setup tells a boxholder to write: the names
 * in `_config/box.json` `plugins` and a schema stub per default type. Views
 * are not written; a plugin audit tests guidance (card docs and the plugin
 * skill), not rendering. Nothing is committed, so a crash leaves a dirty box
 * that the next run refuses; the caller resets the box after the audit.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { clearBoxConfigCache } from "../../../core/box/config.js";
import { listPlugins } from "../../../core/plugins/active.js";
import { boxCodePaths, getBoxShape } from "../../../lib/box-shape.js";
import { getBoxDir } from "../../../lib/paths/core.js";
import { pluginByName } from "../../../plugins.js";
import { invalidateBoxSchemas } from "../../../schemas.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { z } from "zod";

/** The `box.json` keys this module rewrites; every other key passes through. */
const boxConfigFileSchema = z.object({ plugins: z.array(z.string()).optional() }).passthrough();

class AuditPluginNotReadyError extends Error {
  constructor(problems: string[]) {
    super(`Audit plugins are not ready: ${problems.join("; ")}`);
    this.name = "AuditPluginNotReadyError";
  }
}

/** The stub the plugin README shows for one default type. */
function schemaStub(plugin: string, type: string): string {
  return [
    "import { cardSchema } from \"beebox/cards\";",
    `import plugin from "beebox/plugins/${plugin}";`,
    "",
    `export default cardSchema(${JSON.stringify(type)}, plugin.schemas[${JSON.stringify(type)}]);`,
    "",
  ].join("\n");
}

/** Activate `names` in the box's config and write each missing schema stub. */
export async function activateAuditPlugins(boxRoot: string, names: readonly string[]): Promise<void> {
  const configPath = path.join(getBoxDir(boxRoot, "config"), "box.json");
  const text = await fs.readFile(configPath, "utf-8").catch((error: unknown) => {
    if (errnoCode(error) === "ENOENT") return "{}";
    throw error;
  });
  const config = boxConfigFileSchema.parse(JSON.parse(text));
  const current = config.plugins ?? [];
  config.plugins = [...current, ...names.filter((name) => !current.includes(name))];
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const { schemasDir } = boxCodePaths(await getBoxShape(boxRoot));
  await fs.mkdir(schemasDir, { recursive: true });
  for (const name of names) {
    const plugin = pluginByName(name);
    if (plugin === undefined) throw new AuditPluginNotReadyError([`unknown plugin ${name}`]);
    for (const type of Object.keys(plugin.schemas ?? {})) {
      // An existing stub is the box's own; leave it and let the readiness
      // check report it if it does not define the type.
      await fs.writeFile(path.join(schemasDir, `${type}.ts`), schemaStub(name, type), { flag: "wx" })
        .catch((error: unknown) => { if (errnoCode(error) !== "EEXIST") throw error; });
    }
  }
  resetAuditBoxCaches(boxRoot);
}

/** Drop the process-wide config and schema caches so the next read sees the box on disk. */
export function resetAuditBoxCaches(boxRoot: string): void {
  clearBoxConfigCache(boxRoot);
  invalidateBoxSchemas(boxRoot);
}

/** Fail unless every named plugin is active with every schema stub in effect. */
export async function assertAuditPluginsReady(boxRoot: string, names: readonly string[]): Promise<void> {
  const { plugins, problems } = await listPlugins(boxRoot);
  for (const name of names) {
    const listing = plugins.find((plugin) => plugin.name === name);
    if (listing?.active !== true) {
      problems.push(`${name} is not active`);
      continue;
    }
    for (const stub of listing.stubs) {
      if (stub.kind === "schema" && !stub.effective) problems.push(`${stub.path} does not define ${stub.name}`);
    }
  }
  if (problems.length > 0) throw new AuditPluginNotReadyError(problems);
}
