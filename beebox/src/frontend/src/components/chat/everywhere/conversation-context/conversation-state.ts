/** Selection metadata belongs to this tab; drafts have their existing box store. */
import { conversationSelectionSchema, type ConversationSelection } from "@shared/chat-composer-binding";
import { readSessionJson, writeSessionJson } from "../../../../lib/session-json";

const WHAT = "Conversation selection";

export function readConversation(storageScope: string): ConversationSelection | null {
  const selection = readSessionJson({ key: `bbx-conversation:${storageScope}`, schema: conversationSelectionSchema.nullable(), fallback: null, what: WHAT });
  return selection?.kind === "ready" ? selection : null;
}
export function saveConversation(storageScope: string, selection: ConversationSelection): void {
  if (selection.kind !== "ready") return;
  writeSessionJson({ key: `bbx-conversation:${storageScope}`, value: selection, what: WHAT });
}
