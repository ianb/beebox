/**
 * Install the beebox Codex plugin from the package's local marketplace.
 *
 * The registration this writes is GLOBAL machine state — one `beebox`
 * marketplace entry in `~/.codex/config.toml`, shared by every checkout on the
 * machine. Two rules follow from that, and both are load-bearing:
 *
 * - **Don't fight over it.** A worktree, a temp checkout, and the main
 *   checkout all run this code. If each re-pointed the entry at itself, the
 *   last one to run would own it — and a checkout that is later deleted leaves
 *   a registration whose root is gone. So a usable registration is left alone
 *   whoever owns it; only a missing root or a version mismatch earns a
 *   re-point, and a merely-uninstalled plugin is installed from the existing
 *   marketplace rather than triggering one.
 * - **Repair rather than throw.** `codex plugin list` is exactly the command a
 *   dangling registration breaks ("marketplace root does not contain a
 *   supported manifest"), so an installer that treats its failure as fatal can
 *   never fix the state it created. A failed list means remove-and-re-add.
 *
 * Both `codex plugin add` and `codex plugin marketplace add` are idempotent —
 * re-adding what is already there exits 0 with `"alreadyAdded": true`
 * (verified against codex-cli 0.149.0) — so the repair path is safe to run
 * against a state that turns out to be fine.
 *
 * Tests never reach the real `~/.codex`: `.taprc` overrides `CODEX_HOME` in
 * every test process (`test/helpers/isolate-codex-home.ts`).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { z } from "zod";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { assertNever } from "../../lib/invariant.js";
import { codexBinaryPath } from "../../services/codex-binary.js";

const execFileAsync = promisify(execFile);
// Only the entry we look for has to carry a local `path`: since codex-cli
// 0.153.4 the list also carries remote plugins (`source: { source: "remote",
// id }`), and a parser that demanded a path on every entry failed the whole
// list — and every chat query behind it — over plugins that are not ours.
const pluginListSchema = z.object({
  installed: z.array(z.looseObject({
    pluginId: z.string(),
    version: z.string(),
    source: z.looseObject({ path: z.string().optional() }),
  })),
});
const marketplaceListSchema = z.object({
  marketplaces: z.array(z.looseObject({
    name: z.string(),
    marketplaceSource: z.looseObject({ source: z.string() }).optional(),
  })),
});
const MARKETPLACE = "beebox";
const PLUGIN_ID = "beebox-codex@beebox";
const PLUGIN_VERSION = "0.1.1";

function pluginBaseVersion(version: string): string {
  return version.split("+", 1)[0] ?? version;
}

export class CodexPluginInstallError extends Error {
  constructor(cause: unknown) {
    super("Could not install the Bee Box Codex plugin", { cause });
    this.name = "CodexPluginInstallError";
  }
}

/** One `codex` invocation, resolving to its stdout. Injected so tests can watch. */
export type CodexCommand = (args: string[]) => Promise<string>;

const runCodex: CodexCommand = async (args) => (await execFileAsync(codexBinaryPath(), args)).stdout;

/**
 * What Codex says about our plugin. The three answers need three responses, and
 * collapsing any pair of them is how a checkout ends up hijacking the entry:
 *
 * - `unreadable` — the CLI refused to list. The usual cause is the dangling
 *   registration this module exists to heal, and it reports that by failing
 *   the list rather than by returning an empty one.
 * - `absent` — the CLI answered and we are simply not installed here.
 * - `installed` — with the version and root it was installed from.
 */
type PluginState =
  | { kind: "unreadable" }
  | { kind: "absent" }
  | { kind: "installed"; version: string; path: string };

async function readPluginState(run: CodexCommand): Promise<PluginState> {
  let stdout: string;
  try {
    stdout = await run(["plugin", "list", "--json"]);
  } catch (error) {
    console.warn("[codex-plugin] `codex plugin list` failed; re-registering the marketplace:", error);
    return { kind: "unreadable" };
  }
  const found = pluginListSchema.parse(JSON.parse(stdout)).installed
    .find((plugin) => plugin.pluginId === PLUGIN_ID);
  if (found === undefined) return { kind: "absent" };
  // Ours is installed from a local marketplace, so a pathless entry under our
  // id is a registration this module does not understand: treat it as
  // unreadable and re-register rather than trust or throw.
  if (found.source.path === undefined) {
    console.warn("[codex-plugin] our plugin is listed without a local path; re-registering:", found.source);
    return { kind: "unreadable" };
  }
  return { kind: "installed", version: found.version, path: found.source.path };
}

/** True when a `beebox` marketplace is registered and its root still exists. */
async function marketplaceIsUsable(run: CodexCommand): Promise<boolean> {
  const listed = marketplaceListSchema.parse(JSON.parse(await run(["plugin", "marketplace", "list", "--json"])));
  const source = listed.marketplaces.find((candidate) => candidate.name === MARKETPLACE)?.marketplaceSource?.source;
  return source !== undefined && existsSync(source);
}

/**
 * Point the `beebox` marketplace at this checkout and install from it.
 *
 * The removals are best-effort by design: this runs precisely when the current
 * state is unknown or broken, so "there was nothing to remove" and "the entry
 * was too broken to remove cleanly" are both fine — the `add` that follows is
 * what has to succeed, and it succeeds against an already-good state too.
 */
async function reregister(run: CodexCommand): Promise<void> {
  const cleanup = [
    ["plugin", "remove", PLUGIN_ID, "--json"],
    ["plugin", "marketplace", "remove", MARKETPLACE, "--json"],
  ];
  for (const args of cleanup) {
    await run(args).catch((error: unknown) => {
      console.debug("[codex-plugin] cleanup before re-registering failed (expected when nothing is registered):", error);
      return "";
    });
  }
  await run(["plugin", "marketplace", "add", PACKAGE_ROOT, "--json"]);
  await run(["plugin", "add", PLUGIN_ID, "--json"]);
}

/** The whole decision, with the `codex` runner injected. Exported for tests. */
export async function installCodexPlugin(run: CodexCommand): Promise<void> {
  try {
    const state = await readPluginState(run);
    switch (state.kind) {
      case "unreadable":
        await reregister(run);
        return;
      case "absent":
        // Someone else's marketplace, still on disk, is a marketplace we can
        // install from — taking it over would only move the problem to them.
        if (await marketplaceIsUsable(run)) await run(["plugin", "add", PLUGIN_ID, "--json"]);
        else await reregister(run);
        return;
      case "installed":
        // Another checkout's registration is fine as long as it is still there
        // and current: the entry is shared, and churn is what breaks the others.
        if (pluginBaseVersion(state.version) === PLUGIN_VERSION && existsSync(state.path)) return;
        await reregister(run);
        return;
      default:
        assertNever(state);
    }
  } catch (error) {
    throw new CodexPluginInstallError(error);
  }
}

let installation: Promise<void> | null = null;

/**
 * Idempotent per process; performs no global mutation unless Codex is selected.
 *
 * A rejection clears the memo. The point of this module is that a broken
 * registration is repairable, and a server process that cached one failed
 * attempt would refuse to try again for its whole lifetime — turning a
 * transient CLI failure into a permanently empty codex chat list.
 */
export function ensureCodexPluginInstalled(): Promise<void> {
  installation ??= installCodexPlugin(runCodex).catch((error: unknown) => {
    installation = null;
    throw error;
  });
  return installation;
}
