/**
 * CLI entry for `bin/tour`. Discovers *.tour.ts in beebox/test/tours/,
 * loads them (which causes their `tour(...)` calls to register), then
 * runs either a single tour by name, all of them, or just lists what's
 * available.
 *
 * The worktree base URL is detected the same way `bin/browse` does it
 * (BROWSE_WORKTREE env var, defaulting to "main"), so tours work
 * uniformly from main or any worktree.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runTour } from "./runner.js";
import { clearRegistry, registeredTours } from "./index.js";

const __dirname = import.meta.dirname;
const TOURS_DIR = path.resolve(__dirname, "..");

interface ParsedArgs {
  command: "list" | "all" | "run";
  name: string | null;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.length === 0) return { command: "list", name: null };
  const first = argv[0];
  if (first === "--list" || first === "-l") return { command: "list", name: null };
  if (first === "--all") return { command: "all", name: null };
  return { command: "run", name: first ?? null };
}

async function discoverTourFiles(): Promise<string[]> {
  const entries = await readdir(TOURS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".tour.ts"))
    .map((e) => path.join(TOURS_DIR, e.name))
    .toSorted();
}

async function loadAll(files: readonly string[]): Promise<void> {
  clearRegistry();
  for (const f of files) {
    await import(pathToFileURL(f).href);
  }
}

function detectBaseUrl(): string {
  const worktree = process.env["BROWSE_WORKTREE"] ?? "main";
  const box = process.env["BROWSE_BOX"] ?? "test1";
  const port = process.env["ROUTER_PORT"] ?? "3210";
  return `http://localhost:${port}/${worktree}/${box}`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const files = await discoverTourFiles();
  await loadAll(files);
  const tours = registeredTours();

  if (args.command === "list") {
    if (tours.length === 0) {
      process.stdout.write("No tours found in beebox/test/tours/\n");
      return 0;
    }
    process.stdout.write("Available tours:\n");
    for (const t of tours) {
      process.stdout.write(`  ${t.name.padEnd(20)} ${t.description}\n`);
    }
    return 0;
  }

  const baseUrl = detectBaseUrl();

  if (args.command === "all") {
    process.stdout.write(`Running ${String(tours.length)} tours against ${baseUrl}\n\n`);
    let firstFailure: number | null = null;
    for (const t of tours) {
      const code = await runOne(t.name, baseUrl);
      if (code !== 0 && firstFailure === null) firstFailure = code;
    }
    return firstFailure ?? 0;
  }

  const target = tours.find((t) => t.name === args.name);
  if (!target) {
    process.stderr.write(`tour: no tour named "${args.name ?? "<none>"}"\n`);
    process.stderr.write("Use `bin/tour --list` to see what's available.\n");
    return 1;
  }
  return runOne(target.name, baseUrl);
}

async function runOne(name: string, baseUrl: string): Promise<number> {
  const target = registeredTours().find((t) => t.name === name);
  if (!target) {
    process.stderr.write(`tour: internal error — "${name}" disappeared from registry\n`);
    return 1;
  }
  process.stdout.write(`▶ ${name}\n`);
  try {
    const result = await runTour(target, { baseUrl });
    const violations = result.checkpoints.reduce(
      (sum, cp) => sum + cp.artifacts.reduce((s, a) => s + a.axeViolationCount, 0),
      0,
    );
    process.stdout.write(`  ${String(result.checkpoints.length)} checkpoints, ${String(result.findings.length)} findings, ${String(violations)} axe violations\n`);
    process.stdout.write(`  → ${result.summaryPath}\n\n`);
    return 0;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`  ✗ ${message}\n\n`);
    return 1;
  }
}

main().then((code) => process.exit(code)).catch((e: unknown) => {
  process.stderr.write(`tour: unexpected error: ${String(e)}\n`);
  process.exit(1);
});
