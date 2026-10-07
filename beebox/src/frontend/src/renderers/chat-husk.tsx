/**
 * Chat husk renderer — registers the ChatHuskView component for `chat`
 * cards (web chat session husks; docs/plans/chat-husks.md).
 */

import { lazyComponent } from "../lib/lazy-component";
import type { RendererEntry } from "../file-type-registry";

export const chatHuskRenderer: RendererEntry = {
  selector: { type: "chat" },
  renderer: { name: "Chat", Component: lazyComponent(() => import("../components/chat-husk/ChatHuskView"), (m) => m.ChatHuskView), priority: 100 },
};
