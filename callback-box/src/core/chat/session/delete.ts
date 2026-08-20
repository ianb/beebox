import { BOX_DIRS } from "../../../lib/paths.js";
import type { commitTrashReceipt, moveCardsToTrash } from "../../commands/trash.js";
import type { recoverTrashReceipt } from "../../commands/trash-recovery.js";
import { listChatHusks, listChatHusksUnder, type ChatHuskEntry } from "../husk.js";
import { acquireChatReviewLease } from "../review/lock.js";
import { assertReviewStateReadableForDeletion, removeSessionFromReview, restoreSessionToReview, type ReviewSessionState } from "../review/state.js";
import type { ChatScheduleManager, DetachedSchedulesReceipt } from "../schedules.js";
import {
  clearMostActiveIfMatches,
  readHistoryFile,
  removeSessionFromHistory,
  restoreMostActiveIfEmpty,
  restoreSessionHistoryEntries,
  type MostActiveFile,
  type SessionHistoryEntry,
} from "./history.js";
import { deleteSdkSessionStorage, inspectSessionStoragePresence, resolveSessionStorageTargets, type DeleteStorageOptions, type SessionStorageState } from "./delete-storage.js";
import type { ChatSessionRegistry } from "./registry.js";
import { parseSdkSessionId } from "./session-id.js";
import { finishDeletedHusks } from "./delete-husks.js";
import { logDeletePhase } from "./delete-log.js";
import { codexSessionExists, deleteCodexSession } from "./codex-transcript.js";
import type { AgentEngine } from "../../box/config.js";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { chatModelFileForSession } from "./state.js";

async function inspectCodexStorage(boxRoot: string, sessionId: string) {
  const present = await codexSessionExists(boxRoot, sessionId);
  return { jsonl: present, sidecar: false, state: present ? "present" as const : "absent" as const };
}

export class ChatSessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`No chat card belongs to session ${sessionId}`);
    this.name = "ChatSessionNotFoundError";
  }
}

class ConflictingChatHusksError extends Error {
  constructor() {
    super("Matching chat cards disagree about their context directory");
    this.name = "ConflictingChatHusksError";
  }
}

export class SessionStorageContextMismatchError extends Error {
  constructor() {
    super("Chat card and session history disagree about the transcript directory");
    this.name = "SessionStorageContextMismatchError";
  }
}

export type DeleteChatResult =
  | { status: "deleted"; sessionId: string; schedulesCancelled: number }
  | {
      status: "cleanup-required";
      sessionId: string;
      storage: SessionStorageState;
      retry: "delete-again" | "trash-husk" | "commit-trash";
      huskTrashed: boolean;
      commitPending: boolean;
    };

export interface DeleteChatRuntime {
  registry: ChatSessionRegistry;
  scheduleManager: ChatScheduleManager;
  maintenance?: Promise<void> | undefined;
}

interface RemovedState {
  schedules: DetachedSchedulesReceipt;
  pointer: MostActiveFile | null;
  history: SessionHistoryEntry[];
  review: ReviewSessionState | null;
}

interface DeleteChatOptions {
  boxRoot: string;
  sessionId: string;
  runtime: DeleteChatRuntime;
  sdkDelete?: DeleteStorageOptions["sdkDelete"];
  moveToTrash?: typeof moveCardsToTrash;
  commitTrash?: typeof commitTrashReceipt;
  recoverTrash?: typeof recoverTrashReceipt;
}

function matchingHusks(husks: ChatHuskEntry[], sessionId: string): ChatHuskEntry[] {
  return husks.filter((husk) => husk.session === sessionId);
}

async function findAuthority(
  boxRoot: string,
  sessionId: string,
): Promise<{
  active: ChatHuskEntry[];
  trashed: ChatHuskEntry[];
  contextDir: string;
}> {
  const [activeHusks, trashedHusks] = await Promise.all([listChatHusks(boxRoot), listChatHusksUnder(boxRoot, BOX_DIRS.trash)]);
  const active = matchingHusks(activeHusks, sessionId);
  const trashed = matchingHusks(trashedHusks, sessionId);
  const authority = [...active, ...trashed];
  if (authority.length === 0) throw new ChatSessionNotFoundError(sessionId);
  const bindings = new Set(authority.map((husk) => husk.contextDir ?? ""));
  if (bindings.size !== 1) throw new ConflictingChatHusksError();
  return { active, trashed, contextDir: [...bindings][0] ?? "" };
}

async function verifyHistoryBinding(options: { boxRoot: string; sessionId: string; contextDir: string }): Promise<void> {
  const entries = (await readHistoryFile(options.boxRoot, { strict: true }))?.sessions.filter((entry) => entry.id === options.sessionId) ?? [];
  if (entries.length === 0) return;
  const bindings = new Set(entries.map((entry) => entry.contextDir ?? ""));
  if (bindings.size !== 1 || !bindings.has(options.contextDir)) throw new SessionStorageContextMismatchError();
}

async function compensate(options: { boxRoot: string; sessionId: string; runtime: DeleteChatRuntime; removed: RemovedState }): Promise<boolean> {
  const { boxRoot, sessionId, runtime, removed } = options;
  const outcomes = await Promise.allSettled([
    restoreSessionToReview(boxRoot, { sessionId, previous: removed.review }),
    restoreSessionHistoryEntries(boxRoot, removed.history),
    restoreMostActiveIfEmpty(boxRoot, removed.pointer),
    Promise.resolve().then(() => runtime.scheduleManager.restoreDetachedSchedules(removed.schedules)),
  ]);
  return outcomes.every((outcome) => outcome.status === "fulfilled");
}

/** Execute the ordered, confirmed deletion of one owned chat conversation. */
export async function deleteChatSession(options: DeleteChatOptions): Promise<DeleteChatResult> {
  const sessionId = parseSdkSessionId(options.sessionId);
  await options.runtime.maintenance;
  const authority = await findAuthority(options.boxRoot, sessionId);
  await verifyHistoryBinding({ boxRoot: options.boxRoot, sessionId, contextDir: authority.contextDir });
  const historyEntry = (await readHistoryFile(options.boxRoot, { strict: true }))?.sessions
    .find((entry) => entry.id === sessionId);
  const engine: AgentEngine = historyEntry?.engine ?? "claude";
  const targets = engine === "claude"
    ? await resolveSessionStorageTargets({ boxRoot: options.boxRoot, contextDir: authority.contextDir, sessionId })
    : null;
  const beforeStorage = targets === null
    ? await inspectCodexStorage(options.boxRoot, sessionId)
    : await inspectSessionStoragePresence(targets);
  logDeletePhase({ sessionId, phase: "preflight", detail: { storage: beforeStorage.state, activeHusks: authority.active.length, trashedHusks: authority.trashed.length } });
  const releaseReview = await acquireChatReviewLease(options.boxRoot, "chat-delete");

  try {
    await assertReviewStateReadableForDeletion(options.boxRoot);
    options.runtime.registry.deletion.begin(sessionId);
    options.runtime.scheduleManager.blockForDeletion(sessionId);
    const removedRef: { value: RemovedState | null } = { value: null };
    let schedulesCancelled = 0;
    try {
      await options.runtime.registry.deletion.stopAndRemove(sessionId);
      logDeletePhase({ sessionId, phase: "stopped" });
      const storage = await (async () => {
        const state: RemovedState = {
          schedules: { sessionId, schedules: [] },
          pointer: null,
          history: [],
          review: null,
        };
        removedRef.value = state;
        const schedules = await options.runtime.scheduleManager.detachForSession(sessionId);
        state.schedules = schedules;
        schedulesCancelled = schedules.schedules.length;
        logDeletePhase({ sessionId, phase: "schedules", detail: { removed: schedulesCancelled } });
        const pointer = await clearMostActiveIfMatches(options.boxRoot, sessionId);
        state.pointer = pointer;
        logDeletePhase({ sessionId, phase: "pointer", detail: { removed: pointer !== null } });
        const history = await removeSessionFromHistory(options.boxRoot, sessionId);
        state.history = history;
        logDeletePhase({ sessionId, phase: "history", detail: { removed: history.length } });
        const review = await removeSessionFromReview(options.boxRoot, sessionId);
        state.review = review;
        logDeletePhase({ sessionId, phase: "review", detail: { removed: review !== null } });
        const deletedStorage = targets === null
          ? await deleteCodexSession(options.boxRoot, sessionId).then(() => "absent" as const)
          : await deleteSdkSessionStorage({
            targets,
            sessionId,
            ...(options.sdkDelete === undefined ? {} : { sdkDelete: options.sdkDelete }),
          });
        logDeletePhase({ sessionId, phase: "storage", detail: { state: deletedStorage } });
        return deletedStorage;
      })();

    options.runtime.registry.deletion.finish(sessionId);
    options.runtime.scheduleManager.finishDeletion(sessionId);
    const husks = await finishDeletedHusks({
      boxRoot: options.boxRoot,
      sessionId,
      registry: options.runtime.registry,
      active: authority.active,
      trashed: authority.trashed,
      storage,
      ...(options.moveToTrash === undefined ? {} : { moveToTrash: options.moveToTrash }),
      ...(options.commitTrash === undefined ? {} : { commitTrash: options.commitTrash }),
      ...(options.recoverTrash === undefined ? {} : { recoverTrash: options.recoverTrash }),
    });
    if (!husks.complete) {
      logDeletePhase({ sessionId, phase: "husk", detail: { complete: false, retry: husks.retry } });
      return {
        status: "cleanup-required",
        sessionId,
        storage,
        retry: husks.retry,
        huskTrashed: husks.huskTrashed,
        commitPending: husks.commitPending,
      };
    }
    await rm(join(options.boxRoot, chatModelFileForSession(sessionId)), { force: true });
    logDeletePhase({ sessionId, phase: "husk", detail: { complete: true } });
    return { status: "deleted", sessionId, schedulesCancelled };
    } catch (error) {
      const afterStorage = targets === null
        ? await inspectCodexStorage(options.boxRoot, sessionId)
        : await inspectSessionStoragePresence(targets);
      const storageChanged = beforeStorage.jsonl !== afterStorage.jsonl || beforeStorage.sidecar !== afterStorage.sidecar;
      if (!storageChanged && removedRef.value !== null) {
        const restored = await compensate({
          boxRoot: options.boxRoot,
          sessionId,
          runtime: options.runtime,
          removed: removedRef.value,
        });
        if (restored) {
          options.runtime.registry.deletion.cancel(sessionId);
          console.error("chat-delete: failed before transcript deletion; state restored", { sessionId, error });
          throw error;
        }
      }
      if (!storageChanged && removedRef.value === null) {
        options.runtime.scheduleManager.finishDeletion(sessionId);
        options.runtime.registry.deletion.cancel(sessionId);
        throw error;
      }
      options.runtime.scheduleManager.finishDeletion(sessionId);
      if (afterStorage.state === "present") options.runtime.registry.deletion.cancel(sessionId);
      else options.runtime.registry.deletion.finish(sessionId);
      console.error("chat-delete: cleanup required", {
        sessionId,
        error,
        storage: afterStorage.state,
      });
      return {
        status: "cleanup-required",
        sessionId,
        storage: afterStorage.state,
        retry: "delete-again",
        huskTrashed: false,
        commitPending: false,
      };
    }
  } finally {
    await releaseReview();
  }
}
