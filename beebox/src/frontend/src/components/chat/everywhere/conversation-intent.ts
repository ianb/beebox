/** Browsing carries focus; explicit session/landmark intent can replace it. */
import { parseChatAgentEngine } from "@shared/chat-models";
import type { ConversationSelection, ConversationTarget } from "@shared/chat-composer-binding";
import type { ConversationRequest } from "./resolve-conversation";

function samePendingStartup(target: ConversationTarget | null, remembered: ConversationSelection | null): boolean {
  return target?.kind === "start" && remembered?.kind === "ready" && remembered.target.kind === "start" && remembered.target.clientConversationId === target.clientConversationId;
}

interface RouteIntentInput {
  first: boolean; chatPage: boolean;
  search: { session?: string; contextDir?: string; engine?: string; model?: string };
  selection: ConversationSelection;
  remembered: ConversationSelection | null;
  cardPath: string | null;
  browseDir: string | null;
}

function explicitChatRequest(input: RouteIntentInput): ConversationRequest | null {
  const { first, search, selection, remembered } = input;
  const target = selection.kind === "ready" ? selection.target : null;
  if (!first && target?.kind === "session" && target.sessionId === search.session) return null;
  if (first && search.session === "new" && samePendingStartup(target, remembered)) return null;
  // The one request that names a chat on the user's behalf: `?session=` in
  // the URL. A remembered or previously-rendered selection is not that.
  return { kind: search.session === "new" ? "new" : "session", sessionId: search.session, named: true,
    contextDir: search.contextDir, engine: parseChatAgentEngine(search.engine ?? "") ?? undefined, model: search.model };
}

export function routeConversationRequest(input: RouteIntentInput): ConversationRequest | null {
  const { first, chatPage, search, selection, remembered, cardPath, browseDir } = input;
  const target = selection.kind === "ready" ? selection.target : null;
  if (chatPage && search.session) return explicitChatRequest(input);
  if (remembered?.kind === "ready" && remembered.target.kind === "session") {
    if (!first && target?.kind === "session" && target.sessionId === remembered.target.sessionId) return null;
    return { kind: "session", sessionId: remembered.target.sessionId, contextDir: remembered.target.contextDir };
  }
  if (remembered?.kind === "ready" && remembered.target.kind === "start") return { kind: "restore", target: remembered.target, label: remembered.label };
  if (!first) return null;
  if (target?.kind === "session") return { kind: "session", sessionId: target.sessionId };
  if (target) return null;
  if (chatPage) return { kind: "default" };
  if (cardPath) return { kind: "card", cardPath };
  return { kind: "landmark", contextDir: browseDir ?? "" };
}

/** Each async resolution owns a ticket; newer intent and unmount invalidate it. */
export function createResolutionGate() {
  let generation = 0;
  return {
    claim: () => ++generation,
    accepts: (ticket: number) => ticket === generation,
    cancel: () => { generation += 1; },
  };
}
