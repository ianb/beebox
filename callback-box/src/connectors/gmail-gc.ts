/**
 * Gmail garbage collection — reconcile pending inbox threads against Gmail.
 *
 * Closes the otherwise one-way loop: when a thread's triggering label is
 * removed upstream (the user archives it, drops the label, etc.) the box still
 * holds a pending card under `box/inbox/email/`. This pass full-lists the
 * currently-matching messages, derives the set of matching Gmail *thread* ids,
 * and trashes the pending threads whose id is no longer in that set.
 *
 * Safety — *location is state*: only thread cards still sitting directly in
 * `box/inbox/email/` are candidates. The moment an agent acts on a thread it is
 * moved out (`store/archive/`, `store/`, `store/trash/`), making it invisible
 * here — so GC never touches a thread the user has already engaged, nor the
 * replies/jobs/downstream cards an agent spawned elsewhere. The join is the
 * Gmail *thread* id (`thread-id` on the card): `seenGmailIds` is keyed by
 * *message* id with no on-disk card→message-id link, so reconciliation works at
 * thread granularity. Withdrawn threads keep their seen ids — re-applying the
 * label does not auto-reimport (the common case is "archived, don't want it
 * back").
 *
 * Withdrawn threads move to `store/trash/` (reversible, greppable) via the same
 * rename scheme as `cb rm` (see core/commands/trash.ts); their refs are pruned
 * from any pending intake job. A pass that withdraws nothing makes no commit
 * and prints nothing.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { renderFrontmatterBlock, splitCardContent } from "../cards/index.js";
import { attachDirFor } from "../shared/attach-path.js";
import { getBoxDir } from "../cli/lib/paths.js";
import { stageFiles, commit } from "../cli/lib/git.js";
import type { GoogleGmailService } from "../services/google-gmail.js";
import { buildGmailQuery, listAllMatching, type GmailPullConfig } from "./gmail-pull.js";

interface ReconcileResult {
  /** Box-root-relative paths of the thread cards withdrawn to trash. */
  withdrawn: string[];
}

/** Parse a card/job file's frontmatter into a plain object (best-effort). */
function frontmatterOf(content: string): Record<string, unknown> {
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return {};
  const parsed: unknown = parseYaml(split.frontmatterText);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

/** Read a thread card's `thread-id`, or null if unreadable / absent. */
async function readThreadId(cardAbs: string): Promise<string | null> {
  let content: string;
  try {
    content = await fs.readFile(cardAbs, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Gmail GC: could not read thread card ${cardAbs}:`, e);
    }
    return null;
  }
  const threadId = frontmatterOf(content)["thread-id"];
  return typeof threadId === "string" ? threadId : null;
}

/** Resolve a non-colliding trash destination, mirroring core/commands/trash.ts. */
async function freeTrashDest(dest: string): Promise<string> {
  try {
    await fs.access(dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return dest;
    throw e;
  }
  const stamp = new Date().toISOString().replaceAll(/[.:]/g, "-");
  const ext = ".email-thread.card";
  return dest.endsWith(ext) ? `${dest.slice(0, -ext.length)}_${stamp}${ext}` : `${dest}_${stamp}`;
}

/**
 * Move a thread card and its `.attach/` scope to `store/trash/`. Returns the
 * box-root-relative paths to stage (old + new, so the rename is captured).
 */
async function trashThread(opts: { boxRoot: string; cardAbs: string }): Promise<string[]> {
  const { boxRoot, cardAbs } = opts;
  const trashDir = getBoxDir(boxRoot, "trash");
  await fs.mkdir(trashDir, { recursive: true });

  const destCard = await freeTrashDest(path.join(trashDir, path.basename(cardAbs)));
  await fs.rename(cardAbs, destCard);
  const staged = [path.relative(boxRoot, cardAbs), path.relative(boxRoot, destCard)];

  const srcAttach = attachDirFor(cardAbs);
  try {
    await fs.access(srcAttach);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return staged;
    throw e;
  }
  const destAttach = attachDirFor(destCard);
  await fs.rename(srcAttach, destAttach);
  staged.push(path.relative(boxRoot, srcAttach), path.relative(boxRoot, destAttach));
  return staged;
}

/**
 * Drop the withdrawn threads' refs from every pending intake job. A job left
 * with no items is itself trashed. Returns box-root-relative paths to stage.
 */
async function pruneJobRefs(boxRoot: string, removedRefs: string[]): Promise<string[]> {
  const removed = new Set(removedRefs);
  const jobsDir = path.join(boxRoot, "box/jobs");
  let files: string[];
  try {
    files = await fs.readdir(jobsDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }

  const staged: string[] = [];
  for (const file of files) {
    if (!file.endsWith("job.card")) continue;
    const abs = path.join(jobsDir, file);
    const content = await fs.readFile(abs, "utf-8");
    const split = splitCardContent(content);
    const fm = frontmatterOf(content);
    const items = fm["items"];
    if (!Array.isArray(items)) continue;

    const kept = items.filter(
      (it) => !(it && typeof it === "object" && removed.has(refOf(it))),
    );
    if (kept.length === items.length) continue;

    if (kept.length === 0) {
      staged.push(...(await trashCard({ boxRoot, cardAbs: abs })));
      continue;
    }
    fm["items"] = kept;
    await fs.writeFile(abs, renderFrontmatterBlock(fm, split.body));
    staged.push(path.relative(boxRoot, abs));
  }
  return staged;
}

/** Extract a `{ ref }` item's path, or "" for anything malformed. */
function refOf(item: unknown): string {
  if (item && typeof item === "object" && "ref" in item) {
    const ref = (item as { ref?: unknown }).ref;
    return typeof ref === "string" ? ref : "";
  }
  return "";
}

/** Move a plain card (no attach scope assumed) to trash; stage old + new. */
async function trashCard(opts: { boxRoot: string; cardAbs: string }): Promise<string[]> {
  const { boxRoot, cardAbs } = opts;
  const trashDir = getBoxDir(boxRoot, "trash");
  await fs.mkdir(trashDir, { recursive: true });
  const dest = path.join(trashDir, path.basename(cardAbs));
  await fs.rename(cardAbs, dest);
  return [path.relative(boxRoot, cardAbs), path.relative(boxRoot, dest)];
}

/**
 * Reconcile pending `box/inbox/email/` threads against the connector's current
 * Gmail match set, withdrawing orphans to trash. Quiet and side-effect-free
 * when there is nothing to withdraw.
 */
export async function reconcileOrphans(opts: {
  boxRoot: string;
  service: GoogleGmailService;
  config: GmailPullConfig;
}): Promise<ReconcileResult> {
  const { boxRoot, service, config } = opts;
  const emailDir = path.join(boxRoot, "box/inbox/email");

  let entries: string[];
  try {
    entries = await fs.readdir(emailDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { withdrawn: [] };
    throw e;
  }
  const threadCards = entries.filter((e) => e.endsWith(".email-thread.card"));
  if (threadCards.length === 0) return { withdrawn: [] };

  const refs = await listAllMatching(service, buildGmailQuery(config));
  const matchingThreadIds = new Set(refs.map((r) => r.threadId));

  const orphanCards: string[] = [];
  for (const file of threadCards) {
    const cardAbs = path.join(emailDir, file);
    const threadId = await readThreadId(cardAbs);
    if (threadId === null) continue; // unreadable / no id — leave it (conservative)
    if (!matchingThreadIds.has(threadId)) orphanCards.push(cardAbs);
  }
  if (orphanCards.length === 0) return { withdrawn: [] };

  const withdrawn: string[] = [];
  const staged: string[] = [];
  for (const cardAbs of orphanCards) {
    withdrawn.push(path.relative(boxRoot, cardAbs));
    staged.push(...(await trashThread({ boxRoot, cardAbs })));
  }
  staged.push(...(await pruneJobRefs(boxRoot, withdrawn)));

  await stageFiles(boxRoot, staged);
  await commit(boxRoot, {
    message: `gmail: withdraw ${withdrawn.length} thread${withdrawn.length === 1 ? "" : "s"} (label removed upstream)`,
    trailers: { "Withdrawn-By": "gmail-connector" },
  });

  return { withdrawn };
}
