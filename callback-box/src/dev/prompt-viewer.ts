#!/usr/bin/env tsx
/**
 * Prompt Viewer — generate the data behind the `dev/prompts/` browser page: the
 * static prompt inventory, the three assembled per-situation contexts, a simple
 * duplication report, and a growing size ledger for prompt-size-over-time.
 *
 * Usage:
 *   pnpm prompt-viewer
 *   pnpm prompt-viewer --box ~/src/boxes/test1
 *   pnpm prompt-viewer --box <path> --no-ledger
 *
 * Writes `dev/prompts/data.json` (gitignored) and appends to
 * `dev/prompts/size-ledger.jsonl` (tracked) when the numbers actually changed.
 * The page itself is the hand-written `dev/prompts/index.html`.
 */

import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import { errnoCode } from "../lib/error-guards.js";
import {
  buildViewerData,
  relativizeHome,
  type LedgerLine,
} from "./lib/prompt-viewer-data.js";

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function parseArgs(argv: string[]): { box: string; ledger: boolean } {
  let box = "~/src/boxes/test1";
  let ledger = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--box") {
      const next = argv[++i];
      if (next === undefined) throw new MissingBoxPathError();
      box = next;
    } else if (arg === "--no-ledger") {
      ledger = false;
    } else {
      throw new UnknownArgError(arg ?? "");
    }
  }
  return { box: resolve(expandHome(box)), ledger };
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

class MissingBoxPathError extends UsageError {
  constructor() {
    super("--box requires a path");
    this.name = "MissingBoxPathError";
  }
}

class UnknownArgError extends UsageError {
  constructor(arg: string) {
    super(`Unknown argument: ${arg}`);
    this.name = "UnknownArgError";
  }
}

async function gitShortSha(): Promise<string> {
  try {
    const { stdout } = await execa("git", ["rev-parse", "--short", "HEAD"], { cwd: PACKAGE_ROOT });
    return stdout.trim();
  } catch (_e) {
    return "unknown";
  }
}

/** Numeric content of the last ledger line, or null if the ledger is absent/empty. */
async function lastLedgerContent(path: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  const lines = raw.split("\n").filter(Boolean);
  const last = lines.at(-1);
  if (last === undefined) return null;
  const parsed: LedgerLine = JSON.parse(last);
  return JSON.stringify({ situations: parsed.situations, fragments: parsed.fragments });
}

async function main(): Promise<void> {
  const { box, ledger } = parseArgs(process.argv.slice(2));
  const commit = await gitShortSha();
  const generatedAt = new Date().toISOString();

  const { data, ledgerContent } = await buildViewerData({ box, commit, generatedAt });

  const outDir = join(PACKAGE_ROOT, "..", "dev", "prompts");
  await mkdir(outDir, { recursive: true });
  const dataPath = join(outDir, "data.json");
  await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`);

  const fragmentCount = data.fragmentIndex.length;
  const dupCount = data.duplication.length;

  let ledgerNote: string;
  const ledgerPath = join(outDir, "size-ledger.jsonl");
  if (!ledger) {
    ledgerNote = "ledger skipped (--no-ledger)";
  } else {
    const newContent = JSON.stringify({
      situations: ledgerContent.situations,
      fragments: ledgerContent.fragments,
    });
    const previous = await lastLedgerContent(ledgerPath);
    if (previous === newContent) {
      ledgerNote = "ledger unchanged";
    } else {
      const line: LedgerLine = {
        at: generatedAt,
        commit,
        box: relativizeHome(box),
        situations: ledgerContent.situations,
        fragments: ledgerContent.fragments,
      };
      await appendFile(ledgerPath, `${JSON.stringify(line)}\n`);
      ledgerNote = "ledger appended";
    }
  }

  console.log(
    `${String(fragmentCount)} fragments, ${String(dupCount)} duplication findings, ${ledgerNote} → dev/prompts/data.json`,
  );
}

try {
  await main();
} catch (e) {
  if (e instanceof UsageError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
