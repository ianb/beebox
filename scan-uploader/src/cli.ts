/**
 * Entry point. Bundled by esbuild into a single `dist/scan-uploader.mjs`,
 * runnable with plain `node` — no checkout, no install, no `bbx`. Invoked
 * either by a ScanSnap post-scan hook or as a manual/periodic sweep; the
 * check endpoint's dedup makes double-runs harmless.
 */

import { homedir } from "node:os";

import { loadConfig, type UploaderConfig, type TargetConfig } from "./config.js";
import { MISSING_CONFIG_MESSAGE, pathExists, resolveConfigPath } from "./config-path.js";
import { runConfigureCommand } from "./configure-cli.js";
import { errorMessage } from "./error-guards.js";
import { runTarget, type RunSummary } from "./run-target.js";
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

function printSummary(target: TargetConfig, summary: RunSummary): void {
  console.log(
    `${target.folder}: uploaded=${String(summary.uploaded)} duplicate=${String(summary.duplicate)} ` +
      `rejected=${String(summary.rejected)} skipped-unsettled=${String(summary.skippedUnsettled)} ` +
      `skipped-identity-changed=${String(summary.skippedIdentityChanged)} errors=${String(summary.errors)}`,
  );
}

function hasFailure(summary: RunSummary): boolean {
  return summary.rejected > 0 || summary.errors > 0;
}

async function runAllTargets(config: UploaderConfig, options: { retryRejected: boolean }): Promise<number> {
  let exitCode = 0;
  for (const target of config.targets) {
    const summary = await runTarget(target, options);
    printSummary(target, summary);
    if (hasFailure(summary)) exitCode = 1;
  }
  return exitCode;
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
    return await runAllTargets(config, { retryRejected });
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
