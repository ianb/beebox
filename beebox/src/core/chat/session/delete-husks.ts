import {
  commitTrashReceipt,
  moveCardsToTrash,
  type TrashReceipt,
} from "../../commands/trash.js";
import { recoverTrashReceipt } from "../../commands/trash-recovery.js";
import type { ChatHuskEntry } from "../husk-read.js";
import type { ChatSessionRegistry } from "./registry.js";
import type { SessionStorageState } from "./delete-storage.js";

class HuskTrashMoveError extends Error {
  constructor(
    readonly receipt: TrashReceipt,
    readonly cause: unknown,
  ) {
    super("Could not move every chat card to Trash");
    this.name = "HuskTrashMoveError";
  }
}

export interface HuskCleanupOptions {
  boxRoot: string;
  sessionId: string;
  registry: ChatSessionRegistry;
  active: ChatHuskEntry[];
  trashed: ChatHuskEntry[];
  storage: SessionStorageState;
  moveToTrash?: typeof moveCardsToTrash;
  commitTrash?: typeof commitTrashReceipt;
  recoverTrash?: typeof recoverTrashReceipt;
}

export type HuskCleanupResult =
  | { complete: true }
  | {
      complete: false;
      retry: "trash-husk" | "commit-trash";
      huskTrashed: boolean;
      commitPending: boolean;
    };

const pendingTrashReceipts = new WeakMap<ChatSessionRegistry, Map<string, TrashReceipt>>();

function pendingReceiptsFor(registry: ChatSessionRegistry): Map<string, TrashReceipt> {
  const existing = pendingTrashReceipts.get(registry);
  if (existing !== undefined) return existing;
  const created = new Map<string, TrashReceipt>();
  pendingTrashReceipts.set(registry, created);
  return created;
}

async function trashActiveHusks(options: {
  boxRoot: string;
  husks: ChatHuskEntry[];
  moveToTrash: typeof moveCardsToTrash;
}): Promise<TrashReceipt> {
  const combined: TrashReceipt = { moves: [], gitPaths: [] };
  const ctx = {
    boxRoot: options.boxRoot,
    write: (_text: string) => {},
    writeLine: (_text: string) => {},
  };
  for (const husk of options.husks) {
    try {
      const receipt = await options.moveToTrash(ctx, [husk.path]);
      combined.moves.push(...receipt.moves);
      combined.gitPaths.push(...receipt.gitPaths);
    } catch (error) {
      throw new HuskTrashMoveError(combined, error);
    }
  }
  return combined;
}

function cleanupResult(options: { retry: "trash-husk" | "commit-trash"; receipt: TrashReceipt; commitPending: boolean }): HuskCleanupResult {
  return { complete: false, retry: options.retry, huskTrashed: options.receipt.moves.length > 0, commitPending: options.commitPending };
}

/** Finish the recoverable card move after irreversible SDK storage deletion. */
export async function finishDeletedHusks(options: HuskCleanupOptions): Promise<HuskCleanupResult> {
  const pending = pendingReceiptsFor(options.registry);
  const moveToTrash = options.moveToTrash ?? moveCardsToTrash;
  const commitTrash = options.commitTrash ?? commitTrashReceipt;
  const recoverTrash = options.recoverTrash ?? recoverTrashReceipt;
  let receipt = pending.get(options.sessionId) ?? { moves: [], gitPaths: [] };
  if (receipt.moves.length === 0 && options.active.length === 0 && options.trashed.length > 0) {
    try {
      receipt = await recoverTrash(
        options.boxRoot,
        options.trashed.map((husk) => husk.path),
      );
    } catch (error) {
      console.error("chat-delete: could not recover pending trash commit", { sessionId: options.sessionId, error });
      return { complete: false, retry: "commit-trash", huskTrashed: true, commitPending: true };
    }
  }
  try {
    const moved = await trashActiveHusks({ boxRoot: options.boxRoot, husks: options.active, moveToTrash });
    receipt = { moves: [...receipt.moves, ...moved.moves], gitPaths: [...receipt.gitPaths, ...moved.gitPaths] };
  } catch (error) {
    const partial = error instanceof HuskTrashMoveError ? error.receipt : { moves: [], gitPaths: [] };
    receipt = { moves: [...receipt.moves, ...partial.moves], gitPaths: [...receipt.gitPaths, ...partial.gitPaths] };
    if (receipt.moves.length > 0) {
      try {
        await commitTrash(options.boxRoot, { receipt, reason: "Deleted chat conversation" });
      } catch (commitError) {
        pending.set(options.sessionId, receipt);
        console.error("chat-delete: partial husk move commit failed", { sessionId: options.sessionId, commitError });
      }
    }
    console.error("chat-delete: husk move failed after transcript deletion", { sessionId: options.sessionId, error });
    return cleanupResult({ retry: "trash-husk", receipt, commitPending: pending.has(options.sessionId) });
  }
  try {
    if (receipt.moves.length > 0) await commitTrash(options.boxRoot, { receipt, reason: "Deleted chat conversation" });
    pending.delete(options.sessionId);
    return { complete: true };
  } catch (error) {
    pending.set(options.sessionId, receipt);
    console.error("chat-delete: trash commit failed after transcript deletion", { sessionId: options.sessionId, error });
    return cleanupResult({ retry: "commit-trash", receipt, commitPending: true });
  }
}
