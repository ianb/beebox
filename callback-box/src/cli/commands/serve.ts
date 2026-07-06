/**
 * cb serve - Start the webapp server
 *
 * Serves one or more boxes, each at its own URL slug based on directory basename.
 * Usage: cb serve [dirs...]
 *   - With args: uses the given dirs directly.
 *   - No args: walks up from the current directory to its box root (so this
 *     works from a v2 box's package root or any subdirectory), falling back
 *     to the bare cwd if no box is found — a one-off local-dev convenience.
 *
 * The `~/.config/cb/boxes.json` manifest (`cb boxes add/remove/list`) feeds
 * the SCHEDULER only — see `docs/scheduler.md`. `cb serve` never reads it;
 * to serve several boxes behind one process, use `cb hub`, which has its own
 * manifest (`hub.json`).
 */

import { Command } from "commander";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { startServer, DEFAULT_PORT, type BoxSpec } from "../../webapp/server.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { getBoxShapeOrLegacyFallback } from "../../lib/box-shape.js";
import { findBoxRoot } from "../../lib/paths.js";

/**
 * The slug a box gets when nothing overrides it. For a legacy (shapeVersion
 * 1) box this is the box dir's own basename, same as always. For a v2 box
 * `boxRoot` is the `content/` directory (see "The box repository" in
 * `docs/implemented-plans/boxes-as-packages-v2.md`), so `path.basename(boxRoot)` would
 * always be the literal string "content" — the F1 gap the plan calls out.
 * The meaningful name for a v2 box is its PACKAGE root's basename instead.
 */
async function defaultSlugFor(boxRoot: string): Promise<string> {
  const shape = await getBoxShapeOrLegacyFallback(boxRoot);
  return path.basename(shape.shapeVersion >= 2 ? shape.packageRoot : shape.boxRoot);
}

/**
 * `<slug>=<boxRoot>` argv encoding `server-main.ts` expects. Exported so
 * `--dev`'s spawn args (below) and its doctest build it the same way a
 * resolved `BoxSpec[]` always does — a v2 box's `content/` dir basename is
 * always the literal string "content", so passing a bare dir instead would
 * silently slug every v2 box "content" (server-main.ts's bare-dir fallback
 * derives the slug from `path.basename`, same gap `--slug`/`resolveBoxes`
 * exist to close for the non-dev path).
 */
export function toBoxArgs(boxes: BoxSpec[]): string[] {
  return boxes.map((box) => `${box.slug}=${box.boxRoot}`);
}

/**
 * Resolve directory arguments into a `BoxSpec` array. `slugOverride` (from
 * `--slug`) only applies when there's exactly one dir — passing it with
 * multiple dirs is an ambiguous request, not a "apply to all" default.
 * Exported for `--dev`'s arg building above and its doctest.
 */
export async function resolveBoxes(dirs: string[], slugOverride: string | undefined): Promise<BoxSpec[]> {
  if (slugOverride !== undefined && dirs.length > 1) {
    console.error("Error: --slug can only be used when serving a single box directory.");
    process.exit(1);
  }

  const resolved = await Promise.all(
    dirs.map(async (dir) => {
      const boxRoot = path.resolve(dir);
      const slug = slugOverride ?? (await defaultSlugFor(boxRoot));
      return { slug, boxRoot };
    })
  );

  // Check for duplicate slugs
  const slugs = new Set<string>();
  for (const box of resolved) {
    if (slugs.has(box.slug)) {
      console.error(
        `Error: Duplicate box slug "${box.slug}". All directories must have unique basenames.`
      );
      process.exit(1);
    }
    slugs.add(box.slug);
  }

  return resolved;
}

export const serveCommand = new Command("serve")
  .description("Start the webapp server")
  .argument("[dirs...]", "Box directories to serve (default: current directory)")
  .option("-p, --port <port>", "Port to listen on", String(DEFAULT_PORT))
  .option("-h, --host <host>", "Host to bind to", "localhost")
  .option("-d, --dev", "Run in development mode with auto-reload")
  .option(
    "--slug <slug>",
    "URL slug to serve the box under (default: the box's own basename — the PACKAGE root's " +
      "basename for a v2 box, since its content/ dir's basename is always \"content\"). " +
      "Only valid with a single box directory — this is how `cb hub` names a box's process."
  )
  .action(async (dirs: string[], options: { port: string; host: string; dev?: boolean; slug?: string }) => {
    const port = parseInt(options.port, 10);

    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(`Error: Invalid port number: ${options.port}`);
      process.exit(1);
    }

    // Resolve which box dirs to serve. Precedence:
    //   1. Explicit positional args.
    //   2. The current directory, walked up to its box root (handles running
    //      from a v2 box's package root or any subdirectory) — falls back to
    //      the bare cwd if no box is found (fixtures, or a plain directory
    //      for one-off local dev).
    // The boxes.json manifest is never consulted here — it feeds the
    // scheduler only; see the module doc-comment above.
    let boxDirs: string[];
    if (dirs.length > 0) {
      boxDirs = dirs;
    } else {
      const cwdBoxRoot = await findBoxRoot(process.cwd());
      boxDirs = [cwdBoxRoot ?? process.cwd()];
    }
    const boxes = await resolveBoxes(boxDirs, options.slug);

    if (options.dev) {
      // exec into node --watch with tsx loader, bypassing the CLI wrapper.
      // Uses node's native watcher (not tsx --watch) for proper signal handling.
      const projectDir = PACKAGE_ROOT;
      const serverTs = path.join(projectDir, "src/webapp/server-main.ts");
      const srcDir = path.join(projectDir, "src");
      const boxArgs = toBoxArgs(boxes);

      const args = [
        "--watch",
        `--watch-path=${srcDir}`,
        "--import", "tsx",
        serverTs,
        ...boxArgs,
      ];

      // Set PORT/HOST as env vars for the server entry point
      const env = {
        ...process.env,
        PORT: String(port),
        HOST: options.host,
      };

      // Spawn node --watch and forward signals for clean shutdown.
      // stdio: "inherit" makes the child own the terminal.
      const child = spawn(process.execPath, args, { stdio: "inherit", env, cwd: projectDir });

      // Forward signals to child
      const forward = (sig: NodeJS.Signals) => child.kill(sig);
      process.on("SIGINT", () => forward("SIGINT"));
      process.on("SIGTERM", () => forward("SIGTERM"));

      child.on("exit", (code) => process.exit(code ?? 0));
      return;
    }

    await startServer({
      port,
      host: options.host,
      boxes,
      prewarmChat: true,
    });
  });
