/**
 * Chat husk renderer — registers the ChatHuskView component for `chat`
 * cards (web chat session husks; docs/plans/chat-husks.md).
 */

import { ChatHuskView } from "../components/chat-husk/ChatHuskView";
import type { RendererEntry } from "../file-type-registry";

export const chatHuskRenderer: RendererEntry = {
  selector: { type: "chat" },
  renderer: { name: "Chat", Component: ChatHuskView, priority: 100 },
};
