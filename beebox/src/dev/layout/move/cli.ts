#!/usr/bin/env node --import tsx
/**
 * `pnpm layout-move <moves.json> [--dry-run]`: applies a move list — `git mv`
 * each pair, then rewrites every import specifier the move touches (modules,
 * tests, doctest fences, and `bin/**\/*.ts`), and prints every non-import
 * mention of a moved path for hand repair. See
 * docs/plans/file-layout.moves.subplan.md.
 *
 * Move list shape: `{ "moves": [{ "from": "<repo-relative>", "to": "<repo-relative>" }] }`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { applyRewrites, moveFiles } from "./apply.js";
import { collectRewrites, collectSources } from "./edges.js";
import { parseMoveList } from "./list.js";
import { reportMentions } from "./mentions.js";
import { scanRoots } from "./roots.js";
import { validateMoveList } from "./validate.js";

export class MissingMoveListArgumentError extends Error {
  constructor() {
    super("usage: layout-move <moves.json> [--dry-run]");
    this.name = "MissingMoveListArgumentError";
  }
}

export class UnknownArgumentError extends Error {
  readonly argument: string;
  constructor(argument: string) {
    super("unknown argument; expected a move list path and optional --dry-run");
    this.name = "UnknownArgumentError";
    this.argument = argument;
  }
}

interface Args {
  moveListPath: string;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): Args {
  let moveListPath: string | null = null;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (moveListPath === null) moveListPath = arg;
    else throw new UnknownArgumentError(arg);
  }
  if (moveListPath === null) throw new MissingMoveListArgumentError();
  return { moveListPath, dryRun };
}

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../../../..");

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const raw = readFileSync(resolve(process.cwd(), args.moveListPath), "utf8");
  const moves = validateMoveList({ moves: parseMoveList(raw), repoRoot: REPO_ROOT });
  const moveMap = new Map(moves.map((move) => [move.from, move.to] as const));

  console.log(`layout-move: ${moves.length} move(s)`);
  for (const move of moves) console.log(`  ${move.from} -> ${move.to}`);

  const roots = scanRoots(REPO_ROOT);
  const sources = await collectSources({ repoRoot: REPO_ROOT, roots });
  const { byImporter, edgeCount } = collectRewrites({ sources, moveMap });
  console.log(`layout-move: ${edgeCount} specifier rewrite(s) across ${byImporter.size} file(s)`);
  for (const [path, rewrites] of byImporter) {
    for (const [oldSpecifier, newSpecifier] of rewrites) {
      console.log(`  ${path}: "${oldSpecifier}" -> "${newSpecifier}"`);
    }
  }

  if (args.dryRun) return;

  moveFiles({ repoRoot: REPO_ROOT, moves });
  applyRewrites({ repoRoot: REPO_ROOT, byImporter });

  const mentions = reportMentions({
    repoRoot: REPO_ROOT,
    moves,
    roots,
    rewrittenFiles: new Set(byImporter.keys()),
  });
  for (const group of mentions) {
    if (group.lines.length === 0) continue;
    console.log(`non-import mentions of ${group.movedPath}:`);
    for (const line of group.lines) console.log(`  ${line}`);
  }
}

await main();
