import type { BroadcastEventFn } from "../routes/sse.js";
import type { Services } from "../../services/index.js";
import type { ChatSession } from "../../core/chat-session.js";

export interface TrpcContext {
  boxRoot: string;
  boxSlug: string;
  broadcastEvent: BroadcastEventFn;
  services: Services;
  chatSession: ChatSession;
}
