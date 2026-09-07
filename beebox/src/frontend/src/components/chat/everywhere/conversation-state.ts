/** Selection metadata belongs to this tab; drafts have their existing box store. */
import { conversationSelectionSchema, type ConversationSelection } from "@shared/chat-composer-binding";

export function readConversation(boxSlug: string): ConversationSelection | null {
  if (!("sessionStorage" in globalThis)) return null;
  try {
    const result = conversationSelectionSchema.safeParse(JSON.parse(sessionStorage.getItem(`bbx-conversation:${boxSlug}`) ?? "null"));
    return result.success && result.data.kind === "ready" ? result.data : null;
  } catch (error) {
    console.warn("Conversation selection could not be restored", error);
    return null;
  }
}
export function saveConversation(boxSlug: string, selection: ConversationSelection): void {
  if (selection.kind !== "ready") return;
  try { sessionStorage.setItem(`bbx-conversation:${boxSlug}`, JSON.stringify(selection)); }
  catch (error) { console.warn("Conversation selection could not be saved", error); }
}
