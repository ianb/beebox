/**
 * cb serve - Start the webapp server
 */

import { Command } from "commander";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { startServer, DEFAULT_PORT } from "../../webapp/server.js";

export const serveCommand = new Command("serve")
  .description("Start the webapp server")
  .option("-p, --port <port>", "Port to listen on", String(DEFAULT_PORT))
  .option("-h, --host <host>", "Host to bind to", "localhost")
  .option("-d, --dev", "Run in development mode with auto-reload")
  .action(async (options: { port: string; host: string; dev?: boolean }) => {
    const port = parseInt(options.port, 10);

    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(`Error: Invalid port number: ${options.port}`);
      process.exit(1);
    }

    if (options.dev) {
      // Run with tsx --watch for auto-reload
      // Find the source file path (relative to this compiled file)
      const srcFile = path.resolve(
        import.meta.dirname,
        "../../../src/cli/index.ts"
      );

      const args = ["--watch", srcFile, "serve", "--port", String(port), "--host", options.host];

      console.log(`Starting dev server with auto-reload on http://${options.host}:${port}`);

      const child = spawn("npx", ["tsx", ...args], {
        stdio: "inherit",
        cwd: process.cwd(),
        detached: true, // Create new process group so we can kill the tree
      });

      // Kill child process tree on exit
      const cleanup = () => {
        if (child.pid && !child.killed) {
          try {
            // Kill the process group (negative PID kills the group)
            process.kill(-child.pid, "SIGTERM");
          } catch {
            // Process may already be dead, try direct kill
            try {
              child.kill("SIGTERM");
            } catch {
              // Already dead
            }
          }
        }
      };

      process.on("SIGINT", () => {
        cleanup();
        process.exit(0);
      });

      process.on("SIGTERM", () => {
        cleanup();
        process.exit(0);
      });

      process.on("exit", cleanup);

      child.on("error", (err) => {
        console.error("Failed to start dev server:", err.message);
        process.exit(1);
      });

      child.on("exit", (code) => {
        process.exit(code ?? 0);
      });

      return;
    }

    await startServer({
      port,
      host: options.host,
    });
  });
