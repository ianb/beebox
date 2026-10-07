import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getStatus } from "../../../../../lib/git/core/operations.js";
import { stageAndCommitPaths } from "../../../../../lib/git/core/operations.js";
import type { ChatHuskEntry } from "../../../husk-read.js";
import type { SessionStorageState } from "./storage.js";

export interface HuskCleanupOptions {
  boxRoot: string;
  sessionId: string;
  husks: ChatHuskEntry[];
  storage: SessionStorageState;
  commit?: typeof stageAndCommitPaths;
  remove?: typeof rm;
}

export type HuskCleanupResult =
  | { complete: true }
  | { complete: false; retry: "delete-husk" };

/** Permanently remove chat cards after transcript deletion, committing tracked removals. */
export async function finishDeletedHusks(options: HuskCleanupOptions): Promise<HuskCleanupResult> {
  const remove = options.remove ?? rm;
  const commit = options.commit ?? stageAndCommitPaths;
  const paths: string[] = [];
  const statePath = join(options.boxRoot, `.beebox/chat-delete/${encodeURIComponent(options.sessionId)}.json`);
  const stateMarker = { deleteChatCardPaths: options.husks.map((husk) => husk.path) };
  if (options.husks.length > 0) {
    await mkdir(join(options.boxRoot, ".beebox/chat-delete"), { recursive: true });
    await writeFile(statePath, JSON.stringify(stateMarker));
  }
  try {
    for (const husk of options.husks) {
      const cardPath = join(options.boxRoot, husk.path);
      const exists = await access(cardPath).then(() => true, () => false);
      if (exists) await remove(cardPath, { force: true });
      paths.push(husk.path);
      const attachPath = `${husk.path.slice(0, -".chat.card".length)}.attach`;
      await remove(join(options.boxRoot, attachPath), { recursive: true, force: true });
      paths.push(attachPath);
    }
  } catch (error) {
    console.error("chat-delete: card deletion failed after transcript deletion", { error });
    return { complete: false, retry: "delete-husk" };
  }

  if (paths.length === 0) {
    await remove(statePath, { force: true });
    return { complete: true };
  }
  // Stage only paths that exist in the index, so first-attempt deletion of an
  // uncommitted chat card needs no commit and cannot fail on a missing pathspec.
  const status = await getStatus(options.boxRoot);
  const changed = new Set([...status.staged, ...status.modified]);
  const tracked = paths.filter((target) => changed.has(target) || [...changed].some((candidate) => candidate.startsWith(`${target}/`)));
  if (tracked.length === 0) {
    await remove(statePath, { force: true });
    return { complete: true };
  }
  try {
    await commit(options.boxRoot, { paths: tracked, message: "Delete chat conversation" });
    await remove(statePath, { force: true });
    return { complete: true };
  } catch (error) {
    console.error("chat-delete: card deletion commit failed after transcript deletion", { error });
    return { complete: false, retry: "delete-husk" };
  }
}
