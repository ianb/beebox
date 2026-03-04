/**
 * cb serve - Start the webapp server
 *
 * Serves one or more boxes, each at its own URL slug based on directory basename.
 * Usage: cb serve [dirs...]
 *   - No args: serves current directory
 *   - Multiple dirs: each dir's basename becomes its URL slug
 */

import { Command } from "commander";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { startServer, DEFAULT_PORT, type BoxSpec } from "../../webapp/server.js";

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

    // Default to current directory if no dirs specified
    const boxDirs = dirs.length > 0 ? dirs : [process.cwd()];
    const boxes = resolveBoxes(boxDirs);

    if (options.dev) {
      // exec into node --watch with tsx loader, bypassing the CLI wrapper.
      // Uses node's native watcher (not tsx --watch) for proper signal handling.
      const projectDir = path.resolve(import.meta.dirname, "../../..");
      const serverTs = path.join(projectDir, "src/webapp/server.ts");
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
      const child = spawn(process.execPath, args, { stdio: "inherit", env });

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
    });
  });
