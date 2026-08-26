/**
 * Lint what the change implicates, instead of the whole tree.
 *
 *   node --import tsx bin/lint-changed.ts            # callback-box (its `lint:changed`)
 *   node --import tsx bin/lint-changed.ts --root     # dispatch per changed package
 *   node --import tsx bin/lint-changed.ts --base <ref>
 *
 * The same "run what the change implicates" move `test:changed` made, for the
 * same measured reason: a whole-tree `pnpm lint` in callback-box is ~37s solo
 * and minutes under contention, while one file is ~4s. Changed = `git diff
 * --name-only <base>...HEAD` ∪ dirty, via the selector's own `changedPaths`, so
 * the two answer the same question.
 *
 * Accepted escape, stated: a change in file A can break lint in file B that
 * imports it (the type-aware rules see across files), and that consequence is
 * missed here exactly as an unimplicated test's failure is. `pnpm lint` remains
 * the whole-tree gate; run it when you changed something many files import.
 *
 * The rules are pure and exported for bin/lint-changed.test.ts; the git,
 * filesystem and spawning is the shell at the bottom.
 *
 * See issues/closed/code-quality/2026-08-25-lint-runs-contend-like-tests.md and
 * callback-box/docs/plans/change-based-test-selection.md, mechanism B.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { changedPaths } from "./test-git.js";
import { packageOwnerDirs } from "./workspace-packages.js";

const REPO_ROOT = join(import.meta.dirname, "..");

/**
 * What `lint:backend` covers: `eslint src/ scripts/ test/ user-stories/` from
 * callback-box, whose config ignores `src/frontend/**` and `**\/*.mjs`.
 */
const BACKEND_ROOTS = ["src", "scripts", "test", "user-stories"];

/** What `lint:frontend` covers: `eslint src/` from callback-box/src/frontend. */
const FRONTEND_DIR = "callback-box/src/frontend";
const FRONTEND_ROOT = `${FRONTEND_DIR}/src/`;

// `{ts,tsx,js,jsx}` is the preset's own file glob (personal-vibe-check/preset.ts
// `exts`); `.cjs` rides eslint's default flat-config files. `.mjs` is in the
// backend config's ignores, so it is deliberately absent.
const BACKEND_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".cjs"];
const FRONTEND_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

const hasExtension = (path: string, extensions: string[]): boolean =>
  extensions.some((extension) => path.endsWith(extension));

export interface CallbackBoxTargets {
  /** Paths relative to `callback-box/`. */
  backend: string[];
  /** Paths relative to `callback-box/src/frontend/`. */
  frontend: string[];
}

/**
 * Split repo-relative changed paths the way lint-staged splits them: frontend
 * source gets the frontend config, everything else the callback-box one.
 *
 * A path neither script covers (`deploy/`, `docs/`, a `.mjs`) is dropped — not
 * skipped silently by accident, but because whole-tree `pnpm lint` does not
 * lint it either, and handing eslint an ignored file only earns a warning.
 */
export function splitCallbackBoxTargets(paths: string[]): CallbackBoxTargets {
  const backend: string[] = [];
  const frontend: string[] = [];
  for (const path of paths) {
    // The whole frontend subtree is in the backend config's `ignores`, but only
    // its `src/` is in `lint:frontend`'s argument — so `src/frontend/vite.config.ts`
    // is linted by neither, and must not be handed to either.
    if (path.startsWith(`${FRONTEND_DIR}/`)) {
      if (path.startsWith(FRONTEND_ROOT) && hasExtension(path, FRONTEND_EXTENSIONS)) {
        frontend.push(path.slice(`${FRONTEND_DIR}/`.length));
      }
      continue;
    }
    if (!path.startsWith("callback-box/")) continue;
    const relative = path.slice("callback-box/".length);
    const [root] = relative.split("/");
    if (root === undefined || !BACKEND_ROOTS.includes(root)) continue;
    if (!hasExtension(relative, BACKEND_EXTENSIONS)) continue;
    backend.push(relative);
  }
  return { backend: backend.sort(), frontend: frontend.sort() };
}

/** One thing to run, named the way an agent would type it. */
export interface LintCommand {
  label: string;
  cwd: string;
  argv: string[];
}

export interface DispatchInput {
  paths: string[];
  /** Every workspace package directory, from {@link packageOwnerDirs}. */
  packageDirs: string[];
  /** Does `<dir>/package.json` define this script? */
  hasScript: (dir: string, script: string) => boolean;
}

/**
 * Which package each changed path belongs to, longest prefix wins.
 *
 * `callback-box/src/frontend` is its own workspace package but never its own
 * lint run: root `pnpm lint` filters it out precisely because callback-box's
 * `lint:frontend` already covers it. {@link packageOwnerDirs} leaves it out of
 * the list for that reason, so a frontend path lands on callback-box here.
 */
export function packageOf(path: string, packageDirs: string[]): string | null {
  let best: string | null = null;
  for (const dir of packageDirs) {
    if (!path.startsWith(`${dir}/`)) continue;
    if (best === null || dir.length > best.length) best = dir;
  }
  return best;
}

/**
 * The root fan-out, reduced to the packages this change touched.
 *
 * callback-box gets its own `lint:changed` (it is the big one, and it knows
 * the frontend/backend split); every other package runs its whole `lint`,
 * which is seconds. `schedules/` is not a package — `bin/schedules lint` is
 * what checks it, and it is the only root path the root eslint config lints.
 */
export function dispatchPlan(input: DispatchInput): LintCommand[] {
  const commands: LintCommand[] = [];
  const packages = new Set<string>();
  let schedules = false;
  for (const path of input.paths) {
    if (path.startsWith("schedules/")) schedules = true;
    const dir = packageOf(path, input.packageDirs);
    if (dir !== null) packages.add(dir);
  }
  for (const dir of [...packages].sort()) {
    const script = dir === "callback-box" ? "lint:changed" : "lint";
    if (!input.hasScript(dir, script)) continue;
    commands.push({
      label: `pnpm --dir ${dir} ${script}`,
      cwd: ".",
      argv: ["pnpm", "--dir", dir, script],
    });
  }
  if (schedules) {
    commands.push({ label: "bin/schedules lint", cwd: ".", argv: ["bin/schedules", "lint"] });
  }
  return commands;
}

// ── the I/O shell ───────────────────────────────────────────────────────────

interface Args {
  base: string;
  root: boolean;
}

function parseArgs(argv: string[]): Args {
  const index = argv.indexOf("--base");
  const base = index === -1 ? "main" : argv[index + 1];
  if (base === undefined) throw new Error("--base needs a ref");
  return { base, root: argv.includes("--root") };
}

/** Deleted paths are still "changed"; there is nothing left on disk to lint. */
function existing(paths: string[]): string[] {
  return paths.filter((path) => existsSync(join(REPO_ROOT, path)));
}

function hasScript(dir: string, script: string): boolean {
  try {
    const raw = readFileSync(join(REPO_ROOT, dir, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts?.[script] !== undefined;
  } catch {
    return false;
  }
}

function runCommand(command: LintCommand): number {
  const [executable, ...args] = command.argv;
  if (executable === undefined) throw new Error("empty command");
  console.error(`lint-changed: ${command.label}`);
  const result = spawnSync(executable, args, {
    cwd: join(REPO_ROOT, command.cwd),
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  return result.status ?? 1;
}

/**
 * The eslint cache (`--cache-location` under node_modules/.cache/, gitignored
 * and per-worktree) is shared with the whole-tree scripts on purpose: a warm
 * cache from either run makes the other cheap. It keys on file content, so the
 * cross-file caveat above applies to it identically.
 */
function eslintCommand(input: { cwd: string; cache: string; files: string[] }): LintCommand {
  return {
    label: `eslint ${input.files.length} file${input.files.length === 1 ? "" : "s"} in ${input.cwd}`,
    cwd: input.cwd,
    argv: [
      "pnpm",
      "exec",
      "eslint",
      "--cache",
      "--cache-strategy",
      "content",
      "--cache-location",
      input.cache,
      ...input.files,
    ],
  };
}

function callbackBoxCommands(paths: string[]): LintCommand[] {
  const { backend, frontend } = splitCallbackBoxTargets(paths);
  const commands: LintCommand[] = [];
  if (backend.length > 0) {
    commands.push(
      eslintCommand({
        cwd: "callback-box",
        cache: "node_modules/.cache/eslint/backend",
        files: backend,
      }),
    );
  }
  if (frontend.length > 0) {
    commands.push(
      eslintCommand({
        cwd: FRONTEND_DIR,
        cache: "node_modules/.cache/eslint/frontend",
        files: frontend,
      }),
    );
  }
  return commands;
}

function main(argv: string[]): number {
  const args = parseArgs(argv);
  const paths = existing(changedPaths({ base: args.base, cwd: REPO_ROOT }));
  const commands = args.root
    ? dispatchPlan({ paths, packageDirs: packageOwnerDirs(REPO_ROOT), hasScript })
    : callbackBoxCommands(paths);
  if (commands.length === 0) {
    console.log("lint-changed: nothing lintable changed");
    return 0;
  }
  let status = 0;
  for (const command of commands) {
    const code = runCommand(command);
    if (code !== 0) status = code;
  }
  return status;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 2;
  }
}
