/**
 * cb scheduler - Manage the schedule runner daemon.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";
import { createReadStream } from "node:fs";
import { execSync } from "node:child_process";
import { Command } from "commander";
import {
  loadSchedulerConfig,
  isBox,
  runScheduler,
  boxLogFile,
  LOG_DIR,
  type LogEntry,
} from "../../core/scheduler.js";
import {
  loadBoxesConfig,
  addBoxToManifest,
  removeBoxFromManifest,
} from "../../core/boxes-config.js";

const PLIST_LABEL = "com.callback.scheduler";
const PLIST_PATH = path.join(
  os.homedir(),
  "Library/LaunchAgents",
  `${PLIST_LABEL}.plist`
);
const STDERR_LOG = path.join(LOG_DIR, "scheduler-stderr.log");

export const schedulerCommand = new Command("scheduler")
  .description("Manage the schedule runner daemon");

schedulerCommand
  .command("start")
  .description("Run the scheduler daemon (foreground)")
  .option("--interval <seconds>", "Poll interval in seconds", "60")
  .action(async (options: { interval: string }) => {
    await runScheduler({ intervalSeconds: parseInt(options.interval, 10) });
  });

// `cb scheduler {add,remove,list}` are deprecated aliases — the box
// manifest is now shared with `cb serve`, so the canonical commands
// live under `cb boxes`. Keep these working for scripts that already
// use them.

function deprecationNotice(newCommand: string): void {
  console.error(
    `[deprecated] Use \`cb boxes ${newCommand}\` instead — ` +
      "`cb scheduler` box management will be removed in a future release.",
  );
}

schedulerCommand
  .command("add")
  .description("[deprecated] Use `cb boxes add` instead")
  .argument("<path>", "Path to the box")
  .action(async (boxPath: string) => {
    deprecationNotice("add");
    const resolved = path.resolve(boxPath);
    if (!(await isBox(resolved))) {
      console.error(`Not a valid box (missing .cb-box): ${resolved}`);
      process.exit(1);
    }
    const added = await addBoxToManifest(resolved);
    console.log(added ? `Added: ${resolved}` : `Already configured: ${resolved}`);
  });

schedulerCommand
  .command("remove")
  .description("[deprecated] Use `cb boxes remove` instead")
  .argument("<path>", "Path to the box")
  .action(async (boxPath: string) => {
    deprecationNotice("remove");
    const resolved = path.resolve(boxPath);
    const removed = await removeBoxFromManifest(resolved);
    if (!removed) {
      console.error(`Not configured: ${resolved}`);
      process.exit(1);
    }
    console.log(`Removed: ${resolved}`);
  });

schedulerCommand
  .command("list")
  .description("[deprecated] Use `cb boxes list` instead")
  .action(async () => {
    deprecationNotice("list");
    const config = await loadBoxesConfig();
    if (config.boxes.length === 0) {
      console.log("No boxes configured. Use `cb boxes add <path>` to add one.");
      return;
    }
    for (const box of config.boxes) {
      const valid = await isBox(box);
      console.log(`${valid ? "  " : "! "}${box}${valid ? "" : " (missing .cb-box)"}`);
    }
  });

schedulerCommand
  .command("status")
  .description("Show scheduler status")
  .action(async () => {
    const config = await loadSchedulerConfig();
    console.log(`Configured boxes: ${config.boxes.length}`);
    for (const box of config.boxes) {
      const valid = await isBox(box);
      console.log(`  ${valid ? "✓" : "✗"} ${box}`);
    }

    // Check launchd status
    try {
      const output = execSync(`launchctl list ${PLIST_LABEL} 2>&1`, {
        encoding: "utf-8",
      });
      console.log("\nLaunchd service: loaded");
      // Extract PID if running
      const pidMatch = output.match(/"PID"\s*=\s*(\d+)/);
      if (pidMatch) {
        console.log(`  PID: ${pidMatch[1]}`);
      }
    } catch {
      console.log("\nLaunchd service: not loaded");
    }

    console.log(`\nPlist: ${PLIST_PATH}`);
    console.log("Logs: <boxRoot>/.callback-box/scheduler.jsonl");
  });

schedulerCommand
  .command("install")
  .description("Install launchd plist for auto-start")
  .action(async () => {
    // Find the cb binary — process.argv[1] may be a .ts file when run via tsx,
    // so use `which cb` to get the actual installed binary path
    let cbPath: string;
    try {
      cbPath = execSync("which cb", { encoding: "utf-8" }).trim();
    } catch {
      cbPath = process.argv[1] ?? "cb";
      console.warn(`Warning: could not resolve cb binary via 'which', using ${cbPath}`);
    }

    // launchd doesn't source shell profiles, so PATH won't include nvm/node.
    // Capture the current PATH so the daemon can find node.
    const currentPath = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${cbPath}</string>
    <string>scheduler</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${currentPath}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${STDERR_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${STDERR_LOG}</string>
</dict>
</plist>
`;

    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.mkdir(path.dirname(PLIST_PATH), { recursive: true });
    await fs.writeFile(PLIST_PATH, plist);
    console.log(`Wrote ${PLIST_PATH}`);
    console.log();
    console.log("To start the scheduler:");
    console.log(`  launchctl load ${PLIST_PATH}`);
    console.log();
    console.log("To stop it:");
    console.log(`  launchctl unload ${PLIST_PATH}`);
  });

schedulerCommand
  .command("log")
  .description("Show scheduler log entries")
  .option("--box <path>", "Show logs for a specific box (default: all configured boxes)")
  .option("--limit <n>", "Max entries to show", "20")
  .option("--errors", "Only show entries with errors")
  .option("--script <name>", "Only show entries where this script ran or errored")
  .option("--json", "Output raw JSONL")
  .action(async (options: { box?: string; limit: string; errors?: boolean; script?: string; json?: boolean }) => {
    const limit = parseInt(options.limit, 10);

    // Determine which boxes to read logs from
    let boxes: string[];
    if (options.box) {
      boxes = [path.resolve(options.box)];
    } else {
      const config = await loadSchedulerConfig();
      boxes = config.boxes;
    }

    if (boxes.length === 0) {
      console.log("No boxes configured.");
      return;
    }

    // Read entries from all box logs
    const allEntries: LogEntry[] = [];
    for (const boxPath of boxes) {
      const logPath = boxLogFile(boxPath);
      try {
        await fs.access(logPath);
      } catch {
        continue;
      }

      const rl = readline.createInterface({
        input: createReadStream(logPath),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as LogEntry;
          if (options.errors) {
            if (entry.error) { /* keep */ }
            else if (entry.result && entry.result.errors > 0) { /* keep */ }
            else continue;
          }
          if (options.script) {
            // Keep only tick entries where this script ran or errored.
            const match = entry.result && entry.result.scripts.some(
              (s) => s.name === options.script && (s.status === "ran" || s.status === "error"),
            );
            if (!match) continue;
          }
          allEntries.push(entry);
        } catch {
          // skip malformed
        }
      }
    }

    // Sort newest first
    allEntries.sort((a, b) => b.ts.localeCompare(a.ts));
    const shown = allEntries.slice(0, limit);

    if (options.json) {
      for (const e of shown) {
        console.log(JSON.stringify(e));
      }
      return;
    }

    if (shown.length === 0) {
      console.log("No matching log entries.");
      return;
    }

    for (const e of shown) {
      const ts = e.ts.replace("T", " ").replace(/\.\d+Z$/, "Z");
      if (e.event === "tick" && e.result) {
        const boxName = path.basename(e.box ?? "?");
        const r = e.result;
        let ranScripts = r.scripts.filter((s) => s.status === "ran");
        let errorScripts = r.scripts.filter((s) => s.status === "error");

        // When filtering to a single script, render just that script's line
        // with timestamp + box context — suppress the tick summary header.
        if (options.script) {
          ranScripts = ranScripts.filter((s) => s.name === options.script);
          errorScripts = errorScripts.filter((s) => s.name === options.script);
          for (const s of ranScripts) {
            const dur = s.durationMs ? ` (${(s.durationMs / 1000).toFixed(1)}s)` : "";
            console.log(`${ts}  ${boxName}: → ${s.name}${dur}`);
          }
          for (const s of errorScripts) {
            console.log(`${ts}  ${boxName}: ✗ ${s.name}: ${s.error ?? "unknown error"}`);
          }
          continue;
        }

        if (r.ran === 0 && r.errors === 0) {
          console.log(`${ts}  ${boxName}: all ${r.skipped} skipped`);
        } else {
          console.log(`${ts}  ${boxName}: ${r.ran} ran, ${r.skipped} skipped, ${r.errors} errors`);
          for (const s of ranScripts) {
            const dur = s.durationMs ? ` (${(s.durationMs / 1000).toFixed(1)}s)` : "";
            console.log(`  → ${s.name}${dur}`);
          }
          for (const s of errorScripts) {
            console.log(`  ✗ ${s.name}: ${s.error ?? "unknown error"}`);
          }
        }
      } else if (e.event === "tick" && e.error) {
        const boxName = path.basename(e.box ?? "?");
        console.log(`${ts}  ${boxName}: ERROR ${e.error}`);
      }
    }

    if (allEntries.length > limit) {
      console.log(`\n(${allEntries.length - limit} more entries, use --limit to see more)`);
    }
  });

schedulerCommand
  .command("uninstall")
  .description("Remove launchd plist")
  .action(async () => {
    try {
      execSync(`launchctl unload ${PLIST_PATH} 2>&1`);
      console.log("Unloaded launchd service");
    } catch {
      // May not be loaded
    }

    try {
      await fs.unlink(PLIST_PATH);
      console.log(`Removed ${PLIST_PATH}`);
    } catch {
      console.log(`Plist not found: ${PLIST_PATH}`);
    }
  });
