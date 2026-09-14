/**
 * Entry point. Bundled by esbuild into a single `dist/scan-uploader.mjs`,
 * runnable with plain `node` — no checkout, no install, no `bbx`. Invoked by
 * the launchd agent (on a folder change or on its interval) or by hand; the
 * check endpoint's dedup makes double-runs harmless.
 */

import { homedir } from "node:os";

import { loadConfig, type UploaderConfig } from "./config.js";
import { MISSING_CONFIG_MESSAGE, pathExists, resolveConfigPath } from "./config-path.js";
import { runConfigureCommand } from "./configure-cli.js";
import { errorMessage } from "./error-guards.js";
import { notifySweep } from "./notify.js";
import { runAllTargets } from "./run-all.js";
import { runScheduleCommand } from "./schedule-cli.js";

function printHelp(): void {
  console.log(
    [
      "Usage: scan-uploader [config.json] [--retry-rejected]",
      "       scan-uploader configure <server-url-with-box> --folder <path> [options]",
      "       scan-uploader schedule <install|uninstall|status> [options]",
      "",
      "Uploads new files from configured folders to a beebox scan-upload",
      "endpoint. Config defaults to ./scan-uploader.json if present, else",
      "~/.config/scan-uploader.json.",
      "",
      "  --retry-rejected  re-PUT previously rejected files (after a fix upstream)",
      "  -h, --help        show this help",
      "",
      "Run `scan-uploader configure --help` or `scan-uploader schedule --help`",
      "for those subcommands' options.",
    ].join("\n"),
  );
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args[0] === "configure") {
    return runConfigureCommand(args.slice(1));
  }
  if (args[0] === "schedule") {
    return runScheduleCommand(args.slice(1));
  }
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }
  const retryRejected = args.includes("--retry-rejected");
  const explicitConfigPath = args.find((arg) => !arg.startsWith("-"));
  const configPath =
    explicitConfigPath ?? (await resolveConfigPath({ cwd: process.cwd(), homeDir: homedir() }));

  if (explicitConfigPath === undefined && !(await pathExists(configPath))) {
    for (const line of MISSING_CONFIG_MESSAGE) {
      console.error(line);
    }
    return 1;
  }

  let config: UploaderConfig;
  try {
    config = await loadConfig(configPath);
  } catch (e) {
    console.error(errorMessage(e));
    return 1;
  }

  try {
    // The desktop banner is posted here rather than inside the sweep so the
    // sweep stays a pure function of its seams — and so nothing notifies when
    // a test or a future caller drives `runAllTargets` directly.
    const result = await runAllTargets(config, { retryRejected });
    await notifySweep(result.boxes);
    return result.exitCode;
  } catch (e) {
    console.error(`scan-uploader: ${errorMessage(e)}`);
    return 1;
  }
}

async function run(): Promise<void> {
  process.exitCode = await main();
}

void run().catch((e: unknown) => {
  console.error(`scan-uploader: unexpected error: ${errorMessage(e)}`);
  process.exitCode = 1;
});
