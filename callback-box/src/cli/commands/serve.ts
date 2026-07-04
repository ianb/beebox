/**
 * cb serve - Start the webapp server
 *
 * Serves one or more boxes, each at its own URL slug based on directory basename.
 * Usage: cb serve [dirs...]
 *   - With args: uses the given dirs directly.
 *   - No args, manifest populated: serves every box in ~/.config/cb/boxes.json.
 *   - No args, manifest empty: serves the current directory (legacy fallback,
 *     useful for one-off local development).
 */

import { Command } from "commander";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { startServer, DEFAULT_PORT, type BoxSpec } from "../../webapp/server.js";
import { loadBoxesConfig } from "../../core/boxes-config.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { getBoxShapeOrLegacyFallback } from "../lib/box-shape.js";

/**
 * The slug a box gets when nothing overrides it. For a legacy (shapeVersion
 * 1) box this is the box dir's own basename, same as always. For a v2 box
 * `boxRoot` is the `content/` directory (see "The box repository" in
 * `docs/plans/boxes-as-packages-v2.md`), so `path.basename(boxRoot)` would
 * always be the literal string "content" — the F1 gap the plan calls out.
 * The meaningful name for a v2 box is its PACKAGE root's basename instead.
 */
async function defaultSlugFor(boxRoot: string): Promise<string> {
  const shape = await getBoxShapeOrLegacyFallback(boxRoot);
  return path.basename(shape.shapeVersion >= 2 ? shape.packageRoot : shape.boxRoot);
}

/**
 * Resolve directory arguments into a `BoxSpec` array. `slugOverride` (from
 * `--slug`) only applies when there's exactly one dir — passing it with
 * multiple dirs is an ambiguous request, not a "apply to all" default.
 */
async function resolveBoxes(dirs: string[], slugOverride: string | undefined): Promise<BoxSpec[]> {
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
    //   2. Manifest at ~/.config/cb/boxes.json (the production path on
    //      servers — added/removed via `cb boxes add|remove`).
    //   3. Current directory (legacy fallback for one-off local dev).
    let boxDirs: string[];
    if (dirs.length > 0) {
      boxDirs = dirs;
    } else {
      const manifest = await loadBoxesConfig();
      if (manifest.boxes.length > 0) {
        boxDirs = manifest.boxes;
        console.log(`Serving ${manifest.boxes.length} box(es) from manifest:`);
        for (const b of manifest.boxes) console.log(`  ${b}`);
      } else {
        boxDirs = [process.cwd()];
      }
    }
    const boxes = await resolveBoxes(boxDirs, options.slug);

    if (options.dev) {
      // exec into node --watch with tsx loader, bypassing the CLI wrapper.
      // Uses node's native watcher (not tsx --watch) for proper signal handling.
      const projectDir = PACKAGE_ROOT;
      const serverTs = path.join(projectDir, "src/webapp/server-main.ts");
      const srcDir = path.join(projectDir, "src");
      const resolvedDirs = boxDirs.map((d) => path.resolve(d));

      const args = [
        "--watch",
        `--watch-path=${srcDir}`,
        "--import", "tsx",
        serverTs,
        ...resolvedDirs,
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
