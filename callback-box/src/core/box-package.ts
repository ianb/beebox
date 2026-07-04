/**
 * Package-root scaffolding for shapeVersion 2 boxes (see "The box
 * repository" in `docs/plans/boxes-as-packages-v2.md`). `cb init` on a path
 * with no existing box detects a fresh init and lays down BOTH halves: a
 * thin coding-session package at the target path, and the operational box
 * at `<target>/content/`. An existing box (legacy or v2) is left in its
 * current shape — conversion is a later migration (Track H), not init's job.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isValidBox } from "./box.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";

export type BoxInitMode = "fresh" | "update-legacy" | "update-v2";

/**
 * Thrown when a fresh `cb init` would overwrite a package.json it didn't
 * create — the target directory already has one, so scaffolding blindly
 * risks clobbering an unrelated package.
 */
export class BoxPackageConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoxPackageConflictError";
  }
}

export interface BoxTarget {
  mode: BoxInitMode;
  /** The operational root — where `.cb-box`, `box/`, `config/`, etc. live (or will). */
  boxRoot: string;
  /** The package root — where `package.json`/`node_modules`/`src/` live (or
   * will). Equals `boxRoot` for a legacy box. */
  packageRoot: string;
}

/**
 * Decide what `cb init <path>` is looking at: an existing legacy box (marker
 * at the target itself), an existing v2 box (marker at `<target>/content`),
 * or nothing yet. A fresh init always scaffolds the v2 layout — there is no
 * "legacy fresh init" anymore; existing legacy boxes just keep working in
 * place until migrated (Track H).
 */
export async function detectBoxTarget(targetPath: string): Promise<BoxTarget> {
  const resolvedRoot = path.resolve(targetPath);
  if (await isValidBox(resolvedRoot)) {
    return { mode: "update-legacy", boxRoot: resolvedRoot, packageRoot: resolvedRoot };
  }
  const contentRoot = path.join(resolvedRoot, "content");
  if (await isValidBox(contentRoot)) {
    return { mode: "update-v2", boxRoot: contentRoot, packageRoot: resolvedRoot };
  }
  return { mode: "fresh", boxRoot: contentRoot, packageRoot: resolvedRoot };
}

const ROOT_GITIGNORE = `node_modules/

# Trick dependencies (installed by agent) -- see src/tricks/
src/tricks/node_modules/
`;

const ROOT_CLAUDE_MD = `# Box Package

This is a callback-box PACKAGE. The live, operational box is \`content/\` --
that's where an agent (chat, wakeup, scheduled run) actually works; it never
sees this directory's package machinery directly.

- \`src/\` holds box-authored code (schemas, views, tricks) -- edited in a
  coding session opened at this root, not by the operating agent.
- \`content/\` is the box: cards, config, runtime state. Its own \`CLAUDE.md\`
  is the operating agent's context.
- This package depends on \`callback-box\` (see \`package.json\`) the way any
  Node package depends on a library.
`;

/**
 * Read the running engine's own version (this checkout's package.json,
 * resolved via `PACKAGE_ROOT`) to pin the scaffolded box's `callback-box`
 * dependency.
 */
async function engineVersion(): Promise<string> {
  const raw = await fs.readFile(path.join(PACKAGE_ROOT, "package.json"), "utf-8");
  const pkg = JSON.parse(raw) as { version?: string };
  return pkg.version ?? "0.0.0";
}

/**
 * Scaffold the coding-session half of a fresh v2 box: `package.json`,
 * `tsconfig.json`, a thin root `CLAUDE.md`, and a root `.gitignore`.
 * Idempotent in the sense that every write is a plain overwrite, but it's
 * only ever called for a genuinely fresh init (see `detectBoxTarget`) — an
 * existing package root is never touched by `cb init`.
 *
 * Deliberately does NOT run `pnpm install` — the `callback-box` dependency
 * isn't resolvable through a real registry/tarball channel yet (Track F).
 * Instead, when `node_modules/` is absent, it symlinks
 * `node_modules/callback-box` straight at the running engine's own
 * `PACKAGE_ROOT` — the same trick the v2 fixture doctests and `cb view test`
 * use — so the box is loadable (`getBoxShape`'s dependency check, native
 * schema/view resolution) before a real install ever happens. Track F's real
 * install replaces this symlink with an actual dependency.
 *
 * `detectBoxTarget` only checks whether `targetPath` (and `targetPath/content`)
 * is a *box* — a plain non-empty directory (an existing project, a directory
 * with an unrelated package.json) still reads as "fresh." Overwriting that
 * directory's `package.json` would silently clobber someone else's package,
 * so a pre-existing `package.json` is a hard conflict; the other three
 * scaffold files (`tsconfig.json`, `CLAUDE.md`, `.gitignore`) are only
 * written when absent, so a directory that already has its own is left
 * alone.
 * @throws BoxPackageConflictError if `packageRoot` already has a `package.json`
 */
export async function scaffoldPackageRoot(packageRoot: string): Promise<void> {
  await fs.mkdir(packageRoot, { recursive: true });

  const packageJsonPath = path.join(packageRoot, "package.json");
  if (await pathExists(packageJsonPath)) {
    throw new BoxPackageConflictError(
      `Cannot initialize a callback-box package at ${packageRoot}: it already has a ` +
        "package.json. Fresh `cb init` scaffolds a new coding-session package there and " +
        "won't overwrite an existing one — remove it first, or run `cb init` on the " +
        "directory only after confirming it's meant to become a box package."
    );
  }

  const version = await engineVersion();
  const packageJson = {
    name: path.basename(packageRoot),
    private: true,
    type: "module",
    dependencies: { "callback-box": `^${version}` },
  };
  await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");

  await writeFileIfAbsent(
    path.join(packageRoot, "tsconfig.json"),
    JSON.stringify({ extends: "callback-box/tsconfig.base.json", include: ["src"] }, null, 2) + "\n"
  );

  await writeFileIfAbsent(path.join(packageRoot, "CLAUDE.md"), ROOT_CLAUDE_MD);
  await writeFileIfAbsent(path.join(packageRoot, ".gitignore"), ROOT_GITIGNORE);

  await fs.mkdir(path.join(packageRoot, "src"), { recursive: true });

  const nodeModulesDir = path.join(packageRoot, "node_modules");
  if (!(await pathExists(nodeModulesDir))) {
    await fs.mkdir(nodeModulesDir, { recursive: true });
    await fs.symlink(PACKAGE_ROOT, path.join(nodeModulesDir, "callback-box"), "dir");
  }
}

/** Whether `filePath` exists, tolerating (only) the not-found case. */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (_e) {
    // ENOENT is the expected "doesn't exist yet" case — the error carries no
    // other actionable info.
    return false;
  }
}

/**
 * Write `content` to `filePath` only if nothing is there yet. Used for the
 * package scaffold files that a directory might already have its own
 * version of (`tsconfig.json`, `CLAUDE.md`, `.gitignore`) — unlike
 * `package.json`, which is a hard conflict, these are fine to leave in place.
 */
async function writeFileIfAbsent(filePath: string, content: string): Promise<void> {
  if (await pathExists(filePath)) return;
  await fs.writeFile(filePath, content);
}
