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

/**
 * Resolve directory arguments into BoxSpec array.
 */
function resolveBoxes(dirs: string[]): BoxSpec[] {
  const resolved = dirs.map((dir) => {
    const boxRoot = path.resolve(dir);
    const slug = path.basename(boxRoot);
    return { slug, boxRoot };
  });

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
  .action(async (dirs: string[], options: { port: string; host: string; dev?: boolean }) => {
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
    const boxes = resolveBoxes(boxDirs);

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
