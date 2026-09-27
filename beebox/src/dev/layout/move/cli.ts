#!/usr/bin/env node --import tsx
/**
 * `pnpm layout-move <moves.json> [--dry-run] [--no-rewrite-mentions]`:
 * applies a move list — `git mv` each pair, then rewrites every import
 * specifier the move touches (modules, tests, doctest fences, and
 * `bin/**\/*.ts`). By default it also rewrites every confidently-resolvable
 * non-import mention of a moved path (`mention-rewrite.ts`) and reports the
 * rest as "needs review"; `--no-rewrite-mentions` reverts to printing every
 * mention for hand repair instead. See docs/plans/file-layout.moves.subplan.md.
 *
 * Move list shape: `{ "moves": [{ "from": "<repo-relative>", "to": "<repo-relative>" }] }`.
 *
 * `pnpm layout-move --mentions-from-git <base> [--dry-run]`: mentions-only
 * mode for moves that already happened (and are already typechecked) before
 * this tool existed. Computes the old->new mapping from git's rename
 * detection between `<base>` and `HEAD` (`git-renames.ts`) and runs only the
 * mention rewrite over it — no `git mv`, no import-specifier rewrite.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { applyRewrites, moveFiles } from "./apply.js";
import { collectRewrites, collectSources } from "./edges.js";
import { computeRenamesFromGit } from "./git-renames.js";
import { parseMoveList } from "./list.js";
import { computeMentionRewrite, type MentionRewriteResult } from "./mention-rewrite.js";
import { reportMentions } from "./mentions.js";
import { scanRoots } from "./roots.js";
import { validateMoveList } from "./validate.js";

export class MissingMoveListArgumentError extends Error {
  constructor() {
    super("usage: layout-move <moves.json> [--dry-run] [--no-rewrite-mentions] | layout-move --mentions-from-git <base> [--dry-run]");
    this.name = "MissingMoveListArgumentError";
  }
}

export class MissingMentionsFromGitBaseError extends Error {
  constructor() {
    super("--mentions-from-git requires a <base> ref argument");
    this.name = "MissingMentionsFromGitBaseError";
  }
}

export class UnknownArgumentError extends Error {
  readonly argument: string;
  constructor(argument: string) {
    super("unknown argument; expected a move list path and optional --dry-run/--no-rewrite-mentions, or --mentions-from-git <base>");
    this.name = "UnknownArgumentError";
    this.argument = argument;
  }
}

interface MoveListArgs {
  mode: "move-list";
  moveListPath: string;
  dryRun: boolean;
  rewriteMentions: boolean;
}

interface MentionsFromGitArgs {
  mode: "mentions-from-git";
  base: string;
  dryRun: boolean;
}

type Args = MoveListArgs | MentionsFromGitArgs;

export function parseArgs(argv: string[]): Args {
  let moveListPath: string | null = null;
  let dryRun = false;
  let rewriteMentions = true;
  let base: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--no-rewrite-mentions") rewriteMentions = false;
    else if (arg === "--rewrite-mentions") rewriteMentions = true;
    else if (arg === "--mentions-from-git") {
      const value = argv[i + 1];
      if (value === undefined) throw new MissingMentionsFromGitBaseError();
      base = value;
      i += 1;
    } else if (moveListPath === null && base === null) moveListPath = arg;
    else throw new UnknownArgumentError(arg);
  }
  if (base !== null) return { mode: "mentions-from-git", base, dryRun };
  if (moveListPath === null) throw new MissingMoveListArgumentError();
  return { mode: "move-list", moveListPath, dryRun, rewriteMentions };
}

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../../../..");

function printMentionRewriteSummary(result: MentionRewriteResult, params: { dryRun: boolean }): void {
  const verb = params.dryRun ? "would rewrite" : "rewrote";
  console.log(`layout-move: mention rewrites (${verb})`);
  for (const [kind, count] of result.countsByForm) console.log(`  ${kind}: ${count}`);
  console.log(`  ${result.fileEdits.size} file(s) touched`);
  const needsReviewCount = result.needsReview.reduce((sum, group) => sum + group.lines.length, 0);
  console.log(`  needs review: ${needsReviewCount} mention(s)`);
  for (const group of result.needsReview) {
    if (group.lines.length === 0) continue;
    console.log(`needs review for ${group.movedPath}:`);
    for (const line of group.lines) console.log(`  ${line}`);
  }
}

function runMentionsFromGit(args: MentionsFromGitArgs): void {
  const { moves, rejected } = computeRenamesFromGit({ repoRoot: REPO_ROOT, base: args.base });
  console.log(`layout-move: ${moves.length} rename(s) detected from git (base ${args.base})`);
  if (rejected.length > 0) {
    console.log(`layout-move: ${rejected.length} rejected rename(s)`);
    for (const r of rejected) console.log(`  ${r.from} -> ${r.to}: ${r.reason}`);
  }
  const roots = scanRoots(REPO_ROOT);
  const result = computeMentionRewrite({ repoRoot: REPO_ROOT, moves, roots, rewrittenFiles: new Set() });
  if (!args.dryRun) {
    for (const [path, text] of result.fileEdits) writeFileSync(resolve(REPO_ROOT, path), text, "utf8");
  }
  printMentionRewriteSummary(result, { dryRun: args.dryRun });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "mentions-from-git") {
    runMentionsFromGit(args);
    return;
  }
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

  const rewrittenFiles = new Set(byImporter.keys());

  if (args.dryRun) {
    if (args.rewriteMentions) {
      const result = computeMentionRewrite({ repoRoot: REPO_ROOT, moves, roots, rewrittenFiles });
      printMentionRewriteSummary(result, { dryRun: true });
    }
    return;
  }

  moveFiles({ repoRoot: REPO_ROOT, moves });
  applyRewrites({ repoRoot: REPO_ROOT, byImporter });

  if (args.rewriteMentions) {
    const result = computeMentionRewrite({ repoRoot: REPO_ROOT, moves, roots, rewrittenFiles });
    for (const [path, text] of result.fileEdits) writeFileSync(resolve(REPO_ROOT, path), text, "utf8");
    printMentionRewriteSummary(result, { dryRun: false });
    return;
  }

  const mentions = reportMentions({ repoRoot: REPO_ROOT, moves, roots, rewrittenFiles });
  for (const group of mentions) {
    if (group.lines.length === 0) continue;
    console.log(`non-import mentions of ${group.movedPath}:`);
    for (const line of group.lines) console.log(`  ${line}`);
  }
}

await main();
