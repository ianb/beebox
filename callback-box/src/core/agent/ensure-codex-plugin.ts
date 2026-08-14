/** Install the callback-box Codex plugin from the package's local marketplace. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { z } from "zod";
import { PACKAGE_ROOT } from "../../lib/package-root.js";

const execFileAsync = promisify(execFile);
const pluginListSchema = z.object({
  installed: z.array(z.looseObject({
    pluginId: z.string(),
    version: z.string(),
    source: z.looseObject({ path: z.string() }),
  })),
});
const marketplaceListSchema = z.object({
  marketplaces: z.array(z.looseObject({
    name: z.string(),
    marketplaceSource: z.looseObject({ source: z.string() }).optional(),
  })),
});
const PLUGIN_ID = "callback-box-codex@callback-box";
const PLUGIN_VERSION = "0.1.0";

class CodexPluginInstallError extends Error {
  constructor(cause: unknown) {
    super("Could not install the Callback Box Codex plugin", { cause });
    this.name = "CodexPluginInstallError";
  }
}

let installation: Promise<void> | null = null;

async function install(): Promise<void> {
  try {
    const listed = await execFileAsync("codex", ["plugin", "list", "--json"]);
    const plugins = pluginListSchema.parse(JSON.parse(listed.stdout));
    const current = plugins.installed.find((plugin) => plugin.pluginId === PLUGIN_ID);
    const expectedPluginPath = join(PACKAGE_ROOT, "plugins", "callback-box-codex");
    if (current?.version === PLUGIN_VERSION && resolve(current.source.path) === expectedPluginPath) return;
    const listedMarkets = await execFileAsync("codex", ["plugin", "marketplace", "list", "--json"]);
    const markets = marketplaceListSchema.parse(JSON.parse(listedMarkets.stdout));
    const market = markets.marketplaces.find((candidate) => candidate.name === "callback-box");
    if (market?.marketplaceSource?.source !== PACKAGE_ROOT) {
      if (current !== undefined) await execFileAsync("codex", ["plugin", "remove", PLUGIN_ID, "--json"]);
      if (market !== undefined) {
        await execFileAsync("codex", ["plugin", "marketplace", "remove", "callback-box", "--json"]);
      }
      await execFileAsync("codex", ["plugin", "marketplace", "add", PACKAGE_ROOT, "--json"]);
    }
    await execFileAsync("codex", ["plugin", "add", PLUGIN_ID, "--json"]);
  } catch (error) {
    throw new CodexPluginInstallError(error);
  }
}

/** Idempotent per process; performs no global mutation unless Codex is selected. */
export function ensureCodexPluginInstalled(): Promise<void> {
  installation ??= install();
  return installation;
}
