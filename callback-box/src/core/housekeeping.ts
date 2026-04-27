/**
 * Housekeeping tasks that run during sync.
 *
 * These are deterministic cleanup operations that don't require
 * an agent — they can run automatically before job processing.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CardLoader } from "cardworks";
import { stageFiles, commit } from "../cli/lib/git.js";
import { getBoxTime } from "../cli/lib/time.js";

/**
 * Expire old briefs by moving them to the archive.
 *
 * Briefs older than 7 days are automatically moved to store/archive/briefs/
 * with read-reason="expired" to distinguish them from user-read briefs.
 */
export async function expireOldBriefs(
  boxRoot: string,
  onLog?: (msg: string) => void,
): Promise<number> {
  const EXPIRY_DAYS = 7;
  const now = getBoxTime(boxRoot).getTime();
  const expiryMs = EXPIRY_DAYS * 24 * 60 * 60 * 1000;

  const unreadDir = path.join(boxRoot, "box/output/briefs");
  const archiveDir = path.join(boxRoot, "store/archive/briefs");

  let files: string[];
  try {
    files = await fs.readdir(unreadDir);
  } catch {
    return 0;
  }

  const briefFiles = files.filter((f) => f.endsWith(".news-brief.card"));
  if (briefFiles.length === 0) {
    return 0;
  }

  const filesToStage: string[] = [];
  const expiredNotes: Array<{ name: string; ageDays: number }> = [];

  for (const file of briefFiles) {
    const fullPath = path.join(unreadDir, file);

    const stat = await fs.stat(fullPath);
    const age = now - stat.mtimeMs;

    if (age > expiryMs) {
      const ageDays = Math.floor(age / (24 * 60 * 60 * 1000));
      onLog?.(`  Expiring: ${file} (${ageDays} days old)`);

      // Add expiry attributes to the card
      try {
        const loader = new CardLoader(boxRoot);
        const card = await loader.load(fullPath);
        card.element.attrs["read-at"] = getBoxTime(boxRoot).toISOString();
        card.element.attrs["read-reason"] = "expired";
        await loader.save(card);
      } catch (err) {
        onLog?.(`    Warning: Could not update card attributes: ${(err as Error).message}`);
      }

      // Move to archive
      await fs.mkdir(archiveDir, { recursive: true });
      const newPath = path.join(archiveDir, file);
      await fs.rename(fullPath, newPath);

      filesToStage.push(`box/output/briefs/${file}`);
      filesToStage.push(`store/archive/briefs/${file}`);

      const briefName = file
        .replace(/\.news-brief\.card$/, "")
        .replace(/^\d{4}-\d{2}-\d{2}[T_]?/, "")
        .replace(/_/g, " ")
        .trim() || file;
      expiredNotes.push({ name: briefName, ageDays });
    }
  }

  if (expiredNotes.length === 0) {
    return 0;
  }

  // Stage and commit
  await stageFiles(boxRoot, filesToStage);
  const expireLines = [
    `Expire ${expiredNotes.length} old brief${expiredNotes.length === 1 ? "" : "s"}`,
    "",
  ];
  for (const note of expiredNotes.slice(0, 5)) {
    expireLines.push(`- ${note.name} (${note.ageDays} days old)`);
  }
  if (expiredNotes.length > 5) {
    expireLines.push(`  + ${expiredNotes.length - 5} more`);
  }
  await commit(boxRoot, {
    message: expireLines.join("\n"),
    trailers: {
      "Triggered-By": "cb wakeup",
      Phase: "housekeeping",
      "Briefs-Expired": String(expiredNotes.length),
    },
  });

  onLog?.(`  Expired ${expiredNotes.length} brief(s)`);
  return expiredNotes.length;
}

/**
 * Sweep transient chat-upload files from <boxRoot>/tmp/.
 *
 * The chat composer uploads files here before referencing them in messages.
 * Once the agent has read them, they linger — this removes anything older
 * than 7 days. The directory itself is gitignored, so no commit is needed.
 */
export async function cleanupOldTmpUploads(
  boxRoot: string,
  onLog?: (msg: string) => void,
): Promise<number> {
  const EXPIRY_DAYS = 7;
  const now = getBoxTime(boxRoot).getTime();
  const expiryMs = EXPIRY_DAYS * 24 * 60 * 60 * 1000;

  const tmpDir = path.join(boxRoot, "tmp");
  let entries: string[];
  try {
    entries = await fs.readdir(tmpDir);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const entry of entries) {
    const fullPath = path.join(tmpDir, entry);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (now - stat.mtimeMs <= expiryMs) continue;

    try {
      await fs.unlink(fullPath);
      removed++;
      const ageDays = Math.floor((now - stat.mtimeMs) / (24 * 60 * 60 * 1000));
      onLog?.(`  Removed: tmp/${entry} (${ageDays} days old)`);
    } catch (err) {
      onLog?.(`  Warning: could not remove tmp/${entry}: ${(err as Error).message}`);
    }
  }

  if (removed > 0) {
    onLog?.(`  Removed ${removed} stale upload(s) from tmp/`);
  }
  return removed;
}
