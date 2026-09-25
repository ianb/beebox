import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../../beebox/src/lib/error-guards.js";

export async function optionalText(file: string): Promise<string | null> {
  try { return await fs.readFile(file, "utf8"); }
  catch (error) { if (errnoCode(error) === "ENOENT") return null; throw error; }
}
export function configuredBoxes(text: string | null, home: string): string[] {
  const line = text?.split("\n").find((entry) => entry.startsWith("BOXES="));
  return (line?.slice(6).trim().split(/\s+/u).filter(Boolean) ?? [])
    .map((entry) => entry.startsWith("~/") ? path.join(home, entry.slice(2)) : entry);
}
const registrySchema = z.object({ boxes: z.record(z.string(), z.object({ path: z.string() })) });
export function registryPaths(text: string, configPath: string): string[] {
  return Object.values(registrySchema.parse(JSON.parse(text)).boxes)
    .map((entry) => path.resolve(path.dirname(configPath), entry.path));
}

/** Fail closed on unreadable ownership; aliases never grant additional scope. */
export async function localTargets(opts: {
  mainRoot: string; worktrees: string[]; clonesRoot: string; configDir: string; home: string;
}): Promise<{ eligible: string[]; excluded: string[]; unreadable: string[] }> {
  const owned: string[] = [];
  const addOwned = async (root: string): Promise<void> => {
    try { owned.push(await fs.realpath(root)); }
    catch (error) { if (errnoCode(error) !== "ENOENT") throw error; }
  };
  await addOwned(opts.clonesRoot);
  for (const worktree of opts.worktrees) {
    if (await fs.realpath(worktree) === await fs.realpath(opts.mainRoot)) continue;
    await addOwned(worktree);
    for (const root of configuredBoxes(await optionalText(path.join(worktree, "beebox/.env")), opts.home)) {
      await addOwned(path.resolve(worktree, "beebox", root));
    }
    const config = path.join(opts.configDir, `${path.basename(worktree)}.json`);
    const text = await optionalText(config);
    if (text !== null) for (const root of registryPaths(text, config)) await addOwned(root);
  }
  const eligible: string[] = [], excluded: string[] = [], unreadable: string[] = [];
  const configured = configuredBoxes(await optionalText(path.join(opts.mainRoot, "beebox/.env")), opts.home);
  for (const entry of configured) {
    let root: string;
    try { root = await fs.realpath(path.resolve(opts.mainRoot, "beebox", entry)); }
    catch (error) { unreadable.push(`${entry}: ${String(error)}`); continue; }
    const blocked = owned.some((owner) => root === owner || root.startsWith(`${owner}${path.sep}`));
    const target = blocked ? excluded : eligible;
    if (!target.includes(root)) target.push(root);
  }
  return { eligible, excluded, unreadable };
}
