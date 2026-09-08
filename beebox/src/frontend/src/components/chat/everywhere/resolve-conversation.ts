/** Reuse bootstrap/reservation/directory resolution as one shell-owned operation. */
import type { ConversationSelection, ConversationTarget } from "@shared/chat-composer-binding";
import type { trpc, RouterOutput } from "../../../lib/trpc";
import { chatTailSlice, type ChatInitialLoad } from "../../../machines/chat-types";
import type { ChatAgentEngine } from "@shared/chat-models";

type Utils = ReturnType<typeof trpc.useUtils>;
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
async function fresh(params: { utils: Utils; reserve: Reserve; request: ConversationRequest; contextDir: string }): Promise<ResolvedConversation> {
  const { utils, reserve, request, contextDir } = params;
  const status = await utils.chat.status.fetch({});
  const engine = request.engine ?? status.boxEngine;
  if (engine === "claude") {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reserved = await reserve({ sessionId: crypto.randomUUID(), contextDir, engine, model: request.model });
      if (reserved.kind === "reserved") return { selection: { kind: "ready", label: "New conversation", target: { kind: "session", sessionId: reserved.sessionId, contextDir } } };
      if (reserved.kind === "unsupported") break;
    }
  }
  const features = await utils.chat.newFeatures.fetch({ contextDir });
  return { selection: { kind: "ready", label: "New conversation", target: {
    kind: "start", clientConversationId: crypto.randomUUID(), contextDir, engine,
    ...(request.model ? { model: request.model } : {}), seedFeatures: features,
  } } };
}
export async function resolveConversation(params: { utils: Utils; reserve: Reserve; request: ConversationRequest }): Promise<ResolvedConversation> {
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
  const data = await utils.chat.bootstrap.fetch({ session, slice: chatTailSlice() });
  if (data.kind === "empty") return fresh({ ...params, contextDir });
  if (data.kind === "unavailable") {
    // A chat the user did not name — the landmark's latest, a card's, the
    // box default — whose transcript is not on this machine (expired, or run
    // elsewhere) is not an error to show: it is "no conversation to resume",
    // and the shell starts a fresh one, as the chat page always did before
    // this resolver existed (2026-09-08: every box whose last chat had aged
    // out opened to "Conversation unavailable" with nothing to do). The same
    // goes for a chat the shell merely remembered or last rendered. A chat
    // the user named — `?session=` in the URL, a pick from a list — stays an
    // honest dead end: they asked for that one.
    if (request.named !== true && data.reason === "missing-local-transcript") return fresh({ ...params, contextDir });
    return { selection: { kind: "unavailable", contextDir, reason: `Conversation unavailable: ${data.reason}` } };
  }
  const directory = await utils.chat.directoryFor.fetch({ sessionId: data.sessionId });
  return { selection: { kind: "ready", label: data.label ?? "Conversation", target: {
    kind: "session", sessionId: data.sessionId, contextDir: directory.contextDir,
  } }, initial: preload(data) };
}
