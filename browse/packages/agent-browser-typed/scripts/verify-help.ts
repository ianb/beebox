// Diff checked-in `agent-browser <cmd> --help` snapshots against the installed
// binary. Exits non-zero with a unified-ish report on drift. On --update, rewrites
// the snapshots in place (use only when an agent is about to manually update the
// corresponding typed declarations).
//
// Run from browse/ via: pnpm verify-help [--update]

import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/runner.js";

const HELP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "help");

interface Drift {
  command: string;
  captured: string;
  current: string;
}

async function captureHelp(command: string): Promise<string> {
  const { stdout, stderr } = await run([command, "--help"]);
  return stdout.length > 0 ? stdout : stderr;
}

async function main(): Promise<number> {
  const update = process.argv.includes("--update");
  const entries = (await readdir(HELP_DIR)).filter((f) => f.endsWith(".txt")).sort();
  if (entries.length === 0) {
    process.stderr.write(`No help snapshots in ${HELP_DIR}\n`);
    return 1;
  }
  const drift: Drift[] = [];
  for (const entry of entries) {
    const command = entry.replace(/\.txt$/, "");
    const path = join(HELP_DIR, entry);
    const captured = await readFile(path, "utf8");
    const current = await captureHelp(command);
    if (current !== captured) {
      if (update) {
        await writeFile(path, current, "utf8");
        process.stdout.write(`updated: ${entry}\n`);
      } else {
        drift.push({ command, captured, current });
      }
    }
  }
  if (drift.length === 0) {
    process.stdout.write(`${String(entries.length)} help snapshots match.\n`);
    return 0;
  }
  process.stderr.write(`Drift in ${String(drift.length)} of ${String(entries.length)} help snapshots:\n\n`);
  for (const d of drift) {
    process.stderr.write(`==== ${d.command} ====\n`);
    process.stderr.write(`--- captured\n${d.captured}`);
    process.stderr.write(`+++ current\n${d.current}\n`);
  }
  process.stderr.write(`\nFix: update typed declarations in src/commands/${drift.map((d) => d.command).join(", ")}, then re-run with --update to refresh snapshots.\n`);
  return 1;
}

main().then((code) => {
  process.exit(code);
}).catch((e: unknown) => {
  process.stderr.write(`verify-help: ${String(e)}\n`);
  process.exit(1);
});
