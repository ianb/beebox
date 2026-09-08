/** Reuse bootstrap/reservation/directory resolution as one shell-owned operation. */
import type { ConversationSelection, ConversationTarget } from "@shared/chat-composer-binding";
import type { trpc, RouterOutput } from "../../../lib/trpc";
import { chatTailSlice, type ChatInitialLoad } from "../../../machines/chat-types";
import type { ChatAgentEngine } from "@shared/chat-models";
import type { ReservationReceipt, ReservationReceipts } from "./reservation-receipts";
import { createReservationRecovery } from "./reservation-recovery";

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
  /** The user named this chat (the URL's `?session=`, or a pick from a list); a restored or remembered one is not named. */
  named?: boolean;
}
export interface ResolvedConversation { selection: ConversationSelection; initial?: ChatInitialLoad }
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
}): Promise<{ contextDir: string; receipt: ReservationReceipt | null }> {
  if (params.sessionId === undefined) return { contextDir: params.contextDir, receipt: null };
  try {
    const receipt = await params.ensureReservation(params.sessionId);
    return { contextDir: receipt?.contextDir ?? params.contextDir, receipt };
  } catch (error) {
    // The id may have become a real chat since the receipt was written. Let
    // bootstrap prove that before turning a recovery transport error into the
    // selected conversation's error state.
    console.warn("Conversation reservation could not be recovered", error);
    return { contextDir: params.contextDir, receipt: null };
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
        return { selection: { kind: "ready", label: "New conversation", target: { kind: "session", sessionId: reserved.sessionId, contextDir } } };
      }
      if (reserved.kind === "unsupported") break;
    }
  }
  const features = await utils.chat.newFeatures.fetch({ contextDir });
  return { selection: { kind: "ready", label: "New conversation", target: {
    kind: "start", clientConversationId: crypto.randomUUID(), contextDir, engine,
    ...(request.model ? { model: request.model } : {}), seedFeatures: features,
  } } };
}
function resolveEmptyBootstrap(input: { params: Parameters<typeof resolveConversation>[0]; contextDir: string;
  receiptProven: boolean }): Promise<ResolvedConversation> | ResolvedConversation {
  if (input.receiptProven) {
    return { selection: { kind: "unavailable", contextDir: input.contextDir, reason: "This conversation has no saved transcript in this box." } };
  }
  return fresh({ ...input.params, contextDir: input.contextDir });
}
function retireUsedReceipt(data: Extract<Bootstrap, { kind: "resumable" }>, receipts: ReservationReceipts | null): void {
  if (data.history.total === 0) return;
  try { receipts?.remove(data.sessionId); }
  catch (error) { console.warn("Conversation reservation receipt could not be removed", error); }
}
export async function resolveConversation(params: { utils: Utils; reserve: Reserve; receipts: ReservationReceipts | null; request: ConversationRequest;
  ensureReservation?: (sessionId: string) => Promise<ReservationReceipt | null> }): Promise<ResolvedConversation> {
  const { utils, request } = params;
  if (request.kind === "restore" && request.target) return { selection: { kind: "ready", target: request.target, label: request.label ?? "New conversation" } };
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
  const provenReceipt = session === undefined ? undefined : params.receipts?.get(session);
  const receiptProven = provenReceipt !== undefined;
  if (provenReceipt !== undefined) contextDir = provenReceipt.contextDir;
  const ensureReservation = params.ensureReservation ?? createReservationRecovery(params.receipts, params.reserve);
  const restored = await restoreBeforeBootstrap({ sessionId: session, contextDir, ensureReservation });
  contextDir = restored.contextDir;
  const data: Bootstrap = await utils.chat.bootstrap.fetch(
    { session, slice: chatTailSlice() },
    { staleTime: 0 },
  );
  if (data.kind === "empty") return resolveEmptyBootstrap({ params, contextDir, receiptProven });
  // Recover a proven empty reservation before replacing an implicitly selected missing chat.
  if (data.kind === "unavailable" && request.named !== true && !receiptProven && data.reason === "missing-local-transcript") return fresh({ ...params, contextDir });
  if (data.kind === "unavailable") return { selection: { kind: "unavailable", contextDir, reason: data.reason === "missing-local-transcript" ? "This conversation has no saved transcript in this box." : `Conversation unavailable: ${data.reason}` } };
  retireUsedReceipt(data, params.receipts);
  const directory = await utils.chat.directoryFor.fetch(
    { sessionId: data.sessionId },
    { staleTime: 0 },
  );
  return { selection: { kind: "ready", label: data.label ?? "Conversation", target: {
    kind: "session", sessionId: data.sessionId, contextDir: directory.contextDir,
  } }, initial: preload(data) };
}
