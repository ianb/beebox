/** Reuse bootstrap/reservation/directory resolution as one shell-owned operation. */
import type { ConversationSelection, ConversationTarget } from "@shared/chat-composer-binding";
import type { trpc, RouterOutput } from "../../../lib/trpc";
import { chatTailSlice, type ChatInitialLoad } from "../../../machines/chat-types";
import type { ChatAgentEngine } from "@shared/chat-models";
import type { ReservationReceipts } from "./reservation-receipts";

type Utils = ReturnType<typeof trpc.useUtils>;
type Bootstrap = RouterOutput["chat"]["bootstrap"];
type ResolvedBootstrap = Exclude<Bootstrap, { kind: "empty" }>;
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
export interface ResolvedConversation { selection: ConversationSelection; initial?: ChatInitialLoad }
type Reserve = (input: { sessionId: string; contextDir: string; engine?: ChatAgentEngine; model?: string }) => Promise<RouterOutput["chat"]["reserveSession"]>;
function preload(data: RouterOutput["chat"]["bootstrap"]): ChatInitialLoad | undefined {
  if (data.kind !== "resumable") return undefined;
  return { status: "loaded", entries: data.history.entries, total: data.history.total,
    sessionId: data.sessionId, running: data.status.running, busy: data.status.busy, pending: data.pending };
}
async function recoverMissingReservation(params: {
  utils: Utils;
  reserve: Reserve;
  receipts: ReservationReceipts | null;
  sessionId: string | undefined;
  data: ResolvedBootstrap;
  contextDir: string;
}): Promise<{ data: ResolvedBootstrap; contextDir: string }> {
  const { data, receipts, sessionId } = params;
  if (data.kind !== "unavailable" || data.reason !== "missing-local-transcript" || sessionId === undefined) {
    return { data, contextDir: params.contextDir };
  }
  const receipt = receipts?.get(sessionId);
  if (receipt === undefined) return { data, contextDir: params.contextDir };
  try {
    const recovered = await params.reserve({ sessionId: receipt.sessionId, contextDir: receipt.contextDir,
      engine: receipt.engine, ...(receipt.model !== undefined ? { model: receipt.model } : {}) });
    if (recovered.kind !== "reserved" && recovered.kind !== "taken") {
      return { data, contextDir: receipt.contextDir };
    }
    const retried = await params.utils.chat.bootstrap.fetch(
      { session: sessionId, slice: chatTailSlice() },
      { staleTime: 0 },
    );
    // A missing explicit id never becomes a newly selected conversation.
    // `empty` after recovery means the server still cannot prove this id.
    return { data: retried.kind === "empty" ? data : retried, contextDir: receipt.contextDir };
  } catch (error) {
    console.warn("Conversation reservation could not be recovered", error);
    return { data, contextDir: receipt.contextDir };
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
export async function resolveConversation(params: { utils: Utils; reserve: Reserve; receipts: ReservationReceipts | null; request: ConversationRequest }): Promise<ResolvedConversation> {
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
  let data: Bootstrap = await utils.chat.bootstrap.fetch({ session, slice: chatTailSlice() });
  if (data.kind === "empty") return fresh({ ...params, contextDir });
  const recovered = await recoverMissingReservation({ ...params, sessionId: session, data, contextDir });
  data = recovered.data;
  contextDir = recovered.contextDir;
  if (data.kind === "unavailable") return { selection: { kind: "unavailable", contextDir, reason: data.reason === "missing-local-transcript" ? "This conversation has no saved transcript in this box." : `Conversation unavailable: ${data.reason}` } };
  if (data.history.total > 0) {
    try { params.receipts?.remove(data.sessionId); }
    catch (error) { console.warn("Conversation reservation receipt could not be removed", error); }
  }
  const directory = await utils.chat.directoryFor.fetch(
    { sessionId: data.sessionId },
    { staleTime: 0 },
  );
  return { selection: { kind: "ready", label: data.label ?? "Conversation", target: {
    kind: "session", sessionId: data.sessionId, contextDir: directory.contextDir,
  } }, initial: preload(data) };
}
