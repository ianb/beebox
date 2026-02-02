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

      // Set TSX_TSCONFIG_PATH so tsx finds the correct tsconfig.json
      // regardless of the current working directory
      const tsconfigPath = path.resolve(import.meta.dirname, "../../../tsconfig.json");

      const child = spawn("npx", ["tsx", ...args], {
        stdio: "inherit",
        cwd: process.cwd(),
        // Don't use detached - let child inherit our process group
        // so signals propagate naturally when parent is killed
        env: {
          ...process.env,
          TSX_TSCONFIG_PATH: tsconfigPath,
        },
      });

      // Forward termination signals to child
      const cleanup = () => {
        if (child.pid && !child.killed) {
          try {
            child.kill("SIGTERM");
          } catch {
            // Already dead
          }
        }
      };

      process.on("SIGINT", () => {
        cleanup();
        // Don't exit immediately - let child handle SIGINT and we'll exit when it does
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
