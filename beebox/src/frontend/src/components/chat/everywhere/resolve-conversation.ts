/** Reuse bootstrap/reservation/directory resolution as one shell-owned operation. */
import type { ConversationSelection, ConversationTarget } from "@shared/chat-composer-binding";
import type { trpc, RouterOutput } from "../../../lib/trpc/client";
import { chatTailSlice, type ChatInitialLoad } from "../../../machines/chat-types";
import type { ChatAgentEngine } from "@shared/chat-models";
import type { ReservationReceipt, ReservationReceipts } from "./reservation-receipts";
import { createReservationRecovery, ReservationRecoveryUnsupportedError } from "./reservation-recovery";

type Utils = ReturnType<typeof trpc.useUtils>;
type Bootstrap = RouterOutput["chat"]["bootstrap"];
export interface ConversationRequest {
  kind: "session" | "landmark" | "card" | "default" | "new" | "restore";
  target?: ConversationTarget;
  label?: string;
  sessionId?: string;
  contextDir?: string;
  cardPath?: string;
  engine?: ChatAgentEngine;
  model?: string;
}
export interface ResolvedConversation {
  selection: ConversationSelection;
  initial?: ChatInitialLoad;
  /**
   * The resolver created this conversation for this tab and nobody has written
   * in it yet: a `start` target, or a session that still holds this tab's
   * reservation receipt. An existing session with no entries and no receipt is
   * not unstarted (issues/closed/bugs/2026-09-21-fresh-chat-reservation-suppresses-openers.md).
   */
  unstarted: boolean;
}
type Reserve = (input: { sessionId: string; contextDir: string; engine?: ChatAgentEngine; model?: string }) => Promise<RouterOutput["chat"]["reserveSession"]>;
function preload(data: RouterOutput["chat"]["bootstrap"]): ChatInitialLoad | undefined {
  if (data.kind !== "resumable") return undefined;
  return { status: "loaded", entries: data.history.entries, total: data.history.total,
    sessionId: data.sessionId, running: data.status.running, busy: data.status.busy, pending: data.pending };
}
async function restoreBeforeBootstrap(params: {
  sessionId: string | undefined;
  contextDir: string;
  ensureReservation: (sessionId: string) => Promise<ReservationReceipt | null>;
}): Promise<{ contextDir: string; receipt: ReservationReceipt | null; failed: boolean }> {
  if (params.sessionId === undefined) return { contextDir: params.contextDir, receipt: null, failed: false };
  try {
    const receipt = await params.ensureReservation(params.sessionId);
    return { contextDir: receipt?.contextDir ?? params.contextDir, receipt, failed: false };
  } catch (error) {
    // The id may have become a real chat since the receipt was written. Let
    // bootstrap prove that before turning a recovery transport error into the
    // selected conversation's error state.
    console.warn("Conversation reservation could not be recovered", error);
    return { contextDir: params.contextDir, receipt: null, failed: !(error instanceof ReservationRecoveryUnsupportedError) };
  }
}
async function fresh(params: { utils: Utils; reserve: Reserve; receipts: ReservationReceipts | null; request: ConversationRequest; contextDir: string }): Promise<ResolvedConversation> {
  const { utils, reserve, receipts, request, contextDir } = params;
  const status = await utils.chat.status.fetch({});
  const engine = request.engine ?? status.boxEngine;
  if (engine === "claude" && receipts !== null) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reserved = await reserve({ sessionId: crypto.randomUUID(), contextDir, engine, model: request.model });
      if (reserved.kind === "reserved") {
        try { receipts.put({ sessionId: reserved.sessionId, contextDir, engine,
          ...(request.model !== undefined ? { model: request.model } : {}) }); }
        catch (error) {
          console.warn("Conversation reservation receipt could not be saved", error);
          break;
        }
        return { unstarted: true, selection: { kind: "ready", label: "New conversation", target: { kind: "session", sessionId: reserved.sessionId, contextDir } } };
      }
      if (reserved.kind === "unsupported") break;
    }
  }
  const features = await utils.chat.newFeatures.fetch({ contextDir });
  return { unstarted: true, selection: { kind: "ready", label: "New conversation", target: {
    kind: "start", clientConversationId: crypto.randomUUID(), contextDir, engine,
    ...(request.model ? { model: request.model } : {}), seedFeatures: features,
  } } };
}
/**
 * A load always lands on a usable chat: a session this box cannot open (never
 * created, expired, ran elsewhere, being deleted) is replaced by a new one in
 * the same place. The conversation menu is how the person picks another.
 */
function replaceMissing(input: { params: Parameters<typeof resolveConversation>[0]; contextDir: string;
  session: string | undefined; reason: string }): Promise<ResolvedConversation> {
  if (input.session !== undefined) console.warn(`Conversation ${input.session} could not be opened (${input.reason}); starting a new one`);
  return fresh({ ...input.params, contextDir: input.contextDir });
}
function retireUsedReceipt(data: Extract<Bootstrap, { kind: "resumable" }>, receipts: ReservationReceipts | null): void {
  if (data.history.total === 0) return;
  try { receipts?.remove(data.sessionId); }
  catch (error) { console.warn("Conversation reservation receipt could not be removed", error); }
}
/** A remembered target: a `start` has had no first send; a session is unstarted while this tab holds its receipt. */
function restoreTarget(input: { target: ConversationTarget; label: string | undefined }, receipts: ReservationReceipts | null): ResolvedConversation {
  const { target } = input;
  const unstarted = target.kind === "start" || receipts?.get(target.sessionId) !== undefined;
  return { unstarted, selection: { kind: "ready", target, label: input.label ?? "New conversation" } };
}
/** A bootstrapped session is unstarted only when it is empty and still holds this tab's receipt (read after `retireUsedReceipt`). */
function resumed(data: Extract<Bootstrap, { kind: "resumable" }>, receipts: ReservationReceipts | null): ResolvedConversation {
  const unstarted = data.history.total === 0 && receipts?.get(data.sessionId) !== undefined;
  const label = data.label ?? (unstarted ? "New conversation" : "Conversation");
  return { unstarted, selection: { kind: "ready", label, target: {
    kind: "session", sessionId: data.sessionId, contextDir: data.contextDir,
  } }, initial: preload(data) };
}
export async function resolveConversation(params: { utils: Utils; reserve: Reserve; receipts: ReservationReceipts | null; request: ConversationRequest;
  ensureReservation?: (sessionId: string) => Promise<ReservationReceipt | null> }): Promise<ResolvedConversation> {
  const { utils, request } = params;
  if (request.kind === "restore" && request.target) return restoreTarget({ target: request.target, label: request.label }, params.receipts);
  let contextDir = request.contextDir ?? "";
  let session = request.sessionId;
  if (request.kind === "card" && request.cardPath) {
    const resolved = await utils.chat.openForCard.fetch({ cardPath: request.cardPath });
    contextDir = resolved.contextDir;
    session = resolved.sessionId ?? undefined;
  } else if (request.kind === "landmark") {
    session = (await utils.chat.lastSessionForDirectory.fetch({ contextDir })).sessionId ?? undefined;
  }
  if (request.kind === "new" || (request.kind !== "default" && !session)) return fresh({ ...params, contextDir });
  // A receipt names the place this tab reserved the chat in; a replacement stays there too.
  const provenReceipt = session === undefined ? undefined : params.receipts?.get(session);
  if (provenReceipt !== undefined) contextDir = provenReceipt.contextDir;
  const ensureReservation = params.ensureReservation ?? createReservationRecovery(params.receipts, params.reserve);
  const restored = await restoreBeforeBootstrap({ sessionId: session, contextDir, ensureReservation });
  contextDir = restored.contextDir;
  const bootstrap = () => utils.chat.bootstrap.fetch({ session, slice: chatTailSlice() }, { staleTime: 0 });
  let data: Bootstrap = await bootstrap();
  // Recovery failed (say, the box was restarting) and the chat is not there
  // without it. Bootstrap just answered, so the box is up: recover once more
  // before replacing a chat this tab holds a receipt for. A second transport
  // failure throws; the person sees it with Retry, not a different chat.
  if (data.kind !== "resumable" && restored.failed && session !== undefined) {
    const receipt = await ensureReservation(session).catch((error: unknown) => {
      if (error instanceof ReservationRecoveryUnsupportedError) return null;
      throw error;
    });
    if (receipt !== null) data = await bootstrap();
  }
  if (data.kind === "empty") return replaceMissing({ params, contextDir, session, reason: "no transcript" });
  if (data.kind === "unavailable") return replaceMissing({ params, contextDir, session, reason: data.reason });
  retireUsedReceipt(data, params.receipts);
  // Bootstrap answers the session's directory too, read after any reservation
  // recovery above. Seeding the `chat.directoryFor` cache saves the chat's own
  // binding query (InteractiveChat's useChatBinding) the round trip as well.
  utils.chat.directoryFor.setData({ sessionId: data.sessionId }, { contextDir: data.contextDir });
  return resumed(data, params.receipts);
}
