/**
 * cb trick - Run box-local agent-authored scripts.
 *
 * Tricks are TypeScript scripts in `<tricksDir>/scripts/<name>/index.ts`,
 * where `tricksDir` is `boxCodePaths(shape).tricksDir` — `boxRoot/tricks`
 * for a legacy (v1) box, `packageRoot/src/tricks` for a package (v2) box.
 * The agent writes them; they're only callable from within the box.
 *
 * Scripts run as subprocesses via tsx with their own package context,
 * so they can install and import their own npm dependencies.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { stageAll, commit, getStatus } from "../../lib/git.js";
import { buildScriptEnv } from "../../core/script-env.js";
import { boxCodePaths, boxCodePathsRelativeToBoxRoot, getBoxShapeOrLegacyFallback } from "../lib/box-shape.js";

const require = createRequire(import.meta.url);

/** Resolve the tsx CLI binary from cb's own dependencies. */
function resolveTsx(): string {
  // tsx/cli is the entry point for the tsx binary
  return require.resolve("tsx/cli");
}

/**
 * If the trick left uncommitted changes, stage and commit them.
 */
async function commitIfDirty(boxRoot: string, trickName: string): Promise<void> {
  const status = await getStatus(boxRoot);
  if (status.clean) return;

  await stageAll(boxRoot);
  await commit(boxRoot, {
    message: `Auto-commit changes from trick: ${trickName}`,
    trailers: { "Run-By": `trick/${trickName}` },
  });
  console.log(`Committed changes left by trick "${trickName}".`);
}

interface TrickInfo {
  name: string;
  description: string;
  entryPoint: string;
}

/**
 * Extract description from a trick's source without executing it.
 * Looks for: export const description = "...";
 */
async function readDescription(entryPoint: string): Promise<string> {
  try {
    const content = await fs.readFile(entryPoint, "utf-8");
    const match = content.match(
      /export\s+const\s+description\s*=\s*["'`]([^"'`]*)["'`]/
    );
    return match?.[1] ?? "";
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read trick description, continuing without one: ${entryPoint}:`, e);
    }
    return "";
  }
}

/**
 * Discover all tricks by scanning `<tricksDir>/scripts/` for directories
 * with index.ts.
 */
async function discoverTricks(tricksDir: string): Promise<TrickInfo[]> {
  const scriptsDir = path.join(tricksDir, "scripts");

  let entries: string[];
  try {
    entries = await fs.readdir(scriptsDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Could not read tricks directory, treating as no tricks: ${scriptsDir}:`, e);
    }
    return [];
  }

  const tricks: TrickInfo[] = [];

  for (const entry of entries) {
    const entryPoint = path.join(scriptsDir, entry, "index.ts");
    try {
      await fs.access(entryPoint);
    } catch (_e) {
      // No index.ts in this directory — not a trick, skip it. fs.access
      // throwing here just means the file is absent, which is expected.
      continue;
    }

    const description = await readDescription(entryPoint);
    tricks.push({ name: entry, description, entryPoint });
  }

  return tricks.toSorted((a, b) => a.name.localeCompare(b.name));
}

interface RunTrickOptions {
  boxRoot: string;
  tricksDir: string;
  name: string;
  entryPoint: string;
  args: string[];
}

/**
 * Run a trick as a subprocess via tsx. The subprocess cwd is `tricksDir`
 * (`boxRoot/tricks` for a legacy box, `packageRoot/src/tricks` for a
 * package box) so relative imports and the trick's own `package.json`
 * resolve the same way in either shape.
 * Returns the exit code.
 */
async function runTrick(opts: RunTrickOptions): Promise<number> {
  const env = await buildScriptEnv(opts.boxRoot, {
    CB_BOX_ROOT: opts.boxRoot,
    CB_TRICK_NAME: opts.name,
  });
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [resolveTsx(), opts.entryPoint, ...opts.args], {
      cwd: opts.tricksDir,
      env,
      stdio: "inherit",
    });

    child.on("error", (err) => {
      console.error(`Failed to start trick: ${err.message}`);
      resolve(1);
    });

    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

export const trickCommand = new Command("trick")
  .description("Run box-local agent-authored scripts (tricks)")
  .argument("[name]", "Trick to run")
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(async function (this: Command, name: string | undefined) {
    const boxRoot = await requireBoxRoot();
    const shape = await getBoxShapeOrLegacyFallback(boxRoot);
    const tricksDir = boxCodePaths(shape).tricksDir;
    // The relative "tricks/scripts" (or "../src/tricks/scripts" for a
    // package box) shown in user-facing messages below, expressed from the
    // agent's actual cwd (boxRoot).
    const relScriptsDir = `${boxCodePathsRelativeToBoxRoot(shape).tricksDir}/scripts`;

    if (!name) {
      // List available tricks
      const tricks = await discoverTricks(tricksDir);
      if (tricks.length === 0) {
        console.log("No tricks found.");
        console.log("");
        console.log(`Create one at ${relScriptsDir}/<name>/index.ts`);
        console.log(`See ${relScriptsDir}/CLAUDE.md for details.`);
        return;
      }

      console.log("Available tricks:");
      console.log("");
      for (const trick of tricks) {
        const desc = trick.description ? ` — ${trick.description}` : "";
        console.log(`  ${trick.name}${desc}`);
      }
      return;
    }

    // Run the named trick
    const entryPoint = path.join(tricksDir, "scripts", name, "index.ts");
    try {
      await fs.access(entryPoint);
    } catch (_e) {
      // fs.access throws only because the entry point is absent; the
      // not-found message below is the meaningful handling of that.
      console.error(`Trick not found: ${name}`);
      console.error(`Expected: ${relScriptsDir}/${name}/index.ts`);
      process.exitCode = 1;
      return;
    }

    // Collect remaining args after the trick name
    const trickArgs = this.args.slice(1);

    const exitCode = await runTrick({ boxRoot, tricksDir, name, entryPoint, args: trickArgs });
    if (exitCode !== 0) {
      process.exitCode = exitCode;
      return;
    }

    // Auto-commit any changes the trick left uncommitted
    await commitIfDirty(boxRoot, name);
  });
