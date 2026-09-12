// Export the selected public-site card graph from a Bee Box workbench.
// Dry-run is the default; --apply writes additions and updates only.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildSite } from "./build.js";
import { ASIDE_SUFFIX, DOC_SUFFIX, PAGE_SUFFIX } from "./cards.js";

const SITE_DIR = import.meta.dirname;
const DESTINATION_DIR = path.join(SITE_DIR, "cards");
const STAGING_PARTS = ["_publish", "public-site"];
const SITE_DOC_SUFFIX = ".site-doc.card";

export class BoxExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoxExportError";
  }
}

interface ExportCard {
  sourceRelative: string;
  destinationRelative: string;
  contents: Buffer;
}

export interface BoxExportOptions {
  boxDir: string;
  destinationDir?: string;
  apply?: boolean;
}

export interface BoxExportReport {
  mode: "apply" | "dry-run";
  boxDir: string;
  stagingDir: string;
  destinationDir: string;
  additions: string[];
  updates: string[];
  unchanged: string[];
  retained: string[];
  pageCount: number;
  written: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function requireDirectory(target: string, label: string): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if (isMissing(error)) throw new BoxExportError(`${label} does not exist: ${target}`);
    throw error;
  }
  if (stat.isSymbolicLink()) throw new BoxExportError(`${label} must not be a symlink: ${target}`);
  if (!stat.isDirectory()) throw new BoxExportError(`${label} is not a directory: ${target}`);
}

function safeRelativePath(input: string): string {
  const relative = input.split(path.sep).join("/");
  if (
    relative === "" ||
    relative.includes("\\") ||
    path.posix.isAbsolute(relative) ||
    path.posix.normalize(relative) !== relative ||
    relative.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new BoxExportError(`unsafe staged path: ${input}`);
  }
  return relative;
}

export function mapStagedCardPath(input: string): string {
  const relative = safeRelativePath(input);
  if (relative.endsWith(SITE_DOC_SUFFIX)) {
    return `${relative.slice(0, -SITE_DOC_SUFFIX.length)}${DOC_SUFFIX}`;
  }
  if (relative.endsWith(PAGE_SUFFIX) || relative.endsWith(ASIDE_SUFFIX)) return relative;
  throw new BoxExportError(
    `unsupported staged file ${relative} (expected *${PAGE_SUFFIX}, *${SITE_DOC_SUFFIX}, or *${ASIDE_SUFFIX})`,
  );
}

function entryRelative(root: string, entry: { parentPath: string; name: string }): string {
  return safeRelativePath(path.relative(root, path.join(entry.parentPath, entry.name)));
}

async function discoverStagedCards(stagingDir: string): Promise<ExportCard[]> {
  const entries = await fs.readdir(stagingDir, { recursive: true, withFileTypes: true });
  const cards: ExportCard[] = [];
  const destinations = new Set<string>();
  const sorted = entries.toSorted((a, b) => {
    const aPath = path.join(a.parentPath, a.name);
    const bPath = path.join(b.parentPath, b.name);
    return aPath.localeCompare(bPath);
  });
  for (const entry of sorted) {
    const relative = entryRelative(stagingDir, entry);
    if (entry.isSymbolicLink()) throw new BoxExportError(`staging contains a symlink: ${relative}`);
    if (entry.isDirectory()) {
      if (!entry.name.endsWith(".attach")) {
        throw new BoxExportError(`unsupported staging directory ${relative} (only *.attach directories are allowed)`);
      }
      continue;
    }
    if (!entry.isFile()) throw new BoxExportError(`unsupported staging entry: ${relative}`);
    const destinationRelative = mapStagedCardPath(relative);
    if (destinations.has(destinationRelative)) {
      throw new BoxExportError(`multiple staged cards map to ${destinationRelative}`);
    }
    destinations.add(destinationRelative);
    cards.push({
      sourceRelative: relative,
      destinationRelative,
      contents: await fs.readFile(path.join(stagingDir, relative)),
    });
  }
  return cards;
}

function isPublicCard(relative: string): boolean {
  return relative.endsWith(PAGE_SUFFIX) || relative.endsWith(DOC_SUFFIX) || relative.endsWith(ASIDE_SUFFIX);
}

async function discoverDestinationCards(destinationDir: string): Promise<Map<string, Buffer>> {
  const entries = await fs.readdir(destinationDir, { recursive: true, withFileTypes: true });
  const cards = new Map<string, Buffer>();
  for (const entry of entries) {
    const relative = entryRelative(destinationDir, entry);
    if (entry.isSymbolicLink()) throw new BoxExportError(`destination contains a symlink: ${relative}`);
    if (entry.isDirectory()) {
      if (!entry.name.endsWith(".attach")) {
        throw new BoxExportError(`unsupported destination directory: ${relative}`);
      }
      continue;
    }
    if (!entry.isFile() || !isPublicCard(relative)) {
      throw new BoxExportError(`unsupported destination entry: ${relative}`);
    }
    cards.set(relative, await fs.readFile(path.join(destinationDir, relative)));
  }
  return cards;
}

async function requireBoxMarker(boxDir: string): Promise<void> {
  try {
    await fs.lstat(path.join(boxDir, ".git"));
  } catch (error) {
    if (isMissing(error)) throw new BoxExportError(`not a Bee Box Git worktree: ${boxDir}`);
    throw error;
  }
}

async function requireSafeDestination(destinationDir: string, relative: string): Promise<void> {
  let current = destinationDir;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new BoxExportError(`destination path contains a symlink: ${relative}`);
      if (current !== path.join(destinationDir, relative) && !stat.isDirectory()) {
        throw new BoxExportError(`destination parent is not a directory: ${relative}`);
      }
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}

async function validateCards(cards: readonly ExportCard[]): Promise<number> {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "bee-box-site-export-"));
  const cardsDir = path.join(scratch, "cards");
  const distDir = path.join(scratch, "dist");
  try {
    await fs.mkdir(cardsDir, { recursive: true });
    for (const card of cards) {
      const destination = path.join(cardsDir, card.destinationRelative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, card.contents);
    }
    const result = await buildSite({ cardsDir, distDir, base: "/", writeSourceManifest: false });
    return result.pageCount;
  } catch (error) {
    throw new BoxExportError(`staged public-site graph is invalid: ${errorMessage(error)}`);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

function compareCards(cards: readonly ExportCard[], existing: ReadonlyMap<string, Buffer>): {
  additions: string[];
  updates: string[];
  unchanged: string[];
  retained: string[];
} {
  const additions: string[] = [];
  const updates: string[] = [];
  const unchanged: string[] = [];
  const selected = new Set(cards.map((card) => card.destinationRelative));
  for (const card of cards) {
    const current = existing.get(card.destinationRelative);
    if (current === undefined) additions.push(card.destinationRelative);
    else if (current.equals(card.contents)) unchanged.push(card.destinationRelative);
    else updates.push(card.destinationRelative);
  }
  const retained = [...existing.keys()].filter((relative) => !selected.has(relative));
  return { additions, updates, unchanged, retained };
}

export async function exportBoxCards(options: BoxExportOptions): Promise<BoxExportReport> {
  const boxDir = path.resolve(options.boxDir);
  const stagingDir = path.join(boxDir, ...STAGING_PARTS);
  const destinationDir = path.resolve(options.destinationDir ?? DESTINATION_DIR);
  await requireDirectory(boxDir, "box");
  await requireBoxMarker(boxDir);
  await requireDirectory(stagingDir, "public-site staging root");
  await requireDirectory(destinationDir, "repository card destination");

  const cards = await discoverStagedCards(stagingDir);
  const existing = await discoverDestinationCards(destinationDir);
  for (const card of cards) await requireSafeDestination(destinationDir, card.destinationRelative);
  const changes = compareCards(cards, existing);
  const pageCount = await validateCards(cards);
  const toWrite = cards.filter((card) =>
    changes.additions.includes(card.destinationRelative) || changes.updates.includes(card.destinationRelative),
  );
  if (options.apply === true) {
    for (const card of toWrite) {
      const destination = path.join(destinationDir, card.destinationRelative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, card.contents);
    }
  }
  return {
    mode: options.apply === true ? "apply" : "dry-run",
    boxDir,
    stagingDir,
    destinationDir,
    ...changes,
    pageCount,
    written: options.apply === true ? toWrite.length : 0,
  };
}

function reportList(label: string, paths: readonly string[]): string {
  return `${label}: ${paths.length === 0 ? "none" : paths.join(", ")}`;
}

export function formatBoxExportReport(report: BoxExportReport): string {
  const result = report.mode === "apply"
    ? `result: wrote ${report.written} card(s); destination-only cards were retained`
    : "result: dry run; nothing written";
  return [
    `box-export: ${report.mode}`,
    `box: ${report.boxDir}`,
    `source: ${report.stagingDir}`,
    `destination: ${report.destinationDir}`,
    `validation: passed (${report.pageCount} page(s))`,
    reportList("add", report.additions),
    reportList("update", report.updates),
    reportList("unchanged", report.unchanged),
    reportList("retain", report.retained),
    result,
  ].join("\n") + "\n";
}

interface CliArgs {
  boxDir: string;
  apply: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let boxDir: string | undefined;
  let apply = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] ?? "";
    if (argument === "--apply") apply = true;
    else if (argument === "--box") {
      const value = argv[++index];
      if (value === undefined) throw new BoxExportError("--box requires a path");
      boxDir = value;
    } else if (argument.startsWith("--box=")) boxDir = argument.slice("--box=".length);
    else throw new BoxExportError(`unknown argument: ${argument}`);
  }
  if (boxDir === undefined || boxDir === "") {
    throw new BoxExportError("usage: pnpm --dir site box-export --box <path> [--apply]");
  }
  return { boxDir, apply };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await exportBoxCards(args);
  process.stdout.write(formatBoxExportReport(report));
}

if (process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(`box export failed: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
