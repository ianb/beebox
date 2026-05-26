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
 *   npx tsx scripts/migrate/attachments.ts <boxRoot>             # dry-run
 *   npx tsx scripts/migrate/attachments.ts <boxRoot> --apply     # execute
 *   npx tsx scripts/migrate/attachments.ts <boxRoot> --apply --no-commit
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

/**
 * A wrapper dir holds a session or thread card plus its child files. We
 * record where the wrapper lives, what session/thread card it owns, and the
 * basename we'll give the dissolved layout (typically the wrapper's name).
 */
interface WrapperInfo {
  /** Box-rel path of the wrapper directory (e.g. `box/inbox/capture-XX`). */
  wrapperRel: string;
  /** Wrapper's parent directory (box-rel). */
  parentRel: string;
  /** Basename used for the dissolved card (== wrapper directory name). */
  basename: string;
  /** Card type of the session/thread card (e.g. `capture-session`). */
  type: string;
  /** Filename of the session/thread card inside the wrapper. */
  innerCardName: string;
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

  // Step 1: discover wrapper dirs (any directory containing a *.<type>.card
  // for a wrapper-style type). Walks the whole box, since wrappers can live
  // anywhere — box/inbox, store/archive, store/archive/captures, etc.
  const wrappers: WrapperInfo[] = [];
  await findWrappersRecursive({
    boxRoot,
    scanDirAbs: boxRoot,
    wrapperTypes: ["capture-session", "email-thread"],
    out: wrappers,
  });

  for (const w of wrappers) {
    const newSessionCardRel = w.parentRel === "."
      ? `${w.basename}.${w.type}.card`
      : `${w.parentRel}/${w.basename}.${w.type}.card`;
    const newAttachRel = w.parentRel === "."
      ? `${w.basename}.attach`
      : `${w.parentRel}/${w.basename}.attach`;
    const record: SessionMoveRecord = {
      oldWrapperDir: w.basename,
      sessionBasename: w.basename,
      oldWrapperRel: w.wrapperRel,
      newSessionCardRel,
      newAttachRel,
    };
    if (w.type === "capture-session") plan.sessionMoves.push(record);
    else plan.threadMoves.push(record);
  }

  // Quick lookup: which wrapper a given old path is inside, if any.
  const wrapperByRel = new Map<string, WrapperInfo>();
  for (const w of wrappers) wrapperByRel.set(w.wrapperRel, w);

  function findOwningWrapper(oldRel: string): WrapperInfo | null {
    for (const w of wrappers) {
      if (oldRel === w.wrapperRel) return w;
      if (oldRel.startsWith(w.wrapperRel + "/")) return w;
    }
    return null;
  }

  // Step 2: enumerate every file/dir and place each entry.
  const allRel = await walkAll(boxRoot);

  // Build basename → card map per directory so we can identify "who owns
  // this non-card file?" by sibling-basename match in the file's own dir.
  const cardsByDir = new Map<string, Map<string, string>>(); // dir -> (basename -> cardFileName)
  for (const rel of allRel) {
    if (!rel.endsWith(".card")) continue;
    const dir = path.dirname(rel);
    const name = path.basename(rel);
    const base = cardBasename(name);
    if (base === name) continue;
    const m = cardsByDir.get(dir) ?? new Map<string, string>();
    m.set(base, name);
    cardsByDir.set(dir, m);
  }

  // For each card, collect the leaf filenames it references as attachments.
  // This filters out compiled-output siblings (e.g. `briefing.md` written
  // by generateDocs() but not referenced from the card) — they share a
  // basename but aren't user-managed attachments.
  const cardReferencedFilenames = new Map<string, Set<string>>();
  for (const rel of allRel) {
    if (!rel.endsWith(".card")) continue;
    try {
      const content = await fs.readFile(path.join(boxRoot, rel), "utf-8");
      const filenames = extractReferencedFilenames(content);
      cardReferencedFilenames.set(rel, filenames);
    } catch {
      cardReferencedFilenames.set(rel, new Set());
    }
  }

  // Per-directory: filename → owning card (the card in this dir that
  // references the file). Lets us route a file into the right card's
  // attach scope even when basenames don't match — common when image
  // cards are renamed with descriptive suffixes (`photo-001-foo.image.card`
  // still references `photo-001.jpg` by short name).
  const fileOwnerByDir = new Map<string, Map<string, string>>();
  for (const [cardRel, refs] of cardReferencedFilenames) {
    if (refs.size === 0) continue;
    const dir = path.dirname(cardRel);
    const m = fileOwnerByDir.get(dir) ?? new Map<string, string>();
    for (const filename of refs) {
      // Only consider files that actually exist as siblings — skip refs
      // pointing into subdirs or to nonexistent files.
      if (!m.has(filename)) m.set(filename, path.basename(cardRel));
    }
    fileOwnerByDir.set(dir, m);
  }

  // First pass: compute new path for every CARD in the box.
  const cardNewPath = new Map<string, string>();
  for (const rel of allRel) {
    if (!rel.endsWith(".card")) continue;
    if (/\.attach\//.test(rel)) {
      // Already inside an attach scope (rare in test1 boxes, but defensive)
      cardNewPath.set(rel, rel);
      continue;
    }

    const wrapper = findOwningWrapper(rel);
    if (wrapper) {
      const innerName = path.basename(rel);
      if (innerName === wrapper.innerCardName) {
        // The session/thread card itself — lifts up to wrapper's parent.
        const newCardRel = wrapper.parentRel === "."
          ? `${wrapper.basename}.${wrapper.type}.card`
          : `${wrapper.parentRel}/${wrapper.basename}.${wrapper.type}.card`;
        cardNewPath.set(rel, newCardRel);
      } else {
        // Child card — lands inside the session's attach scope, preserving
        // any subdirectory structure it had within the wrapper.
        const insideWrapper = rel.slice(wrapper.wrapperRel.length + 1);
        const attachDir = wrapper.parentRel === "."
          ? `${wrapper.basename}.attach`
          : `${wrapper.parentRel}/${wrapper.basename}.attach`;
        cardNewPath.set(rel, `${attachDir}/${insideWrapper}`);
      }
    } else {
      // Not in a wrapper — card stays put.
      cardNewPath.set(rel, rel);
    }
  }

  // Second pass: compute new path for every NON-CARD file/dir.
  for (const rel of allRel) {
    if (rel.endsWith(".card")) continue;
    if (/\.attach\//.test(rel)) continue;
    if (/\.attach$/.test(rel)) continue;

    const dirRel = path.dirname(rel);
    const leafName = path.basename(rel);
    const absPath = path.join(boxRoot, rel);
    const isDir = await isDirectory(absPath);

    // Skip wrapper directories themselves — they go away as containers.
    if (wrapperByRel.has(rel)) continue;

    const wrapper = findOwningWrapper(rel);

    // sharedStem = strip a single extension from filename; for a directory,
    // use the name as-is. Used to match sibling cards (`Foo.image.card` <-> `Foo.jpg`).
    const sharedStem = isDir
      ? leafName
      : (() => {
          const dot = leafName.lastIndexOf(".");
          return dot === -1 ? leafName : leafName.slice(0, dot);
        })();

    // Find an owning card for this file. Two paths:
    //   (1) A sibling card explicitly references the file by leaf name.
    //   (2) A sibling card shares the file's sharedStem (legacy convention
    //       for cards that don't have an explicit `<filename>` ref).
    // (1) wins when it disagrees with (2) — explicit refs are authoritative
    // and handle the descriptive-suffix case (`photo-001-foo.image.card`
    // referencing `photo-001.jpg`).
    const siblingCards = cardsByDir.get(dirRel);
    const explicitOwner = fileOwnerByDir.get(dirRel)?.get(leafName);
    const stemOwner = siblingCards ? siblingCards.get(sharedStem) : undefined;
    const owningCardName = explicitOwner ?? stemOwner;

    // Special case: sheet's `<basename>/` legacy subdir (directory whose name
    // matches a sibling .sheet.card's basename, but the sub-files are loose
    // inside it, not nested attach scopes).
    const isSheetLegacySubdir = isDir
      && siblingCards
      && siblingCards.get(leafName)
      && (siblingCards.get(leafName) ?? "").endsWith(".sheet.card");

    if (isSheetLegacySubdir) {
      // Rename `<dir>/<basename>/` → `<dir>/<basename>.attach/`.
      const owningCardRel = `${dirRel === "." ? "" : `${dirRel}/`}${siblingCards!.get(leafName)}`;
      const owningCardNewPath = cardNewPath.get(owningCardRel) ?? owningCardRel;
      const owningCardNewBase = cardBasename(path.basename(owningCardNewPath));
      const owningCardNewDir = path.dirname(owningCardNewPath);
      const newAttachRel = owningCardNewDir === "."
        ? `${owningCardNewBase}.attach`
        : `${owningCardNewDir}/${owningCardNewBase}.attach`;
      plan.moves.push({ from: rel, to: newAttachRel, isDirectory: true });
      continue;
    }

    if (owningCardName) {
      // Two cases:
      //   - Explicit owner: card has a ref to this leaf name; route it in.
      //   - Stem-only owner: file shares basename with a card. Route in
      //     only if the card actually references the file (filters out
      //     generated-output siblings like briefing.md).
      const owningCardRel = `${dirRel === "." ? "" : `${dirRel}/`}${owningCardName}`;
      const referenced = cardReferencedFilenames.get(owningCardRel);
      const isReferenced = referenced ? referenced.has(leafName) : false;
      const shouldNest = owningCardName === explicitOwner || isReferenced;

      if (shouldNest) {
        const owningCardNewPath = cardNewPath.get(owningCardRel) ?? owningCardRel;
        const owningCardNewBase = cardBasename(path.basename(owningCardNewPath));
        const owningCardNewDir = path.dirname(owningCardNewPath);
        const newAttachRel = owningCardNewDir === "."
          ? `${owningCardNewBase}.attach`
          : `${owningCardNewDir}/${owningCardNewBase}.attach`;
        const newPath = `${newAttachRel}/${leafName}`;
        if (newPath !== rel) {
          plan.moves.push({ from: rel, to: newPath, isDirectory: isDir });
        }
        continue;
      }
      // Sibling matches by basename but isn't a referenced attachment;
      // fall through to wrapper-orphan or stay-put behavior.
    }

    if (wrapper) {
      // Skip directories inside wrappers — their files will be moved
      // individually below, and the directory itself will be left empty
      // (cleaned up at the end). Planning a directory rename here would
      // collide with the per-file moves into the same destination.
      if (isDir) continue;
      // Orphan file inside a wrapper — lifts into the session's attach scope
      // flat (no per-card nesting). Preserves any subdir structure.
      const insideWrapper = rel.slice(wrapper.wrapperRel.length + 1);
      const attachDir = wrapper.parentRel === "."
        ? `${wrapper.basename}.attach`
        : `${wrapper.parentRel}/${wrapper.basename}.attach`;
      const newPath = `${attachDir}/${insideWrapper}`;
      if (newPath !== rel) {
        plan.moves.push({ from: rel, to: newPath, isDirectory: false });
      }
      continue;
    }

    // Else: standalone file with no owning card and no wrapper. Stays put.
  }

  // Card moves are also part of the plan.
  for (const [oldRel, newRel] of cardNewPath) {
    if (oldRel !== newRel) {
      plan.moves.push({ from: oldRel, to: newRel, isDirectory: false });
    }
  }

  // Ref rewrites — uses the final move map.
  await planRefRewrites({ plan, boxRoot, allRel });

  return plan;
}

interface FindWrappersArgs {
  boxRoot: string;
  scanDirAbs: string;
  cardType: string;
  out: WrapperInfo[];
}

/**
 * Pull out leaf filenames referenced from a card's content. Picks up
 * `ref="..."`, `src="..."`, and text content of `<body-file>` / `<content>`-
 * style elements. Returns just the leaf filename (path-stripped) of each ref.
 *
 * Used to filter sibling-basename matches: only files actually referenced
 * by the card should be treated as that card's attachments. Files that
 * happen to share a basename but aren't referenced (e.g. a generateDocs()
 * output sitting next to a briefing card) stay put.
 */
function extractReferencedFilenames(cardContent: string): Set<string> {
  const out = new Set<string>();
  // Match ref="value", refs="value", src="value", path="value"
  const attrMatches = cardContent.matchAll(/\b(?:ref|refs|src|path)\s*=\s*"([^"]+)"/g);
  for (const m of attrMatches) {
    const value = m[1] ?? "";
    for (const ref of value.split(/\s+/)) {
      if (!ref) continue;
      const stripped = ref.startsWith("attach/") ? ref.slice("attach/".length) : ref;
      const leaf = stripped.includes("/") ? stripped.slice(stripped.lastIndexOf("/") + 1) : stripped;
      if (leaf) out.add(leaf);
    }
  }
  // Match <body-file>value</body-file> and similar single-line element text
  const elMatches = cardContent.matchAll(/<(?:body-file|content)>([^<]+)<\/(?:body-file|content)>/g);
  for (const m of elMatches) {
    const value = (m[1] ?? "").trim();
    if (!value) continue;
    const stripped = value.startsWith("attach/") ? value.slice("attach/".length) : value;
    const leaf = stripped.includes("/") ? stripped.slice(stripped.lastIndexOf("/") + 1) : stripped;
    if (leaf) out.add(leaf);
  }
  return out;
}

async function findWrappers(args: FindWrappersArgs): Promise<void> {
  const { boxRoot, scanDirAbs, cardType, out } = args;
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
    let inner: string[];
    try {
      inner = await fs.readdir(wrapperAbs);
    } catch {
      continue;
    }
    const cardFile = inner.find((f) => f.endsWith(`.${cardType}.card`));
    if (!cardFile) continue;
    out.push({
      wrapperRel: path.relative(boxRoot, wrapperAbs),
      parentRel: path.relative(boxRoot, scanDirAbs),
      basename: e.name,
      type: cardType,
      innerCardName: cardFile,
    });
  }
}

interface FindWrappersRecursiveArgs {
  boxRoot: string;
  scanDirAbs: string;
  wrapperTypes: string[];
  out: WrapperInfo[];
}

/**
 * Recursively walk the box looking for wrapper directories. A directory is a
 * wrapper iff:
 *   - it has multiple children (a *.session/thread.card plus child files), AND
 *   - exactly one of its children is a *.<wrapper-type>.card, AND
 *   - it isn't already an attach scope.
 *
 * Recurses into non-wrapper directories. Stops at wrappers (children inside
 * them aren't themselves wrappers — they're attached files).
 *
 * The "parent dir contains a wrapper card" check prevents misclassifying a
 * regular directory like `box/inbox/` (which itself holds session-cards
 * after migration) as a wrapper of its own.
 */
async function findWrappersRecursive(args: FindWrappersRecursiveArgs): Promise<void> {
  const { boxRoot, scanDirAbs, wrapperTypes, out } = args;
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await fs.readdir(scanDirAbs, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    if (e.name.endsWith(".attach")) continue;

    const childAbs = path.join(scanDirAbs, e.name);
    let innerEntries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      innerEntries = await fs.readdir(childAbs, { withFileTypes: true });
    } catch {
      continue;
    }
    const inner = innerEntries.map((d) => d.name);
    let cardFile: string | undefined;
    let cardType: string | undefined;
    for (const type of wrapperTypes) {
      const found = inner.find((f) => f.endsWith(`.${type}.card`));
      if (found) {
        cardFile = found;
        cardType = type;
        break;
      }
    }

    // A wrapper holds a session card plus loose sibling cards/files. A
    // regular containing directory (like `box/inbox/`, where new-layout
    // capture-session cards live as siblings of their `.attach/` dirs)
    // also contains a session card, but additionally has subdirectories
    // that themselves house data (`capture-XX/`, `capture-XX.attach/`,
    // `email/`, etc.). Use the presence of any non-`.attach` subdir as
    // the signal: a real wrapper's only subdirs are `<base>.attach/`
    // (rare in the old layout, but possible) or none.
    const hasNonAttachSubdir = innerEntries.some(
      (d) => d.isDirectory() && !d.name.endsWith(".attach")
    );

    if (cardFile && cardType && !hasNonAttachSubdir) {
      out.push({
        wrapperRel: path.relative(boxRoot, childAbs),
        parentRel: path.relative(boxRoot, scanDirAbs),
        basename: e.name,
        type: cardType,
        innerCardName: cardFile,
      });
      continue; // Don't recurse into a wrapper.
    }
    // Not a wrapper — recurse.
    await findWrappersRecursive({
      boxRoot,
      scanDirAbs: childAbs,
      wrapperTypes,
      out,
    });
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
    try {
      await fs.rename(fromAbs, toAbs);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      // Destination already exists (partial prior migration, or an .attach
      // dir that was hand-created). Merge the source contents into it
      // instead of failing the whole run.
      if (err.code === "ENOTEMPTY" || err.code === "EEXIST") {
        await mergeMove(fromAbs, toAbs);
      } else {
        throw e;
      }
    }
  }

  // 3. Clean up any leftover empty directories inside (and including) each
  // dissolved wrapper. We walk depth-first so child empties get removed
  // before their parents.
  for (const sm of [...plan.sessionMoves, ...plan.threadMoves]) {
    const wrapperAbs = path.join(boxRoot, sm.oldWrapperRel);
    await removeEmptyDirsRecursively(wrapperAbs);
  }
}

/**
 * Recursively move `from` into `to`, where `to` already exists. For each child:
 * if it doesn't collide, rename(); if it does and both sides are directories,
 * recurse. If both sides are files and identical, drop the source; if they
 * differ, throw — that's a real conflict the user needs to resolve.
 */
async function mergeMove(fromAbs: string, toAbs: string): Promise<void> {
  const sourceStat = await fs.stat(fromAbs);
  if (!sourceStat.isDirectory()) {
    // File-on-file collision. If contents identical, drop the source.
    const [a, b] = await Promise.all([
      fs.readFile(fromAbs),
      fs.readFile(toAbs).catch(() => null as Buffer | null),
    ]);
    if (b && a.equals(b)) {
      await fs.unlink(fromAbs);
      return;
    }
    throw new Error(`mergeMove conflict: file ${fromAbs} and ${toAbs} differ`);
  }
  const children = await fs.readdir(fromAbs);
  for (const name of children) {
    const childFrom = path.join(fromAbs, name);
    const childTo = path.join(toAbs, name);
    try {
      await fs.rename(childFrom, childTo);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOTEMPTY" || err.code === "EEXIST") {
        await mergeMove(childFrom, childTo);
      } else {
        throw e;
      }
    }
  }
  await fs.rmdir(fromAbs);
}

async function removeEmptyDirsRecursively(dirAbs: string): Promise<void> {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      await removeEmptyDirsRecursively(path.join(dirAbs, e.name));
    }
  }
  try {
    const remaining = await fs.readdir(dirAbs);
    if (remaining.length === 0) {
      await fs.rmdir(dirAbs);
    }
  } catch {
    // already gone
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
