/**
 * Load the real cards and files a view receives from its dependency globs.
 *
 * Shared by the `/api/views/:slug/cards` route (the running app) and the
 * `cb view test` command, so both feed a view provably the same data. Glob each
 * dependency pattern, parse `.card` files into ViewCard, list non-card files,
 * deep-list each card's attach scope, and annotate git working-tree status.
 *
 * Unlike the route's original inline version, this also reports cards that
 * matched a dependency glob but failed to load (`skipped`) — the route ignores
 * that list (a live page silently omits a broken card), but `cb view test`
 * surfaces it as author feedback.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { glob } from "glob";
import { loadCardFile } from "../card-io.js";
import { buildLoadContext } from "../load-context.js";
import { getStatus, gitBoxPrefix, isRepo } from "../../lib/git.js";
import { fileEtag } from "../../webapp/file-etag.js";
import { attachDirFor } from "../../shared/attach-path.js";
import type { ViewCard, ViewFile } from "./types.js";

/** A card whose dependency glob matched but that failed to load. */
export interface SkippedCard {
  path: string;
  error: string;
}

export interface ViewCardsResult {
  cards: ViewCard[];
  files: ViewFile[];
  /** Cards that matched a dependency glob but failed to load. Empty in the happy path. */
  skipped: SkippedCard[];
}

/**
 * Resolve a view's `dependencies` globs to the cards and files it renders.
 * `boxRoot` is the box directory; `dependencies` are the view's glob patterns.
 */
export async function loadViewCards(boxRoot: string, dependencies: string[]): Promise<ViewCardsResult> {
  if (dependencies.length === 0) {
    return { cards: [], files: [], skipped: [] };
  }

  // Collect matching files from all dependency globs: cards parse into
  // ViewCard; everything else (attachments, .md, .jsonl, ...) arrives as
  // metadata in `files`.
  const cardPaths = new Set<string>();
  const filePaths = new Set<string>();
  for (const pattern of dependencies) {
    const matches = await glob(pattern, { cwd: boxRoot, nodir: true });
    for (const m of matches) {
      if (m.endsWith(".card")) cardPaths.add(m);
      else filePaths.add(m);
    }
  }

  const ctx = await buildLoadContext(boxRoot);
  const cards: ViewCard[] = [];
  const skipped: SkippedCard[] = [];

  for (const relPath of cardPaths) {
    try {
      const absPath = path.join(boxRoot, relPath);
      const loaded = await loadCardFile(absPath, ctx);
      const viewCard = frontmatterViewCard(relPath, loaded.fields);
      const attachments = await listAttachments(boxRoot, relPath);
      if (attachments.length > 0) {
        viewCard.attachments = attachments;
      }
      cards.push(viewCard);
    } catch (e) {
      // The route omits broken cards silently; we additionally record them so
      // `cb view test` can report "your dependency selected an invalid card".
      skipped.push({ path: relPath, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const files: ViewFile[] = [];
  for (const relPath of [...filePaths].toSorted()) {
    const meta = await statViewFile(boxRoot, relPath);
    if (meta !== null) files.push(meta);
  }

  // Annotate git working-tree state so views can show unsaved/uncommitted
  // indicators and decide when to offer a commit affordance.
  const gitStatusOf = await buildGitStatusLookup(boxRoot);
  if (gitStatusOf !== null) {
    for (const file of files) annotateGitStatus(file, gitStatusOf);
    for (const card of cards) {
      for (const att of card.attachments ?? []) annotateGitStatus(att, gitStatusOf);
    }
  }

  return { cards, files, skipped };
}

/** Phase-2 card → ViewCard: parsed fields in `frontmatter`, body split out. */
function frontmatterViewCard(relPath: string, fields: Record<string, unknown>): ViewCard {
  const frontmatter: Record<string, unknown> = {};
  let body: string | undefined;
  for (const [key, value] of Object.entries(fields)) {
    if (key === "type") continue;
    if (key === "body") {
      // The body field is always named `body` — enforced by cardSchema().
      if (typeof value === "string") body = value;
      continue;
    }
    frontmatter[key] = value;
  }
  const type = fields["type"];
  const viewCard: ViewCard = {
    path: relPath,
    type: typeof type === "string" ? type : "",
    frontmatter,
  };
  if (body !== undefined) viewCard.body = body;
  return viewCard;
}

type GitStatusLookup = (relPath: string) => "dirty" | "untracked" | null;

/**
 * One repo-wide status call mapped to a per-path lookup. Untracked entries
 * from porcelain can be whole directories ("?? new-dir/"), so untracked
 * matching is prefix-aware; dirty (modified/staged) entries are exact.
 */
async function buildGitStatusLookup(boxRoot: string): Promise<GitStatusLookup | null> {
  if (!(await isRepo(boxRoot))) return null;
  const status = await getStatus(boxRoot);
  // getStatus paths are repo-root-relative; a v2 box's repo root is the
  // package root, so they carry a `content/` prefix while `file.path` (the
  // lookup key) is box-relative. Strip the prefix so both frames match —
  // without this, no view file is ever annotated dirty/untracked on a v2 box.
  const prefix = await gitBoxPrefix(boxRoot);
  const strip = (p: string): string => (prefix !== "" && p.startsWith(prefix) ? p.slice(prefix.length) : p);
  const dirty = new Set([...status.modified, ...status.staged].map(strip));
  const untracked = status.untracked.map(strip);
  return (relPath: string) => {
    if (dirty.has(relPath)) return "dirty";
    for (const entry of untracked) {
      if (entry === relPath || (entry.endsWith("/") && relPath.startsWith(entry))) {
        return "untracked";
      }
    }
    return null;
  };
}

function annotateGitStatus(file: ViewFile, lookup: GitStatusLookup): void {
  const status = lookup(file.path);
  if (status !== null) file.gitStatus = status;
}

/** Stat one file into ViewFile metadata; null when it vanished mid-request. */
async function statViewFile(boxRoot: string, relPath: string): Promise<ViewFile | null> {
  try {
    const st = await fs.stat(path.join(boxRoot, relPath));
    if (!st.isFile()) return null;
    return { path: relPath, size: st.size, mtimeMs: st.mtimeMs, etag: fileEtag(st) };
  } catch (_e) {
    return null;
  }
}

/**
 * Deep metadata listing of a card's attach scope (box-relative paths with
 * size/mtime) — so a view can discover e.g. ".../sessions/history.jsonl"
 * next to its card and fetch it via readFile()/fileUrl(). Metadata only:
 * attachments can be huge or binary, so content is never inlined here.
 */
async function listAttachments(boxRoot: string, cardRelPath: string): Promise<ViewFile[]> {
  const scopeRel = attachDirFor(cardRelPath);
  const scopeAbs = path.join(boxRoot, scopeRel);
  const out: ViewFile[] = [];
  async function walk(absDir: string, relPrefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch (_e) {
      return; // no attach scope — the common case
    }
    for (const entry of entries) {
      const rel = relPrefix === "" ? entry.name : `${relPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path.join(absDir, entry.name), rel);
      } else if (entry.isFile()) {
        const meta = await statViewFile(boxRoot, `${scopeRel}/${rel}`);
        if (meta !== null) out.push(meta);
      }
    }
  }
  await walk(scopeAbs, "");
  return out.toSorted((a, b) => a.path.localeCompare(b.path));
}
