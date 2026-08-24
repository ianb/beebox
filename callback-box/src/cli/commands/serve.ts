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
import { boxSlug } from "../../lib/box-slug.js";
import { findBoxRoot, BOX_MARKER } from "../../lib/paths.js";
import { isValidBox } from "../../core/box/index.js";
import { loadEnv, serverEnvSchema } from "../../lib/env.js";

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

/** Fail-closed production decision, shared with its direct doctest. */
export function devSurfacesEnabled(env: { CB_DEV_SURFACES?: string | undefined }): boolean {
  return env.CB_DEV_SURFACES === "1";
}

/** Build the watched development child's environment with an explicit opt-in. */
export function devServerEnvironment(
  sourceEnv: NodeJS.ProcessEnv,
  options: { port: number; host: string },
): NodeJS.ProcessEnv {
  return {
    ...sourceEnv,
    CB_DEV_SURFACES: "1",
    PORT: String(options.port),
    HOST: options.host,
  };
}

/**
 * Resolve an explicit dir argument to the directory that actually holds the
 * box. A v2 package root (marker at `<dir>/content/.cb-box`) resolves to its
 * `content/` — `cb serve <package-root>` is the obvious thing to type and
 * used to die later with a raw ENOENT reading `<package-root>/.cb-box`. A
 * dir that is neither a box nor a package root fails here, with the marker
 * path named, instead of as an uncaught stack trace at startup.
 * Exported for its doctest.
 */
export async function resolveServableBoxRoot(boxRoot: string): Promise<string> {
  if (await isValidBox(boxRoot)) return boxRoot;
  const contentRoot = path.join(boxRoot, "content");
  if (await isValidBox(contentRoot)) return contentRoot;
  console.error(
    `Error: ${boxRoot} is not a callback box — no ${BOX_MARKER} there or in ` +
      `${contentRoot}. Run \`cb init ${boxRoot}\` to create one, or point ` +
      "`cb serve` at an existing box."
  );
  process.exit(1);
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
      const boxRoot = await resolveServableBoxRoot(path.resolve(dir));
      const slug = slugOverride ?? (await boxSlug(boxRoot));
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
    // `cli/index.ts` validates only the deliberately permissive CLI schema.
    // Serving has a narrower boundary, including the strict dev-surface flag.
    const envConfig = loadEnv(serverEnvSchema);
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
      // TODO(env-migration): the watched child still receives its validated
      // launch configuration through process.env.
      const env = devServerEnvironment(process.env, { port, host: options.host });

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
      devSurfaces: devSurfacesEnabled(envConfig),
    });
  });
