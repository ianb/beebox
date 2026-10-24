#!/usr/bin/env tsx
/**
 * `engine-link-spec-2026-10` runner: replace the box's machine-local `beebox`
 * link with the portable `link:.beebox/engine` (`plan.ts` holds the decision).
 *
 * 1. Plan. A refusal exits 1 with nothing written. A pinned engine (any
 *    non-`link:` spec, or a link into the box) is left alone and exits 0, so
 *    the migration counts as done for that box.
 * 2. Link. `.beebox/engine` is pointed at the old link's target, unless it is
 *    already usable. A dead old target exits 1 with the repair, nothing written.
 * 3. Write `package.json`, then refresh a tracked `pnpm-lock.yaml` with
 *    `pnpm install --lockfile-only --prefer-offline`. The refresh re-resolves
 *    the box's direct dependencies, so it fetches registry metadata the pnpm
 *    cache lacks (`--offline` failed on every production box: the cache held
 *    no `typescript` metadata). A failed refresh restores both
 *    files and exits 1, so the migration stays pending and the manifest never
 *    disagrees with the tracked lockfile. The real install, which repoints
 *    `node_modules/beebox`, is the next install path's job (deploy, worktree
 *    setup, the docker entrypoint); until then the old link still resolves.
 * 4. Verify: the spec reads back portable and the link is usable.
 *
 * Usage:
 *   pnpm exec tsx src/scripts/migrate/engine-link-spec/run.ts <boxRoot>           # plan only
 *   pnpm exec tsx src/scripts/migrate/engine-link-spec/run.ts <boxRoot> --apply
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { ENGINE_LINK, ENGINE_LINK_SPEC, engineRealPath, ensureEngineLink, readBeeBoxSpec } from "../../../core/box/engine-link.js";
import { isWithin } from "../../../lib/box-containment.js";
import { runCollectedChild, type CollectedChildResult } from "../../../lib/run-child.js";
import { errnoCode, errorMessage } from "../../../shared/error-guards.js";
import { lockfileIsPortable, planEngineSpec } from "./plan.js";

export type RunMode = "plan" | "apply";

/** Refreshes `<boxRoot>/pnpm-lock.yaml` against the rewritten `package.json`. */
export type RefreshLockfile = (boxRoot: string) => Promise<CollectedChildResult>;

const REFRESH_ARGS = ["install", "--lockfile-only", "--prefer-offline"];

const refreshWithPnpm: RefreshLockfile = (boxRoot) =>
  runCollectedChild({ command: "pnpm", args: REFRESH_ARGS, cwd: boxRoot, env: process.env });

async function readOptional(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

const PREFIX = "engine-link-spec:";

/**
 * Refresh the lockfile against the manifest now on disk. On a nonzero exit, a
 * failed spawn (no pnpm on PATH), or a lockfile that still names another engine, restore both files to their snapshots and
 * return the exit-1 result, so the migration stays pending.
 */
async function refreshOrRestore({ boxRoot, packageJson, lockfile, refreshLockfile }: {
  boxRoot: string;
  packageJson: string;
  lockfile: string;
  refreshLockfile: RefreshLockfile | undefined;
}): Promise<{ code: number; lines: string[] } | null> {
  let refreshed: CollectedChildResult;
  try {
    refreshed = await (refreshLockfile ?? refreshWithPnpm)(boxRoot);
  } catch (e) {
    refreshed = { code: 1, output: errorMessage(e) };
  }
  if (refreshed.code === 0) {
    // pnpm can exit 0 and still record another engine (an override from
    // elsewhere); the migration is done only when the lockfile agrees.
    if (lockfileIsPortable(await fs.readFile(path.join(boxRoot, "pnpm-lock.yaml"), "utf-8"))) return null;
    refreshed = { code: 1, output: `pnpm-lock.yaml still does not record "beebox": "${ENGINE_LINK_SPEC}" after the refresh.` };
  }
  await fs.writeFile(path.join(boxRoot, "package.json"), packageJson);
  await fs.writeFile(path.join(boxRoot, "pnpm-lock.yaml"), lockfile);
  return {
    code: 1,
    lines: [
      `${PREFIX} \`pnpm ${REFRESH_ARGS.join(" ")}\` failed in ${boxRoot} (exit ${String(refreshed.code)}); package.json and pnpm-lock.yaml restored, the migration stays pending.`,
      ...refreshed.output.trim().split("\n").slice(-5),
    ],
  };
}

/** One run over one box. Returns the exit code and the lines it printed. */
export async function runEngineLinkSpec({ boxRoot, mode, refreshLockfile }: {
  boxRoot: string;
  mode: RunMode;
  refreshLockfile?: RefreshLockfile;
}): Promise<{ code: number; lines: string[] }> {
  const packageJsonPath = path.join(boxRoot, "package.json");
  const packageJson = await readOptional(packageJsonPath);
  if (packageJson === null) return { code: 1, lines: [`${PREFIX} ${packageJsonPath} is missing; nothing written.`] };
  const plan = planEngineSpec(packageJson);
  if (plan.kind === "refuse") return { code: 1, lines: [`${PREFIX} ${plan.reason} Nothing written.`] };
  if (plan.kind === "pinned") return { code: 0, lines: [`${PREFIX} skipped: pinned engine (${plan.spec}).`] };
  const lockfilePath = path.join(boxRoot, "pnpm-lock.yaml");
  const lockfile = await readOptional(lockfilePath);
  if (plan.kind === "already-portable") {
    // A refresh that failed after an earlier run wrote the manifest leaves the
    // lockfile behind; it is not converted until the lockfile agrees.
    if (lockfile === null || lockfileIsPortable(lockfile)) return { code: 0, lines: [`${PREFIX} already converted.`] };
    if (mode === "plan") return { code: 0, lines: ["would refresh pnpm-lock.yaml (dry run; pass --apply)"] };
    const failure = await refreshOrRestore({ boxRoot, packageJson, lockfile, refreshLockfile });
    return failure ?? { code: 0, lines: [`${PREFIX} refreshed pnpm-lock.yaml for "${ENGINE_LINK_SPEC}".`] };
  }

  const linkPath = path.join(boxRoot, ENGINE_LINK);
  const linkUsable = (await engineRealPath(linkPath)) !== null;
  if (plan.linkTarget !== null) {
    const target = path.resolve(boxRoot, plan.linkTarget);
    const engine = await engineRealPath(target);
    // An in-box target is a pin by where it points, whether or not it resolves now.
    const boxReal = await fs.realpath(boxRoot);
    if (isWithin(boxReal, path.resolve(boxReal, plan.linkTarget)) || (engine !== null && isWithin(boxReal, engine))) {
      return { code: 0, lines: [`${PREFIX} skipped: pinned engine (link:${plan.linkTarget} is inside the box).`] };
    }
    if (engine === null && !linkUsable) {
      return { code: 1, lines: [`${PREFIX} the engine at ${target} is missing; link one with \`ln -sfn <engine checkout>/beebox ${linkPath}\` and rerun. Nothing written.`] };
    }
    if (mode === "plan") return { code: 0, lines: [`would set "beebox": "${ENGINE_LINK_SPEC}" and link ${ENGINE_LINK} (dry run; pass --apply)`] };
    if (!linkUsable) await ensureEngineLink(boxRoot, target);
  } else if (!linkUsable) {
    return { code: 1, lines: [`${PREFIX} ${linkPath} does not resolve to an engine; link one with \`ln -sfn <engine checkout>/beebox ${linkPath}\` and rerun. Nothing written.`] };
  } else if (mode === "plan") {
    return { code: 0, lines: ["would drop the beebox override (dry run; pass --apply)"] };
  }

  await fs.writeFile(packageJsonPath, plan.packageJson);
  if (lockfile !== null) {
    const failure = await refreshOrRestore({ boxRoot, packageJson, lockfile, refreshLockfile });
    if (failure !== null) return failure;
  }
  if ((await readBeeBoxSpec(boxRoot)) !== ENGINE_LINK_SPEC || (await engineRealPath(linkPath)) === null) {
    return { code: 1, lines: [`${PREFIX} verify failed: the spec or ${ENGINE_LINK} did not read back.`] };
  }
  return { code: 0, lines: [`${PREFIX} "beebox" is now "${ENGINE_LINK_SPEC}"; ${ENGINE_LINK} → ${await fs.readlink(linkPath)}.`] };
}

// CLI entry — only when run directly, not when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const boxRoot = args.find((a) => !a.startsWith("--"));
  if (boxRoot === undefined) {
    console.error("Usage: engine-link-spec/run.ts <boxRoot> [--apply]\n\nCommit the portable beebox dependency.");
    process.exit(1);
  }
  const mode: RunMode = args.includes("--apply") ? "apply" : "plan";
  const { code, lines } = await runEngineLinkSpec({ boxRoot: path.resolve(boxRoot), mode });
  for (const line of lines) (code === 0 ? console.log : console.error)(line);
  process.exit(code);
}
