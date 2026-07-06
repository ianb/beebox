/**
 * Chat husk renderer — registers the ChatHuskView component for `chat`
 * cards (web chat session husks; docs/plans/chat-husks.md).
 */

import { ChatHuskView } from "../components/chat-husk/ChatHuskView";
import { registerFileType } from "./index";

registerFileType({ type: "chat" }, {
  renderer: { name: "Chat", Component: ChatHuskView, priority: 100 },
});
