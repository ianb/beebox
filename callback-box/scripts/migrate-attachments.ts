#!/usr/bin/env tsx
/* eslint-disable import/no-namespace, security/detect-non-literal-fs-filename */
/**
 * Migrate a box from the old sibling-attachment layout to the new
 * `<basename>.attach/` directory layout.
 *
 * Old layout:
 *   inbox/Voice_Memo.memo.card
 *   inbox/Voice_Memo.m4a
 *   inbox/capture-XX/photo-001.image.card + photo-001.jpg
 *   inbox/email/thread-Y-abc12345/thread.email-thread.card +
 *     msg-001.email-message.card + msg-001.body.txt + attachments/
 *   store/drive/Budget.sheet.card + Budget/Summary.json
 *   store/drive/Project_Notes.doc.card + Project_Notes.md
 *
 * New layout:
 *   inbox/Voice_Memo.memo.card
 *   inbox/Voice_Memo.attach/Voice_Memo.m4a
 *   inbox/capture-XX.capture-session.card +
 *     inbox/capture-XX.attach/photo-001.image.card +
 *     photo-001.attach/photo-001.jpg
 *   inbox/email/thread-Y-abc12345.email-thread.card +
 *     thread-Y-abc12345.attach/msg-001.email-message.card +
 *     msg-001.attach/{msg-001.body.txt, attachments/...}
 *   store/drive/Budget.sheet.card +
 *     Budget.attach/Summary.json
 *   store/drive/Project_Notes.doc.card +
 *     Project_Notes.attach/Project_Notes.md
 *
 * Refs inside the cards are rewritten so that pointers to the moved files
 * resolve correctly. Refs to a card's OWN attached files use the `attach/`
 * virtual prefix; cross-card refs use the full new path.
 *
 * Usage:
 *   npx tsx scripts/migrate-attachments.ts <boxRoot>             # dry-run
 *   npx tsx scripts/migrate-attachments.ts <boxRoot> --apply     # execute
 *   npx tsx scripts/migrate-attachments.ts <boxRoot> --apply --no-commit
 *
 * Requires a clean git tree (unless --apply is omitted). After --apply the
 * tree is left staged; run a git commit yourself or pass --commit.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";

interface MigrationOptions {
  boxRoot: string;
  apply: boolean;
  commit: boolean;
}

interface MoveRecord {
  /** Box-rel old path. */
  from: string;
  /** Box-rel new path. */
  to: string;
  /** True for the directory case (Budget/ → Budget.attach/). */
  isDirectory: boolean;
}

interface RefRewrite {
  /** Box-rel path of the card whose content we'll edit. */
  cardPath: string;
  /** Old substring to replace. */
  oldText: string;
  /** New substring. */
  newText: string;
}

interface SessionMoveRecord {
  /** Old wrapper-dir name (e.g. `capture-20260310T1924-abc12345`). */
  oldWrapperDir: string;
  /** New session basename (typically same as oldWrapperDir). */
  sessionBasename: string;
  /** Old box-rel wrapper dir (e.g. `box/inbox/capture-...`). */
  oldWrapperRel: string;
  /** New box-rel session card path. */
  newSessionCardRel: string;
  /** New box-rel attach scope. */
  newAttachRel: string;
}

interface MigrationPlan {
  /** Files / directories to physically move. */
  moves: MoveRecord[];
  /** Cards whose content needs string-level rewriting. */
  rewrites: RefRewrite[];
  /** Capture sessions whose wrapper dir is being dissolved. */
  sessionMoves: SessionMoveRecord[];
  /** Email threads whose wrapper dir is being dissolved. */
  threadMoves: SessionMoveRecord[];
  /** Warnings (non-fatal). */
  warnings: string[];
  /** Errors (abort). */
  errors: string[];
}

const SKIP_DIRS = new Set([
  ".git",
  ".callback-box",
  "node_modules",
  ".tap",
  "tmp",
]);

function parseArgs(argv: string[]): MigrationOptions {
  const positional: string[] = [];
  let apply = false;
  let commit = false;
  for (const arg of argv.slice(2)) {
    if (arg === "--apply") apply = true;
    else if (arg === "--commit") commit = true;
    else if (arg === "--no-commit") commit = false;
    else if (arg.startsWith("--")) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    } else positional.push(arg);
  }
  if (positional.length !== 1) {
    console.error("Usage: migrate-attachments.ts <boxRoot> [--apply] [--commit]");
    process.exit(2);
  }
  return { boxRoot: path.resolve(positional[0]!), apply, commit };
}

function cardBasename(filename: string): string {
  if (!filename.endsWith(".card")) return filename;
  const withoutCard = filename.slice(0, -".card".length);
  const lastDot = withoutCard.lastIndexOf(".");
  if (lastDot === -1) return withoutCard;
  return withoutCard.slice(0, lastDot);
}

function cardType(filename: string): string | null {
  if (!filename.endsWith(".card")) return null;
  const withoutCard = filename.slice(0, -".card".length);
  const lastDot = withoutCard.lastIndexOf(".");
  if (lastDot === -1) return null;
  return withoutCard.slice(lastDot + 1);
}

async function walkAll(boxRoot: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(absDir: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(absDir, e.name);
      const rel = path.relative(boxRoot, abs);
      out.push(rel);
      if (e.isDirectory()) await visit(abs);
    }
  }
  await visit(boxRoot);
  return out;
}

async function isDirectory(absPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(absPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function buildPlan(boxRoot: string): Promise<MigrationPlan> {
  const plan: MigrationPlan = {
    moves: [],
    rewrites: [],
    sessionMoves: [],
    threadMoves: [],
    warnings: [],
    errors: [],
  };

  // -------- Pass A: dissolve capture-session wrapper directories --------
  // Wrapper dirs hold a *.capture-session.card and child files. After
  // migration, the session card lives at the parent dir and children live in
  // a sibling attach scope.
  const inboxAbs = path.join(boxRoot, "box/inbox");
  await dissolveSessionWrappers({
    plan,
    boxRoot,
    scanDirAbs: inboxAbs,
    cardType: "capture-session",
    moveCollector: plan.sessionMoves,
  });

  // Email thread wrappers — same shape (a directory with one *.email-thread.card
  // and msg-NNN.email-message.card siblings).
  await dissolveSessionWrappers({
    plan,
    boxRoot,
    scanDirAbs: path.join(boxRoot, "box/inbox/email"),
    cardType: "email-thread",
    moveCollector: plan.threadMoves,
  });
  await dissolveSessionWrappers({
    plan,
    boxRoot,
    scanDirAbs: path.join(boxRoot, "store/archive/email"),
    cardType: "email-thread",
    moveCollector: plan.threadMoves,
  });

  // -------- Pass B: peer-sibling attachments --------
  // For every *.card in the box, find sibling files sharing its basename
  // and queue them to move into <basename>.<type>.attach/.
  const allRel = await walkAll(boxRoot);
  for (const rel of allRel) {
    if (!rel.endsWith(".card")) continue;
    const cardName = path.basename(rel);
    const dirRel = path.dirname(rel);
    const base = cardBasename(cardName);
    const type = cardType(cardName);
    if (!type) continue;

    // Skip cards that already live inside an attach scope.
    if (/\.attach($|\/)/.test(rel)) continue;

    const dirAbs = path.join(boxRoot, dirRel);
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      continue;
    }

    // Attach dir name is just `<basename>.attach` (no type suffix); basename
    // collisions across types in the same directory are forbidden by the
    // lint rule, so a single `<basename>.attach/` unambiguously belongs to
    // exactly one card.
    void type;
    const attachDirName = `${base}.attach`;
    const attachDirRel = dirRel === "." ? attachDirName : `${dirRel}/${attachDirName}`;

    for (const e of entries) {
      if (e.name === cardName) continue;
      if (e.name === attachDirName) continue; // already migrated
      // Skip other cards in same dir — they have their own scope.
      if (e.name.endsWith(".card")) continue;
      // Same basename means it belongs to this card.
      const sharedStem = e.isDirectory()
        ? e.name
        : (() => {
            const dot = e.name.lastIndexOf(".");
            return dot === -1 ? e.name : e.name.slice(0, dot);
          })();
      if (sharedStem !== base) {
        // Special case for sheets: legacy layout puts CSV/JSON inside a
        // <basename>/ subdirectory that shares the card's *basename* but NOT
        // its type-suffix.
        if (e.isDirectory() && e.name === base) {
          // Fall through to handle as sheet/drive subdir below
        } else {
          continue;
        }
      }

      // Plan the move
      const fromRel = dirRel === "." ? e.name : `${dirRel}/${e.name}`;
      let toRel: string;
      if (e.isDirectory() && e.name === base) {
        // Move *contents* of the legacy subdir into the attach scope.
        // Handled below — for now, just plan the directory move (rename).
        toRel = attachDirRel;
      } else {
        toRel = `${attachDirRel}/${e.name}`;
      }
      plan.moves.push({ from: fromRel, to: toRel, isDirectory: e.isDirectory() });
    }
  }

  // -------- Pass C: ref rewrites --------
  // After we know every move, every card needs its refs adjusted so:
  //   - refs to the OWN card's attached files use the `attach/` virtual prefix
  //   - cross-card refs that pointed at an old absolute path get rewritten
  //     to the new path
  await planRefRewrites({ plan, boxRoot, allRel });

  return plan;
}

interface DissolveOpts {
  plan: MigrationPlan;
  boxRoot: string;
  scanDirAbs: string;
  cardType: string;
  moveCollector: SessionMoveRecord[];
}

async function dissolveSessionWrappers(opts: DissolveOpts): Promise<void> {
  const { plan, boxRoot, scanDirAbs, cardType, moveCollector } = opts;
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await fs.readdir(scanDirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const wrapperAbs = path.join(scanDirAbs, e.name);
    // Look for the session/thread card inside
    let inner: string[];
    try {
      inner = await fs.readdir(wrapperAbs);
    } catch {
      continue;
    }
    const cardFile = inner.find((f) => f.endsWith(`.${cardType}.card`));
    if (!cardFile) continue;
    // Choose a basename for the new card. For capture sessions the wrapper
    // dir name == old session basename; for email threads the wrapper dir
    // name is the safe-subject form, but the card is conventionally named
    // `thread.email-thread.card` and the wrapper provides the identity.
    let sessionBasename = e.name;
    // If the existing card has a meaningful basename other than "thread",
    // prefer it. Otherwise fall back to the wrapper dir name.
    const innerCardBase = cardBasename(cardFile);
    if (innerCardBase && innerCardBase !== "thread") {
      sessionBasename = innerCardBase;
    }
    const newSessionCardRel = path.relative(
      boxRoot,
      path.join(scanDirAbs, `${sessionBasename}.${cardType}.card`),
    );
    const newAttachRel = path.relative(
      boxRoot,
      path.join(scanDirAbs, `${sessionBasename}.attach`),
    );
    const oldWrapperRel = path.relative(boxRoot, wrapperAbs);
    const oldCardRel = `${oldWrapperRel}/${cardFile}`;

    moveCollector.push({
      oldWrapperDir: e.name,
      sessionBasename,
      oldWrapperRel,
      newSessionCardRel,
      newAttachRel,
    });

    // Move the card to the parent dir under its new name.
    plan.moves.push({ from: oldCardRel, to: newSessionCardRel, isDirectory: false });

    // Everything else in the wrapper directory goes into the new attach scope.
    for (const f of inner) {
      if (f === cardFile) continue;
      const fromRel = `${oldWrapperRel}/${f}`;
      const toRel = `${newAttachRel}/${f}`;
      const isDir = await isDirectory(path.join(boxRoot, fromRel));
      plan.moves.push({ from: fromRel, to: toRel, isDirectory: isDir });
    }
  }
}

interface PlanRefArgs {
  plan: MigrationPlan;
  boxRoot: string;
  allRel: string[];
}

async function planRefRewrites(args: PlanRefArgs): Promise<void> {
  const { plan, boxRoot, allRel } = args;

  // Build a map from old box-rel paths to new box-rel paths. This is the
  // composition of every move (peer attachments + wrapper dissolutions).
  const moveMap = new Map<string, string>();
  for (const m of plan.moves) {
    moveMap.set(m.from, m.to);
  }

  // For each card in the box (under its *new* location, but we don't write
  // until execute), look at its current content for paths that resolve to
  // any old-path entry and rewrite them.
  const cardRels = allRel.filter((p) => p.endsWith(".card"));
  for (const cardRel of cardRels) {
    const absPath = path.join(boxRoot, cardRel);
    let content: string;
    try {
      content = await fs.readFile(absPath, "utf-8");
    } catch {
      continue;
    }

    // Compute where the card will live AFTER migration.
    const newCardRel = moveMap.get(cardRel) ?? cardRel;
    const newCardDir = path.dirname(newCardRel);
    const newCardBasename = cardBasename(path.basename(newCardRel));
    const newCardAttachRel = `${newCardDir === "." ? "" : `${newCardDir}/`}${newCardBasename}.attach`;

    // First: for any moved file (from → to), if the card's CURRENT content
    // references `from` (or just its basename), rewrite to the new ref form.
    const pendingRewrites: Array<{ oldText: string; newText: string }> = [];

    // Sort by length descending so longer/more-specific paths are replaced first.
    const moves = [...plan.moves].sort((a, b) => b.from.length - a.from.length);

    for (const m of moves) {
      // Full-path replacement (box-relative).
      if (content.includes(m.from)) {
        pendingRewrites.push({ oldText: m.from, newText: m.to });
      }
      // Absolute-path replacement (leading slash).
      const absFrom = "/" + m.from;
      const absTo = "/" + m.to;
      if (content.includes(absFrom)) {
        pendingRewrites.push({ oldText: absFrom, newText: absTo });
      }
    }

    // Now: refs to files that moved into THIS card's own attach scope
    // should be re-expressed with the `attach/` virtual prefix.
    // E.g. `ref="photo-001.jpg"` on photo-001.image.card → `ref="attach/photo-001.jpg"`.
    // Also catches `Budget/Summary.json` → `attach/Summary.json` for sheets.
    for (const m of moves) {
      if (!m.to.startsWith(newCardAttachRel + "/")) continue;
      const inScope = m.to.slice(newCardAttachRel.length + 1); // path within attach
      // Bare filename (basename only).
      const fromBasename = path.basename(m.from);
      if (content.includes(`ref="${fromBasename}"`)) {
        pendingRewrites.push({
          oldText: `ref="${fromBasename}"`,
          newText: `ref="attach/${inScope}"`,
        });
      }
      // Old subdir form (e.g. Budget/Summary.json) — m.from already includes
      // the subdir; produce the `ref="Budget/Summary.json"` variant.
      const oldRelFromCardDir = path.relative(path.dirname(cardRel), m.from);
      if (oldRelFromCardDir !== fromBasename && content.includes(`ref="${oldRelFromCardDir}"`)) {
        pendingRewrites.push({
          oldText: `ref="${oldRelFromCardDir}"`,
          newText: `ref="attach/${inScope}"`,
        });
      }
      // <body-file>msg-001.body.txt</body-file> form.
      if (content.includes(`>${fromBasename}<`)) {
        pendingRewrites.push({
          oldText: `>${fromBasename}<`,
          newText: `>attach/${inScope}<`,
        });
      }
    }

    // Dedupe in case multiple passes produced the same rewrite.
    const seen = new Set<string>();
    for (const r of pendingRewrites) {
      const key = `${r.oldText}${r.newText}`;
      if (seen.has(key)) continue;
      seen.add(key);
      plan.rewrites.push({ cardPath: cardRel, oldText: r.oldText, newText: r.newText });
    }
  }
}

async function executePlan(boxRoot: string, plan: MigrationPlan): Promise<void> {
  // 1. Apply ref rewrites in-place (before moving — the cards are still at
  //    their old paths). Group rewrites by cardPath for one read/write each.
  const rewritesByCard = new Map<string, RefRewrite[]>();
  for (const r of plan.rewrites) {
    const list = rewritesByCard.get(r.cardPath);
    if (list) list.push(r);
    else rewritesByCard.set(r.cardPath, [r]);
  }
  for (const [cardRel, rewrites] of rewritesByCard) {
    const abs = path.join(boxRoot, cardRel);
    let content: string;
    try {
      content = await fs.readFile(abs, "utf-8");
    } catch {
      continue;
    }
    let updated = content;
    for (const r of rewrites) {
      updated = updated.split(r.oldText).join(r.newText);
    }
    if (updated !== content) {
      await fs.writeFile(abs, updated);
    }
  }

  // 2. Apply moves. Sort so deeper paths move first (move children before
  //    parents), and so directory moves don't collide with subsequent moves
  //    that target the same directory.
  const moves = [...plan.moves].sort((a, b) => b.from.length - a.from.length);
  for (const m of moves) {
    const fromAbs = path.join(boxRoot, m.from);
    const toAbs = path.join(boxRoot, m.to);
    try {
      await fs.access(fromAbs);
    } catch {
      // Source might have already been moved (e.g. as part of a parent dir).
      continue;
    }
    await fs.mkdir(path.dirname(toAbs), { recursive: true });
    await fs.rename(fromAbs, toAbs);
  }

  // 3. Clean up any leftover empty wrapper directories.
  for (const sm of [...plan.sessionMoves, ...plan.threadMoves]) {
    const wrapperAbs = path.join(boxRoot, sm.oldWrapperRel);
    try {
      const remaining = await fs.readdir(wrapperAbs);
      if (remaining.length === 0) {
        await fs.rmdir(wrapperAbs);
      }
    } catch {
      // already gone
    }
  }
}

async function runGit(args: string[], boxRoot: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd: boxRoot });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

async function checkGitClean(boxRoot: string): Promise<boolean> {
  const result = await runGit(["status", "--porcelain"], boxRoot);
  if (result.code !== 0) return false;
  return result.stdout.trim().length === 0;
}

function printPlan(plan: MigrationPlan): void {
  console.log(`\n=== Migration plan ===`);
  console.log(`\nSession dissolutions: ${plan.sessionMoves.length}`);
  for (const sm of plan.sessionMoves) {
    console.log(`  ${sm.oldWrapperRel}/ → ${sm.newSessionCardRel} (+ ${sm.newAttachRel}/)`);
  }
  console.log(`\nEmail-thread dissolutions: ${plan.threadMoves.length}`);
  for (const sm of plan.threadMoves) {
    console.log(`  ${sm.oldWrapperRel}/ → ${sm.newSessionCardRel} (+ ${sm.newAttachRel}/)`);
  }
  console.log(`\nMoves: ${plan.moves.length}`);
  for (const m of plan.moves.slice(0, 100)) {
    console.log(`  ${m.from}${m.isDirectory ? "/" : ""} → ${m.to}${m.isDirectory ? "/" : ""}`);
  }
  if (plan.moves.length > 100) {
    console.log(`  …and ${plan.moves.length - 100} more`);
  }
  console.log(`\nRef rewrites: ${plan.rewrites.length}`);
  const byCard = new Map<string, number>();
  for (const r of plan.rewrites) byCard.set(r.cardPath, (byCard.get(r.cardPath) ?? 0) + 1);
  for (const [card, count] of [...byCard.entries()].toSorted().slice(0, 50)) {
    console.log(`  ${card}: ${count} rewrite(s)`);
  }
  if (byCard.size > 50) {
    console.log(`  …and ${byCard.size - 50} more cards`);
  }
  if (plan.warnings.length > 0) {
    console.log(`\nWarnings:`);
    for (const w of plan.warnings) console.log(`  ${w}`);
  }
  if (plan.errors.length > 0) {
    console.log(`\nErrors:`);
    for (const e of plan.errors) console.log(`  ${e}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  console.log(`Box: ${options.boxRoot}`);
  console.log(`Mode: ${options.apply ? "APPLY" : "dry run (use --apply to execute)"}`);

  // Verify boxRoot is a git repo
  const isClean = await checkGitClean(options.boxRoot);
  if (options.apply && !isClean) {
    console.error("\nError: git working tree is not clean. Commit or stash first.");
    process.exit(1);
  }

  console.log(`\nBuilding migration plan...`);
  const plan = await buildPlan(options.boxRoot);
  printPlan(plan);

  if (plan.errors.length > 0) {
    console.error("\nAborting due to errors.");
    process.exit(1);
  }

  if (!options.apply) {
    console.log("\n(dry run — no changes made. Re-run with --apply to execute.)");
    return;
  }

  console.log("\nExecuting plan...");
  await executePlan(options.boxRoot, plan);
  console.log("Done.");

  if (options.commit) {
    console.log("Staging all changes...");
    await runGit(["add", "-A"], options.boxRoot);
    const message = "Migrate attachments to <basename>.attach/ layout";
    await runGit(["commit", "-m", message], options.boxRoot);
    console.log("Committed.");
  } else {
    console.log("\nMigration complete. Review changes and commit when ready.");
  }
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
